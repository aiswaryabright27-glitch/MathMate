import * as pdfjsLib from "./lib/pdf.mjs";

const BACKEND_URL = "http://127.0.0.1:8000";
const MAX_CONTEXT_CHARS = 18000;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  chrome.runtime.getURL("lib/pdf.worker.mjs");

let currentSource = null;
let history = [];
let isBusy = false;
let voiceSessionActive = false;
let restartVoiceListening = null;
let currentQuestionIsVoice = false;
let activeVoiceUtterance = null;

const $ = id => document.getElementById(id);

// ==================================================
// STATUS AND UI
// ==================================================

function setStatus(message, isError = false) {
  const element = $("sourceStatus");
  if (!element) return;

  element.textContent = message;
  element.classList.toggle("error", isError);
}

function setBusy(value) {
  isBusy = value;

  for (const id of [
    "askButton",
    "readScreen",
    "choosePdf",
    "attachPdf"
  ]) {
    const element = $(id);
    if (element) element.disabled = value;
  }
}

function updateContext() {
  const pill = $("contextPill");
  if (!pill) return;

  if (!currentSource) {
    pill.textContent = "No source selected";
    return;
  }

  const type = { pdf: "📄 PDF", image: "🖼 Image", web: "🌐 Web" }[currentSource.kind] || "🖥 Screen";
  const page = currentSource.pageNumber ? ` · page ${currentSource.pageNumber}` : "";
  pill.textContent = `${type}${page} · ${currentSource.title}`;
}

async function saveState() {
  try {
    await chrome.storage.session.set({
      mathmateSource: currentSource,
      mathmateHistory: history
    });
  } catch (error) {
    console.error("SESSION SAVE ERROR:", error);
  }
}

// ==================================================
// MATH RENDERING AND CHAT MESSAGES
// ==================================================

function renderRichText(container, text) {
  const pattern =
    /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(
        document.createTextNode(text.slice(lastIndex, match.index))
      );
    }

    const token = match[0];
    let expression = token;
    let displayMode = false;

    if (token.startsWith("$$") && token.endsWith("$$")) {
      expression = token.slice(2, -2);
      displayMode = true;
    } else if (token.startsWith("\\[") && token.endsWith("\\]")) {
      expression = token.slice(2, -2);
      displayMode = true;
    } else if (token.startsWith("\\(") && token.endsWith("\\)")) {
      expression = token.slice(2, -2);
    } else {
      expression = token.slice(1, -1);
    }

    const math = document.createElement("span");

    if (window.katex) {
      try {
        math.innerHTML = window.katex.renderToString(expression, {
          displayMode,
          throwOnError: false,
          strict: "ignore"
        });
      } catch {
        math.textContent = token;
      }
    } else {
      math.textContent = token;
    }

    container.appendChild(math);
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    container.appendChild(
      document.createTextNode(text.slice(lastIndex))
    );
  }
}

function renderMessage(role, content) {
  const chat = $("chat");

  if (!chat) {
    console.error('MathMate: element id="chat" was not found.');
    return;
  }

  const greeting = $("greetingArea");
  const suggestions = $("suggestions");

  if (greeting) greeting.hidden = true;
  if (suggestions) suggestions.hidden = true;

  const message = document.createElement("div");
  message.className = `message ${role}`;

  const label = document.createElement("span");
  label.className = "message-label";
  label.textContent = role === "user" ? "YOU" : "MATHMATE";

  const body = document.createElement("div");
  body.className = "message-body";

  renderRichText(body, String(content ?? ""));

  message.appendChild(label);
  message.appendChild(body);

  chat.appendChild(message);
}

function showTyping() {
  removeTyping();

  const chat = $("chat");
  if (!chat) return;

  const typing = document.createElement("div");
  typing.id = "typing";
  typing.className = "message assistant";
  typing.textContent = "MathMate is thinking… ✨";

  chat.appendChild(typing);
}

function removeTyping() {
  const element = $("typing");
  if (element) element.remove();
}

// ==================================================
// VOICE INPUT
// Captures microphone audio, converts it to WAV, and transcribes via Gradium.
// ==================================================

