import { clamp } from "../utils/formatters.js";

const ENERGY_MAX_WATTS = 30;

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

export default EnergyGauge;
