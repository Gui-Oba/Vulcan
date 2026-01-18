import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  Cpu,
  Database,
  Globe2,
  HardDrive,
  Laptop,
  Leaf,
  Moon,
  Send,
  Share2,
  Sun,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DigitalTwin from "./components/DigitalTwin.jsx";
import WorldMap from "./components/WorldMap.jsx";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Sankey,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MAX_POINTS = 60;
const ENERGY_MAX_WATTS = 30;
const MAP_LINGER_MS = 10000;
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api/explain";
const SECTION_TITLES = {
  cpu: "CPU Activity",
  digitalTwin: "Digital Twin",
  network: "Network Throughput",
  worldMap: "Live World Map",
  energy: "Energy Impact",
  carbon: "Carbon Footprint",
  sankey: "Data Flow Sankey",
  memoryDisk: "Memory & Disk",
  processes: "Resource Hogs",
  snapshot: "Snapshot",
};
const LEFT_SECTIONS = new Set(["cpu", "digitalTwin", "network", "worldMap"]);

const formatBytes = (value) => {
  if (!Number.isFinite(value)) return "--";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatRate = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(2)} MB/s`;
};

const formatTemp = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)} deg C`;
};

const formatCo2 = (grams) => {
  if (!Number.isFinite(grams)) return "--";
  if (grams >= 1000) return `${(grams / 1000).toFixed(4)} kg`;
  return `${grams.toFixed(4)} g`;
};

const formatMs = (value) => {
  if (!Number.isFinite(value)) return "--";
  return `${value.toFixed(1)} ms`;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const heatColor = (value) => {
  const bounded = clamp(value, 0, 100);
  const hue = 190 - bounded * 1.6;
  return `hsl(${hue}, 80%, 55%)`;
};

const EnergyGauge = ({ wattage, source, theme }) => {
  const isLight = theme === "light";
  const safeWattage = Number.isFinite(wattage) ? wattage : 0;
  const percent = clamp(safeWattage / ENERGY_MAX_WATTS, 0, 1);
  const energyColor =
    safeWattage <= 6 ? "#22c55e" : safeWattage <= 15 ? "#f59e0b" : "#ef4444";
  const ringStyle = {
    background: `conic-gradient(${energyColor} 0deg ${
      percent * 360
    }deg, rgba(148,163,184,0.2) ${percent * 360}deg 360deg)`,
  };
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - percent);

  return (
    <div className="flex items-center gap-6">
      <div className="relative flex h-36 w-36 items-center justify-center">
        {isLight ? (
          <svg
            className="absolute inset-0"
            viewBox="0 0 120 120"
            aria-hidden="true"
          >
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke="rgba(15, 23, 42, 0.15)"
              strokeWidth="8"
            />
            <circle
              cx="60"
              cy="60"
              r={radius}
              fill="none"
              stroke={energyColor}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 60 60)"
            />
          </svg>
        ) : (
          <div
            className="absolute inset-0 rounded-full p-[2px]"
            style={ringStyle}
          />
        )}
        <div className="relative flex h-28 w-28 flex-col items-center justify-center rounded-full bg-midnight-veil text-center shadow-inner">
          <span className="text-2xl font-semibold text-white">
            {Number.isFinite(wattage) ? wattage.toFixed(1) : "--"}
          </span>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-400">
            Watts
          </span>
        </div>
      </div>
      <div>
        <p className="text-sm uppercase tracking-[0.3em] text-slate-400">
          Energy Impact
        </p>
        <p className="mt-2 text-lg font-semibold text-white">
          {Number.isFinite(wattage)
            ? safeWattage <= 6
              ? "Low"
              : safeWattage <= 15
              ? "Moderate"
              : "High"
            : "Unavailable"}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {source ? `Source: ${source}` : "Awaiting energy metrics"}
        </p>
      </div>
    </div>
  );
};

const ChartTooltip = ({ active, payload, label, unit }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/90 px-3 py-2 text-xs text-slate-200 shadow-xl">
      <p className="text-slate-400">{label}</p>
      {payload.map((item) => (
        <p key={item.name} className="mt-1">
          <span className="mr-2 font-semibold text-white">{item.name}:</span>
          {item.value.toFixed(2)} {unit}
        </p>
      ))}
    </div>
  );
};

