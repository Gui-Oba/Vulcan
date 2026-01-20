# Vulcan

A real-time macOS system monitor with a FastAPI websocket backend and a React + Vite frontend. The dashboard focuses on live system telemetry (CPU, memory, disk, network, energy) and visualizes it with charts, a digital twin, and a world traffic map.

## Architecture

- Backend: `backend/main.py` (FastAPI + psutil + subprocess)
  - WebSocket: `ws://localhost:8000/ws` streams a JSON payload every 1s.
  - REST: `POST /api/explain` for the Gemini explainer.
- Frontend: `frontend/src/App.jsx` (React + Tailwind + Recharts + react-simple-maps).

## Data Sources By Section

This section explains where each panel's data comes from and how it is calculated.

### CPU Activity + System Heatmap

- Source: `psutil.cpu_percent(interval=None, percpu=True)`.
- Calculation:
  - Per-core data is displayed directly.
  - Average CPU = mean of per-core percentages.
- Heatmap: uses per-core percentages to color each tile.

### Digital Twin (Temperature Glow)

- Source: `powermetrics` (thermal sampler) via subprocess.
- If a real temperature is present, it is used directly.
- If only thermal pressure is available, a temperature is estimated with a pressure-to-temp mapping and scaled by CPU load.
- UI: the three.js model emissive color tracks temperature.

### Network Throughput

- Source: `psutil.net_io_counters()`.
- Calculation:
  - Upload MB/s = (bytes_sent delta) / elapsed / 1024 / 1024.
  - Download MB/s = (bytes_recv delta) / elapsed / 1024 / 1024.

### Latency + Jitter

- Source: `ping -c 3 -q 8.8.8.8`.
- Calculation:
  - Avg latency = ping average.
  - Jitter = ping stddev (from the round-trip stats line).

### Live World Map (Traffic Geolocation)

- Packet capture source: `tcpdump -nn -l -q -tt -i <iface> "ip or ip6"`.
- Flow extraction:
  - Parses source/destination IPs and packet length.
  - Direction is determined by local IPs vs public IPs.
  - Per-second flow deltas are accumulated and sent to the frontend.
- Process attribution:
  - Uses `psutil.net_connections(kind="inet")` to map flows to process names.
- Geolocation:
  - Default API: `https://ipapi.co/{ip}/json/`.
  - Fallback: `https://ipinfo.io/{ip}/json`.
  - Coordinates are cached in memory.
- UI: map arcs are drawn from a fixed origin (Montreal) to destination coordinates.

### Energy Impact

- Source: `powermetrics` cpu_power sampler (or pmset as fallback).
- Uses `powermetrics -n 1 -i 1 --samplers cpu_power` for a quick snapshot.
- The gauge color is mapped to wattage thresholds (low/moderate/high).

### Carbon Footprint

- Uses energy and network usage to estimate CO2e.
- Device energy:
  - Integrates wattage over time to kWh.
  - CO2e = energy_kwh * 468 g CO2e/kWh (default intensity).
- Network energy:
  - Network bytes -> GB -> kWh using `NETWORK_KWH_PER_GB` (default 0.06).
  - CO2e = network_kwh * 468 g CO2e/kWh.

### Data Flow Sankey

- Source: same flow data as the world map.
- Aggregation:
  - Outbound flows only.
  - App -> Protocol -> Country with MB/s weights.

### Memory & Disk

- Memory used/total:
  - Source: `vm_stat` for page counts; converted using page size.
- Memory pressure:
  - Source: `psutil.virtual_memory().percent`.
- Swap usage:
  - Source: `psutil.swap_memory()`.
- Disk throughput and IOPS:
  - Source: `psutil.disk_io_counters()`
  - MB/s from byte deltas; IOPS from read/write count deltas.

### Resource Hogs

- Source: `psutil.process_iter()` with `cpu_percent`.
- Shows the top 5 processes by CPU usage.

### Snapshot

- Uses the latest CPU average, network rates, and memory used from the same metrics payload.

### Gemini Explainer

- API: `POST /api/explain`.
- Uses `google-genai` with a system prompt that includes a summarized snapshot of the live data.
- Section chats prepend `[Section: <name>]` to focus the explanation.

## Sampling Cadence

- WebSocket payload: every 1 second.
- Energy/thermal sampling: every 5 seconds.
- Battery health: every 60 seconds.
- Latency/jitter: every 10 seconds.
- Top processes: every 2 seconds.

## Environment Variables

Backend `.env` (optional):

- `GEMINI_API_KEY`: required for `/api/explain`.
- `GEMINI_MODEL`: defaults to `models/gemini-3-flash-preview`.
- `CAPTURE_METHOD`: defaults to `tcpdump`.
- `CAPTURE_INTERFACES`: comma-separated interfaces (e.g. `en0`).
- `GEOIP_API_URL`: defaults to `https://ipapi.co/{ip}/json/`.
- `GEOIP_API_KEY`: optional (if your provider needs it).
- `GEOIP_FALLBACK_URLS`: defaults to `https://ipinfo.io/{ip}/json`.
- `NETWORK_KWH_PER_GB`: defaults to `0.06`.

Frontend `.env` (optional):

- `VITE_WS_URL`: default `ws://localhost:8000/ws`.
- `VITE_API_URL`: default `http://localhost:8000/api/explain`.

## Running The App

Backend:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
python -m uvicorn backend.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

## Permissions

Some data sources require elevated privileges on macOS:

- `powermetrics` often requires `sudo` to access power and thermal samples.
- `tcpdump` requires `sudo` to capture packets.

If those tools fail, the UI will show missing energy metrics or zero flows.

## Troubleshooting

- WebSocket errors: ensure `uvicorn[standard]` is installed.
- No traffic on the world map: run backend with sudo and set `CAPTURE_INTERFACES=en0`.
- Empty geo cache: check outbound HTTPS access to the geo IP provider.
- Energy values missing: `powermetrics` may not be available on some Macs or may require sudo.

## Notes

- Energy, temperature, and CO2e values are estimates and depend on system permissions and hardware support.
- The world map uses public IP geolocation; local/private IPs are ignored.
