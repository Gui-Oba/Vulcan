import { useMemo, useState } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Line,
  Marker,
  ZoomableGroup,
} from "react-simple-maps";
import { Maximize2 } from "lucide-react";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";
const ORIGIN = {
  name: "Montreal",
  coordinates: [-73.5673, 45.5017],
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const aggregateFlows = (flows) => {
  const map = new Map();
  flows.forEach((flow) => {
    if (!Number.isFinite(flow.lat) || !Number.isFinite(flow.lon)) return;
    const key = `${flow.direction}-${flow.ip}`;
    const current = map.get(key) || {
      ...flow,
      mb_s: 0,
      bytes: 0,
      fade: 0,
    };
    const flowMb = Number.isFinite(flow.mb_s) ? flow.mb_s : 0;
    const flowBytes = Number.isFinite(flow.bytes) ? flow.bytes : 0;
    const flowFade = Number.isFinite(flow.fade) ? flow.fade : 1;
    current.mb_s += flowMb;
    current.bytes += flowBytes;
    current.fade = Math.max(current.fade || 0, flowFade);
    map.set(key, current);
  });
  return Array.from(map.values()).sort((a, b) => b.mb_s - a.mb_s);
};

export default function WorldMap({ flows, theme }) {
  const isLight = theme === "light";
  const landFill = isLight ? "#e2e8f0" : "#111827";
  const landStroke = isLight ? "#cbd5e1" : "#1f2a44";
  const outboundColor = isLight ? "#0ea5e9" : "#22d3ee";
  const inboundColor = isLight ? "#f59e0b" : "#fbbf24";
  const [position, setPosition] = useState({
    coordinates: [0, 20],
    zoom: 1,
  });
  const minZoom = 0.8;
  const maxZoom = 3.5;

  const aggregated = useMemo(() => aggregateFlows(flows), [flows]);
  const topFlows = aggregated.slice(0, 12);

  return (
    <div className="relative h-full w-full">
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-2 rounded-full border border-white/10 bg-slate-900/70 p-1 text-xs text-slate-200 shadow">
        <button
          type="button"
          className="h-8 w-8 rounded-full bg-white/10 transition hover:bg-white/20"
          onClick={() =>
            setPosition((prev) => ({
              ...prev,
              zoom: clamp(prev.zoom + 0.3, minZoom, maxZoom),
            }))
          }
          title="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          className="h-8 w-8 rounded-full bg-white/10 transition hover:bg-white/20"
          onClick={() =>
            setPosition((prev) => ({
              ...prev,
              zoom: clamp(prev.zoom - 0.3, minZoom, maxZoom),
            }))
          }
          title="Zoom out"
        >
          -
        </button>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20"
          onClick={() =>
            setPosition({
              coordinates: [0, 20],
              zoom: 1,
            })
          }
          title="Reset view"
        >
          <Maximize2 className={isLight ? "h-4 w-4 text-slate-600" : "h-4 w-4 text-slate-200"} />
        </button>
      </div>
      <ComposableMap
        projectionConfig={{ scale: 145 }}
        className="h-full w-full"
        style={{ width: "100%", height: "100%" }}
        preserveAspectRatio="xMidYMid meet"
      >
        <ZoomableGroup
          zoom={position.zoom}
          center={position.coordinates}
          onMoveEnd={setPosition}
          minZoom={minZoom}
          maxZoom={maxZoom}
        >
          <Geographies geography={GEO_URL}>
            {({ geographies }) =>
              geographies.map((geo) => (
                <Geography
                  key={geo.rsmKey}
                  geography={geo}
                  fill={landFill}
                  stroke={landStroke}
                  strokeWidth={0.5}
                  style={{ default: { outline: "none" } }}
                />
              ))
            }
          </Geographies>

          {topFlows.map((flow) => {
            const to = [flow.lon, flow.lat];
            const stroke =
              flow.direction === "outbound" ? outboundColor : inboundColor;
            const thickness = clamp(
              0.6 + Math.log1p(flow.mb_s || 0) * 2.5,
              0.6,
              5
            );
            const fade = Number.isFinite(flow.fade) ? flow.fade : 1;

            return (
              <g key={`${flow.direction}-${flow.ip}`}>
                <Line
                  from={ORIGIN.coordinates}
                  to={to}
                  stroke={stroke}
                  strokeWidth={thickness * 2}
                  strokeOpacity={0.15 * fade}
                />
                <Line
                  from={ORIGIN.coordinates}
                  to={to}
                  stroke={stroke}
                  strokeWidth={thickness}
                  strokeOpacity={0.8 * fade}
                  strokeLinecap="round"
                />
                <Marker coordinates={to}>
                  <circle
                    r={2.2 + thickness * 0.3}
                    fill={stroke}
                    opacity={0.85 * fade}
                  />
                </Marker>
              </g>
            );
          })}

          <Marker coordinates={ORIGIN.coordinates}>
            <circle r={4} fill={outboundColor} opacity={0.9} />
          </Marker>
        </ZoomableGroup>
      </ComposableMap>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
        <span>{ORIGIN.name}</span>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: outboundColor }}
            />
            Outbound
          </span>
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: inboundColor }}
            />
            Inbound
          </span>
        </div>
      </div>
    </div>
  );
}
