import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Camera, MessageCircle, Paperclip, RotateCcw, Send, X } from "lucide-react";
import "katex/dist/katex.min.css";
import ScreenCapture from "./ScreenCapture";
import "./FloatingTutor.css";

function TutorMessage({ text }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{ p: ({ children }) => <p>{children}</p> }}
    >
      {text}
    </ReactMarkdown>
  );
}

export default function FloatingTutor({
  open,
  onToggle,
  messages,
  isLoading,
  question,
  setQuestion,
  file,
  setFile,
  onSubmit,
  onFileChange,
  onCapture,
  onNewSession,
  error,
}) {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, open]);

  return (
    <div className="floating-tutor-root">
      {open && (
        <section className="floating-tutor-panel" aria-label="MathMate floating tutor">
          <header className="floating-tutor-header">
            <div className="floating-tutor-heading">
              <span className="floating-tutor-mark" aria-hidden="true">∑</span>
              <div>
                <h2>MathMate</h2>
                <p>Ask about your notes</p>
              </div>
            </div>
            <div className="floating-tutor-header-actions">
              <button type="button" onClick={onNewSession} aria-label="Start a new session" title="New session">
                <RotateCcw size={16} />
              </button>
              <button type="button" onClick={onToggle} aria-label="Close tutor" title="Close">
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="floating-tutor-capture">
            <ScreenCapture onCapture={onCapture} disabled={isLoading} compact />
          </div>

          <div className="floating-tutor-messages" aria-live="polite">
            {messages.map((message, index) => (
              <div
                key={`${index}-${message.role}`}
                className={`floating-tutor-message ${message.role}`}
              >
                <TutorMessage text={message.text} />
              </div>
            ))}
            {isLoading && (
              <div className="floating-tutor-message assistant" role="status">
                Thinking…
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {(error || file) && (
            <div className={`floating-tutor-notice ${error ? "is-error" : ""}`} role={error ? "alert" : undefined}>
              {error ? (
                error
              ) : (
                <>
                  <span className="floating-tutor-file-name">{file.name}</span>
                  <button type="button" onClick={() => setFile(null)} aria-label="Remove image">×</button>
                </>
              )}
            </div>
          )}

          <form className="floating-tutor-composer" onSubmit={onSubmit}>
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask a question…"
              aria-label="Ask MathMate a question"
              rows={2}
              disabled={isLoading}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="floating-tutor-composer-actions">
              <label className="floating-tutor-attach" title="Attach a photo">
                <input type="file" accept="image/*" hidden disabled={isLoading} onChange={onFileChange} />
                <Paperclip size={17} aria-hidden="true" />
                <span className="sr-only">Attach a problem photo</span>
              </label>
              <button
                type="submit"
                className="floating-tutor-send"
                disabled={isLoading || (!question.trim() && !file)}
                aria-label="Send question"
              >
                <Send size={17} aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>
      )}

      <button
        type="button"
        className={`floating-tutor-launcher ${open ? "is-open" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Close MathMate tutor" : "Open MathMate tutor"}
        title={open ? "Close MathMate" : "Ask MathMate"}
      >
        {open ? <X size={22} /> : <><Camera size={18} /><MessageCircle size={19} /></>}
      </button>
    </div>
  );
}