async function recordingToWav(blob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("Audio conversion is not supported in this Chrome version.");
  const context = new AudioContextClass();
  try {
    const source = await context.decodeAudioData(await blob.arrayBuffer());
    if (source.duration < 0.3 || source.numberOfChannels < 1) {
      throw new Error("The recording is too short or contains no audio. Speak for at least half a second and try again.");
    }
    const sampleRate = 24000;
    const ratio = source.sampleRate / sampleRate;
    const audioSampleCount = Math.ceil(source.length / ratio);
    const sampleCount = audioSampleCount + Math.round(sampleRate * 0.8);
    const wav = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(wav);
    const writeText = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, sampleCount * 2, true);
    const channels = Array.from({ length: source.numberOfChannels }, (_, index) => source.getChannelData(index));
    let peak = 0;
    for (let i = 0; i < sampleCount; i++) {
      if (i >= audioSampleCount) {
        view.setInt16(44 + i * 2, 0, true);
        continue;
      }
      const first = Math.floor(i * ratio);
      const last = Math.max(first + 1, Math.min(source.length, Math.floor((i + 1) * ratio)));
      let sample = 0;
      for (const channel of channels) {
        for (let j = first; j < last; j++) sample += channel[j] || 0;
      }
      sample /= channels.length * Math.max(1, last - first);
      const clipped = Math.max(-1, Math.min(1, sample));
      peak = Math.max(peak, Math.abs(clipped));
      view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    }
    if (peak < 0.001) throw new Error("The microphone recording was silent. Check the selected input device and microphone level.");
    return new Blob([wav], { type: "audio/wav" });
  } finally {
    await context.close();
  }
}

function speakAnswer(text) {
  if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
    setStatus("Your answer is in chat. This browser does not provide voice output.", true);
    return Promise.resolve();
  }

  const spokenText = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
    .replace(/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g, (_, display, inline) => display || inline)
    .replace(/\$([^$]+)\$/g, "$1")
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "$1 divided by $2")
    .replace(/\\sqrt\{([^}]+)\}/g, "square root of $1")
    .replace(/\\times/g, " times ")
    .replace(/\\(?:text|mathrm)\{([^}]+)\}/g, "$1")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[*_#`>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!spokenText) return Promise.resolve();

  window.speechSynthesis.cancel();
  return new Promise(resolve => {
    const utterance = new SpeechSynthesisUtterance(spokenText);
    activeVoiceUtterance = utterance;
    const pauseButton = $("pauseVoiceReply");
    const stopButton = $("stopVoiceReply");
    if (pauseButton) pauseButton.hidden = false;
    if (stopButton) stopButton.hidden = false;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (activeVoiceUtterance === utterance) activeVoiceUtterance = null;
      if (pauseButton) {
        pauseButton.hidden = true;
        pauseButton.textContent = "⏸";
        pauseButton.title = "Pause spoken answer";
        pauseButton.setAttribute("aria-label", "Pause spoken answer");
      }
      if (stopButton) stopButton.hidden = true;
      resolve();
    };
    utterance.rate = 1;
    utterance.onend = finish;
    utterance.onerror = finish;
    setStatus("Answering in voice…");
    window.speechSynthesis.speak(utterance);
  });
}

