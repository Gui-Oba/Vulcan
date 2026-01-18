const SectionControls = ({ onHelp, isLight }) => {
  const baseClass = isLight
    ? "border border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200"
    : "border border-white/10 bg-white/10 text-slate-200 hover:bg-white/20";
  const tooltipClass = isLight
    ? "bg-slate-900 text-white"
    : "bg-white text-slate-900";
  return (
    <div className="relative inline-flex group">
      <button
        type="button"
        onClick={onHelp}
        className={`${baseClass} rounded-full p-2 transition`}
        title="Ask Vulco"
        aria-label="Ask Vulco"
      >
        <img
          src="/Group 1.png"
          alt="Ask Vulco"
          className="h-5 w-5 object-contain transition-transform duration-200 group-hover:-translate-y-0.5"
        />
      </button>
      <span
        className={`pointer-events-none absolute -top-8 right-0 rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.2em] opacity-0 shadow transition duration-200 group-hover:opacity-100 ${tooltipClass}`}
      >
        Ask Vulco
      </span>
    </div>
  );
};

export default SectionControls;
