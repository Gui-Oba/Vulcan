from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

import psutil
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

try:
    from google import genai
    from google.genai import types
except ImportError:  # pragma: no cover - handled at runtime
    genai = None
    types = None

app = FastAPI()
load_dotenv()

CO2_INTENSITY_G_PER_KWH = 468.0
NETWORK_KWH_PER_GB = float(os.getenv("NETWORK_KWH_PER_GB", "0.06"))
GEOIP_API_URL = os.getenv("GEOIP_API_URL", "https://ipapi.co/{ip}/json/")
GEOIP_API_KEY = os.getenv("GEOIP_API_KEY")
GEOIP_FALLBACK_URLS = [
    item.strip()
    for item in os.getenv("GEOIP_FALLBACK_URLS", "https://ipinfo.io/{ip}/json").split(",")
    if item.strip()
]
CAPTURE_INTERFACES = os.getenv("CAPTURE_INTERFACES") or os.getenv("SNIFFER_INTERFACES")
CAPTURE_METHOD = os.getenv("CAPTURE_METHOD", "tcpdump").lower()
MAX_FLOW_ITEMS = 24

FLOW_LOCK = threading.Lock()
FLOW_TOTALS: Dict[Tuple[str, str, str, str], int] = defaultdict(int)
CONN_LOCK = threading.Lock()
CONN_MAP: Dict[Tuple[str, str, int, str, int], str] = {}
LOCAL_IPS: set[ipaddress._BaseAddress] = set()
CAPTURE_STARTED = False
CAPTURE_LOCK = threading.Lock()
CAPTURE_ERROR: Optional[str] = None
CAPTURE_IFACES: List[str] = []
CAPTURE_MODE: Optional[str] = None
TCPDUMP_PROCESS: Optional[subprocess.Popen[str]] = None
TCPDUMP_THREAD: Optional[threading.Thread] = None
PACKET_COUNT = 0
LOCAL_MATCH_COUNT = 0
IGNORED_COUNT = 0
GEO_LOCK = threading.Lock()
GEO_CACHE: Dict[str, Dict[str, object]] = {}
GEO_INFLIGHT: set[str] = set()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

WATTS_PATTERN = re.compile(r"([0-9]+(?:\.[0-9]+)?)\s*W")
COMPONENT_PATTERNS = [
    r"CPU Power.*?([0-9]+(?:\.[0-9]+)?)\s*W",
    r"GPU Power.*?([0-9]+(?:\.[0-9]+)?)\s*W",
    r"ANE Power.*?([0-9]+(?:\.[0-9]+)?)\s*W",
    r"DRAM Power.*?([0-9]+(?:\.[0-9]+)?)\s*W",
]
CPU_MW_PATTERN = re.compile(r"CPU Power:\s+(\d+)\s*mW")
TEMP_PATTERNS = [
    re.compile(r"CPU die temperature:\s*([0-9]+(?:\.[0-9]+)?)\s*C", re.IGNORECASE),
    re.compile(r"CPU temperature:\s*([0-9]+(?:\.[0-9]+)?)\s*C", re.IGNORECASE),
    re.compile(r"SoC die temperature:\s*([0-9]+(?:\.[0-9]+)?)\s*C", re.IGNORECASE),
    re.compile(r"Die temperature:\s*([0-9]+(?:\.[0-9]+)?)\s*C", re.IGNORECASE),
    re.compile(r"CPU.*temperature.*?([0-9]+(?:\.[0-9]+)?)\s*C", re.IGNORECASE),
]
THERMAL_PRESSURE_PATTERN = re.compile(
    r"Current pressure level:\s*([A-Za-z]+)", re.IGNORECASE
)
PRESSURE_TEMP_MAP = {
    "nominal": 45.0,
    "moderate": 65.0,
    "heavy": 80.0,
    "serious": 85.0,
    "critical": 95.0,
    "urgent": 95.0,
}
VMSTAT_PAGE_SIZE = re.compile(r"page size of (\d+) bytes")
VMSTAT_ENTRY = re.compile(r"^(.+?):\s+(\d+)\.$")
PING_STATS = re.compile(
    r"round-trip.*?= ([0-9.]+)/([0-9.]+)/([0-9.]+)/([0-9.]+) ms"
)
BATTERY_CAPACITY = re.compile(r"\"([A-Za-z]+Capacity)\" = (\d+)")
DEFAULT_IFACE_PATTERN = re.compile(r"interface:\s+(\S+)")
TCPDUMP_LINE = re.compile(
    r"^(?:(?:\d{2}:\d{2}:\d{2}\.\d+)|(?:\d+\.\d+))?\s*(IP6?|IP)\s+(.+?)\s+>\s+(.+?):\s+(.*)$"
)
TCPDUMP_LEN = re.compile(r"\b(?:length|len)\s+(\d+)")


class ExplainRequest(BaseModel):
    system_data: Dict[str, object]
    user_query: str


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(value, max_value))