async function transcribeVoiceRecording(blob) {
  const wav = await recordingToWav(blob);
  const bytes = new Uint8Array(await wav.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 70000);
  let response;
  try {
    response = await fetch(`${BACKEND_URL}/api/transcribe-audio`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_base64: btoa(binary), mime_type: "audio/wav" }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Gradium transcription timed out. Try a shorter recording.");
    if (error.message === "Failed to fetch") throw new Error("MathMate could not reach its local API at 127.0.0.1:8000. Start the MathMate backend, then try again.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Transcription failed (HTTP ${response.status}).`);
  return String(data.transcript || "").trim();
}

function setupVoiceInput() {
  const button = $("voiceInput");
  if (!button) return;
  let recorder = null;
  let microphoneStream = null;
  let audioContext = null;
  let meterFrame = 0;
  let speechStartedAt = 0;
  let lastVoiceAt = 0;
  let stopReason = "manual";
  let chunks = [];

  const stopMeter = async () => {
    if (meterFrame) cancelAnimationFrame(meterFrame);
    meterFrame = 0;
    if (audioContext && audioContext.state !== "closed") {
      try { await audioContext.close(); } catch { /* already closed */ }
    }
    audioContext = null;
  };

  const stopRecording = reason => {
    if (!recorder || recorder.state !== "recording") return;
    stopReason = reason;
    if (reason === "silence") setStatus("I heard your question. Transcribing with Gradium…");
    else if (reason === "limit") setStatus("Recording limit reached. Transcribing with Gradium…");
    else setStatus("Finishing recording…");
    recorder.stop();
  };

  const monitorSpeech = source => {
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    const tick = () => {
      if (!recorder || recorder.state !== "recording") return;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (rms > 0.008) {
        if (!speechStartedAt) speechStartedAt = now;
        lastVoiceAt = now;
      }
      if (speechStartedAt && now - lastVoiceAt >= 2200) {
        stopRecording("silence");
        return;
      }
      if (now - startedAt >= 60000) {
        stopRecording("limit");
        return;
      }
      if (!speechStartedAt && now - startedAt >= 15000) {
        stopReason = "no-speech";
        voiceSessionActive = false;
        button.textContent = "🎙";
        button.setAttribute("aria-pressed", "false");
        setStatus("I didn't hear speech. Check your microphone, then tap the mic and try again.", true);
        recorder.stop();
        return;
      }
      meterFrame = requestAnimationFrame(tick);
    };
    meterFrame = requestAnimationFrame(tick);
  };

  async function startRecording() {
    if (!voiceSessionActive || isBusy || recorder?.state === "recording") return;
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
      chunks = [];
      speechStartedAt = 0;
      lastVoiceAt = 0;
      stopReason = "manual";
      recorder = new MediaRecorder(microphoneStream);
      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        void stopMeter();
        microphoneStream?.getTracks().forEach(track => track.stop());
        microphoneStream = null;
        recorder = null;
        voiceSessionActive = false;
        button.textContent = "🎙";
        button.setAttribute("aria-pressed", "false");
        setStatus("Microphone recording failed. Check microphone access and try again.", true);
      };
      recorder.onstop = async () => {
        await stopMeter();
        microphoneStream?.getTracks().forEach(track => track.stop());
        microphoneStream = null;
        recorder = null;
        if (stopReason === "manual" && !voiceSessionActive && !speechStartedAt) {
          button.textContent = "🎙";
          button.setAttribute("aria-pressed", "false");
          button.title = "Start interactive voice chat";
          setStatus("Voice chat ended.");
          return;
        }
        if (stopReason === "no-speech" || !speechStartedAt) {
          voiceSessionActive = false;
          button.textContent = "🎙";
          button.setAttribute("aria-pressed", "false");
          setStatus("I didn't hear speech. Check your microphone, then tap the mic and try again.", true);
          return;
        }
        if (!chunks.length) {
          voiceSessionActive = false;
          button.textContent = "🎙";
          button.setAttribute("aria-pressed", "false");
          setStatus("No audio was recorded. Try again.", true);
          return;
        }
        setBusy(true);
        setStatus("Transcribing with Gradium…");
        try {
          const transcript = await transcribeVoiceRecording(new Blob(chunks));
          if (!transcript) throw new Error("No speech was recognized. Try again.");
          $("question").value = transcript;
          currentQuestionIsVoice = true;
          setBusy(false);
          await askMathMate();
        } catch (error) {
          setBusy(false);
          currentQuestionIsVoice = false;
          voiceSessionActive = false;
          button.textContent = "🎙";
          button.setAttribute("aria-pressed", "false");
          setStatus(`Gradium voice input failed: ${error.message}`, true);
        }
      };
      recorder.start();
      audioContext = new AudioContext();
      await audioContext.resume();
      monitorSpeech(audioContext.createMediaStreamSource(microphoneStream));
      button.textContent = "⏹";
      button.setAttribute("aria-pressed", "true");
      button.title = "Tap to finish this question or end voice chat";
      setStatus("Interactive voice chat is on. Speak naturally; MathMate will reply in chat and voice, then listen for your next question.");
    } catch (error) {
      voiceSessionActive = false;
      if (recorder?.state === "recording") {
        stopReason = "setup-error";
        recorder.stop();
      }
      await stopMeter();
      microphoneStream?.getTracks().forEach(track => track.stop());
      microphoneStream = null;
      recorder = null;
      button.textContent = "🎙";
      button.setAttribute("aria-pressed", "false");
      button.title = "Start interactive voice chat";
      if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        try {
          await chrome.tabs.create({ url: chrome.runtime.getURL("mic-permission.html") });
          setStatus("Chrome blocks mic permission prompts from the side panel. I opened a MathMate tab; click Enable microphone there, allow access, then return here.", true);
        } catch (openError) {
          setStatus("Chrome blocks mic permission prompts from the side panel. Open MathMate’s mic-permission.html in a tab and grant access there, then retry.", true);
        }
      } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        setStatus("No microphone was found. Connect or enable a microphone, then try again.", true);
      } else {
        setStatus(`Could not access the microphone: ${error.message}`, true);
      }
    }
  }

  restartVoiceListening = () => { void startRecording(); };

  button.addEventListener("click", async () => {
    if (recorder?.state === "recording") {
      voiceSessionActive = false;
      stopRecording("manual");
      button.textContent = "🎙";
      button.setAttribute("aria-pressed", "false");
      button.title = "Voice chat will end after this answer";
      setStatus("Finishing this question. MathMate will answer once, then close voice chat.");
      return;
    }
    if (voiceSessionActive) {
      voiceSessionActive = false;
      if (window.speechSynthesis?.speaking) window.speechSynthesis.cancel();
      button.textContent = "🎙";
      button.setAttribute("aria-pressed", "false");
      button.title = "Start interactive voice chat";
      setStatus("Voice chat ended.");
      return;
    }
    if (isBusy) return;
    voiceSessionActive = true;
    button.textContent = "⏹";
    button.setAttribute("aria-pressed", "true");
    button.title = "Tap to finish this question or end voice chat";
    await startRecording();
  });

  $("pauseVoiceReply")?.addEventListener("click", () => {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      $("pauseVoiceReply").textContent = "⏸";
      $("pauseVoiceReply").title = "Pause spoken answer";
      $("pauseVoiceReply").setAttribute("aria-label", "Pause spoken answer");
      setStatus("Resuming spoken answer…");
    } else if (window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      $("pauseVoiceReply").textContent = "▶";
      $("pauseVoiceReply").title = "Resume spoken answer";
      $("pauseVoiceReply").setAttribute("aria-label", "Resume spoken answer");
      setStatus("Spoken answer paused.");
    }
  });

  $("stopVoiceReply")?.addEventListener("click", () => {
    window.speechSynthesis.cancel();
    setStatus("Stopped the spoken answer. The written answer is still in chat.");
  });
}

