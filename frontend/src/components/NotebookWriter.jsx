import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PDFDocument } from "pdf-lib";
import "./NotebookWriter.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const API_BASE = "http://127.0.0.1:8000";

const STUDENT_COLORS = [
  { label: "Charcoal", value: "#2e2438" },
  { label: "Pen Blue", value: "#1a4d8c" },
  { label: "Berry", value: "#7c2869" },
  { label: "Forest", value: "#1a6b3d" },
];

const TUTOR_INK = "#502479";
const TUTOR_INK_DARK = "#dcb3f2";

export default function NotebookWriter({
  darkMode = false,
  onSolutionGenerated,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const fileInputRef = useRef(null);

  // Tools & Settings
  const [tool, setTool] = useState("pen"); // pen, highlighter, eraser
  const [strokeColor, setStrokeColor] = useState(STUDENT_COLORS[0].value);
  const [brushSize, setBrushSize] = useState(3);
  const [paperStyle, setPaperStyle] = useState("ruled"); // ruled, grid, plain

  // Homework document layer
  const [hasHomeworkDropped, setHasHomeworkDropped] = useState(false);
  const [homeworkTitle, setHomeworkTitle] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const backgroundDocRef = useRef(null);

  // Agentic Voice & Ambient Listener
  const [ambientListening, setAmbientListening] = useState(false);
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [roastMode, setRoastMode] = useState(false);
  const speechRecognitionRef = useRef(null);

  // Processing & Tutor State
  const [isTutorThinking, setIsTutorThinking] = useState(false);
  const [isWritingAnimation, setIsWritingAnimation] = useState(false);
  const [currentResponse, setCurrentResponse] = useState(null);
  const [statusMessage, setStatusMessage] = useState(
    "Ready"
  );

  // History for Undo / Redo
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  // Animation timer ref
  const animTimerRef = useRef(null);

  // -------------------------------------------------------------
  // CANVAS BACKGROUND & SIZING
  // -------------------------------------------------------------

  const drawPaperPattern = useCallback(
    (context, width, height, style, isDark) => {
      // Background paper color
      context.fillStyle = isDark ? "#221a29" : "#fffdfb";
      context.fillRect(0, 0, width, height);

      // Draw dropped homework document if present
      if (backgroundDocRef.current) {
        try {
          context.drawImage(backgroundDocRef.current, 0, 0, width, height);
          return;
        } catch (e) {
          console.warn("Error drawing background doc:", e);
        }
      }

      const lineColor = isDark ? "rgba(100, 75, 115, 0.35)" : "rgba(224, 212, 235, 0.75)";
      const marginColor = isDark ? "rgba(190, 85, 120, 0.45)" : "rgba(240, 160, 180, 0.65)";

      if (style === "ruled") {
        const lineSpacing = 32;
        context.lineWidth = 1;
        context.strokeStyle = lineColor;

        for (let y = lineSpacing * 1.5; y < height; y += lineSpacing) {
          context.beginPath();
          context.moveTo(0, Math.round(y) + 0.5);
          context.lineTo(width, Math.round(y) + 0.5);
          context.stroke();
        }

        const marginX = 56;
        context.strokeStyle = marginColor;
        context.lineWidth = 1.5;
        context.beginPath();
        context.moveTo(marginX + 0.5, 0);
        context.lineTo(marginX + 0.5, height);
        context.stroke();
      } else if (style === "grid") {
        const gridSpacing = 24;
        context.lineWidth = 0.8;
        context.strokeStyle = lineColor;

        for (let x = gridSpacing; x < width; x += gridSpacing) {
          context.beginPath();
          context.moveTo(Math.round(x) + 0.5, 0);
          context.lineTo(Math.round(x) + 0.5, height);
          context.stroke();
        }

        for (let y = gridSpacing; y < height; y += gridSpacing) {
          context.beginPath();
          context.moveTo(0, Math.round(y) + 0.5);
          context.lineTo(width, Math.round(y) + 0.5);
          context.stroke();
        }
      }
    },
    []
  );

  const redrawCanvasWithBackground = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const currentSnapshot = undoStackRef.current[undoStackRef.current.length - 1];

    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawPaperPattern(context, rect.width, rect.height, paperStyle, darkMode);

    if (currentSnapshot) {
      const img = new Image();
      img.onload = () => {
        context.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = currentSnapshot;
    }
  }, [paperStyle, darkMode, drawPaperPattern]);

  const saveState = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const dataUrl = canvas.toDataURL("image/png");
      undoStackRef.current.push(dataUrl);
      if (undoStackRef.current.length > 30) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
    } catch (e) {
      console.warn("Could not save canvas snapshot:", e);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);

    const context = canvas.getContext("2d");
    if (context) {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawPaperPattern(context, rect.width, rect.height, paperStyle, darkMode);
      saveState();
    }

    const handleResize = () => {
      redrawCanvasWithBackground();
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    redrawCanvasWithBackground();
  }, [paperStyle, darkMode, redrawCanvasWithBackground]);

  // -------------------------------------------------------------
  // HOMEWORK DROP-IN & FILE UPLOAD
  // -------------------------------------------------------------

  const loadHomeworkFile = async (file) => {
    if (!file) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();

    setStatusMessage(`Loading homework: ${file.name}…`);

    try {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });

        const pdfCanvas = document.createElement("canvas");
        pdfCanvas.width = viewport.width;
        pdfCanvas.height = viewport.height;
        const pdfContext = pdfCanvas.getContext("2d");

        await page.render({ canvasContext: pdfContext, viewport }).promise;

        backgroundDocRef.current = pdfCanvas;
        setHasHomeworkDropped(true);
        setHomeworkTitle(file.name);
        redrawCanvasWithBackground();
        saveState();
        setStatusMessage(`Homework PDF "${file.name}" placed on notebook. Ask MathMate out loud! 🎙️`);
      } else if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => {
          const img = new Image();
          img.onload = () => {
            backgroundDocRef.current = img;
            setHasHomeworkDropped(true);
            setHomeworkTitle(file.name);
            redrawCanvasWithBackground();
            saveState();
            setStatusMessage(`Homework image "${file.name}" placed on notebook. Ask MathMate out loud! 🎙️`);
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      }
    } catch (err) {
      console.error("Homework loading error:", err);
      setStatusMessage(`Could not load homework: ${err.message}`);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = () => {
    setIsDraggingOver(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = e.dataTransfer.files;
    if (files.length) {
      await loadHomeworkFile(files[0]);
    }
  };

  // -------------------------------------------------------------
  // VOICE & SPEECH SYNTHESIS ENGINE
  // -------------------------------------------------------------

  const speakText = (text) => {
    if (!window.speechSynthesis) return;

    window.speechSynthesis.cancel();
    const cleanText = String(text || "")
      .replace(/[*_#`~]+/g, "")
      .replace(/\$\$([\s\S]+?)\$\$/g, "$1")
      .replace(/\\\[([\s\S]+?)\\\]/g, "$1")
      .replace(/\\\(([\s\S]+?)\\\)/g, "$1");

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;
    window.speechSynthesis.speak(utterance);
  };

  // Ambient listener setup
  const toggleAmbientListening = () => {
    if (ambientListening) {
      if (speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch (_) {}
      }
      setAmbientListening(false);
      setIsSpeechActive(false);
      setStatusMessage("Ambient voice listener paused.");
    } else {
      const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        setStatusMessage("SpeechRecognition is not supported in this browser. You can use the Voice Prompt chips or Push-to-Talk!");
        return;
      }

      try {
        const recognizer = new SpeechRecognition();
        recognizer.continuous = true;
        recognizer.interimResults = true;
        recognizer.lang = "en-US";

        recognizer.onstart = () => {
          setAmbientListening(true);
          setIsSpeechActive(true);
          setStatusMessage("Ambient Tutor listening in background… Speak your math question out loud! 🎙️");
        };

        recognizer.onresult = (event) => {
          let interim = "";
          let final = "";

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              final += event.results[i][0].transcript;
            } else {
              interim += event.results[i][0].transcript;
            }
          }

          const currentSpeech = final || interim;
          setLiveTranscript(currentSpeech);

          if (final.trim()) {
            setStatusMessage(`Heard: "${final.trim()}"`);
            triggerAgenticAction(final.trim());
          }
        };

        recognizer.onerror = (e) => {
          console.warn("Speech recognition error:", e);
          if (e.error !== "no-speech") {
            setIsSpeechActive(false);
          }
        };

        recognizer.onend = () => {
          // Restart if still in ambient listening mode
          if (ambientListening) {
            try {
              recognizer.start();
            } catch (_) {}
          } else {
            setIsSpeechActive(false);
          }
        };

        recognizer.start();
        speechRecognitionRef.current = recognizer;
      } catch (err) {
        console.error("Recognizer start error:", err);
        setStatusMessage(`Could not start microphone: ${err.message}`);
      }
    }
  };

  // -------------------------------------------------------------
  // AGENTIC ACTIONS (FINISH CALCULATION, DRAW GRAPH, FLAG MISTAKE)
  // -------------------------------------------------------------

  const triggerAgenticAction = async (spokenQuery) => {
    if (!spokenQuery || isTutorThinking) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    setIsTutorThinking(true);
    setStatusMessage(`MathMate is listening & reasoning: "${spokenQuery}"… ✨`);

    try {
      // Export current canvas snapshot
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const exportCtx = exportCanvas.getContext("2d");
      if (!exportCtx) throw new Error("Canvas error");

      exportCtx.fillStyle = "#ffffff";
      exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      exportCtx.drawImage(canvas, 0, 0);

      const imageBase64 = exportCanvas.toDataURL("image/png");

      const response = await fetch(`${API_BASE}/api/agentic-tutor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: imageBase64,
          user_speech: spokenQuery,
          roast_mode: roastMode,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "MathMate could not process query.");
      }

      setCurrentResponse(data);

      // 1. Speak aloud
      if (data.spoken_response) {
        speakText(data.spoken_response);
      }

      // 2. Draw graph if requested
      if (data.graph_data?.should_graph) {
        drawGraphOnCanvas(data.graph_data);
      }

      // 3. Flag mistake if present
      if (data.mistake_flag?.has_mistake) {
        drawMistakeFlagOnCanvas(data.mistake_flag);
      }

      // 4. Write handwritten steps on notebook
      if (data.handwritten_notes && data.handwritten_notes.length) {
        writeStepsOnCanvas(data.handwritten_notes, 45, true, data.final_answer);
      }

      // 5. Notify parent App
      if (onSolutionGenerated) {
        onSolutionGenerated({
          recognized_problem: spokenQuery,
          handwritten_steps: data.handwritten_notes,
          sidebar_explanation: data.spoken_response,
          final_answer: data.final_answer,
        });
      }

      setStatusMessage(data.roast ? `🔥 Roast: "${data.roast}"` : "MathMate answered on your notebook! ✨");
    } catch (err) {
      console.error("Agentic action error:", err);
      setStatusMessage(`Error: ${err.message}`);
    } finally {
      setIsTutorThinking(false);
    }
  };

  // -------------------------------------------------------------
  // GRAPH DRAWING ON NOTEBOOK CANVAS
  // -------------------------------------------------------------

  const drawGraphOnCanvas = (graphData) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    // Coordinate plane dimensions on canvas
    const graphWidth = 260;
    const graphHeight = 220;
    const originX = rect.width - graphWidth - 28;
    const originY = 60;
    const centerX = originX + graphWidth / 2;
    const centerY = originY + graphHeight / 2;

    const scale = 20; // 20 pixels per unit

    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Graph card background
    context.fillStyle = darkMode ? "#2c2035" : "#ffffff";
    context.shadowColor = "rgba(0, 0, 0, 0.15)";
    context.shadowBlur = 10;
    context.fillRect(originX, originY, graphWidth, graphHeight);
    context.strokeStyle = darkMode ? "#6b497a" : "#d7bedc";
    context.lineWidth = 1.5;
    context.strokeRect(originX, originY, graphWidth, graphHeight);
    context.shadowBlur = 0;

    // Grid lines
    context.strokeStyle = darkMode ? "rgba(110, 75, 125, 0.3)" : "rgba(220, 205, 230, 0.6)";
    context.lineWidth = 0.7;

    for (let x = originX; x <= originX + graphWidth; x += scale) {
      context.beginPath();
      context.moveTo(x, originY);
      context.lineTo(x, originY + graphHeight);
      context.stroke();
    }

    for (let y = originY; y <= originY + graphHeight; y += scale) {
      context.beginPath();
      context.moveTo(originX, y);
      context.lineTo(originX + graphWidth, y);
      context.stroke();
    }

    // X and Y Axes
    context.strokeStyle = darkMode ? "#edd5f5" : "#452457";
    context.lineWidth = 1.8;

    // X Axis
    context.beginPath();
    context.moveTo(originX + 10, centerY);
    context.lineTo(originX + graphWidth - 10, centerY);
    context.stroke();

    // Y Axis
    context.beginPath();
    context.moveTo(centerX, originY + 10);
    context.lineTo(centerX, originY + graphHeight - 10);
    context.stroke();

    // Graph Title
    context.fillStyle = darkMode ? "#ecc3f5" : "#6f3180";
    context.font = "bold 13px 'DM Sans', sans-serif";
    context.fillText(graphData.title || "Graph", originX + 12, originY + 20);

    // Plot Function: dynamically evaluate Gemini expression
    context.strokeStyle = "#e84393";
    context.lineWidth = 2.5;
    context.beginPath();

    // Build a safe evaluator from Gemini's expression string
    let evalFn;
    try {
      const rawExpr = (graphData.expression || "x**2 - 4")
        .replace(/\^/g, "**")
        .replace(/(\d)(x)/g, "$1*$2")
        .replace(/sqrt\(/g, "Math.sqrt(")
        .replace(/abs\(/g, "Math.abs(")
        .replace(/sin\(/g, "Math.sin(")
        .replace(/cos\(/g, "Math.cos(")
        .replace(/tan\(/g, "Math.tan(")
        .replace(/log\(/g, "Math.log10(")
        .replace(/ln\(/g, "Math.log(")
        .replace(/pi/gi, "Math.PI")
        .replace(/e(?![a-zA-Z])/g, "Math.E");
      // eslint-disable-next-line no-new-func
      evalFn = new Function("x", `"use strict"; return (${rawExpr});`);
      // Sanity check
      evalFn(0);
    } catch (_) {
      evalFn = (x) => x * x - 4; // fallback: x^2 - 4
    }

    let started = false;
    for (let px = originX + 10; px <= originX + graphWidth - 10; px += 2) {
      const mathX = (px - centerX) / scale;
      let mathY = 0;

      try {
        mathY = evalFn(mathX);
        if (!isFinite(mathY)) { started = false; continue; }
      } catch (_) {
        started = false;
        continue;
      }

      const py = centerY - mathY * scale;

      if (py >= originY + 5 && py <= originY + graphHeight - 5) {
        if (!started) {
          context.moveTo(px, py);
          started = true;
        } else {
          context.lineTo(px, py);
        }
      } else {
        started = false;
      }
    }
    context.stroke();

    // Plot key points (roots, vertex)
    if (graphData.points && Array.isArray(graphData.points)) {
      graphData.points.forEach(([label, mx, my]) => {
        const px = centerX + mx * scale;
        const py = centerY - my * scale;

        if (px >= originX && px <= originX + graphWidth && py >= originY && py <= originY + graphHeight) {
          context.fillStyle = "#8e24aa";
          context.beginPath();
          context.arc(px, py, 4, 0, Math.PI * 2);
          context.fill();

          context.font = "bold 11px 'DM Sans', sans-serif";
          context.fillStyle = darkMode ? "#fae2ff" : "#3b1e4c";
          context.fillText(label, px + 6, py - 4);
        }
      });
    }

    context.restore();
    saveState();
  };

  // -------------------------------------------------------------
  // MISTAKE FLAGGING ON NOTEBOOK CANVAS
  // -------------------------------------------------------------

  const drawMistakeFlagOnCanvas = (mistakeFlag) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    const x = Math.round((rect.width * (mistakeFlag.x_percent || 40)) / 100);
    const y = Math.round((rect.height * (mistakeFlag.y_percent || 30)) / 100);

    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    // Circle mistake spot in alert coral
    context.strokeStyle = "#e84118";
    context.lineWidth = 2.5;
    context.setLineDash([4, 4]);
    context.beginPath();
    context.arc(x, y, 28, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);

    // Draw Sticky Note Flag
    const noteX = Math.min(rect.width - 200, x + 35);
    const noteY = Math.max(20, y - 25);
    const noteW = 190;
    const noteH = 65;

    context.fillStyle = "#fff0ee";
    context.shadowColor = "rgba(232, 65, 24, 0.2)";
    context.shadowBlur = 8;
    context.fillRect(noteX, noteY, noteW, noteH);
    context.strokeStyle = "#f39c87";
    context.lineWidth = 1.5;
    context.strokeRect(noteX, noteY, noteW, noteH);
    context.shadowBlur = 0;

    context.fillStyle = "#9c2616";
    context.font = "bold 12px 'DM Sans', sans-serif";
    context.fillText("⚠️ Mistake Flagged!", noteX + 10, noteY + 18);

    context.fillStyle = "#4a241b";
    context.font = "12px 'DM Sans', sans-serif";
    context.fillText(mistakeFlag.note || "Check sign error", noteX + 10, noteY + 36, noteW - 20);

    if (mistakeFlag.correction) {
      context.fillStyle = "#1e7e34";
      context.font = "bold 11px 'DM Sans', sans-serif";
      context.fillText(`Fix: ${mistakeFlag.correction}`, noteX + 10, noteY + 52);
    }

    context.restore();
    saveState();
  };

  // -------------------------------------------------------------
  // DIRECT HANDWRITING ON NOTEBOOK
  // -------------------------------------------------------------

  const writeStepsOnCanvas = (steps, startYPercent = 45, isAnimated = true, finalAnswer = "") => {
    const canvas = canvasRef.current;
    if (!canvas || !steps || !steps.length) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    if (animTimerRef.current) {
      clearInterval(animTimerRef.current);
      animTimerRef.current = null;
    }

    const startX = 74;
    const startY = Math.max(100, Math.round((rect.height * startYPercent) / 100));
    const lineHeight = 34;
    const ink = darkMode ? TUTOR_INK_DARK : TUTOR_INK;

    if (!isAnimated) {
      context.save();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.font = "bold 24px 'Caveat', 'Segoe Print', cursive, sans-serif";
      context.fillStyle = ink;

      let currentY = startY;
      steps.forEach((step, idx) => {
        const isFinal = idx === steps.length - 1;
        if (isFinal) {
          context.font = "bold 26px 'Caveat', 'Segoe Print', cursive, sans-serif";
          context.fillStyle = darkMode ? "#fae2ff" : "#451a66";
          context.fillText(`${step}  ✓`, startX, currentY);
        } else {
          context.fillText(step, startX, currentY);
        }
        currentY += lineHeight;
      });

      context.restore();
      saveState();
      return;
    }

    setIsWritingAnimation(true);
    let currentStepIdx = 0;
    let currentY = startY;

    animTimerRef.current = setInterval(() => {
      if (currentStepIdx >= steps.length) {
        clearInterval(animTimerRef.current);
        animTimerRef.current = null;
        setIsWritingAnimation(false);
        saveState();
        return;
      }

      const step = steps[currentStepIdx];
      const isFinal = currentStepIdx === steps.length - 1;

      context.save();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.globalCompositeOperation = "source-over";

      if (isFinal) {
        context.font = "bold 26px 'Caveat', 'Segoe Print', cursive, sans-serif";
        context.fillStyle = darkMode ? "#fae2ff" : "#451a66";

        const textWidth = context.measureText(step).width;
        const boxPadding = 8;
        const boxX = startX - boxPadding;
        const boxY = currentY - 18;
        const boxW = textWidth + boxPadding * 2 + 25;
        const boxH = 36;

        context.fillStyle = darkMode ? "rgba(95, 45, 120, 0.4)" : "rgba(245, 225, 252, 0.75)";
        context.fillRect(boxX, boxY, boxW, boxH);
        context.strokeStyle = darkMode ? "#b983d5" : "#b06bc2";
        context.lineWidth = 1.8;
        context.strokeRect(boxX, boxY, boxW, boxH);

        context.fillStyle = darkMode ? "#fae2ff" : "#451a66";
        context.fillText(`${step}  ✓`, startX, currentY);
      } else {
        context.font = "bold 24px 'Caveat', 'Segoe Print', cursive, sans-serif";
        context.fillStyle = ink;
        context.fillText(step, startX, currentY);
      }

      context.restore();
      currentY += lineHeight;
      currentStepIdx += 1;
    }, 380);
  };

  // -------------------------------------------------------------
  // DRAWING TOOLS (PEN, HIGHLIGHTER, ERASER)
  // -------------------------------------------------------------

  const getPoint = (event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const startDrawing = (event) => {
    if (isTutorThinking || isWritingAnimation) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);

    drawingRef.current = true;
    const point = getPoint(event);
    lastPointRef.current = point;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;

    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    if (tool === "eraser") {
      context.globalCompositeOperation = "destination-out";
      context.beginPath();
      context.arc(point.x, point.y, brushSize * 4, 0, Math.PI * 2);
      context.fill();
    } else if (tool === "highlighter") {
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 0.35;
      context.fillStyle = "#ffde59";
      context.beginPath();
      context.arc(point.x, point.y, brushSize * 3, 0, Math.PI * 2);
      context.fill();
    } else {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = strokeColor;
      context.beginPath();
      context.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  };

  const draw = (event) => {
    if (!drawingRef.current || !lastPointRef.current || isTutorThinking || isWritingAnimation) {
      return;
    }
    event.preventDefault();

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!context) return;

    const point = getPoint(event);
    const last = lastPointRef.current;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    context.save();
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineCap = "round";
    context.lineJoin = "round";

    if (tool === "eraser") {
      context.globalCompositeOperation = "destination-out";
      context.lineWidth = brushSize * 8;
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    } else if (tool === "highlighter") {
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 0.35;
      context.strokeStyle = "#ffde59";
      context.lineWidth = brushSize * 6;
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    } else {
      context.globalCompositeOperation = "source-over";
      context.strokeStyle = strokeColor;
      context.lineWidth = brushSize;
      context.beginPath();
      context.moveTo(last.x, last.y);
      context.lineTo(point.x, point.y);
      context.stroke();
    }

    context.restore();
    lastPointRef.current = point;
  };

  const stopDrawing = () => {
    if (drawingRef.current) {
      drawingRef.current = false;
      lastPointRef.current = null;
      saveState();
    }
  };

  const clearNotebook = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(window.devicePixelRatio || 1, 1);

    backgroundDocRef.current = null;
    setHasHomeworkDropped(false);
    setHomeworkTitle("");
    setCurrentResponse(null);

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawPaperPattern(context, rect.width, rect.height, paperStyle, darkMode);
    saveState();
    setStatusMessage("Notebook cleared.");
  };

  const exportAsPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `MathMate-Notebook-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    setStatusMessage("Notebook page saved as image! 📸");
  };

  return (
    <section className="notebook-writer" aria-label="MathMate Agentic Notebook">
      {/* Header */}
      <div className="nw-header">
        <div>
          <span className="nw-eyebrow">✧ AGENTIC AI MATH TUTOR INSIDE YOUR NOTEBOOK ✧</span>
          <h2 className="nw-title">Notebook</h2>
          <p className="nw-subtitle">
            Drop in your homework or write your problem. MathMate listens in the background, finishes calculations,
            flags mistakes, draws graphs, and directly writes on the notebook!
          </p>
        </div>

        <div className="nw-header-badges">
          <span className="nw-header-badge">
            <span>🧠 Gemini Agentic Vision</span>
          </span>
          <span className="nw-header-badge">
            <span>🎙️ Ambient Voice Listener</span>
          </span>
        </div>
      </div>

      {/* Ambient Voice & Roast Control Bar */}
      <div className="nw-ambient-bar">
        <div className="nw-ambient-left">
          <div className={`nw-mic-pulse ${isSpeechActive ? "is-listening" : ""}`}>
            <span>{isSpeechActive ? "🎙️" : "💤"}</span>
          </div>
          <div className="nw-ambient-info">
            <span className="nw-ambient-title">
              {ambientListening
                ? isSpeechActive
                  ? "Ambient Tutor: Listening for questions…"
                  : "Ambient Tutor Active"
                : "Ambient Tutor: Standby"}
            </span>
            <span className="nw-ambient-hint">
              {liveTranscript
                ? `Transcript: "${liveTranscript}"`
                : "Ask out loud: 'How do I get started?', 'Check my work', 'Draw a graph'"}
            </span>
          </div>
        </div>

        <div className="nw-ambient-controls">
          <button
            type="button"
            className={`nw-btn-mic-toggle ${ambientListening ? "is-listening" : ""}`}
            onClick={toggleAmbientListening}
            title="Toggle background ambient voice listening"
          >
            {ambientListening ? "⏹ Stop Listening" : "🎙️ Enable Ambient Mic"}
          </button>

          <button
            type="button"
            className={`nw-btn-roast-toggle ${roastMode ? "is-on" : ""}`}
            onClick={() => setRoastMode((v) => !v)}
            title="Toggle DeepMind hackathon roast mode"
          >
            {roastMode ? "🔥 Roast Mode: ON" : "✨ Cozy Tutor: ON"}
          </button>
        </div>
      </div>

      {/* Voice Prompt Chips for Immediate Testing */}
      <div className="nw-voice-chips-bar">
        <span className="nw-voice-chip-label">Ask Out Loud:</span>
        {[
          "How do I get started with problem 1?",
          "Check my work for mistakes",
          "Finish this calculation",
          "Draw a graph of y = x² - 4",
          "Roast my math skills 🔥",
        ].map((promptText) => (
          <button
            key={promptText}
            type="button"
            className="nw-voice-chip"
            onClick={() => triggerAgenticAction(promptText)}
            disabled={isTutorThinking || isWritingAnimation}
          >
            {promptText}
          </button>
        ))}
      </div>

      {/* Roast Banner if Roast Mode is active and returned */}
      {currentResponse?.roast && (
        <div className="nw-roast-banner">
          <span style={{ fontSize: "20px" }}>🔥</span>
          <span><strong>MathMate Roast:</strong> {currentResponse.roast}</span>
        </div>
      )}

      {/* Drop-in Homework Bar */}
      <div
        className={`nw-dropzone-bar ${isDraggingOver ? "is-dragging" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="nw-drop-info">
          <span className="nw-drop-icon">📂</span>
          <div className="nw-drop-text">
            <strong>
              {hasHomeworkDropped
                ? `Homework Attached: ${homeworkTitle}`
                : "Just drop in your homework (PDF, Photo, or Screenshot)"}
            </strong>
            <small>
              {hasHomeworkDropped
                ? "Active on your notebook canvas. Speak out loud or ask a question!"
                : "Drag & drop your file here, or click to browse."}
            </small>
          </div>
        </div>

        <div className="nw-drop-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/*"
            onChange={(e) => {
              if (e.target.files?.[0]) loadHomeworkFile(e.target.files[0]);
            }}
            hidden
          />
          <button
            type="button"
            className="nw-btn-drop-upload"
            onClick={() => fileInputRef.current?.click()}
          >
            {hasHomeworkDropped ? "Replace Homework" : "Drop In Homework"}
          </button>
        </div>
      </div>

      {/* Main Drawing Toolbar */}
      <div className="nw-toolbar">
        <div className="nw-tool-group">
          <button
            type="button"
            className={`nw-tool-btn ${tool === "pen" ? "is-active" : ""}`}
            onClick={() => setTool("pen")}
            disabled={isTutorThinking || isWritingAnimation}
          >
            ✏️ Pen
          </button>

          <button
            type="button"
            className={`nw-tool-btn ${tool === "highlighter" ? "is-active" : ""}`}
            onClick={() => setTool("highlighter")}
            disabled={isTutorThinking || isWritingAnimation}
          >
            🖌️ Highlight
          </button>

          <button
            type="button"
            className={`nw-tool-btn ${tool === "eraser" ? "is-active" : ""}`}
            onClick={() => setTool("eraser")}
            disabled={isTutorThinking || isWritingAnimation}
          >
            🧹 Eraser
          </button>
        </div>

        <div className="nw-tool-group">
          <div className="nw-colors" aria-label="Student ink color">
            {STUDENT_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`nw-color-swatch ${strokeColor === c.value ? "is-selected" : ""}`}
                style={{ backgroundColor: c.value }}
                onClick={() => {
                  setStrokeColor(c.value);
                  if (tool === "eraser") setTool("pen");
                }}
                title={c.label}
              />
            ))}
          </div>

          <label className="nw-size-control">
            Size:
            <input
              type="range"
              min="1"
              max="8"
              value={brushSize}
              onChange={(e) => setBrushSize(Number(e.target.value))}
              disabled={isTutorThinking || isWritingAnimation}
            />
          </label>
        </div>

        <div className="nw-tool-group">
          <select
            className="nw-paper-select"
            value={paperStyle}
            onChange={(e) => setPaperStyle(e.target.value)}
            disabled={isTutorThinking || isWritingAnimation}
            aria-label="Notebook paper style"
          >
            <option value="ruled">📑 Ruled Notebook</option>
            <option value="grid">📐 Math Grid</option>
            <option value="plain">📄 Blank Page</option>
          </select>

          <button
            type="button"
            className="nw-tool-btn"
            onClick={clearNotebook}
            disabled={isTutorThinking || isWritingAnimation}
            title="Clear entire notebook"
          >
            🗑️ Clear
          </button>
        </div>
      </div>

      {/* Notebook Canvas Surface */}
      <div className="nw-canvas-container">
        <canvas
          ref={canvasRef}
          className="nw-canvas-surface"
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
          onLostPointerCapture={stopDrawing}
          aria-label="MathMate interactive notebook page"
        />

        {/* Floating writing indicator badge */}
        {(isTutorThinking || isWritingAnimation) && (
          <div className="nw-writing-indicator">
            <span className="nw-pen-icon">✍</span>
            <span>
              {isTutorThinking
                ? "MathMate is reasoning over your homework…"
                : "MathMate is writing on your notebook…"}
            </span>
          </div>
        )}
      </div>

      {/* Solution Inspector below canvas */}
      {currentResponse && (
        <div className="nw-solution-card">
          <div className="nw-sc-header">
            <div>
              <span className="nw-sc-badge">
                ✧ MathMate Agentic Action: {currentResponse.intent?.replace(/_/g, " ")}
              </span>
            </div>
            {currentResponse.final_answer && (
              <div className="nw-sc-answer-pill">
                Result: {currentResponse.final_answer}
              </div>
            )}
          </div>

          {currentResponse.spoken_response && (
            <div className="nw-sc-spoken-bubble">
              <strong>🗣️ MathMate Said:</strong> {currentResponse.spoken_response}
            </div>
          )}

          {currentResponse.handwritten_notes?.length > 0 && (
            <div className="nw-sc-steps-list">
              {currentResponse.handwritten_notes.map((step, idx) => (
                <div key={idx} className="nw-sc-step-item">
                  <span className="nw-sc-step-num">{idx + 1}</span>
                  <span>{step}</span>
                </div>
              ))}
            </div>
          )}

          {currentResponse.mistake_flag?.has_mistake && (
            <div className="nw-mistake-alert">
              <span>⚠️</span>
              <div>
                <strong>Mistake Detected on Notebook:</strong>
                <p style={{ margin: "2px 0" }}>{currentResponse.mistake_flag.note}</p>
                {currentResponse.mistake_flag.correction && (
                  <small style={{ color: "#286b57", fontWeight: 700 }}>
                    Correction: {currentResponse.mistake_flag.correction}
                  </small>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer bar */}
      <div className="nw-footer-bar">
        <div className="nw-footer-status">
          <span>{statusMessage}</span>
        </div>

        <div className="nw-footer-actions">
          <button
            type="button"
            className="nw-action-btn"
            onClick={exportAsPng}
            disabled={isTutorThinking || isWritingAnimation}
            title="Download notebook page as PNG"
          >
            💾 Save PNG
          </button>
        </div>
      </div>
    </section>
  );
}
