
const API_BASE = "http://127.0.0.1:8000";

const sourceSelect = document.getElementById("sourceSelect");
const refreshBtn = document.getElementById("refreshBtn");
const captureBtn = document.getElementById("captureBtn");
const captureStatus = document.getElementById("captureStatus");
const problemEl = document.getElementById("problem");
const solutionEl = document.getElementById("solution");
const savePdfBtn = document.getElementById("savePdfBtn");
const pdfStatus = document.getElementById("pdfStatus");
const chatHistory = document.getElementById("chatHistory");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");
const chatStatus = document.getElementById("chatStatus");

let latestSolution = "";
let latestProblem = "";
let latestContext = "";

// Decode common HTML entities that sometimes arrive from the model.
function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&lt;|&#60;/gi, "<")
    .replace(/&gt;|&#62;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function renderMath(expression, displayMode = false) {
  const math = String(expression ?? "").trim();

  if (!math) return "";

  if (!window.katex) {
    return `<code>${escapeHtml(math)}</code>`;
  }

  try {
    return window.katex.renderToString(math, {
      throwOnError: false,
      strict: "ignore",
      displayMode,
      output: "html",
    });
  } catch (error) {
    console.warn("MathMate could not render an equation:", error);
    return `<code>${escapeHtml(math)}</code>`;
  }
}