// ==================================================
// CAPTURE VISIBLE TAB THROUGH BACKGROUND.JS
// ==================================================

async function readScreen() {
  if (isBusy) return;

  setBusy(true);
  setStatus("Capturing the visible screen and reading page text where available…");

  try {
    const response = await chrome.runtime.sendMessage({
      type: "CAPTURE_SCREEN"
    });

    if (!response) throw new Error("No response from MathMate's service worker. Reload the extension and try again.");
    if (!response.success) throw new Error(response.error || "Screen capture failed.");

    const page = response.page;
    if (!page || (!page.screenshot && !page.text?.trim())) throw new Error("Chrome returned neither a screenshot nor readable page text.");

    currentSource = {
      kind: page.kind || "web",
      title: page.title || "Current screen",
      url: page.url || "",
      text: (page.text || "No webpage text was available; use the captured screen image.").slice(0, MAX_CONTEXT_CHARS),
      screenshot: page.screenshot || "",
      pageNumber: page.pageNumber || null,
      tabId: page.tabId
    };

    history = [];

    const chat = $("chat");
    if (chat) chat.replaceChildren();

    updateContext();

    const label = { pdf: "PDF page", image: "image", web: "webpage" }[currentSource.kind] || "screen";
    setStatus(`Screen ready · ${label}${currentSource.pageNumber ? ` ${currentSource.pageNumber}` : ""} · ${currentSource.title}${currentSource.screenshot ? " · visual capture attached" : " · text only"}`);

    renderMessage(
      "assistant",
      `I've captured the visible ${label}${currentSource.pageNumber ? ` (page ${currentSource.pageNumber})` : ""} from "${currentSource.title}". Ask or speak about what's on screen. 🌸`
    );

    await saveState();

    console.log("MathMate captured active screen:", { url: currentSource.url, kind: currentSource.kind, pageNumber: currentSource.pageNumber });
  } catch (error) {
    console.error("SCREEN CAPTURE ERROR:", error);
    setStatus(`Could not capture this screen: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

function makeHandwrittenText(answer) {
  return String(answer || "")
    .replace(/```[\s\S]*?```/g, match => match.replace(/^```[^\n]*\n?|```$/g, ""))
    .replace(/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g, (_, display, inline) => display || inline)
    .replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g, (_, display, inline) => display || inline)
    .replace(/\\(?:boxed|text|mathrm)\{([^{}]*)\}/g, "$1")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1⁄$2")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√($1)")
    .replace(/\\times/g, "×")
    .replace(/\\cdot/g, "·")
    .replace(/\\div/g, "÷")
    .replace(/\\pm/g, "±")
    .replace(/\\neq/g, "≠")
    .replace(/\\leq?/g, "≤")
    .replace(/\\geq?/g, "≥")
    .replace(/\\pi/g, "π")
    .replace(/\\[a-zA-Z]+/g, "")
    .replace(/[{}]/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/[*_`]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 3000);
}