def normalize_ip(address: str) -> Optional[str]:
    candidate = address.split("%", 1)[0]
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def refresh_local_ips() -> None:
    global LOCAL_IPS
    local_ips: set[ipaddress._BaseAddress] = set()
    for addrs in psutil.net_if_addrs().values():
        for addr in addrs:
            if addr.family == socket.AF_INET:
                normalized = normalize_ip(addr.address)
                if normalized:
                    local_ips.add(ipaddress.ip_address(normalized))
            elif addr.family == socket.AF_INET6:
                normalized = normalize_ip(addr.address)
                if normalized:
                    local_ips.add(ipaddress.ip_address(normalized))
    local_ips.update(
        {ipaddress.ip_address("127.0.0.1"), ipaddress.ip_address("::1")}
    )
    LOCAL_IPS = local_ips


def get_default_interface() -> Optional[str]:
    try:
        result = subprocess.run(
            ["route", "-n", "get", "default"],
            capture_output=True,
            text=True,
            timeout=1.0,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None
    match = DEFAULT_IFACE_PATTERN.search(result.stdout)
    if match:
        return match.group(1)
    return None


def build_conn_map() -> Dict[Tuple[str, str, int, str, int], str]:
    connections: Dict[Tuple[str, str, int, str, int], str] = {}
    for conn in psutil.net_connections(kind="inet"):
        if not conn.laddr or not conn.raddr:
            continue
        proto = "TCP" if conn.type == socket.SOCK_STREAM else "UDP"
        laddr = conn.laddr
        raddr = conn.raddr
        l_ip_raw, l_port = (
            (laddr.ip, laddr.port)
            if hasattr(laddr, "ip")
            else (laddr[0], laddr[1])
        )
        r_ip_raw, r_port = (
            (raddr.ip, raddr.port)
            if hasattr(raddr, "ip")
            else (raddr[0], raddr[1])
        )
        l_ip = normalize_ip(l_ip_raw)
        r_ip = normalize_ip(r_ip_raw)
        if not l_ip or not r_ip:
            continue
        name = "Unknown"
        if conn.pid:
            try:
                name = psutil.Process(conn.pid).name()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                name = "Unknown"
        connections[(proto, l_ip, l_port, r_ip, r_port)] = name
    return connections


def split_ip_port(hostport: str) -> Tuple[Optional[str], int]:
    if not hostport:
        return None, 0
    trimmed = hostport.strip().rstrip(":")
    if trimmed.count(".") == 0:
        return normalize_ip(trimmed), 0
    base, port_str = trimmed.rsplit(".", 1)
    if port_str.isdigit():
        return normalize_ip(base), int(port_str)
    return normalize_ip(trimmed), 0


def refresh_conn_map_loop() -> None:
    while True:
        try:
            refresh_local_ips()
            new_map = build_conn_map()
            with CONN_LOCK:
                CONN_MAP.clear()
                CONN_MAP.update(new_map)
        except Exception:
            pass
        time.sleep(5)


def resolve_process_name(
    proto: str, l_ip: str, l_port: int, r_ip: str, r_port: int
) -> str:
    with CONN_LOCK:
        return CONN_MAP.get((proto, l_ip, l_port, r_ip, r_port), "Unknown")


def handle_tcpdump_line(line: str) -> None:
    global PACKET_COUNT, LOCAL_MATCH_COUNT, IGNORED_COUNT
    match = TCPDUMP_LINE.match(line.strip())
    if not match:
        return

    src_hostport = match.group(2)
    dst_hostport = match.group(3)
    remainder = match.group(4)

    src_ip, src_port = split_ip_port(src_hostport)
    dst_ip, dst_port = split_ip_port(dst_hostport)
    if not src_ip or not dst_ip:
        return

    src_ip_obj = ipaddress.ip_address(src_ip)
    dst_ip_obj = ipaddress.ip_address(dst_ip)

    local_ips = LOCAL_IPS
    PACKET_COUNT += 1
    if src_ip_obj in local_ips and dst_ip_obj not in local_ips:
        direction = "outbound"
        remote_ip = dst_ip
        local_ip = src_ip
        local_port = src_port
        remote_port = dst_port
    elif dst_ip_obj in local_ips and src_ip_obj not in local_ips:
        direction = "inbound"
        remote_ip = src_ip
        local_ip = dst_ip
        local_port = dst_port
        remote_port = src_port
    else:
        IGNORED_COUNT += 1
        return
    LOCAL_MATCH_COUNT += 1

    protocol = "TCP"
    upper = remainder.upper()
    if "UDP" in upper:
        protocol = "UDP"
    elif "ICMP" in upper:
        protocol = "ICMP"

    length_match = TCPDUMP_LEN.search(remainder)
    packet_len = int(length_match.group(1)) if length_match else 0
    if packet_len <= 0:
        return

    app = resolve_process_name(protocol, local_ip, local_port, remote_ip, remote_port)

    with FLOW_LOCK:
        FLOW_TOTALS[(direction, remote_ip, protocol, app)] += packet_len


def start_tcpdump(interfaces: Optional[List[str]]) -> bool:
    global TCPDUMP_PROCESS, TCPDUMP_THREAD, CAPTURE_ERROR, CAPTURE_MODE
    if shutil.which("tcpdump") is None:
        CAPTURE_ERROR = "tcpdump-not-installed"
        return False
    iface = interfaces[0] if interfaces else "any"
    if iface == "any":
        CAPTURE_ERROR = "tcpdump-no-interface"
        return False

    cmd = ["tcpdump", "-nn", "-l", "-q", "-tt", "-i", iface, "ip or ip6"]
    try:
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
    except Exception:
        CAPTURE_ERROR = "tcpdump-start-failed"
        return False

    TCPDUMP_PROCESS = process
    CAPTURE_MODE = "tcpdump"

    def read_stdout() -> None:
        if process.stdout is None:
            return
        for line in process.stdout:
            handle_tcpdump_line(line)

    def read_stderr() -> None:
        global CAPTURE_ERROR
        if process.stderr is None:
            return
        for line in process.stderr:
            cleaned = line.strip()
            if cleaned and CAPTURE_ERROR is None:
                CAPTURE_ERROR = cleaned

    TCPDUMP_THREAD = threading.Thread(target=read_stdout, daemon=True)
    TCPDUMP_THREAD.start()
    threading.Thread(target=read_stderr, daemon=True).start()
    CAPTURE_ERROR = None
    return True


def ensure_capture_started() -> None:
    global CAPTURE_STARTED, CAPTURE_ERROR
    if CAPTURE_STARTED:
        return
    with CAPTURE_LOCK:
        if CAPTURE_STARTED:
            return
        refresh_local_ips()
        interfaces = []
        if CAPTURE_INTERFACES:
            interfaces = [
                item.strip()
                for item in CAPTURE_INTERFACES.split(",")
                if item.strip()
            ]
        else:
            default_iface = get_default_interface()
            if default_iface:
                interfaces = [default_iface]
            else:
                for name, stats in psutil.net_if_stats().items():
                    if not stats.isup:
                        continue
                    if name.startswith("lo"):
                        continue
                    interfaces.append(name)
        if not interfaces:
            interfaces = None

        if CAPTURE_METHOD != "tcpdump":
            CAPTURE_ERROR = "capture-disabled"
            CAPTURE_STARTED = True
            return

        if start_tcpdump(interfaces):
            CAPTURE_IFACES[:] = interfaces or []
            threading.Thread(target=refresh_conn_map_loop, daemon=True).start()
        else:
            CAPTURE_ERROR = CAPTURE_ERROR or "tcpdump-start-failed"
        CAPTURE_STARTED = True


def is_public_ip(ip: str) -> bool:
    try:
        address = ipaddress.ip_address(ip)
        return not (
            address.is_private
            or address.is_loopback
            or address.is_multicast
            or address.is_reserved
            or address.is_link_local
        )
    except ValueError:
        return False


def fetch_geo(ip: str) -> None:
    if not is_public_ip(ip):
        with GEO_LOCK:
            GEO_INFLIGHT.discard(ip)
        return

    def parse_loc(value: object) -> Tuple[Optional[float], Optional[float]]:
        if not isinstance(value, str):
            return None, None
        parts = [part.strip() for part in value.split(",")]
        if len(parts) != 2:
            return None, None
        try:
            return float(parts[0]), float(parts[1])
        except ValueError:
            return None, None

    def parse_geo_payload(data: Dict[str, object]) -> Optional[Dict[str, object]]:
        if not data:
            return None
        lat = data.get("latitude") or data.get("lat")
        lon = data.get("longitude") or data.get("lon")
        if lat is None or lon is None:
            loc = data.get("loc") or data.get("location")
            lat, lon = parse_loc(loc)
        if lat is None or lon is None:
            return None
        country = data.get("country_name") or data.get("country") or data.get("countryCode")
        country_code = data.get("country_code") or data.get("countryCode") or data.get("country")
        city = data.get("city")
        return {
            "lat": float(lat),
            "lon": float(lon),
            "country": country,
            "country_code": country_code,
            "city": city,
        }

    def request_geo(url: str) -> Dict[str, object]:
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (OpVisualizer)",
                "Accept": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=2.5) as response:
            payload = response.read().decode("utf-8")
            return json.loads(payload)

    api_key = GEOIP_API_KEY or ""
    encoded_ip = urllib.parse.quote(ip)
    urls = [GEOIP_API_URL] + GEOIP_FALLBACK_URLS
    for template in urls:
        try:
            url = template.format(ip=encoded_ip, api_key=api_key)
        except Exception:
            continue
        try:
            data = request_geo(url)
        except Exception:
            data = {}
        geo = parse_geo_payload(data)
        if geo:
            with GEO_LOCK:
                GEO_CACHE[ip] = geo
                GEO_INFLIGHT.discard(ip)
            return

    with GEO_LOCK:
        GEO_INFLIGHT.discard(ip)


