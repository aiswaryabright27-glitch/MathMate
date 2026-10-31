import { useEffect, useState } from "react";
import { Moon, RotateCcw, Sun } from "lucide-react";
import "./App.css";
import FloatingTutor from "./components/FloatingTutor";
import NotebookWriter from "./components/NotebookWriter";
import PDFWriteMode from "./components/PDFWriteMode";

const initialMessages = [
  {
    role: "assistant",
    text: "Hi, I'm MathMate. Capture your notes or ask me a math question.",
  },
];

function App() {
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem("mathmate-theme") === "dark"
  );
  const [tutorOpen, setTutorOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState(initialMessages);
  const [file, setFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [canvasSnapshot, setCanvasSnapshot] = useState("");
  const [imageError, setImageError] = useState("");
  const [currentContext, setCurrentContext] = useState("");
  const [notebookTab, setNotebookTab] = useState("writer");

  useEffect(() => {
    localStorage.setItem("mathmate-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  function startNewSession() {
    setMessages(initialMessages);
    setQuestion("");
    setFile(null);
    setCanvasSnapshot("");
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

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/analyze-workbook",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_base64: imageBase64, user_prompt: userPrompt }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "MathMate couldn't read that image. Please try again.");
      }

      const recognizedProblem = data.recognized_problem || "Math problem from your image";
      const explanation =
        data.sidebar_explanation ||
        data.solution ||
        data.speech_text ||
        "MathMate analysed your image, but no explanation was returned.";
      const steps = Array.isArray(data.handwritten_steps)
        ? data.handwritten_steps.join("\n\n")
        : typeof data.handwritten_steps === "string"
          ? data.handwritten_steps
          : "";

      setCurrentContext(
        `Current worksheet problem: ${recognizedProblem}\n\nCurrent explanation: ${explanation}`
      );
      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: ["### Problem", recognizedProblem, steps, explanation]
            .filter(Boolean)
            .join("\n\n"),
        },
      ]);
    } catch (error) {
      const message =
        error.message === "Failed to fetch"
          ? "I couldn't reach the MathMate API. Check that the backend is running."
          : error.message || "Something went wrong. Please try again.";
      setImageError(message);
      setMessages((previous) => [...previous, { role: "assistant", text: message }]);
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
        setImageError("Choose a PNG, JPG, or another image file.");
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const imageData = typeof reader.result === "string" ? reader.result : "";
        if (!imageData) {
          setImageError("I couldn't read that image. Please try another.");
          return;
        }

        setMessages((previous) => [
          ...previous,
          { role: "user", text: text || "Please read and solve the math in my image." },
        ]);
        setQuestion("");
        setFile(null);
        await solveImage(
          imageData,
          text || "Read and solve the mathematics problem in this image step by step. Explain it clearly."
        );
      };
      reader.onerror = () => setImageError("I couldn't open that image. Please try again.");
      reader.readAsDataURL(selectedFile);
      return;
    }

    setMessages((previous) => [...previous, { role: "user", text }]);
    setQuestion("");
    setIsLoading(true);

    try {
      const contextualMessage = currentContext
        ? `${currentContext}\n\nStudent follow-up question: ${text}`
        : text;
      const response = await fetch("http://127.0.0.1:8000/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: contextualMessage,
          image_base64: canvasSnapshot || null,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "MathMate couldn't respond right now. Please try again.");
      }

      setMessages((previous) => [
        ...previous,
        {
          role: "assistant",
          text: data.response || data.reply || "MathMate returned an empty response.",
        },
      ]);
    } catch (error) {
      const message =
        error.message === "Failed to fetch"
          ? "I couldn't reach the MathMate API. Check that the backend is running."
          : error.message || "Something went wrong. Please try again.";
      setMessages((previous) => [...previous, { role: "assistant", text: message }]);
    } finally {
      setIsLoading(false);
    }
  }

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;
    if (!selectedFile.type.startsWith("image/")) {
      setImageError("Choose an image file such as PNG or JPG.");
      event.target.value = "";
      return;
    }
    setImageError("");
    setFile(selectedFile);
  }

  function handleScreenCapture(imageBase64) {
    setImageError("");
    setMessages((previous) => [
      ...previous,
      {
        role: "user",
        text: "I captured my screen. Please read the visible notes and answer my question.",
      },
    ]);
    solveImage(
      imageBase64,
      "This is a screenshot captured with the student's permission. Read the visible notes and identify the most relevant mathematics problem. Solve it step by step and explain clearly. Do not claim to have edited the original page."
    );
  }

  return (
    <div className={`app-shell ${darkMode ? "dark-mode" : "light-mode"}`}>
      <header className="app-header">
        <div className="app-brand" aria-label="MathMate">
          <span className="app-brand-mark" aria-hidden="true">∑</span>
          <span>MathMate</span>
        </div>

        <nav className="workspace-tabs" aria-label="Workspace">
          <button
            type="button"
            className={notebookTab === "writer" ? "is-active" : ""}
            onClick={() => setNotebookTab("writer")}
          >
            Notebook
          </button>
          <button
            type="button"
            className={notebookTab === "pdf" ? "is-active" : ""}
            onClick={() => setNotebookTab("pdf")}
          >
            PDF tools
          </button>
        </nav>

        <div className="header-actions">
          <button type="button" className="header-button" onClick={startNewSession} title="New tutor session">
            <RotateCcw size={17} aria-hidden="true" />
            <span>New session</span>
          </button>
          <button
            type="button"
            className="theme-button"
            onClick={() => setDarkMode((current) => !current)}
            aria-label={`Switch to ${darkMode ? "light" : "dark"} mode`}
            title={`Switch to ${darkMode ? "light" : "dark"} mode`}
          >
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      <main className="workspace-main">
        {notebookTab === "writer" ? (
          <>
            <div className="workspace-title">
              <h1>Notebook</h1>
            </div>
            <NotebookWriter darkMode={darkMode} />
          </>
        ) : (
          <>
            <div className="workspace-title">
              <h1>PDF tools</h1>
            </div>
            <PDFWriteMode />
          </>
        )}
      </main>

      <FloatingTutor
        open={tutorOpen}
        onToggle={() => setTutorOpen((open) => !open)}
        messages={messages}
        isLoading={isLoading}
        question={question}
        setQuestion={setQuestion}
        file={file}
        setFile={setFile}
        onSubmit={sendMessage}
        onFileChange={handleFileChange}
        onCapture={handleScreenCapture}
        onNewSession={startNewSession}
        error={imageError}
        darkMode={darkMode}
      />
    </div>
  );
}

export default App;