async function writeSolutionOnCapturedPage(source, answer) {
  if (source?.kind !== "web" || source.tabId == null || !source.screenshot) return false;
  const text = makeHandwrittenText(answer);
  if (!text) return false;
  const host = (() => { try { return new URL(source.url).hostname; } catch { return ""; } })();
  const isNotebookLm = host === "notebooklm.google.com" || host.endsWith(".notebooklm.google.com");
  const response = await chrome.runtime.sendMessage({
    type: isNotebookLm ? "INSERT_NOTE_TEXT" : "PLACE_HANDWRITTEN_SOLUTION",
    tabId: source.tabId,
    pageUrl: source.url,
    text,
  });
  if (!response?.success) throw new Error(response?.error || "Chrome could not add the handwriting overlay.");
  return true;
}

// ==================================================
// READ PDF
// ==================================================

async function scanPdfPage(page, pageNumber) {
  const viewport = page.getViewport({ scale: 1.35 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`Could not render PDF page ${pageNumber}.`);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const imageBase64 = canvas.toDataURL("image/jpeg", 0.78);
  const response = await fetch(`${BACKEND_URL}/api/scan-pdf-page`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ page_number: pageNumber, image_base64: imageBase64 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || `Page scan failed (HTTP ${response.status}).`);
  return String(data.text || "").trim();
}

async function loadPdf(file) {
  if (!file || isBusy) return;

  if (file.size > 50 * 1024 * 1024) {
    setStatus("Choose a PDF smaller than 50 MB.", true);
    return;
  }

  setStatus("Opening PDF…");
  setBusy(true);

  try {
    const buffer = await file.arrayBuffer();

    const pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(buffer)
    }).promise;

    const sections = [];
    const failedPages = [];
    let truncated = false;

    for (let number = 1; number <= pdf.numPages; number++) {
      setStatus(`Reading PDF · page ${number} of ${pdf.numPages}…`);
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      let pageText = content.items
        .filter(item => typeof item.str === "string")
        .map(item => item.str)
        .join(" ").trim();

      if (pageText.replace(/\s/g, "").length < 200) {
        try {
          setStatus(`Scanning PDF page ${number} of ${pdf.numPages} with Gemini vision…`);
          pageText = await scanPdfPage(page, number);
        } catch (error) {
          console.error(`PDF page ${number} scan failed:`, error);
          failedPages.push(number);
          pageText = "[Visual scan failed for this page.]";
        }
      }

      const section = `[Page ${number}]\n${pageText || "[No readable text found.]"}`;
      const used = sections.join("\n\n").length;
      const remaining = MAX_CONTEXT_CHARS - used - 2;
      if (section.length > remaining) {
        if (remaining > 30) {
          sections.push(section.slice(0, remaining - 35) + "\n[Page text truncated]");
        }
        truncated = true;
        break;
      }
      sections.push(section);
    }

    const text = sections.join("\n\n");
    if (!text.trim()) throw new Error("No readable PDF pages were found.");

    currentSource = {
      kind: "pdf",
      title: file.name,
      url: "",
      pages: pdf.numPages,
      text,
      failedPages
    };

    history = [];

    const chat = $("chat");
    if (chat) chat.replaceChildren();

    updateContext();

    setStatus(
      `PDF ready · ${sections.length} of ${pdf.numPages} pages processed` +
      (failedPages.length ? ` · scan failed on page${failedPages.length > 1 ? "s" : ""} ${failedPages.join(", ")}` : "") +
      (truncated ? ` · context limited to the first ${sections.length} pages` : "")
    );

    renderMessage(
      "assistant",
      `I've processed "${file.name}"${failedPages.length ? `, but couldn't scan page${failedPages.length > 1 ? "s" : ""} ${failedPages.join(", ")}` : ""}. Ask about a page, question, or diagram. 🌸`
    );

    await saveState();
  } catch (error) {
    console.error("PDF READING ERROR:", error);
    setStatus(`Could not read PDF: ${error.message}`, true);
  } finally {
    setBusy(false);
  }
}