def enqueue_geo_lookup(ip: str) -> None:
    with GEO_LOCK:
        if ip in GEO_CACHE or ip in GEO_INFLIGHT:
            return
        GEO_INFLIGHT.add(ip)
    threading.Thread(target=fetch_geo, args=(ip,), daemon=True).start()


def get_geo(ip: str) -> Optional[Dict[str, object]]:
    with GEO_LOCK:
        return GEO_CACHE.get(ip)


def get_capture_status() -> Dict[str, object]:
    with FLOW_LOCK:
        flow_count = len(FLOW_TOTALS)
    with GEO_LOCK:
        geo_cached = len(GEO_CACHE)
        geo_inflight = len(GEO_INFLIGHT)

    sniffer_running = False
    if TCPDUMP_PROCESS is not None:
        sniffer_running = TCPDUMP_PROCESS.poll() is None
    capture_available = shutil.which("tcpdump") is not None
    return {
        "scapy_available": False,
        "capture_available": capture_available,
        "sniffer_running": sniffer_running,
        "sniffer_error": CAPTURE_ERROR,
        "sniffer_mode": CAPTURE_MODE,
        "capture_method": CAPTURE_METHOD,
        "flow_keys": flow_count,
        "geo_cached": geo_cached,
        "geo_inflight": geo_inflight,
        "local_ip_count": len(LOCAL_IPS),
        "ifaces": list(CAPTURE_IFACES),
        "packet_count": PACKET_COUNT,
        "local_match_count": LOCAL_MATCH_COUNT,
        "ignored_count": IGNORED_COUNT,
    }