// Protect math and code before escaping the remaining text.
function renderInlineMarkdown(input) {
  let text = decodeEntities(input);
  const protectedItems = [];

  function protect(html) {
    const token = `MATHMATEPROTECTED${protectedItems.length}TOKEN`;
    protectedItems.push(html);
    return token;
  }

  // Inline code must not be interpreted as mathematics.
  text = text.replace(/`([^`\n]+)`/g, (_match, code) =>
    protect(`<code>${escapeHtml(code)}</code>`)
  );

  // Explicit inline math: \( ... \).
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_match, math) =>
    protect(renderMath(math))
  );

  // Inline dollar math: $ ... $.
  text = text.replace(/(?<!\$)\$([^$\n]+)\$(?!\$)/g, (_match, math) =>
    protect(renderMath(math))
  );

  // Convert common unwrapped LaTeX commands into rendered mathematics.
  // This handles simple fractions and square roots when delimiters are missing.
  text = text.replace(
    /\\frac\s*\{([^{}\n]+)\}\s*\{([^{}\n]+)\}/g,
    (_match, numerator, denominator) =>
      protect(renderMath(`\\frac{${numerator}}{${denominator}}`))
  );

  text = text.replace(
    /\\sqrt\s*\{([^{}\n]+)\}/g,
    (_match, value) => protect(renderMath(`\\sqrt{${value}}`))
  );

  // Escape all remaining ordinary text.
  text = escapeHtml(text);

  // Basic Markdown formatting.
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__(.+?)__/g, "<strong>$1</strong>");
  text = text.replace(
    /(^|[^*])\*([^*\n]+)\*(?!\*)/g,
    "$1<em>$2</em>"
  );

  // Restore protected code and rendered math.
  text = text.replace(
    /MATHMATEPROTECTED(\d+)TOKEN/g,
    (_match, index) => protectedItems[Number(index)] ?? ""
  );

  return text;
}

function renderMarkdown(markdown) {
  const text = decodeEntities(markdown)
    .replace(/\r\n?/g, "\n")
    .replace(/&nbsp;/gi, " ");

  const lines = text.split("\n");
  const output = [];

  let paragraph = [];
  let listItems = [];
  let listType = null;
  let inCodeBlock = false;
  let codeLines = [];
  let inMathBlock = false;
  let mathLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;

    output.push(
      `<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`
    );
    paragraph = [];
  }

  function flushList() {
    if (!listItems.length || !listType) return;

    const tag = listType === "ordered" ? "ol" : "ul";
    output.push(
      `<${tag}>${listItems.map(item =>
        `<li>${renderInlineMarkdown(item)}</li>`
      ).join("")}</${tag}>`
    );

    listItems = [];
    listType = null;
  }

  function flushText() {
    flushParagraph();
    flushList();
  }

  for (const originalLine of lines) {
    const line = originalLine.trim();

    if (line.startsWith("```")) {
      if (inCodeBlock) {
        output.push(
          `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        flushText();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(originalLine);
      continue;
    }

    // Display equations spanning multiple lines.
    if (line === "$$" && !inMathBlock) {
      flushText();
      inMathBlock = true;
      mathLines = [];
      continue;
    }

    if (line === "$$" && inMathBlock) {
      output.push(renderMath(mathLines.join("\n"), true));
      mathLines = [];
      inMathBlock = false;
      continue;
    }

    if (inMathBlock) {
      mathLines.push(originalLine);
      continue;
    }

    // Display equations written on one line.
    const displayMatch = line.match(/^\$\$([\s\S]+)\$\$$/);

    if (displayMatch) {
      flushText();
      output.push(renderMath(displayMatch[1], true));
      continue;
    }

    // Display equations using \[ ... \].
    const bracketMatch = line.match(/^\\\[([\s\S]+)\\\]$/);

    if (bracketMatch) {
      flushText();
      output.push(renderMath(bracketMatch[1], true));
      continue;
    }

    if (!line) {
      flushText();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);

    if (heading) {
      flushText();
      const level = heading[1].length;
      output.push(
        `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`
      );
      continue;
    }

    if (/^([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushText();
      output.push("<hr>");
      continue;
    }

    if (line.startsWith("> ")) {
      flushText();
      output.push(
        `<blockquote>${renderInlineMarkdown(line.slice(2))}</blockquote>`
      );
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    const unordered = line.match(/^[-*+]\s+(.+)$/);
    const item = ordered || unordered;

    if (item) {
      flushParagraph();
      const newType = ordered ? "ordered" : "unordered";

      if (listType && listType !== newType) flushList();

      listType = newType;
      listItems.push(item[1]);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushText();

  if (inMathBlock) {
    output.push(renderMath(mathLines.join("\n"), true));
  }

  if (inCodeBlock) {
    output.push(
      `<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`
    );
  }

  return output.join("\n");
}

function setStatus(element, message) {
  element.textContent = message || "";
}

function addBubble(text, who = "tutor") {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${who}`;

  if (who === "tutor") {
    bubble.innerHTML = renderMarkdown(text);
  } else {
    bubble.textContent = text;
  }

  chatHistory.appendChild(bubble);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

async function loadSources() {
  refreshBtn.disabled = true;
  setStatus(captureStatus, "Finding available screens and windows…");

  try {
    const sources = await window.mathmateDesktop.getSources();
    sourceSelect.replaceChildren();

    if (!sources.length) {
      sourceSelect.add(new Option("No screens or windows found", ""));
      setStatus(captureStatus, "No capture sources were found.");
      return;
    }

    for (const source of sources) {
      sourceSelect.add(new Option(source.name, source.id));
    }

    setStatus(captureStatus, `${sources.length} capture sources found.`);
  } catch (error) {
    setStatus(captureStatus, `Could not list windows: ${error.message}`);
  } finally {
    refreshBtn.disabled = false;
  }
}

function base64FromDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

async function captureAndExplain() {
  const sourceId = sourceSelect.value;

  if (!sourceId) {
    setStatus(captureStatus, "Choose a screen or application window first.");
    return;
  }

  captureBtn.disabled = true;
  savePdfBtn.disabled = true;
  setStatus(captureStatus, "Capturing and analysing your worksheet…");
  setStatus(pdfStatus, "");

  try {
    const capture = await window.mathmateDesktop.captureSource(sourceId);

    const response = await fetch(`${API_BASE}/api/analyze-workbook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_base64: base64FromDataUrl(capture.imageDataUrl),
        user_prompt:
          "Act as a patient mathematics tutor. Read the problem in the screenshot " +
          "and solve it accurately. Return readable Markdown, not one long paragraph. " +
          "Put each heading on its own line. Use a Problem section, numbered solution " +
          "steps, and a Final Answer section. Explain why each formula is used. " +
          "Put each calculation on its own line. For probability questions, identify " +
          "each event and calculate every requested probability and odds value. " +
          "Never leave an equation blank. If odds are a:b, state clearly whether " +
          "these are favourable:unfavourable or unfavourable:favourable before " +
          "converting them to probabilities. Verify the interpretation against the " +
          "screenshot. Use \\(...\\) for inline maths and $$ on separate lines for " +
          "display equations. Every fraction must use valid LaTeX. If any part of " +
          "the screenshot is unclear, identify exactly what is uncertain.",
      }),
    });

    const bodyText = await response.text();
    let data;

    try {
      data = JSON.parse(bodyText);
    } catch {
      throw new Error(`Unexpected backend response: ${bodyText.slice(0, 180)}`);
    }

    if (!response.ok) {
      throw new Error(
        data.detail || data.error || `Backend request failed (${response.status}).`
      );
    }

    latestProblem =
      data.recognized_problem ||
      "The problem could not be confidently identified.";

    latestSolution =
      data.sidebar_explanation ||
      data.solution ||
      data.speech_text ||
      data.handwritten_steps ||
      "No written explanation was returned. Try a clearer screenshot.";

    if (Array.isArray(latestSolution)) {
      latestSolution = latestSolution.join("\n");
    }

    latestContext = `Problem:\n${latestProblem}\n\nExplanation:\n${latestSolution}`;

    problemEl.innerHTML = renderMarkdown(latestProblem);
    solutionEl.innerHTML = renderMarkdown(latestSolution);

    savePdfBtn.disabled = !String(latestSolution).trim();

    chatHistory.replaceChildren();
    addBubble("I've analysed the problem. Ask me about any step.", "tutor");

    if (data.needs_clarification) {
      setStatus(
        captureStatus,
        "Analysis needs clarification. Check the explanation before relying on the answer."
      );
    } else if (data.repair_attempted && data.repair_failed) {
      setStatus(
        captureStatus,
        "Analysis returned, but some calculations may still be incomplete. Please verify the answer."
      );
    } else {
      setStatus(captureStatus, `Analysis complete: ${capture.name}`);
    }
  } catch (error) {
    setStatus(
      captureStatus,
      `Could not analyse the screenshot: ${error.message}`
    );
  } finally {
    captureBtn.disabled = false;
  }
}

async function saveSolutionToPdf() {
  if (!String(latestSolution).trim()) {
    setStatus(pdfStatus, "Capture and solve a problem first.");
    return;
  }

  savePdfBtn.disabled = true;
  setStatus(
    pdfStatus,
    "Choose your original PDF, then choose where to save the solved copy."
  );

  try {
    const text =
      `MathMate solution\n\nProblem:\n${latestProblem}\n\n` +
      `Step-by-step explanation:\n${latestSolution}`;

    const result = await window.mathmateDesktop.savePdf({
      text,
      pageIndex: 0,
    });

    if (result.canceled) {
      setStatus(
        pdfStatus,
        "Save cancelled. Your original PDF has not been changed."
      );
      return;
    }

    const warning = result.truncated
      ? " Some text may not fit on the page."
      : "";

    setStatus(pdfStatus, `Saved a new PDF copy: ${result.filePath}${warning}`);

    const openButton = document.createElement("button");
    openButton.className = "secondary";
    openButton.textContent = "Show saved PDF in folder";

    openButton.addEventListener("click", async () => {
      await window.mathmateDesktop.openFileLocation(result.filePath);
    });

    pdfStatus.appendChild(document.createTextNode(" "));
    pdfStatus.appendChild(openButton);
  } catch (error) {
    setStatus(pdfStatus, `Could not save PDF: ${error.message}`);
  } finally {
    savePdfBtn.disabled = false;
  }
}

async function askMathMate(question) {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: question,
      context: latestContext,
    }),
  });

  const bodyText = await response.text();
  let data;

  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Unexpected backend response: ${bodyText.slice(0, 180)}`);
  }

  if (!response.ok) {
    throw new Error(
      data.detail || data.error || `Chat request failed (${response.status}).`
    );
  }

  const answer =
    data.response || data.answer || data.reply || data.message || data.text;

  if (typeof answer === "string" && answer.trim()) {
    return answer;
  }

  return "The backend replied, but its answer field wasn't recognised.";
}

refreshBtn.addEventListener("click", loadSources);
captureBtn.addEventListener("click", captureAndExplain);
savePdfBtn.addEventListener("click", saveSolutionToPdf);

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const question = chatInput.value.trim();
  if (!question) return;

  addBubble(question, "user");
  chatInput.value = "";
  sendBtn.disabled = true;
  setStatus(chatStatus, "Thinking…");

  try {
    const answer = await askMathMate(question);
    addBubble(answer, "tutor");
    setStatus(chatStatus, "");
  } catch (error) {
    setStatus(chatStatus, `Could not get an answer: ${error.message}`);
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
});

loadSources();