// ==================================================
// BUILD CONTEXT FOR THE AI
// ==================================================

function buildContext(source, previousHistory) {
  const parts = [];

  if (source) {
    parts.push(
      `Study source: ${source.kind}`,
      `Title: ${source.title}`,
      source.url ? `URL: ${source.url}` : "",
      source.pages ? `Pages: ${source.pages}` : "",
      source.pageNumber ? `Visible page: ${source.pageNumber}` : "",
      "Use the source below when answering.",
      `Source content:\n${source.text}`
    );
  } else {
    parts.push(
      "No webpage or PDF is loaded. Answer the general question."
    );
  }

  if (previousHistory.length) {
    parts.push(
      "Previous conversation:\n" +
      previousHistory.slice(-10)
        .map(item => `${item.role}: ${item.content}`)
        .join("\n")
    );
  }

  const context = parts.filter(Boolean).join("\n\n");
  return context.length > MAX_CONTEXT_CHARS
    ? `${context.slice(0, MAX_CONTEXT_CHARS - 38)}\n[Context shortened to fit request limits.]`
    : context;
}

// ==================================================
// COMMON CHAT REQUEST, WITH OPTIONAL IMAGE
// ==================================================

async function sendToBackend(question, imageBase64 = "") {
  const source = currentSource;
  const previousHistory = [...history];

  const response = await fetch(`${BACKEND_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: question,
      context: buildContext(source, previousHistory),
      image_base64: imageBase64 || source?.screenshot || ""
    })
  });

  const raw = await response.text();
  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      `Backend returned non-JSON data (HTTP ${response.status}).`
    );
  }

  if (!response.ok) {
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : `HTTP ${response.status}: ${JSON.stringify(data.detail || data)}`
    );
  }

  const answer =
    data.answer ?? data.response ?? data.reply ?? data.message;

  if (typeof answer !== "string") {
    console.error("Unexpected API response:", data);
    throw new Error("The backend response did not contain an answer.");
  }

  return answer;
}

// ==================================================
// ASK MATHMATE
// ==================================================

async function askMathMate() {
  if (isBusy) return;

  const shouldSpeakAnswer = currentQuestionIsVoice;
  currentQuestionIsVoice = false;

  const input = $("question");

  if (!input) {
    setStatus('Missing element: "question".', true);
    return;
  }

  const question = input.value.trim();
  const sourceForQuestion = currentSource ? { ...currentSource } : null;

  if (!question) {
    setStatus("Type a message first.");
    input.focus();
    return;
  }

  renderMessage("user", question);
  input.value = "";

  setBusy(true);
  showTyping();
  setStatus("Sending message…");
  let chatFailed = false;

  try {
    const answer = await sendToBackend(question);

    removeTyping();
    renderMessage("assistant", answer);
    if (shouldSpeakAnswer) await speakAnswer(answer);
    if (
      sourceForQuestion?.kind === "web" &&
      sourceForQuestion.screenshot &&
      /\b(solve|work\s*out|calculate|find\s+[a-z]|show\s+(?:the\s+)?(?:steps|working)|step\s+by\s+step)\b/i.test(question)
    ) {
      try {
        await writeSolutionOnCapturedPage(sourceForQuestion, answer);
        const sourceHost = (() => { try { return new URL(sourceForQuestion.url).hostname; } catch { return ""; } })();
        renderMessage("assistant", sourceHost.includes("notebooklm.google.com")
          ? "Open or create a NotebookLM note, then click in the note where you want the solution inserted. It will be added as editable note text."
          : "Click a blank spot on the captured webpage to place the answer in handwriting style. You can edit, move, or remove it there.");
      } catch (error) {
        renderMessage("assistant", `I solved it, but couldn't write on that webpage: ${error.message}`);
      }
    }
    history.push(
      { role: "user", content: question },
      { role: "assistant", content: answer }
    );

    history = history.slice(-12);

    await saveState();
    setStatus("Answer ready ✨");
  } catch (error) {
    chatFailed = true;
    removeTyping();

    console.error("CHAT REQUEST ERROR:", error);

    renderMessage(
      "assistant",
      `I couldn't get a reply.\n${error.message}`
    );

    setStatus(`Chat failed: ${error.message}`, true);
  } finally {
    setBusy(false);
    if (voiceSessionActive) {
      if (!chatFailed && !shouldSpeakAnswer) setStatus("Answer is in chat. Listening for your next question…");
      if (!chatFailed && shouldSpeakAnswer && voiceSessionActive) setStatus("Answer spoken. Listening for your next question…");
      setTimeout(() => restartVoiceListening?.(), 180);
    }
  }
}

