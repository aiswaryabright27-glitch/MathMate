
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { PDFDocument } from "pdf-lib";
import "./PDFWriteMode.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const API_URL = "http://127.0.0.1:8000/api/analyze-workbook";

export default function PDFWriteMode() {
  const [expanded, setExpanded] = useState(false);
  const [pdfFile, setPdfFile] = useState(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [placement, setPlacement] = useState(65);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [solution, setSolution] = useState(null);
  const [needsPlacement, setNeedsPlacement] = useState(false);

  const pdfCanvasRef = useRef(null);
  const annotationCanvasRef = useRef(null);
  const pdfDocumentRef = useRef(null);
  const renderedPageRef = useRef(null);
  const annotationDataRef = useRef(null);
  const solutionRef = useRef(null);
  const placementRef = useRef(placement);
  const fileInputRef = useRef(null);

  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);

  useEffect(() => {
    return () => {
      pdfDocumentRef.current?.destroy();
    };
  }, []);

  async function renderPage(documentToRender, index, zoomFactor = zoom, preserveAnnotation = false) {
    const pdfCanvas = pdfCanvasRef.current;
    const annotationCanvas = annotationCanvasRef.current;

    if (!pdfCanvas || !annotationCanvas || !documentToRender) return;

    setStatus("Rendering PDF page…");

    const page = await documentToRender.getPage(index + 1);
    const naturalViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2.5, 1050 / naturalViewport.width) * zoomFactor;
    const viewport = page.getViewport({ scale });

    const width = Math.max(1, Math.round(viewport.width));
    const height = Math.max(1, Math.round(viewport.height));

    pdfCanvas.width = width;
    pdfCanvas.height = height;
    annotationCanvas.width = width;
    annotationCanvas.height = height;

    const context = pdfCanvas.getContext("2d");
    const annotationContext = annotationCanvas.getContext("2d");

    if (!context || !annotationContext) {
      throw new Error("Could not create the PDF drawing canvas.");
    }

    annotationContext.clearRect(0, 0, width, height);

    await page.render({
      canvas: pdfCanvas,
      canvasContext: context,
      viewport,
    }).promise;

    renderedPageRef.current = {
      width,
      height,
      pageWidth: naturalViewport.width,
      pageHeight: naturalViewport.height,
    };

    if (preserveAnnotation && solutionRef.current) {
      drawSolution(solutionRef.current, placementRef.current);
    } else {
      annotationDataRef.current = null;
      setSolution(null);
      solutionRef.current = null;
      setNeedsPlacement(false);
    }
    setStatus(`Page ${index + 1} of ${documentToRender.numPages} ready.`);
  }

  async function openPdf(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setStatus("Please select a PDF file.");
      event.target.value = "";
      return;
    }

    setBusy(true);
    setStatus("Opening PDF…");

    try {
      pdfDocumentRef.current?.destroy();

      const bytes = await file.arrayBuffer();
      const document = await pdfjsLib.getDocument({
        data: new Uint8Array(bytes),
      }).promise;

      pdfDocumentRef.current = document;
      setPdfFile(file);
      setPageIndex(0);
      setPageCount(document.numPages);

      await renderPage(document, 0);
    } catch (error) {
      console.error("PDF open failed:", error);
      setStatus(`Couldn't open PDF: ${error.message}`);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function changePage(nextIndex) {
    const document = pdfDocumentRef.current;

    if (!document || busy || nextIndex < 0 || nextIndex >= document.numPages) {
      return;
    }

    setBusy(true);

    try {
      setPageIndex(nextIndex);
      await renderPage(document, nextIndex);
    } catch (error) {
      console.error("PDF page rendering failed:", error);
      setStatus(`Couldn't render page: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function changeZoom(nextZoom) {
    const document = pdfDocumentRef.current;
    if (!document || busy) return;
    setBusy(true);
    const boundedZoom = Math.max(0.7, Math.min(2, nextZoom));
    setZoom(boundedZoom);
    try {
      await renderPage(document, pageIndex, boundedZoom, true);
    } catch (error) {
      setStatus(`Couldn't zoom page: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  function getSolutionLines(data) {
    const steps = data?.handwritten_steps;

    if (Array.isArray(steps)) {
      return steps.map((step) => String(step).trim()).filter(Boolean);
    }

    if (typeof steps === "string") {
      return steps.split(/\r?\n/).map((step) => step.trim()).filter(Boolean);
    }

    return [];
  }

  function drawSolution(data, topPercent) {
    const canvas = annotationCanvasRef.current;
    const dimensions = renderedPageRef.current;

    if (!canvas || !dimensions) {
      throw new Error("Open a PDF page first.");
    }

    const lines = getSolutionLines(data);

    if (!lines.length) {
      throw new Error("The AI didn't return any solution steps.");
    }

    const context = canvas.getContext("2d");
    if (!context) throw new Error("Couldn't draw the solution.");

    context.clearRect(0, 0, canvas.width, canvas.height);

    const fontSize = Math.max(15, Math.min(24, canvas.width * 0.023));
    const lineHeight = fontSize * 1.65;
    const marginX = Math.max(18, canvas.width * 0.045);
    const maxWidth = canvas.width - marginX * 2;

    context.fillStyle = "#31234c";
    context.textBaseline = "top";
    context.textAlign = "left";

    context.font = `${fontSize}px Arial, sans-serif`;

    const wrappedLines = [];

    for (const originalLine of lines) {
      const words = originalLine.split(/\s+/);
      let current = "";

      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;

        if (context.measureText(candidate).width > maxWidth && current) {
          wrappedLines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }

      if (current) wrappedLines.push(current);
    }

    let y = Math.round((canvas.height * topPercent) / 100);
    const maxY = canvas.height - fontSize - 10;

    for (const line of wrappedLines) {
      if (y > maxY) break;

      context.fillText(line, marginX, y, maxWidth);
      y += lineHeight;
    }

    annotationDataRef.current = canvas.toDataURL("image/png");
    setPlacement(topPercent);
    setNeedsPlacement(false);
    setStatus("Solution placed on the page. Review it before exporting.");
  }

  async function solveAndWrite() {
    const document = pdfDocumentRef.current;
    const pdfCanvas = pdfCanvasRef.current;

    if (!document || !pdfCanvas || !pdfFile) {
      setStatus("Open a PDF first.");
      return;
    }

    setBusy(true);
    setStatus("MathMate is reading and solving the worksheet…");

    try {
      const imageBase64 = pdfCanvas.toDataURL("image/png");

      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: imageBase64,
          user_prompt:
            "Read the mathematics problem on this PDF page. Solve it accurately step by step. Return short, readable solution lines suitable for writing on the page. Identify a genuinely blank area using y_start_percent, from 0 at the top to 100 at the bottom. If there is no safe blank area, return 100. Do not invent a blank area.",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || "The MathMate API request failed.");
      }

      if (data.needs_clarification) {
        setStatus(
          "MathMate couldn't confidently read the problem. Try a clearer page or another scan."
        );
        return;
      }

      const lines = getSolutionLines(data);

      if (!lines.length) {
        throw new Error("The AI didn't return any solution steps.");
      }

      setSolution(data);
      solutionRef.current = data;

      const suggested = Number(data.y_start_percent);
      const safePosition =
        Number.isFinite(suggested) && suggested >= 0 && suggested < 100;

      if (safePosition) {
        drawSolution(data, suggested);
      } else {
        setNeedsPlacement(true);
        setStatus(
          "MathMate solved the problem but couldn't identify a safe blank area. Choose a position, then place the solution."
        );
      }
    } catch (error) {
      console.error("MathMate PDF solve failed:", error);
      setStatus(
        error.message === "Failed to fetch"
          ? "Couldn't reach MathMate's API. Make sure the Python backend is running on port 8000."
          : error.message
      );
    } finally {
      setBusy(false);
    }
  }

  function clearAnnotation() {
    const canvas = annotationCanvasRef.current;
    const context = canvas?.getContext("2d");

    if (canvas && context) {
      context.clearRect(0, 0, canvas.width, canvas.height);
    }

    annotationDataRef.current = null;
    setStatus("The page annotation was cleared.");
  }

  async function exportAnnotatedPdf() {
    const document = pdfDocumentRef.current;

    if (!pdfFile || !document) {
      setStatus("Open a PDF first.");
      return;
    }

    if (!annotationDataRef.current) {
      setStatus("Ask MathMate to write a solution before exporting.");
      return;
    }

    setBusy(true);
    setStatus("Preparing your annotated PDF…");

    try {
      const pdfBytes = await pdfFile.arrayBuffer();
      const pdf = await PDFDocument.load(pdfBytes);
      const pages = pdf.getPages();
      const page = pages[pageIndex];

      if (!page) throw new Error("The selected PDF page doesn't exist.");

      const response = await fetch(annotationDataRef.current);
      const pngBytes = await response.arrayBuffer();
      const image = await pdf.embedPng(pngBytes);
      const { width, height } = page.getSize();

      image.scale(1);

      page.drawImage(image, {
        x: 0,
        y: 0,
        width,
        height,
      });

      const savedBytes = await pdf.save();
      const blob = new Blob([savedBytes], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");

      anchor.href = url;
      anchor.download = `${pdfFile.name.replace(/\.pdf$/i, "")}-MathMate.pdf`;
      window.document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setStatus("Export started. Check your Downloads folder for the new PDF.");
    } catch (error) {
      console.error("PDF export failed:", error);
      setStatus(`Couldn't export the PDF: ${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pdfwm-root">
      <button
        className="pdfwm-launcher"
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        ✨ Let MathMate write it for you
      </button>

      {expanded && (
        <section className="pdfwm-panel" aria-label="AI PDF writing workspace">
          <header className="pdfwm-header">
            <div>
              <p className="pdfwm-eyebrow">AI WORKSHEET WRITER</p>
              <h2>MathMate Write Mode</h2>
              <p>I'll solve the problem and write the steps onto your PDF.</p>
            </div>
            <button
              type="button"
              className="pdfwm-close"
              onClick={() => setExpanded(false)}
              aria-label="Close PDF writing workspace"
            >
              ×
            </button>
          </header>

          <div className="pdfwm-toolbar">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Open PDF
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={openPdf}
              hidden
            />

            <span className="pdfwm-zoom-controls">
              <button type="button" onClick={() => changeZoom(zoom - 0.15)} disabled={busy || zoom <= 0.7}>−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => changeZoom(zoom + 0.15)} disabled={busy || zoom >= 2}>＋</button>
            </span>
          </div>

          {pdfFile && (
            <div className="pdfwm-pages">
              <span title={pdfFile.name}>{pdfFile.name}</span>
              <div>
                <button
                  type="button"
                  disabled={busy || pageIndex <= 0}
                  onClick={() => changePage(pageIndex - 1)}
                >
                  Previous
                </button>
                <span>{pageIndex + 1} / {pageCount}</span>
                <button
                  type="button"
                  disabled={busy || pageIndex >= pageCount - 1}
                  onClick={() => changePage(pageIndex + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          )}

          <div className="pdfwm-preview">
            {pdfFile ? (
              <div className="pdfwm-canvas-stack">
                <canvas ref={pdfCanvasRef} className="pdfwm-page-canvas" />
                <canvas
                  ref={annotationCanvasRef}
                  className="pdfwm-annotation-canvas"
                  aria-label="AI-generated solution overlay"
                />
              </div>
            ) : (
              <div className="pdfwm-empty">
                <span>▤</span>
                <strong>Open a worksheet PDF</strong>
                <p>MathMate will read the current page and write the solution for you.</p>
              </div>
            )}
          </div>

          {needsPlacement && (
            <div className="pdfwm-placement">
              <label htmlFor="pdfwm-position">
                Where should MathMate write? {placement}%
              </label>
              <input
                id="pdfwm-position"
                type="range"
                min="5"
                max="90"
                value={placement}
                onChange={(event) => setPlacement(Number(event.target.value))}
              />
              <button
                type="button"
                disabled={busy || !solution}
                onClick={() => {
                  try {
                    drawSolution(solutionRef.current, placementRef.current);
                  } catch (error) {
                    setStatus(error.message);
                  }
                }}
              >
                Place solution here
              </button>
            </div>
          )}

          {solution && !needsPlacement && (
            <div className="pdfwm-placement">
              <label htmlFor="pdfwm-reposition">Adjust solution position · {placement}%</label>
              <input
                id="pdfwm-reposition"
                type="range"
                min="5"
                max="90"
                value={placement}
                onChange={(event) => setPlacement(Number(event.target.value))}
              />
              <button type="button" disabled={busy} onClick={() => {
                try { drawSolution(solutionRef.current, placement); }
                catch (error) { setStatus(error.message); }
              }}>Update placement</button>
            </div>
          )}

          <div className="pdfwm-actions">
            <button
              type="button"
              className="pdfwm-primary"
              onClick={solveAndWrite}
              disabled={busy || !pdfFile}
            >
              {busy ? "Working…" : "Solve & write automatically"}
            </button>
            <button
              type="button"
              onClick={exportAnnotatedPdf}
              disabled={busy || !annotationDataRef.current}
            >
              Save annotated PDF
            </button>
            <button
              type="button"
              onClick={clearAnnotation}
              disabled={busy || !annotationDataRef.current}
            >
              Clear writing
            </button>
          </div>

          <p className="pdfwm-status" role="status" aria-live="polite">
            {status || "Open a PDF to begin."}
          </p>
          <p className="pdfwm-note">
            Your original PDF stays unchanged. Review the typeset solution and
            adjust its position before exporting.
          </p>
        </section>
      )}
    </div>
  );
}
