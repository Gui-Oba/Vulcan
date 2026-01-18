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

export default ChartTooltip;