const SectionControls = ({ onHelp, isLight }) => {
  const baseClass = isLight
    ? "border border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200"
    : "border border-white/10 bg-white/10 text-slate-200 hover:bg-white/20";
  return (
    <button
      type="button"
      onClick={onHelp}
      className={`${baseClass} rounded-full p-2 transition`}
    title="Ask about this section"
    aria-label="Ask about this section"
  >
      <img
        src="/Group 1.png"
        alt="Help"
        className="h-9 w-9 object-contain"
      />
    </button>
  );
};

const SectionChat = ({
  title,
  messages,
  value,
  onChange,
  onSubmit,
  onClose,
  isLoading,
  side,
  theme,
}) => {
  const isLight = theme === "light";
  const panelClass = isLight
    ? "border-slate-200 bg-white text-slate-900"
    : "border-white/10 bg-slate-950/90 text-slate-200";
  const userBubble = isLight
    ? "bg-cyan-500/10 text-slate-900"
    : "bg-cyan-500/10 text-cyan-100";
  const assistantBubble = isLight
    ? "bg-slate-100 text-slate-700"
    : "bg-white/5 text-slate-200";
  const inputClass = isLight
    ? "border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:ring-cyan-500/40"
    : "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:ring-cyan-400/40";
  const sendClass = isLight
    ? "border-slate-200 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20"
    : "border-white/10 bg-cyan-400/20 text-cyan-200 hover:bg-cyan-400/40";
  const sideClass =
    side === "left"
      ? "left-4 lg:-left-[400px]"
      : "right-4 lg:-right-[400px]";
  return (
    <div
      className={`absolute top-12 z-50 w-96 max-w-[92vw] rounded-2xl border p-3 shadow-2xl backdrop-blur-xl ${panelClass} ${sideClass}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.25em]">
          {title}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-1 text-slate-400 transition hover:text-slate-200"
          title="Close chat"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1 text-xs">
        {messages.length === 0 ? (
          <p className="text-slate-400">
            Ask a question about this panel to get a focused explanation.
          </p>
        ) : (
          messages.map((message, index) => (
            <div
              key={`${message.role}-${index}`}
              className={`rounded-lg px-3 py-2 ${
                message.role === "user" ? userBubble : assistantBubble
              }`}
            >
              <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                {message.role === "user" ? "You" : "Vulco"}
              </p>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                className="markdown mt-1"
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ))
        )}
        {isLoading && (
          <p className="text-xs text-slate-400">
            Vulco is analyzing your system...
          </p>
        )}
      </div>
      <form onSubmit={onSubmit} className="mt-3 flex items-center gap-2">
        <input
          value={value}
          onChange={onChange}
          placeholder="Ask about this section..."
          className={`flex-1 rounded-full border px-3 py-2 text-xs focus:outline-none focus:ring-2 ${inputClass}`}
        />
        <button
          type="submit"
          disabled={isLoading}
          className={`rounded-full border p-2 transition disabled:opacity-50 ${sendClass}`}
          title="Send"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
};

const SectionCard = ({ className, children, chat }) => {
  const raised = Boolean(chat);
  return (
    <section className={`${className} relative ${raised ? "z-40" : ""}`}>
      {children}
      {chat}
    </section>
  );
};

export default function App() {
  const [metrics, setMetrics] = useState(null);
  const [cpuHistory, setCpuHistory] = useState([]);
  const [netHistory, setNetHistory] = useState([]);
  const [flowCache, setFlowCache] = useState(() => new Map());
  const [flowNow, setFlowNow] = useState(() => Date.now());
  const [status, setStatus] = useState("connecting");
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem("theme");
    return stored === "light" ? "light" : "dark";
  });
  const [activeChatSection, setActiveChatSection] = useState(null);
  const [sectionMessages, setSectionMessages] = useState({});
  const [sectionInputs, setSectionInputs] = useState({});
  const [sectionLoading, setSectionLoading] = useState({});

  useEffect(() => {
    let shouldClose = false;
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      if (shouldClose) {
        socket.close();
        return;
      }
      setStatus("live");
    };
    socket.onclose = () => {
      if (!shouldClose) setStatus("offline");
    };
    socket.onerror = () => {
      if (!shouldClose) setStatus("error");
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const timestamp = new Date(data.timestamp * 1000).toLocaleTimeString();
      setMetrics(data);
      const nowMs = Date.now();
      setFlowNow(nowMs);
      setFlowCache((prev) => {
        const next = new Map(prev);
        const flows = Array.isArray(data.network_flows)
          ? data.network_flows
          : [];
        flows.forEach((flow) => {
          const direction = flow.direction || "unknown";
          const ip = flow.ip || "unknown";
          const key = `${direction}-${ip}`;
          const existing = next.get(key);
          next.set(key, {
            ...(existing || {}),
            ...flow,
            lastSeen: nowMs,
          });
        });
        for (const [key, value] of next) {
          const lastSeen = value?.lastSeen || 0;
          if (nowMs - lastSeen > MAP_LINGER_MS) {
            next.delete(key);
          }
        }
        return next;
      });

      setCpuHistory((prev) => {
        const next = [
          ...prev,
          { time: timestamp, cpu: data.cpu?.total ?? 0 },
        ];
        return next.slice(-MAX_POINTS);
      });

      setNetHistory((prev) => {
        const next = [
          ...prev,
          {
            time: timestamp,
            download: data.network?.download_mb_s ?? 0,
            upload: data.network?.upload_mb_s ?? 0,
          },
        ];
        return next.slice(-MAX_POINTS);
      });
    };

    return () => {
      shouldClose = true;
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("theme-light", theme === "light");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const suggestQuestion = (text, sectionId) => {
    if (!sectionId) return;
    setSectionInputs((prev) => ({ ...prev, [sectionId]: text }));
    setActiveChatSection(sectionId);
  };

  const toggleTheme = () => {
    setTheme((current) => (current === "light" ? "dark" : "light"));
  };

  const toggleSectionChat = (sectionId) => {
    setActiveChatSection((current) =>
      current === sectionId ? null : sectionId
    );
  };

  const sendSectionQuestion = async (event, sectionId) => {
    event.preventDefault();
    const question = (sectionInputs[sectionId] || "").trim();
    if (!question) return;

    setSectionMessages((prev) => {
      const next = { ...prev };
      const history = next[sectionId] ? [...next[sectionId]] : [];
      history.push({ role: "user", content: question });
      next[sectionId] = history;
      return next;
    });
    setSectionInputs((prev) => ({ ...prev, [sectionId]: "" }));

    if (!metrics) {
      setSectionMessages((prev) => {
        const next = { ...prev };
        const history = next[sectionId] ? [...next[sectionId]] : [];
        history.push({
          role: "assistant",
          content: "System data is still loading. Try again in a moment.",
        });
        next[sectionId] = history;
        return next;
      });
      return;
    }

    setSectionLoading((prev) => ({ ...prev, [sectionId]: true }));
    try {
      const sectionTitle = SECTION_TITLES[sectionId] || "This section";
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_data: metrics,
          user_query: `[Section: ${sectionTitle}] ${question}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data = await response.json();
      setSectionMessages((prev) => {
        const next = { ...prev };
        const history = next[sectionId] ? [...next[sectionId]] : [];
        history.push({
          role: "assistant",
          content: data.answer || "No response returned.",
        });
        next[sectionId] = history;
        return next;
      });
    } catch (error) {
      setSectionMessages((prev) => {
        const next = { ...prev };
        const history = next[sectionId] ? [...next[sectionId]] : [];
        history.push({
          role: "assistant",
          content: "Unable to reach the Gemini explainer endpoint.",
        });
        next[sectionId] = history;
        return next;
      });
    } finally {
      setSectionLoading((prev) => ({ ...prev, [sectionId]: false }));
    }
  };

  const renderSectionChat = (sectionId) => {
    if (activeChatSection !== sectionId) return null;
    const side = LEFT_SECTIONS.has(sectionId) ? "right" : "left";
    return (
      <SectionChat
        title={SECTION_TITLES[sectionId] || "Section"}
        messages={sectionMessages[sectionId] || []}
        value={sectionInputs[sectionId] || ""}
        onChange={(event) =>
          setSectionInputs((prev) => ({
            ...prev,
            [sectionId]: event.target.value,
          }))
        }
        onSubmit={(event) => sendSectionQuestion(event, sectionId)}
        onClose={() => setActiveChatSection(null)}
        isLoading={Boolean(sectionLoading[sectionId])}
        side={side}
        theme={theme}
      />
    );
  };

  const memoryPercent = metrics?.memory?.pressure ?? 0;
  const memoryUsed = metrics?.memory?.used ?? 0;
  const memoryTotal = metrics?.memory?.total ?? 0;
  const swapUsed = metrics?.memory?.swap_used ?? 0;
  const swapTotal = metrics?.memory?.swap_total ?? 0;
  const swapPercent = metrics?.memory?.swap_percent ?? 0;
  const diskRead = metrics?.disk?.read_mb_s ?? 0;
  const diskWrite = metrics?.disk?.write_mb_s ?? 0;
  const diskReadIops = metrics?.disk?.read_iops ?? 0;
  const diskWriteIops = metrics?.disk?.write_iops ?? 0;
  const perCore = metrics?.cpu?.per_core ?? [];
  const cpuTemp = metrics?.thermal?.cpu_temp_c;
  const thermalSource = metrics?.thermal?.source;
  const thermalPressure = metrics?.thermal?.pressure_level;
  const tempEstimated = metrics?.thermal?.is_estimated;
  const latencyMs = metrics?.network?.latency_ms;
  const jitterMs = metrics?.network?.jitter_ms;
  const liveFlows = metrics?.network_flows ?? [];
  const networkCapture = metrics?.network_capture;
  const batteryHealth = metrics?.battery?.health_percent;
  const batteryCurrent = metrics?.battery?.current_capacity;
  const batteryDesign = metrics?.battery?.design_capacity;
  const energyKwh = metrics?.sustainability?.energy_kwh ?? 0;
  const co2eGrams = metrics?.sustainability?.co2e_g ?? 0;
  const co2Intensity = metrics?.sustainability?.intensity_g_per_kwh ?? 0;
  const deviceCo2e = metrics?.sustainability?.device_co2e_g ?? 0;
  const networkCo2e = metrics?.sustainability?.network?.co2e_g ?? 0;
  const networkBytes = metrics?.sustainability?.network?.bytes ?? 0;
  const networkEnergyKwh = metrics?.sustainability?.network?.energy_kwh ?? 0;
  const processes = metrics?.processes ?? [];

  const cpuAverage = useMemo(() => {
    if (!perCore.length) return metrics?.cpu?.total ?? 0;
    const sum = perCore.reduce((acc, value) => acc + value, 0);
    return sum / perCore.length;
  }, [metrics, perCore]);

  const sankeyData = useMemo(() => {
    if (!liveFlows.length) return null;
    const nodes = [];
    const nodeIndex = new Map();
    const linkMap = new Map();

    const addNode = (key, label) => {
      if (nodeIndex.has(key)) return nodeIndex.get(key);
      const index = nodes.length;
      nodes.push({ name: key, label });
      nodeIndex.set(key, index);
      return index;
    };

    liveFlows
      .filter((flow) => flow.direction === "outbound")
      .forEach((flow) => {
        const value = Number.isFinite(flow.mb_s) ? flow.mb_s : 0;
        if (value <= 0) return;
        const app = flow.app || "Unknown App";
        const protocol = flow.protocol || "Other";
        const country = flow.country || "Unknown";
        const appIndex = addNode(`app:${app}`, app);
        const protocolIndex = addNode(`protocol:${protocol}`, protocol);
        const countryIndex = addNode(`country:${country}`, country);

        const appKey = `${appIndex}-${protocolIndex}`;
        const protocolKey = `${protocolIndex}-${countryIndex}`;
        linkMap.set(appKey, {
          source: appIndex,
          target: protocolIndex,
          value: (linkMap.get(appKey)?.value || 0) + value,
        });
        linkMap.set(protocolKey, {
          source: protocolIndex,
          target: countryIndex,
          value: (linkMap.get(protocolKey)?.value || 0) + value,
        });
      });

    const links = Array.from(linkMap.values());
    if (!links.length) return null;
    return { nodes, links };
  }, [liveFlows]);

  const mapFlows = useMemo(() => {
    if (!flowCache.size) return [];
    return Array.from(flowCache.values())
      .map((flow) => {
        const ageMs = flowNow - (flow.lastSeen || flowNow);
        const fade = clamp(1 - ageMs / MAP_LINGER_MS, 0, 1);
        const mb_s = Number.isFinite(flow.mb_s) ? flow.mb_s : 0;
        const bytes = Number.isFinite(flow.bytes) ? flow.bytes : 0;
        return {
          ...flow,
          fade,
          mb_s: mb_s * fade,
          bytes: bytes * fade,
        };
      })
      .filter((flow) => flow.fade > 0);
  }, [flowCache, flowNow]);

  const panelClass =
    "rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_20px_60px_rgba(6,15,35,0.45)] backdrop-blur-xl";
  const swapPulseDuration = `${clamp(2.6 - swapPercent / 100 * 1.9, 0.6, 2.6)}s`;
  const heatmapColumns = Math.min(
    8,
    Math.max(4, Math.ceil(Math.sqrt(perCore.length || 4)))
  );
  const isLight = theme === "light";
  const cpuBarClass = isLight
    ? "h-2 rounded-full bg-cyan-500"
    : "h-2 rounded-full bg-gradient-to-r from-cyan-400 via-cyan-300 to-sky-500";
  const memoryBarClass = isLight
    ? "h-2 rounded-full bg-fuchsia-500"
    : "h-2 rounded-full bg-gradient-to-r from-fuchsia-500 via-purple-400 to-cyan-400";
  const swapBarClass = isLight
    ? "h-2 rounded-full bg-rose-400"
    : "h-2 rounded-full bg-gradient-to-r from-fuchsia-400 via-rose-400 to-amber-400";

  return (
    <div className="min-h-screen text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-cyan-200/70">
              Vulcan
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white md:text-4xl">
              Real-time System Monitor
            </h1>
            <p className="mt-2 max-w-xl text-sm text-slate-400">
              Streaming live CPU, memory, disk, network, and energy metrics from
              your Mac.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/10 px-4 py-2">
              <Activity className="h-4 w-4 text-emerald-300" />
              <span className="text-sm font-medium capitalize text-white">
                {status}
              </span>
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20"
              title={
                theme === "light" ? "Switch to dark mode" : "Switch to light mode"
              }
            >
              {theme === "light" ? (
                <Moon className="h-4 w-4 text-slate-200" />
              ) : (
                <Sun className="h-4 w-4 text-amber-300" />
              )}
              {theme === "light" ? "Dark" : "Light"}
            </button>
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="space-y-6">
            <SectionCard className={panelClass} chat={renderSectionChat("cpu")}>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Cpu className="h-5 w-5 text-cyan-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      CPU Activity
                    </p>
                    <p className="text-xs text-slate-400">
                      Avg. {cpuAverage.toFixed(1)}%
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs uppercase tracking-[0.3em] text-slate-500">
                    Last 60s
                  </span>
                  <SectionControls
                    onHelp={() => toggleSectionChat("cpu")}
                    isLight={isLight}
                  />
                </div>
              </div>
              <div
                className="mt-4 h-52 cursor-pointer"
                onClick={() =>
                  suggestQuestion(
                    "What does this CPU Activity graph mean for my current usage?",
                    "cpu"
                  )
                }
                title="Ask Gemini about CPU activity"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cpuHistory}>
                    {!isLight && (
                      <defs>
                        <linearGradient
                          id="cpuGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.6} />
                          <stop offset="100%" stopColor="#22d3ee" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                    )}
                    <CartesianGrid
                      strokeDasharray="4 4"
                      stroke={isLight ? "#e2e8f0" : "#1f2a44"}
                    />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: "#64748b", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tick={{ fill: "#64748b", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip unit="%" />} />
                    <Area
                      type="monotone"
                      dataKey="cpu"
                      name="CPU"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      fill={isLight ? "#0ea5e9" : "url(#cpuGradient)"}
                      fillOpacity={isLight ? 0.2 : 1}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {perCore.length > 0 && (
                <div className="mt-4 grid gap-2 md:grid-cols-2">
                  {perCore.map((value, index) => (
                    <div key={index} className="flex items-center gap-3 text-xs">
                      <span className="w-10 text-slate-400">C{index + 1}</span>
                      <div className="h-2 flex-1 rounded-full bg-white/10">
                        <div
                          className={cpuBarClass}
                          style={{ width: `${clamp(value, 0, 100)}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-slate-300">
                        {value.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {perCore.length > 0 && (
                <div className="mt-6">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>System Heatmap</span>
                    <span>{perCore.length} cores</span>
                  </div>
                  <div
                    className="mt-3 grid gap-2"
                    style={{
                      gridTemplateColumns: `repeat(${heatmapColumns}, minmax(28px, 1fr))`,
                    }}
                  >
                    {perCore.map((value, index) => (
                      <div
                        key={`heat-${index}`}
                        className="flex aspect-square items-center justify-center rounded-lg border border-white/10 text-[10px] font-semibold text-slate-950/90 shadow-inner"
                        style={{
                          background: isLight
                            ? heatColor(value)
                            : `linear-gradient(150deg, ${heatColor(
                                value
                              )} 0%, rgba(15,23,42,0.85) 80%)`,
                        }}
                        title={`Core ${index + 1}: ${value.toFixed(1)}%`}
                      >
                        C{index + 1}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("digitalTwin")}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Laptop className="h-5 w-5 text-cyan-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Digital Twin
                    </p>
                    <p className="text-xs text-slate-400">
                      Emissive glow tracks CPU temperature
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-4">
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">
                      {formatTemp(cpuTemp)}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {tempEstimated
                        ? "Estimated from thermal pressure"
                        : thermalSource
                        ? `Source: ${thermalSource}`
                        : "Awaiting sensor"}
                    </p>
                  </div>
                  <SectionControls
                    onHelp={() => toggleSectionChat("digitalTwin")}
                    isLight={isLight}
                  />
                </div>
              </div>
              <div className="mt-4 h-56 rounded-xl border border-white/10 bg-white/5 p-3">
                <DigitalTwin temperature={cpuTemp} theme={theme} />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Cooler temps stay blue; hotter temps shift toward amber and red.
                {thermalPressure ? ` Pressure: ${thermalPressure}.` : ""}
              </p>
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("network")}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Wifi className="h-5 w-5 text-blue-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Network Throughput
                    </p>
                    <p className="text-xs text-slate-400">
                      Live upload and download speeds
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <ArrowDownLeft className="h-3 w-3 text-emerald-300" />
                      {formatRate(metrics?.network?.download_mb_s ?? 0)}
                    </span>
                    <span className="flex items-center gap-1">
                      <ArrowUpRight className="h-3 w-3 text-amber-300" />
                      {formatRate(metrics?.network?.upload_mb_s ?? 0)}
                    </span>
                  </div>
                  <SectionControls
                    onHelp={() => toggleSectionChat("network")}
                    isLight={isLight}
                  />
                </div>
              </div>
              <div
                className="mt-4 h-52 cursor-pointer"
                onClick={() =>
                  suggestQuestion(
                    "What does the Network Throughput graph mean for my current usage?",
                    "network"
                  )
                }
                title="Ask Gemini about network throughput"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={netHistory}>
                    {!isLight && (
                      <defs>
                        <linearGradient
                          id="downloadGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="#34d399" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="#34d399" stopOpacity={0.05} />
                        </linearGradient>
                        <linearGradient
                          id="uploadGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="#fbbf24" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                    )}
                    <CartesianGrid
                      strokeDasharray="4 4"
                      stroke={isLight ? "#e2e8f0" : "#1f2a44"}
                    />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: "#64748b", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#64748b", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip unit="MB/s" />} />
                    <Area
                      type="monotone"
                      dataKey="download"
                      name="Download"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill={isLight ? "#10b981" : "url(#downloadGradient)"}
                      fillOpacity={isLight ? 0.2 : 1}
                    />
                    <Area
                      type="monotone"
                      dataKey="upload"
                      name="Upload"
                      stroke="#fbbf24"
                      strokeWidth={2}
                      fill={isLight ? "#f59e0b" : "url(#uploadGradient)"}
                      fillOpacity={isLight ? 0.2 : 1}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>Latency {formatMs(latencyMs)}</span>
                <span>Jitter {formatMs(jitterMs)}</span>
              </div>
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("worldMap")}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Globe2 className="h-5 w-5 text-cyan-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Live World Map
                    </p>
                    <p className="text-xs text-slate-400">
                      Outbound and inbound traffic by destination
                    </p>
                  </div>
                </div>
                <SectionControls
                  onHelp={() => toggleSectionChat("worldMap")}
                  isLight={isLight}
                />
              </div>
              <div className="mt-4 h-100 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                <WorldMap flows={mapFlows} theme={theme} />
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Arc thickness reflects real-time bitrate from Montreal.
              </p>
              <div className="mt-3 text-[11px] text-slate-400">
                {networkCapture ? (
                  <span>
                    Capture:{" "}
                    {networkCapture.sniffer_running ? "running" : "stopped"} ·
                    Packets: {networkCapture.packet_count} · Local:{" "}
                    {networkCapture.local_match_count} · Ignored:{" "}
                    {networkCapture.ignored_count} · Flows:{" "}
                    {networkCapture.flow_keys} · Geo cache:{" "}
                    {networkCapture.geo_cached} · Inflight:{" "}
                    {networkCapture.geo_inflight}
                    {networkCapture.ifaces?.length
                      ? ` · Ifaces: ${networkCapture.ifaces.join(", ")}`
                      : ""}
                    {networkCapture.sniffer_mode
                      ? ` · Mode: ${networkCapture.sniffer_mode}`
                      : ""}
                    {networkCapture.capture_method
                      ? ` · Method: ${networkCapture.capture_method}`
                      : ""}
                    {networkCapture.sniffer_error
                      ? ` · Error: ${networkCapture.sniffer_error}`
                      : ""}
                  </span>
                ) : (
                  <span>Capture status pending...</span>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              className={panelClass}
              chat={renderSectionChat("energy")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Zap className="h-5 w-5 text-amber-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">Energy Impact</p>
                    <p className="text-xs text-slate-400">
                      Real-time wattage estimate
                    </p>
                  </div>
                </div>
                <SectionControls
                  onHelp={() => toggleSectionChat("energy")}
                  isLight={isLight}
                />
              </div>
              <div className="mt-6">
                <EnergyGauge
                  wattage={metrics?.energy?.wattage}
                  source={metrics?.energy?.source}
                  theme={theme}
                />
              </div>
              <div className="mt-6 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Battery Health</span>
                  <span className="text-sm font-semibold text-white">
                    {Number.isFinite(batteryHealth)
                      ? `${batteryHealth.toFixed(0)}%`
                      : "--"}
                  </span>
                </div>
                <p className="mt-2 text-[11px] text-slate-400">
                  {batteryCurrent && batteryDesign
                    ? `Full / Design: ${batteryCurrent} / ${batteryDesign} mAh`
                    : "Capacity details unavailable"}
                </p>
              </div>
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("carbon")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Leaf className="h-5 w-5 text-emerald-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Carbon Footprint
                    </p>
                    <p className="text-xs text-slate-400">
                      Total CO2e since this session started
                    </p>
                  </div>
                </div>
                <SectionControls
                  onHelp={() => toggleSectionChat("carbon")}
                  isLight={isLight}
                />
              </div>
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-xs">
                <div className="flex items-center justify-between text-slate-400">
                  <span>Total CO2e</span>
                  <span className="text-sm font-semibold text-white">
                    {formatCo2(co2eGrams)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-slate-400">
                  <span>Energy Used</span>
                  <span className="text-sm font-semibold text-white">
                    {Number.isFinite(energyKwh)
                      ? `${energyKwh.toFixed(4)} kWh`
                      : "--"}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-slate-400">
                  <span>Device CO2e</span>
                  <span className="text-sm font-semibold text-white">
                    {formatCo2(deviceCo2e)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-slate-400">
                  <span>Network CO2e</span>
                  <span className="text-sm font-semibold text-white">
                    {formatCo2(networkCo2e)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-slate-400">
                  <span>Network Energy</span>
                  <span className="text-sm font-semibold text-white">
                    {Number.isFinite(networkEnergyKwh)
                      ? `${networkEnergyKwh.toFixed(4)} kWh`
                      : "--"}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between text-slate-400">
                  <span>Data Transferred</span>
                  <span className="text-sm font-semibold text-white">
                    {formatBytes(networkBytes)}
                  </span>
                </div>
                <p className="mt-3 text-[11px] text-slate-400">
                  Using {Number.isFinite(co2Intensity)
                    ? `${Math.round(co2Intensity)} g CO2e/kWh`
                    : "--"} global average.
                </p>
              </div>
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("sankey")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Share2 className="h-5 w-5 text-cyan-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Data Flow Sankey
                    </p>
                    <p className="text-xs text-slate-400">
                      Apps to protocol to destination country
                    </p>
                  </div>
                </div>
                <SectionControls
                  onHelp={() => toggleSectionChat("sankey")}
                  isLight={isLight}
                />
              </div>
              <div className="mt-4 h-64">
                {sankeyData ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <Sankey
                      data={sankeyData}
                      nameKey="label"
                      nodePadding={14}
                      nodeWidth={18}
                      linkCurvature={0.55}
                      margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                      node={{
                        fill: isLight ? "#94a3b8" : "#1e293b",
                        stroke: isLight ? "#e2e8f0" : "#0f172a",
                      }}
                      link={{
                        stroke: isLight ? "#0ea5e9" : "#22d3ee",
                        strokeOpacity: isLight ? 0.3 : 0.35,
                      }}
                    >
                      <Tooltip
                        formatter={(value) =>
                          `${Number(value).toFixed(3)} MB/s`
                        }
                        contentStyle={{
                          background: isLight
                            ? "rgba(248, 250, 252, 0.95)"
                            : "rgba(15, 23, 42, 0.9)",
                          border: "1px solid rgba(148, 163, 184, 0.2)",
                          borderRadius: "8px",
                        }}
                        itemStyle={{ color: isLight ? "#0f172a" : "#e2e8f0" }}
                      />
                    </Sankey>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-xs text-slate-400">
                    Waiting for outbound flow data...
                  </p>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-400">
                Based on real-time throughput over the last second.
              </p>
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("memoryDisk")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Database className="h-5 w-5 text-fuchsia-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Memory & Disk
                    </p>
                    <p className="text-xs text-slate-400">
                      System usage and I/O
                    </p>
                  </div>
                </div>
                <SectionControls
                  onHelp={() => toggleSectionChat("memoryDisk")}
                  isLight={isLight}
                />
              </div>

              <div className="mt-4 space-y-4">
                <div
                  className="cursor-pointer"
                  onClick={() =>
                    suggestQuestion(
                      "What does this Memory Utilization graph mean for my current usage?",
                      "memoryDisk"
                    )
                  }
                  title="Ask Gemini about memory utilization"
                >
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Memory Utilization</span>
                    <span>{memoryPercent.toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-white/10">
                    <div
                      className={memoryBarClass}
                      style={{ width: `${clamp(memoryPercent, 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {formatBytes(memoryUsed)} / {formatBytes(memoryTotal)}
                  </p>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="flex items-center gap-2">
                      Swap Usage
                      <span
                        className="swap-pulse h-2.5 w-2.5 rounded-full bg-fuchsia-400"
                        style={{ animationDuration: swapPulseDuration }}
                      />
                    </span>
                    <span>{swapPercent.toFixed(0)}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-white/10">
                    <div
                      className={swapBarClass}
                      style={{ width: `${clamp(swapPercent, 0, 100)}%` }}
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {formatBytes(swapUsed)} / {formatBytes(swapTotal)}
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <HardDrive className="h-4 w-4 text-slate-300" />
                      Disk Read
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {formatRate(diskRead)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {Math.round(diskReadIops)} IOPS
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <HardDrive className="h-4 w-4 text-slate-300" />
                      Disk Write
                    </div>
                    <p className="mt-2 text-sm font-semibold text-white">
                      {formatRate(diskWrite)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {Math.round(diskWriteIops)} IOPS
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("processes")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Activity className="h-5 w-5 text-rose-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Resource Hogs
                    </p>
                    <p className="text-xs text-slate-400">
                      Top 5 CPU consumers
                    </p>
                  </div>
                </div>
                <SectionControls
                  onHelp={() => toggleSectionChat("processes")}
                  isLight={isLight}
                />
              </div>
              <div className="mt-4 space-y-2 text-xs">
                {processes.length > 0 ? (
                  processes.map((proc) => (
                    <div
                      key={proc.pid}
                      className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {proc.name}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          PID {proc.pid}
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-rose-300">
                        {proc.cpu_percent.toFixed(1)}%
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">
                    Waiting for process metrics...
                  </p>
                )}
              </div>
            </SectionCard>

            <SectionCard
              className={panelClass}
              chat={renderSectionChat("snapshot")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Cpu className="h-5 w-5 text-cyan-300" />
                  <div>
                    <p className="text-sm font-semibold text-white">Snapshot</p>
                    <p className="text-xs text-slate-400">
                      Current system summary
                    </p>
                  </div>
                </div>
                <SectionControls
                  onHelp={() => toggleSectionChat("snapshot")}
                  isLight={isLight}
                />
              </div>
              <div className="mt-4 grid gap-3 text-xs text-slate-400">
                <div className="flex items-center justify-between">
                  <span>CPU Average</span>
                  <span className="text-white">{cpuAverage.toFixed(1)}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Upload</span>
                  <span className="text-white">
                    {formatRate(metrics?.network?.upload_mb_s ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Download</span>
                  <span className="text-white">
                    {formatRate(metrics?.network?.download_mb_s ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Memory Used</span>
                  <span className="text-white">
                    {formatBytes(memoryUsed)}
                  </span>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}
