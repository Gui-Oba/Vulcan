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
        className="h-5 w-5 object-contain"
      />
    </button>
  );
};

export default SectionControls;