// ==================================================
// NEW CHAT
// ==================================================

async function startNewChat() {
  history = [];

  const chat = $("chat");
  if (chat) chat.replaceChildren();

  const greeting = $("greetingArea");
  const suggestions = $("suggestions");

  if (greeting) greeting.hidden = false;
  if (suggestions) suggestions.hidden = false;

  setStatus(
    currentSource
      ? `Source loaded: ${currentSource.title}`
      : "Ready when you are"
  );

  await saveState();
}

// ==================================================
// EVENT LISTENERS
// ==================================================

function bindEvents() {
  $("readScreen")?.addEventListener("click", readScreen);
  const pdfFile = $("pdfFile");

  $("choosePdf")?.addEventListener("click", () => pdfFile?.click());
  $("attachPdf")?.addEventListener("click", () => pdfFile?.click());

  pdfFile?.addEventListener("change", async event => {
    await loadPdf(event.target.files?.[0]);
    event.target.value = "";
  });

  $("askButton")?.addEventListener("click", askMathMate);
  $("question")?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      askMathMate();
    }
  });

  $("newChat")?.addEventListener("click", startNewChat);

  $("suggestions")?.addEventListener("click", event => {
    const button = event.target.closest("[data-prompt]");
    const input = $("question");

    if (!button || !input) return;

    input.value = button.dataset.prompt || "";
    input.focus();
  });

  setupVoiceInput();
}

// ==================================================
// INITIALISE
// ==================================================

async function init() {
  console.log("MathMate sidepanel.js loaded.");

  bindEvents();

  try {
    const saved = await chrome.storage.session.get([
      "mathmateSource",
      "mathmateHistory"
    ]);

    currentSource = saved.mathmateSource || null;

    history = Array.isArray(saved.mathmateHistory)
      ? saved.mathmateHistory
      : [];

    updateContext();

    if (currentSource) {
      setStatus(`Source ready: ${currentSource.title}`);
    }

    for (const item of history) {
      if (
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string"
      ) {
        renderMessage(item.role, item.content);
      }
    }
  } catch (error) {
    console.error("INITIALISATION ERROR:", error);
    setStatus(`Initialisation error: ${error.message}`, true);
  }
}

init().catch(error => {
  console.error("STARTUP ERROR:", error);
  setStatus(`Startup error: ${error.message}`, true);
});
