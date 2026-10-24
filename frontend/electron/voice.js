
(() => {
  "use strict";

  const API_BASE = "http://127.0.0.1:8000";

  const chatForm = document.getElementById("chatForm");
  const chatInput = document.getElementById("chatInput");
  const chatHistory = document.getElementById("chatHistory");
  const chatStatus = document.getElementById("chatStatus");

  if (!chatForm || !chatInput || !chatHistory || !chatStatus) {
    console.error("MathMate voice: required chat elements were not found.");
    return;
  }

  let stream = null;
  let recorder = null;
  let audioChunks = [];
  let recording = false;
  let voiceReplies = true;
  let awaitingTutorReply = false;
  let activeAudio = null;
  let audioUrl = null;

  // Voice controls
  const style = document.createElement("style");

  style.textContent = `
    .mm-voice-panel {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 10px;
    }

    .mm-voice-button {
      min-height: 40px;
      border: 1px solid #e5d9ed;
      border-radius: 10px;
      padding: 9px;
      color: #60417f;
      background: #f2eafb;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    .mm-voice-button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }

    .mm-voice-button.mm-listening {
      color: white;
      background: #b94c75;
      border-color: #b94c75;
    }

    .mm-voice-button.mm-enabled {
      color: #286b57;
      background: #e5f6f0;
    }

    .mm-voice-status {
      grid-column: 1 / -1;
      min-height: 18px;
      color: #81788d;
      font-size: 11px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
  `;

  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.className = "mm-voice-panel";

  const micButton = document.createElement("button");
  micButton.type = "button";
  micButton.className = "mm-voice-button";
  micButton.textContent = "🎤 Start speaking";

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "mm-voice-button mm-enabled";
  toggleButton.textContent = "🔊 Spoken replies: On";
  toggleButton.setAttribute("aria-pressed", "true");

  const stopButton = document.createElement("button");
  stopButton.type = "button";
  stopButton.className = "mm-voice-button";
  stopButton.textContent = "⏹ Stop speaking";

  const status = document.createElement("div");
  status.className = "mm-voice-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent =
    "Click Start speaking, ask your question, then click Finish question.";

  panel.append(micButton, toggleButton, stopButton, status);
  chatForm.parentNode.insertBefore(panel, chatForm);

  function setStatus(message) {
    status.textContent = message;
  }

  function setMicState(isRecording) {
    recording = isRecording;

    micButton.classList.toggle("mm-listening", isRecording);
    micButton.textContent = isRecording
      ? "⏹ Finish question"
      : "🎤 Start speaking";

    micButton.setAttribute(
      "aria-label",
      isRecording
        ? "Finish and submit your question"
        : "Start speaking a question"
    );
  }

  function stopPlayback() {
    if (activeAudio) {
      activeAudio.onended = null;
      activeAudio.onerror = null;
      activeAudio.pause();
      activeAudio.removeAttribute("src");
      activeAudio.load();
      activeAudio = null;
    }

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
  }

  // Convert Markdown and common math notation to readable speech.
  function plainTextForSpeech(value) {
    return String(value || "")
      .replace(/```[\s\S]*?```/g, " Code block omitted. ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\$\$([\s\S]*?)\$\$/g, "$1")
      .replace(/\\\[([\s\S]*?)\\\]/g, "$1")
      .replace(/\\\(([\s\S]*?)\\\)/g, "$1")
      .replace(
        /\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g,
        "$1 divided by $2"
      )
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, "the square root of $1")
      .replace(/\\times/g, " times ")
      .replace(/\\cdot/g, " times ")
      .replace(/\\div/g, " divided by ")
      .replace(/\\pi/g, " pi ")
      .replace(/\\theta/g, " theta ")
      .replace(/\\infty/g, " infinity ")
      .replace(/\\[a-zA-Z]+/g, " ")
      .replace(/[*_#>|~]/g, " ")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[{}$]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Generate and play speech returned by the Gradium backend.
  async function speakWithPolly(value) {
    if (!voiceReplies) return;

    const text = plainTextForSpeech(value).slice(0, 4800);
    if (!text) return;

    stopPlayback();
    setStatus("Generating spoken answer…");

    try {
      const response = await fetch(`${API_BASE}/api/speech`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text,
          // Empty means use the backend's configured default voice.
          voice_id: ""
        })
      });

      const responseText = await response.text();

      let data;

      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Speech API returned invalid JSON. HTTP ${response.status}.`
        );
      }

      if (!response.ok) {
        throw new Error(
          data.detail || `Speech request failed (${response.status}).`
        );
      }

      if (!data.audio_base64) {
        throw new Error(
          `The speech API returned no audio. Provider: ${
            data.provider || "unknown"
          }.`
        );
      }

      console.log("MathMate speech response:", {
        provider: data.provider || "not specified",
        mimeType: data.mime_type || "not specified",
        voiceId: data.voice_id || "not specified",
        base64Length: data.audio_base64.length
      });

      // Accept plain Base64 or a Base64 data URI.
      const encodedAudio = String(data.audio_base64)
        .replace(/^data:[^,]*;base64,/i, "")
        .replace(/\s/g, "");

      let binary;

      try {
        binary = atob(encodedAudio);
      } catch {
        throw new Error("The returned audio is not valid Base64.");
      }

      const bytes = new Uint8Array(binary.length);

      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      if (bytes.length === 0) {
        throw new Error("The speech API returned an empty audio file.");
      }

      // Inspect the audio signature.
      const signature = Array.from(bytes.slice(0, 12))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join(" ");

      const firstFour = String.fromCharCode(...bytes.slice(0, 4));
      const bytesEightToTwelve = String.fromCharCode(
        ...bytes.slice(8, 12)
      );

      const looksLikeWav =
        bytes.length >= 12 &&
        firstFour === "RIFF" &&
        bytesEightToTwelve === "WAVE";

      const looksLikeMp3 =
        bytes.length >= 3 &&
        bytes[0] === 0x49 &&
        bytes[1] === 0x44 &&
        bytes[2] === 0x33;

      // Prefer the actual WAV signature if the response omitted its MIME type.
      let mimeType = data.mime_type;

      if (!mimeType) {
        if (looksLikeWav) {
          mimeType = "audio/wav";
        } else if (looksLikeMp3) {
          mimeType = "audio/mpeg";
        } else {
          mimeType = "audio/wav";
        }
      }

      console.log("MathMate audio format check:", {
        looksLikeWav,
        looksLikeMp3,
        declaredMimeType: mimeType,
        byteLength: bytes.length,
        firstBytes: signature
      });

      const blob = new Blob([bytes], { type: mimeType });

      audioUrl = URL.createObjectURL(blob);
      activeAudio = new Audio();

      const audio = activeAudio;
      audio.preload = "auto";
      audio.src = audioUrl;

      audio.onloadedmetadata = () => {
        console.log("MathMate audio metadata:", {
          duration: audio.duration,
          readyState: audio.readyState,
          networkState: audio.networkState
        });
      };

      audio.oncanplay = () => {
        console.log("MathMate audio is ready to play.");
      };

      audio.onended = () => {
        if (activeAudio !== audio) return;

        stopPlayback();
        setStatus(
          "Answer finished. Ask another question whenever you're ready."
        );
      };

      audio.onerror = () => {
        if (activeAudio !== audio) return;

        const mediaError = audio.error;

        console.error("MathMate audio playback error:", {
          code: mediaError?.code ?? "unknown",
          message: mediaError?.message || "No browser error message",
          networkState: audio.networkState,
          readyState: audio.readyState,
          mimeType,
          provider: data.provider || "not specified",
          byteLength: bytes.length,
          firstBytes: signature
        });

        const errorCode = mediaError?.code ?? "unknown";

        stopPlayback();

        setStatus(
          `Audio playback failed (code ${errorCode}). Check the console.`
        );
      };

      setStatus("Audio received. Starting playback…");

      await audio.play();

      setStatus(
        `🔊 MathMate is speaking${
          data.provider ? ` with ${data.provider}` : ""
        }…`
      );
    } catch (error) {
      console.error("MathMate speech error:", error);

      setStatus(`Speech failed: ${error.message || "Unknown error."}`);
    }
  }

  // Start microphone recording.
  async function startRecording() {
    try {
      stopPlayback();

      if (
        !navigator.mediaDevices?.getUserMedia ||
        !window.MediaRecorder
      ) {
        throw new Error(
          "This Electron runtime does not support microphone recording."
        );
      }

      setStatus("Requesting microphone access…");

      const permission =
        await window.mathmateDesktop?.requestMicrophonePermission?.();

      if (permission && permission.granted === false) {
        throw new Error(
          "Microphone permission was denied in Electron."
        );
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true
        },
        video: false
      });

      const options = {};

      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        options.mimeType = "audio/webm";
      } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
        options.mimeType = "audio/mp4";
      }

      recorder = new MediaRecorder(stream, options);
      audioChunks = [];

      recorder.ondataavailable = event => {
        if (event.data && event.data.size) {
          audioChunks.push(event.data);
        }
      };

      recorder.onerror = event => {
        setStatus(
          `Recording error: ${
            event.error?.message || "Unknown recording error."
          }`
        );

        cleanupRecording();
      };

      recorder.onstop = transcribeRecording;

      recorder.start(250);
      setMicState(true);

      setStatus(
        "Listening… speak your full question, then click Finish question."
      );
    } catch (error) {
      console.error("MathMate recording error:", error);

      cleanupRecording();
      setMicState(false);

      setStatus(
        `Could not start recording: ${
          error.message || "Check microphone permissions."
        }`
      );
    }
  }

  function cleanupRecording() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    recorder = null;
  }

  function finishRecording() {
    if (!recorder || recorder.state === "inactive") return;

    setMicState(false);
    setStatus("Processing your voice question…");
    recorder.stop();
  }

  // Transcribe the recording and submit it as a normal chat question.
  async function transcribeRecording() {
    const type =
      audioChunks[0]?.type ||
      recorder?.mimeType ||
      "audio/webm";

    const blob = new Blob(audioChunks, { type });

    cleanupRecording();

    if (!blob.size) {
      setStatus("No audio was recorded. Try again.");
      return;
    }

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => resolve(reader.result);

        reader.onerror = () =>
          reject(new Error("Could not read microphone recording."));

        reader.readAsDataURL(blob);
      });

      const response = await fetch(
        `${API_BASE}/api/transcribe-audio`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            audio_base64: dataUrl,
            mime_type: type.split(";")[0] || "audio/webm"
          })
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail ||
          `Transcription failed (${response.status}).`
        );
      }

      const transcript = String(result.transcript || "").trim();

      if (!transcript) {
        throw new Error(
          "No speech was recognized. Try speaking closer to the microphone."
        );
      }

      setStatus(`You said: “${transcript}”`);

      chatInput.value = transcript;

      chatInput.dispatchEvent(
        new Event("input", { bubbles: true })
      );

      awaitingTutorReply = true;
      chatForm.requestSubmit();
    } catch (error) {
      console.error("MathMate transcription error:", error);

      setStatus(`Voice transcription failed: ${error.message}`);
    }
  }

  // Button handlers.
  micButton.addEventListener("click", () => {
    if (recording) {
      finishRecording();
    } else {
      startRecording();
    }
  });

  stopButton.addEventListener("click", () => {
    stopPlayback();
    setStatus("Spoken answer stopped.");
  });

  toggleButton.addEventListener("click", () => {
    voiceReplies = !voiceReplies;

    toggleButton.setAttribute(
      "aria-pressed",
      String(voiceReplies)
    );

    toggleButton.classList.toggle(
      "mm-enabled",
      voiceReplies
    );

    toggleButton.textContent = voiceReplies
      ? "🔊 Spoken replies: On"
      : "🔇 Spoken replies: Off";

    if (!voiceReplies) {
      stopPlayback();
    }

    setStatus(
      voiceReplies
        ? "Spoken answers enabled."
        : "Spoken answers disabled."
    );
  });

  chatForm.addEventListener(
    "submit",
    () => {
      awaitingTutorReply = true;
    },
    true
  );

  // Detect newly added tutor replies and speak them automatically.
  const observer = new MutationObserver(mutations => {
    if (!awaitingTutorReply) return;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        const bubbles = [];

        if (node.matches?.(".bubble.tutor")) {
          bubbles.push(node);
        }

        node.querySelectorAll?.(".bubble.tutor").forEach(bubble => {
          bubbles.push(bubble);
        });

        for (const bubble of bubbles) {
          const text =
            bubble.innerText ||
            bubble.textContent ||
            "";

          if (text.trim()) {
            awaitingTutorReply = false;
            speakWithPolly(text);
            return;
          }
        }
      }
    }
  });

  observer.observe(chatHistory, {
    childList: true,
    subtree: true
  });

  window.addEventListener("beforeunload", () => {
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    cleanupRecording();
    stopPlayback();
    observer.disconnect();
  });
})();