def _parse_watts(text: str) -> Optional[float]:
    direct_patterns = [
        r"Combined Power.*?([0-9]+(?:\.[0-9]+)?)\s*W",
        r"System Power.*?([0-9]+(?:\.[0-9]+)?)\s*W",
        r"Package Power.*?([0-9]+(?:\.[0-9]+)?)\s*W",
    ]
    for pattern in direct_patterns:
        direct_match = re.search(pattern, text)
        if direct_match:
            return float(direct_match.group(1))

    components = []
    for pattern in COMPONENT_PATTERNS:
        match = re.search(pattern, text)
        if match:
            components.append(float(match.group(1)))
    if components:
        return sum(components)

    any_match = WATTS_PATTERN.search(text)
    if any_match:
        return float(any_match.group(1))

    return None


def read_wattage() -> Tuple[Optional[float], Optional[str]]:
    realtime_power = get_realtime_power()
    if realtime_power is not None:
        return realtime_power, "powermetrics"

    commands = [
        (["powermetrics", "--samplers", "cpu_power", "-n", "1", "-i", "1000"], "powermetrics"),
        (
            ["powermetrics", "--samplers", "cpu_power,thermal", "-n", "1", "-i", "1000"],
            "powermetrics",
        ),
        (["powermetrics", "--samplers", "smc", "-n", "1", "-i", "1000"], "powermetrics"),
        (["powermetrics", "-n", "1", "-i", "1000"], "powermetrics"),
        (["pmset", "-g", "batt"], "pmset"),
    ]

    for cmd, source in commands:
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1.5,
            )
        except Exception:
            continue

        if result.returncode != 0:
            continue

        watts = _parse_watts(result.stdout)
        if watts is not None:
            return watts, source

        if source == "pmset":
            return None, source

    return None, None


def get_realtime_power() -> Optional[float]:
    cmd = ["powermetrics", "-n", "1", "-i", "1", "--samplers", "cpu_power"]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=1.5,
        )
    except Exception:
        return None

    if result.returncode != 0:
        return None

    match = CPU_MW_PATTERN.search(result.stdout)
    if not match:
        return None

    return float(match.group(1)) / 1000


def _parse_temperature(text: str) -> Optional[float]:
    for pattern in TEMP_PATTERNS:
        match = pattern.search(text)
        if match:
            return float(match.group(1))
    return None


def _parse_pressure_level(text: str) -> Optional[str]:
    match = THERMAL_PRESSURE_PATTERN.search(text)
    if match:
        return match.group(1).strip()
    return None


def estimate_cpu_temperature(pressure_level: Optional[str], cpu_total: float) -> float:
    base = PRESSURE_TEMP_MAP.get((pressure_level or "nominal").lower(), 45.0)
    cpu_factor = clamp(cpu_total, 0.0, 100.0) / 100.0
    return clamp(base + cpu_factor * 20.0, 30.0, 100.0)


