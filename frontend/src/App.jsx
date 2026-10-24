import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "./App.css";
import ScreenCapture from "./components/ScreenCapture";
import PDFWriteMode from "./components/PDFWriteMode";

const initialMessages = [
  {
    role: "assistant",
    text: "Hey, lovely! ♡ I'm MathMate, your personal math tutor. What are we solving today?",
  },
];

function MathMessage({ text }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p: ({ children }) => (
          <p className="markdown-paragraph">{children}</p>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function App() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("mathmate-theme") === "dark"
  );
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [file, setFile] = useState(null);
  const [activePage, setActivePage] = useState("notebook");
  const [isLoading, setIsLoading] = useState(false);
  const [canvasSnapshot, setCanvasSnapshot] = useState("");
  const [tutorSolution, setTutorSolution] = useState(null);
  const [imageError, setImageError] = useState("");
  const [currentContext, setCurrentContext] = useState("");

  useEffect(() => {
    localStorage.setItem("mathmate-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  function startNewSession() {
    setMessages([
      {
        role: "assistant",
        text: "A fresh page, just for you! ♡ What would you like to learn today?",
      },
    ]);
    setQuestion("");
    setFile(null);
    setCanvasSnapshot("");
    setTutorSolution(null);
    setImageError("");
    setCurrentContext("");
  }

  async function solveImage(
    imageBase64,
    userPrompt = "Read the mathematics problem in this image. Solve it step by step, explain the reasoning clearly, and use readable LaTeX. Identify a safe blank area for the solution if one exists. Never claim a blank area exists if you cannot identify one."
  ) {
    setIsLoading(true);
    setImageError("");
    setCanvasSnapshot(imageBase64);
    setTutorSolution(null);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/analyze-workbook",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            image_base64: imageBase64,
            user_prompt: userPrompt,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "MathMate couldn't analyse this worksheet. Please try again."
        );
      }

      setTutorSolution(data);

      const recognizedProblem =
        data.recognized_problem ||
        "Math problem recognised from your worksheet.";

      const explanation =
        data.sidebar_explanation ||
        data.solution ||
        data.speech_text ||
        "MathMate analysed your worksheet, but no explanation was returned.";

      setCurrentContext(
        `Current worksheet problem: ${recognizedProblem}\n\nCurrent explanation: ${explanation}`
      );

      const steps = Array.isArray(data.handwritten_steps)
        ? data.handwritten_steps.join("\n\n")
        : typeof data.handwritten_steps === "string"
          ? data.handwritten_steps
          : "";

      const fullExplanation = [
        "### Problem recognised",
        recognizedProblem,
        "",
        "### Let's solve it",
        steps,
        "",
        explanation,
      ]
        .filter(Boolean)
        .join("\n\n");

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: fullExplanation,
        },
      ]);

    } catch (error) {
      const errorMessage =
        error.message === "Failed to fetch"
          ? "I couldn't reach the MathMate backend. Check that your Python server is running."
          : error.message || "Something went wrong. Please try again.";

      setImageError(errorMessage);

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: "Oops, lovely! " + errorMessage + " ♡",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();

    const text = question.trim();

    if (isLoading || (!text && !file)) return;

    if (file) {
      const selectedFile = file;

      if (!selectedFile.type.startsWith("image/")) {
        setImageError("Please choose a PNG, JPG, or other image file.");
        return;
      }

      const reader = new FileReader();

      reader.onload = async () => {
        const imageData =
          typeof reader.result === "string" ? reader.result : "";

        if (!imageData) {
          setImageError("I couldn't read that image. Please try another.");
          return;
        }

        if (text) {
          setMessages((previous) => [
            ...previous,
            { role: "user", text },
          ]);
        } else {
          setMessages((previous) => [
            ...previous,
            {
              role: "user",
              text: "Please read and solve the maths in my uploaded image.",
            },
          ]);
        }

        setQuestion("");
        setFile(null);

        await solveImage(
          imageData,
          text ||
            "Read and solve the mathematics problem in this image step by step. Explain it clearly."
        );
      };

      reader.onerror = () => {
        setImageError("I couldn't open that image. Please try again.");
      };

      reader.readAsDataURL(selectedFile);
      return;
    }

    setMessages((previous) => [
      ...previous,
      { role: "user", text },
    ]);

    setQuestion("");
    setIsLoading(true);

    try {
      const contextualMessage = currentContext
        ? `${currentContext}\n\nStudent follow-up question: ${text}`
        : text;

      const response = await fetch("http://127.0.0.1:8000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: contextualMessage,

          // Send the latest captured image with every follow-up question.
          image_base64: canvasSnapshot || null,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.detail ||
            "MathMate couldn't respond right now. Please try again."
        );
      }

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text:
            data.response ||
            data.reply ||
            "MathMate returned an empty response.",
        },
      ]);
    } catch (error) {
      const errorMessage =
        error.message === "Failed to fetch"
          ? "I couldn't reach the MathMate backend. Please check that your Python server is running."
          : error.message || "Something went wrong. Please try again.";

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: "Oops, lovely! " + errorMessage + " ♡",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0];

    if (!selectedFile) return;

    if (!selectedFile.type.startsWith("image/")) {
      setImageError("Please choose an image file, such as PNG or JPG.");
      event.target.value = "";
      return;
    }

    setImageError("");
    setFile(selectedFile);
  }

  function handleScreenCapture(imageBase64) {
    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        text: "I captured my desktop/PDF screen. Please identify the maths problem and help me solve it.",
      },
    ]);

    // Keep the screenshot for follow-up questions.
    // Do not write a desktop screenshot's solution onto the separate canvas.
    solveImage(
      imageBase64,
      "This is a screenshot captured with the student's permission from their desktop. Find the most relevant visible mathematics problem, solve it carefully, and explain the steps. Do not assume the screenshot is a blank digital canvas. Identify whether the screenshot contains enough information to read the problem. Do not claim to have edited the original PDF.",
    );
  }

  const pageTitle =
    activePage === "notebook"
      ? "My notebook"
      : activePage === "practice"
        ? "Practice corner"
        : "My progress";

  return (
    <div className={`app-shell ${darkMode ? "dark-mode" : "light-mode"}`}>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setActivePage("notebook")}
          aria-label="Go to MathMate notebook"
        >
          <span className="brand-icon">∑</span>
          <span className="brand-copy">
            <span className="brand-name">
              MathMate<span className="brand-heart">♡</span>
            </span>
            <span className="brand-subtitle">
              your little learning space
            </span>
          </span>
        </button>

        <button className="new-chat" onClick={startNewSession}>
          <span className="new-chat-plus">＋</span>
          <span>New session</span>
          <span className="new-chat-sparkle">✧</span>
        </button>

        <p className="sidebar-label">YOUR LITTLE WORLD</p>

        <nav className="navigation" aria-label="Main navigation">
          <button
            className={`nav-item ${activePage === "notebook" ? "active" : ""}`}
            onClick={() => setActivePage("notebook")}
          >
            <span className="nav-icon">✎</span>
            <span>My notebook</span>
            {activePage === "notebook" && (
              <span className="nav-heart">♡</span>
            )}
          </button>

          <button
            className={`nav-item ${activePage === "practice" ? "active" : ""}`}
            onClick={() => setActivePage("practice")}
          >
            <span className="nav-icon">✿</span>
            <span>Practice corner</span>
            {activePage === "practice" && (
              <span className="nav-heart">♡</span>
            )}
          </button>

          <button
            className={`nav-item ${activePage === "progress" ? "active" : ""}`}
            onClick={() => setActivePage("progress")}
          >
            <span className="nav-icon">↗</span>
            <span>My progress</span>
            {activePage === "progress" && (
              <span className="nav-heart">♡</span>
            )}
          </button>
        </nav>

        <div className="sidebar-decoration" aria-hidden="true">
          <span className="deco-star star-one">✧</span>
          <span className="deco-flower">✿</span>
          <span className="deco-star star-two">⋆</span>
          <p>little steps,</p>
          <p>lovely progress.</p>
        </div>

        <div className="sidebar-bottom">
          <div className="profile-avatar">M</div>
          <div className="profile-copy">
            <strong>My learning space</strong>
            <span>You're doing just fine ♡</span>
          </div>
          <span className="profile-sparkle">✧</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>MY LITTLE WORLD</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{pageTitle}</strong>
          </div>

          <div className="topbar-actions">
            <span className="tutor-status">
              <span className="status-dot" />
              {isLoading
                ? "MathMate is thinking..."
                : "Tutor space is ready"}
            </span>

            <button
              className="theme-toggle"
              onClick={() => setDarkMode((current) => !current)}
              aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
              title={`Switch to ${darkMode ? "light" : "dark"} mode`}
            >
              <span className="theme-icon">{darkMode ? "☀" : "☾"}</span>
              <span>{darkMode ? "Light mode" : "Dark mode"}</span>
            </button>
          </div>
        </header>

        <div className="workspace">
          <section className="welcome">
            <div className="welcome-eyebrow">
              <span className="eyebrow-sparkle">✧</span>
              YOUR PERSONAL MATH SPACE
              <span className="eyebrow-sparkle">✧</span>
            </div>

            <h1>
              Let's figure it out,
              <br className="mobile-break" />
              <span className="script-heading">together.</span>
              <span className="heading-heart">♡</span>
            </h1>

            <p>
              Bring your questions, your curiosity, and even the confusing
              bits.
              <br className="desktop-break" />
              We'll take it one tiny step at a time.
            </p>

            <div className="welcome-sticker sticker-one" aria-hidden="true">
              ✿
            </div>
            <div className="welcome-sticker sticker-two" aria-hidden="true">
              ✧
            </div>
          </section>

          {activePage === "notebook" && (
            <>
              {canvasSnapshot && (
                <span className="canvas-export-status" aria-live="polite">
                  Worksheet captured. MathMate can now analyse it.
                </span>
              )}

              <ScreenCapture
                onCapture={handleScreenCapture}
                disabled={isLoading}
              />

              <PDFWriteMode />

              {imageError && (
                <section
                  className="solution-window"
                  role="alert"
                  style={{
                    marginTop: "16px",
                    padding: "16px",
                    borderRadius: "16px",
                    background: darkMode ? "#38272c" : "#fff0f0",
                    color: darkMode ? "#ffe2e7" : "#8b2525",
                  }}
                >
                  <strong>Something went wrong</strong>
                  <p>{imageError}</p>
                  <button
                    type="button"
                    onClick={() => setImageError("")}
                  >
                    Dismiss
                  </button>
                </section>
              )}

              {tutorSolution && (
                <section
                  className="solution-window"
                  aria-live="polite"
                  style={{
                    marginTop: "18px",
                    padding: "22px",
                    borderRadius: "20px",
                    border: "1px solid #eadcf4",
                    background: darkMode ? "#282332" : "#fffaff",
                    color: darkMode ? "#f5edf9" : "#43364d",
                  }}
                >
                  <div style={{ marginBottom: "14px" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        letterSpacing: "1.5px",
                        fontWeight: 700,
                        color: darkMode ? "#d5b7ed" : "#9b76b8",
                      }}
                    >
                      ✧ MATHMATE'S WORKED SOLUTION
                    </span>

                    <h2 style={{ marginTop: "8px", marginBottom: "6px" }}>
                      Let's work through it ♡
                    </h2>

                    <p style={{ margin: 0, opacity: 0.8 }}>
                      {tutorSolution.recognized_problem ||
                        "Your worksheet analysis"}
                    </p>
                  </div>

                  {tutorSolution.sidebar_explanation && (
                    <MathMessage
                      text={tutorSolution.sidebar_explanation}
                    />
                  )}

                  {tutorSolution.handwritten_steps && (
                    <div style={{ marginTop: "16px" }}>
                      <h3>Steps</h3>
                      <MathMessage
                        text={
                          Array.isArray(tutorSolution.handwritten_steps)
                            ? tutorSolution.handwritten_steps.join("\n\n")
                            : String(tutorSolution.handwritten_steps)
                        }
                      />
                    </div>
                  )}

                  {tutorSolution.needs_clarification && (
                    <p>
                      I might need one more detail to solve this accurately.
                      You can explain it in the tutor chat below.
                    </p>
                  )}

                  {Number(tutorSolution.y_start_percent) >= 100 && (
                    <p style={{ fontSize: "13px", opacity: 0.8 }}>
                      I couldn't identify a safe blank area for writing
                      directly on this canvas, so I've kept the solution here
                      rather than placing it over your work.
                    </p>
                  )}
                </section>
              )}

              <section
                className="chat-card"
                aria-label="MathMate tutor chat"
              >
                <div className="chat-header">
                  <div className="tutor-avatar">∑</div>

                  <div className="tutor-details">
                    <div className="tutor-name">
                      MathMate Tutor <span className="tiny-heart">♡</span>
                    </div>
                    <p>your patient little study buddy</p>
                  </div>

                  <div className="chat-header-right">
                    <span className="online-pill">
                      <span className="status-dot" />
                      Here to help
                    </span>
                    <span className="header-sparkle" aria-hidden="true">
                      ✧
                    </span>
                  </div>
                </div>

                <div className="messages" aria-live="polite">
                  {messages.map((message, index) => (
                    <div
                      key={`${index}-${message.role}`}
                      className={`message-row ${
                        message.role === "user" ? "user-row" : ""
                      }`}
                    >
                      {message.role === "assistant" && (
                        <div className="message-avatar">∑</div>
                      )}

                      <div className={`message ${message.role}`}>
                        <MathMessage text={message.text} />
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="message-row">
                      <div className="message-avatar">∑</div>
                      <div className="message assistant">
                        MathMate is thinking, lovely... ♡
                      </div>
                    </div>
                  )}
                </div>

                {file && (
                  <div className="file-preview">
                    <span className="file-icon">▧</span>
                    <span className="file-name">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFile(null)}
                      aria-label="Remove selected image"
                    >
                      ×
                    </button>
                  </div>
                )}

                <form className="composer" onSubmit={sendMessage}>
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="Type your question here, lovely..."
                    rows={2}
                    aria-label="Your math question"
                    disabled={isLoading}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />

                  <div className="composer-actions">
                    <label className="upload-button">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileChange}
                        hidden
                        disabled={isLoading}
                      />
                      <span className="upload-plus">＋</span>
                      <span>Add a problem photo</span>
                    </label>

                    <button
                      className="send-button"
                      type="submit"
                      disabled={
                        isLoading || (!question.trim() && !file)
                      }
                    >
                      <span>{isLoading ? "Thinking..." : "Send"}</span>
                      <span>{isLoading ? "…" : "↗"}</span>
                    </button>
                  </div>
                </form>

                <p className="composer-note">
                  <span>♡</span> Mistakes mean you're learning. You're safe
                  to ask.
                </p>
              </section>
            </>
          )}

          {activePage === "practice" && (
            <section className="content-card">
              <div className="content-card-icon">✿</div>
              <p className="content-eyebrow">A LITTLE PRACTICE</p>
              <h2>Practice makes progress.</h2>
              <p>
                Your practice corner is ready for its next step. We'll connect
                your saved questions and difficulty levels when the backend is
                integrated.
              </p>
              <button
                className="primary-action"
                onClick={() => setActivePage("notebook")}
              >
                Ask your tutor <span>♡</span>
              </button>
            </section>
          )}

          {activePage === "progress" && (
            <section className="content-card">
              <div className="content-card-icon">✧</div>
              <p className="content-eyebrow">YOUR LEARNING JOURNEY</p>
              <h2>Every little step counts.</h2>
              <p>
                Your study streak, solved problems, and learning history will
                live here once progress tracking is connected to the backend.
              </p>

              <div className="progress-placeholders">
                <div>
                  <span>♡</span>
                  <strong>Study streak</strong>
                  <small>Coming soon</small>
                </div>
                <div>
                  <span>✎</span>
                  <strong>Problems solved</strong>
                  <small>Coming soon</small>
                </div>
                <div>
                  <span>✧</span>
                  <strong>Topics explored</strong>
                  <small>Coming soon</small>
                </div>
              </div>

              <button
                className="primary-action"
                onClick={() => setActivePage("notebook")}
              >
                Back to notebook <span>♡</span>
              </button>
            </section>
          )}

          <section className="feature-row" aria-label="MathMate features">
            <div className="feature-card">
              <span className="feature-icon pink-icon">✿</span>
              <div>
                <strong>Step by step</strong>
                <span>We'll figure it out.</span>
              </div>
            </div>

            <div className="feature-card">
              <span className="feature-icon purple-icon">♡</span>
              <div>
                <strong>At your own pace</strong>
                <span>No rush, ever.</span>
              </div>
            </div>

            <div className="feature-card">
              <span className="feature-icon peach-icon">✧</span>
              <div>
                <strong>Little wins matter</strong>
                <span>Every day counts.</span>
              </div>
            </div>
          </section>

          <footer className="page-footer">
            made with <span>♡</span> for curious minds
          </footer>
        </div>
      </main>
    </div>
  );
}

export default App;
