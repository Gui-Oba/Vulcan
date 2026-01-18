import { Send, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

export default SectionChat;