def read_thermal_status() -> Dict[str, Optional[object]]:
    commands = [
        (["powermetrics", "--samplers", "thermal", "-n", "1", "-i", "1000"], "powermetrics"),
        (["powermetrics", "--samplers", "thermal", "-n", "1", "-i", "1"], "powermetrics"),
        (["powermetrics", "--samplers", "smc", "-n", "1", "-i", "1000"], "powermetrics"),
        (["powermetrics", "-n", "1", "-i", "1000"], "powermetrics"),
    ]

    for cmd, source in commands:
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=1.5,
            )
        except Exception:
            continue

        if result.returncode != 0:
            continue

        temp = _parse_temperature(result.stdout)
        pressure = _parse_pressure_level(result.stdout)
        if temp is not None:
            return {
                "cpu_temp_c": temp,
                "pressure_level": pressure,
                "source": source,
                "is_estimated": False,
            }
        if pressure:
            estimated = PRESSURE_TEMP_MAP.get(pressure.lower())
            return {
                "cpu_temp_c": estimated,
                "pressure_level": pressure,
                "source": source,
                "is_estimated": True,
            }

    return {
        "cpu_temp_c": None,
        "pressure_level": None,
        "source": None,
        "is_estimated": False,
    }


def read_vm_stat() -> Dict[str, int]:
    try:
        result = subprocess.run(
            ["vm_stat"],
            capture_output=True,
            text=True,
            timeout=1.0,
        )
    except Exception:
        return {}

    if result.returncode != 0:
        return {}

    stats: Dict[str, int] = {}
    page_size = 4096
    for line in result.stdout.splitlines():
        size_match = VMSTAT_PAGE_SIZE.search(line)
        if size_match:
            page_size = int(size_match.group(1))
            continue
        entry_match = VMSTAT_ENTRY.match(line.strip())
        if entry_match:
            stats[entry_match.group(1)] = int(entry_match.group(2))
    stats["page_size"] = page_size
    return stats


def calculate_vm_memory(stats: Dict[str, int]) -> Tuple[Optional[int], Optional[int]]:
    if not stats:
        return None, None
    page_size = stats.get("page_size")
    if not page_size:
        return None, None

    free_pages = stats.get("Pages free", 0)
    speculative = stats.get("Pages speculative", 0)
    active = stats.get("Pages active", 0)
    inactive = stats.get("Pages inactive", 0)
    wired = stats.get("Pages wired down", 0)
    compressed = stats.get("Pages occupied by compressor", 0)

    used_pages = active + inactive + wired + compressed
    total_pages = used_pages + free_pages + speculative
    if total_pages <= 0:
        return None, None

    return used_pages * page_size, total_pages * page_size


def read_battery_health() -> Tuple[Optional[float], Optional[int], Optional[int]]:
    try:
        result = subprocess.run(
            ["ioreg", "-r", "-c", "AppleSmartBattery"],
            capture_output=True,
            text=True,
            timeout=1.5,
        )
    except Exception:
        return None, None, None

    if result.returncode != 0:
        return None, None, None

    caps: Dict[str, int] = {}
    for match in BATTERY_CAPACITY.finditer(result.stdout):
        caps[match.group(1)] = int(match.group(2))

    max_capacity = (
        caps.get("AppleRawMaxCapacity")
        or caps.get("MaxCapacity")
        or caps.get("NominalChargeCapacity")
        or caps.get("FullChargeCapacity")
    )
    design = caps.get("DesignCapacity")
    if not max_capacity or not design:
        return None, max_capacity, design

    health = (max_capacity / design) * 100
    return health, max_capacity, design


def read_latency() -> Tuple[Optional[float], Optional[float]]:
    try:
        result = subprocess.run(
            ["ping", "-c", "3", "-q", "8.8.8.8"],
            capture_output=True,
            text=True,
            timeout=3.5,
        )
    except Exception:
        return None, None

    if result.returncode != 0:
        return None, None

    match = PING_STATS.search(result.stdout)
    if not match:
        return None, None

    avg = float(match.group(2))
    jitter = float(match.group(4))
    return avg, jitter


def read_top_processes(limit: int = 5) -> List[Dict[str, float]]:
    processes = []
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            cpu_percent = proc.cpu_percent(interval=None)
            processes.append(
                {
                    "pid": proc.info["pid"],
                    "name": proc.info.get("name") or "unknown",
                    "cpu_percent": cpu_percent,
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    processes.sort(key=lambda item: item["cpu_percent"], reverse=True)
    return processes[:limit]


def _battery_status(health: Optional[float]) -> str:
    if health is None:
        return "unknown"
    if health >= 90:
        return "excellent"
    if health >= 80:
        return "good"
    if health >= 70:
        return "fair"
    return "poor"


def summarize_system_data(system_data: Dict[str, object]) -> Dict[str, object]:
    cpu = system_data.get("cpu", {}) if isinstance(system_data, dict) else {}
    memory = system_data.get("memory", {}) if isinstance(system_data, dict) else {}
    disk = system_data.get("disk", {}) if isinstance(system_data, dict) else {}
    network = system_data.get("network", {}) if isinstance(system_data, dict) else {}
    energy = system_data.get("energy", {}) if isinstance(system_data, dict) else {}
    thermal = system_data.get("thermal", {}) if isinstance(system_data, dict) else {}
    battery = system_data.get("battery", {}) if isinstance(system_data, dict) else {}
    processes = system_data.get("processes", []) if isinstance(system_data, dict) else []

    per_core = cpu.get("per_core", []) if isinstance(cpu, dict) else []
    top_processes = []
    if isinstance(processes, list):
        for proc in processes[:5]:
            if isinstance(proc, dict):
                top_processes.append(
                    {
                        "name": proc.get("name"),
                        "pid": proc.get("pid"),
                        "cpu_percent": proc.get("cpu_percent"),
                    }
                )

    health = battery.get("health_percent") if isinstance(battery, dict) else None
    return {
        "cpu": {
            "total_percent": cpu.get("total"),
            "per_core_percent": per_core,
        },
        "memory": {
            "pressure_percent": memory.get("pressure"),
            "used_bytes": memory.get("used"),
            "total_bytes": memory.get("total"),
            "swap_percent": memory.get("swap_percent"),
            "swap_used_bytes": memory.get("swap_used"),
            "swap_total_bytes": memory.get("swap_total"),
        },
        "disk": {
            "read_mb_s": disk.get("read_mb_s"),
            "write_mb_s": disk.get("write_mb_s"),
            "read_iops": disk.get("read_iops"),
            "write_iops": disk.get("write_iops"),
        },
        "network": {
            "upload_mb_s": network.get("upload_mb_s"),
            "download_mb_s": network.get("download_mb_s"),
            "latency_ms": network.get("latency_ms"),
            "jitter_ms": network.get("jitter_ms"),
        },
        "energy": {
            "wattage": energy.get("wattage"),
            "source": energy.get("source"),
        },
        "thermal": {
            "cpu_temp_c": thermal.get("cpu_temp_c"),
            "pressure_level": thermal.get("pressure_level"),
            "source": thermal.get("source"),
            "is_estimated": thermal.get("is_estimated"),
        },
        "battery": {
            "health_percent": health,
            "health_status": _battery_status(health),
            "current_capacity": battery.get("current_capacity"),
            "design_capacity": battery.get("design_capacity"),
        },
        "top_processes": top_processes,
    }


def build_system_prompt(system_data: Dict[str, object]) -> str:
    summary = summarize_system_data(system_data)
    data_blob = json.dumps(summary, ensure_ascii=True)
    return (
        "You are a macOS performance expert. Use the real-time hardware snapshot "
        "to explain what is happening on the user's computer in simple terms. "
        "Be decisive and specific. If key data is missing, say what is missing and "
        "provide a concrete way to verify it. "
        "You can reference: CPU per-core and total load, memory pressure + swap, "
        "disk throughput/IOPS, network upload/download, latency/jitter, energy "
        "wattage, thermal temperature/pressure (estimated if flagged), battery health, "
        "top_processes, live flow destinations (world map), Sankey flows, and CO2e. "
        "If a graph shows high CPU, identify the most likely process from the "
        "top_processes list. If the question is about battery health, use "
        "health_percent and current_capacity/design_capacity to explain why it may "
        "be low and what the status implies. "
        "Format: 1 short paragraph, then 3 bullet next steps. "
        "Keep the entire response under 120 words and end with a complete sentence. "
        f"Hardware snapshot: {data_blob}."
    )


def extract_response_text(response: object) -> str:
    text = getattr(response, "text", None)
    if text:
        return text

    candidates = getattr(response, "candidates", None) or []
    collected: List[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        parts = getattr(content, "parts", None) or []
        for part in parts:
            part_text = getattr(part, "text", None)
            if part_text:
                collected.append(part_text)
        if collected:
            break
    if collected:
        return "\n".join(collected)
    return ""


def generate_explanation(system_data: Dict[str, object], user_query: str) -> str:
    if genai is None or types is None:
        raise RuntimeError("google-genai is not installed")

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")

    model_name = os.getenv("GEMINI_MODEL", "models/gemini-3-flash-preview")
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model_name,
        contents=user_query,
        config=types.GenerateContentConfig(
            system_instruction=build_system_prompt(system_data),
            temperature=0.3,
            max_output_tokens=120000,
            response_mime_type="text/plain",
        ),
    )
    text = extract_response_text(response)
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    return text


@app.post("/api/explain")
async def explain(request: ExplainRequest) -> Dict[str, str]:
    try:
        answer = await asyncio.to_thread(
            generate_explanation, request.system_data, request.user_query
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - runtime safety
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {"answer": answer}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()

    ensure_capture_started()

    psutil.cpu_percent(interval=None, percpu=True)
    for proc in psutil.process_iter(["pid"]):
        try:
            proc.cpu_percent(interval=None)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    last_net = psutil.net_io_counters()
    last_disk = psutil.disk_io_counters()
    last_time = time.monotonic()
    last_flow_totals: Dict[Tuple[str, str, str, str], int] = {}
    energy_task: Optional[asyncio.Task[Tuple[Optional[float], Optional[str]]]] = None
    last_energy = {"wattage": None, "source": None}
    last_energy_time = 0.0
    energy_interval = 5.0
    total_energy_kwh = 0.0
    total_network_bytes = 0.0
    thermal_task: Optional[asyncio.Task[Dict[str, Optional[object]]]] = None
    last_thermal = {
        "cpu_temp_c": None,
        "pressure_level": None,
        "source": None,
        "is_estimated": False,
    }
    last_thermal_time = 0.0
    thermal_interval = 5.0
    memory_task: Optional[asyncio.Task[Dict[str, int]]] = None
    last_vm_stat: Dict[str, int] = {}
    last_vm_time = 0.0
    memory_interval = 1.0
    battery_task: Optional[asyncio.Task[Tuple[Optional[float], Optional[int], Optional[int]]]] = None
    last_battery = {"health": None, "current": None, "design": None}
    last_battery_time = 0.0
    battery_interval = 60.0
    latency_task: Optional[asyncio.Task[Tuple[Optional[float], Optional[float]]]] = None
    last_latency = {"avg": None, "jitter": None}
    last_latency_time = 0.0
    latency_interval = 10.0
    process_task: Optional[asyncio.Task[List[Dict[str, float]]]] = None
    last_processes: List[Dict[str, float]] = []
    last_process_time = 0.0
    process_interval = 2.0

    try:
        while True:
            await asyncio.sleep(1)

            now = time.monotonic()
            elapsed = max(now - last_time, 1e-6)

            cpu_per_core = psutil.cpu_percent(interval=None, percpu=True)
            cpu_total = sum(cpu_per_core) / len(cpu_per_core) if cpu_per_core else 0.0

            mem = psutil.virtual_memory()
            swap = psutil.swap_memory()
            net = psutil.net_io_counters()
            disk = psutil.disk_io_counters()

            upload_mb_s = (net.bytes_sent - last_net.bytes_sent) / elapsed / 1024 / 1024
            download_mb_s = (net.bytes_recv - last_net.bytes_recv) / elapsed / 1024 / 1024
            delta_network_bytes = (
                (net.bytes_sent - last_net.bytes_sent)
                + (net.bytes_recv - last_net.bytes_recv)
            )
            if delta_network_bytes > 0:
                total_network_bytes += delta_network_bytes

            with FLOW_LOCK:
                current_flow_totals = dict(FLOW_TOTALS)

            flow_deltas: Dict[Tuple[str, str, str, str], int] = {}
            for key, total in current_flow_totals.items():
                prev = last_flow_totals.get(key, 0)
                diff = total - prev
                if diff > 0:
                    flow_deltas[key] = diff
            last_flow_totals = current_flow_totals

            flow_items = []
            if flow_deltas:
                for (direction, ip, protocol, app), byte_count in flow_deltas.items():
                    enqueue_geo_lookup(ip)
                    geo = get_geo(ip)
                    flow_items.append(
                        {
                            "direction": direction,
                            "ip": ip,
                            "protocol": protocol,
                            "app": app,
                            "bytes": byte_count,
                            "mb_s": byte_count / elapsed / 1024 / 1024,
                            "country": geo.get("country") if geo else None,
                            "country_code": geo.get("country_code") if geo else None,
                            "city": geo.get("city") if geo else None,
                            "lat": geo.get("lat") if geo else None,
                            "lon": geo.get("lon") if geo else None,
                        }
                    )

                flow_items.sort(key=lambda item: item["bytes"], reverse=True)
                flow_items = flow_items[:MAX_FLOW_ITEMS]

            read_mb_s = (disk.read_bytes - last_disk.read_bytes) / elapsed / 1024 / 1024
            write_mb_s = (disk.write_bytes - last_disk.write_bytes) / elapsed / 1024 / 1024
            read_iops = (disk.read_count - last_disk.read_count) / elapsed
            write_iops = (disk.write_count - last_disk.write_count) / elapsed

            if memory_task is not None and memory_task.done():
                try:
                    last_vm_stat = memory_task.result()
                except Exception:
                    last_vm_stat = {}
                last_vm_time = now
                memory_task = None

            if memory_task is None and now - last_vm_time >= memory_interval:
                memory_task = asyncio.create_task(asyncio.to_thread(read_vm_stat))

            if energy_task is not None and energy_task.done():
                try:
                    wattage, energy_source = energy_task.result()
                except Exception:
                    wattage, energy_source = None, None
                last_energy = {"wattage": wattage, "source": energy_source}
                last_energy_time = now
                energy_task = None

            if energy_task is None and now - last_energy_time >= energy_interval:
                energy_task = asyncio.create_task(asyncio.to_thread(read_wattage))

            if thermal_task is not None and thermal_task.done():
                try:
                    last_thermal = thermal_task.result()
                except Exception:
                    last_thermal = {
                        "cpu_temp_c": None,
                        "pressure_level": None,
                        "source": None,
                        "is_estimated": False,
                    }
                last_thermal_time = now
                thermal_task = None

            if thermal_task is None and now - last_thermal_time >= thermal_interval:
                thermal_task = asyncio.create_task(
                    asyncio.to_thread(read_thermal_status)
                )

            cpu_temp_c = last_thermal["cpu_temp_c"]
            if last_thermal["is_estimated"]:
                cpu_temp_c = estimate_cpu_temperature(
                    last_thermal["pressure_level"], cpu_total
                )

            wattage_now = last_energy.get("wattage") or 0.0
            total_energy_kwh += (wattage_now * elapsed) / 3_600_000
            network_gb = total_network_bytes / (1024**3)
            network_energy_kwh = network_gb * NETWORK_KWH_PER_GB
            device_co2e_g = total_energy_kwh * CO2_INTENSITY_G_PER_KWH
            network_co2e_g = network_energy_kwh * CO2_INTENSITY_G_PER_KWH
            total_co2e_g = device_co2e_g + network_co2e_g

            if battery_task is not None and battery_task.done():
                try:
                    health, current, design = battery_task.result()
                except Exception:
                    health, current, design = None, None, None
                last_battery = {"health": health, "current": current, "design": design}
                last_battery_time = now
                battery_task = None

            if battery_task is None and now - last_battery_time >= battery_interval:
                battery_task = asyncio.create_task(asyncio.to_thread(read_battery_health))

            if latency_task is not None and latency_task.done():
                try:
                    avg, jitter = latency_task.result()
                except Exception:
                    avg, jitter = None, None
                last_latency = {"avg": avg, "jitter": jitter}
                last_latency_time = now
                latency_task = None

            if latency_task is None and now - last_latency_time >= latency_interval:
                latency_task = asyncio.create_task(asyncio.to_thread(read_latency))

            if process_task is not None and process_task.done():
                try:
                    last_processes = process_task.result()
                except Exception:
                    last_processes = []
                last_process_time = now
                process_task = None

            if process_task is None and now - last_process_time >= process_interval:
                process_task = asyncio.create_task(asyncio.to_thread(read_top_processes))

            memory_pressure = mem.percent
            vm_used, vm_total = calculate_vm_memory(last_vm_stat)
            memory_used = vm_used if vm_used is not None else mem.used
            memory_total = vm_total if vm_total is not None else mem.total
            payload = {
                "timestamp": time.time(),
                "cpu": {
                    "per_core": cpu_per_core,
                    "total": cpu_total,
                },
                "memory": {
                    "used": memory_used,
                    "total": memory_total,
                    "pressure": memory_pressure,
                    "pressure_source": "psutil",
                    "swap_used": swap.used,
                    "swap_total": swap.total,
                    "swap_percent": swap.percent,
                },
                "disk": {
                    "read_bytes": disk.read_bytes,
                    "write_bytes": disk.write_bytes,
                    "read_mb_s": read_mb_s,
                    "write_mb_s": write_mb_s,
                    "read_iops": read_iops,
                    "write_iops": write_iops,
                },
                "network": {
                    "bytes_sent": net.bytes_sent,
                    "bytes_recv": net.bytes_recv,
                    "upload_mb_s": upload_mb_s,
                    "download_mb_s": download_mb_s,
                    "latency_ms": last_latency["avg"],
                    "jitter_ms": last_latency["jitter"],
                },
                "network_flows": flow_items,
                "network_capture": get_capture_status(),
                "energy": {
                    "wattage": last_energy["wattage"],
                    "source": last_energy["source"],
                },
                "thermal": {
                    "cpu_temp_c": cpu_temp_c,
                    "pressure_level": last_thermal["pressure_level"],
                    "source": last_thermal["source"],
                    "is_estimated": last_thermal["is_estimated"],
                },
                "sustainability": {
                    "energy_kwh": total_energy_kwh,
                    "co2e_g": total_co2e_g,
                    "intensity_g_per_kwh": CO2_INTENSITY_G_PER_KWH,
                    "device_co2e_g": device_co2e_g,
                    "network": {
                        "bytes": total_network_bytes,
                        "gb": network_gb,
                        "energy_kwh": network_energy_kwh,
                        "co2e_g": network_co2e_g,
                        "kwh_per_gb": NETWORK_KWH_PER_GB,
                    },
                },
                "battery": {
                    "health_percent": last_battery["health"],
                    "current_capacity": last_battery["current"],
                    "design_capacity": last_battery["design"],
                },
                "processes": last_processes,
            }

            await websocket.send_json(payload)

            last_net = net
            last_disk = disk
            last_time = now
    except WebSocketDisconnect:
        return
