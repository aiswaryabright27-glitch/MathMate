import { useRef, useState } from "react";
import "./ScreenCapture.css";

/**
 * Lets the user explicitly choose a screen, desktop window, or browser tab,
 * captures one still frame, then stops sharing immediately.
 */
export default function ScreenCapture({ onCapture, disabled = false, compact = false }) {
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);

  async function captureScreen() {
    setError("");

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "Screen capture isn't available in this browser. Open MathMate in a recent version of Chrome or Edge on localhost, then try again."
      );
      return;
    }

    let stream;
    setCapturing(true);

    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 1,
          cursor: "always",
        },
        audio: false,
      });

      const video = videoRef.current;
      if (!video) throw new Error("The screen capture preview isn't ready.");

      const metadataReady = new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = () => reject(new Error("Couldn't read the selected screen."));
      });
      video.srcObject = stream;
      await metadataReady;
      await video.play();

      // Give the browser a moment to deliver the first actual video frame.
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const sourceWidth = video.videoWidth;
      const sourceHeight = video.videoHeight;
      if (!sourceWidth || !sourceHeight) {
        throw new Error("The selected screen returned an empty image. Please try again.");
      }

      // Resize large desktop screenshots so the API request remains manageable.
      const maxWidth = 1600;
      const scale = Math.min(1, maxWidth / sourceWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sourceWidth * scale);
      canvas.height = Math.round(sourceHeight * scale);

      const context = canvas.getContext("2d");
      if (!context) throw new Error("Couldn't prepare the screen image.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const imageData = canvas.toDataURL("image/jpeg", 0.84);
      onCapture?.(imageData);
    } catch (captureError) {
      if (captureError?.name === "NotAllowedError") {
        setError("Screen sharing was cancelled. Click Capture screen and choose your PDF window or entire screen.");
      } else if (captureError?.name === "AbortError") {
        setError("Screen capture was cancelled. Please try again when you're ready.");
      } else {
        setError(captureError?.message || "Couldn't capture the screen. Please try again.");
      }
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      setCapturing(false);
    }
  }

  return (
    <section className={`screen-capture-card${compact ? " is-compact" : ""}`} aria-label="Capture your current worksheet">
      <video ref={videoRef} className="screen-capture-hidden-video" muted playsInline />
      {!compact && <div className="screen-capture-copy">
        <span className="screen-capture-icon" aria-hidden="true">▣</span>
        <div>
          <h3>Working in another app?</h3>
          <p>Capture your PDF in Acrobat or anything visible on your screen, then ask MathMate about it.</p>
        </div>
      </div>}
      <button
        type="button"
        className="screen-capture-button"
        onClick={captureScreen}
        disabled={disabled || capturing}
      >
        <span aria-hidden="true">{capturing ? "◌" : "⌗"}</span>
        {capturing ? "Capturing…" : compact ? "Capture notes" : "Capture screen"}
      </button>
      {!compact && <p className="screen-capture-permission">Your browser will ask you to choose a screen or window. Sharing stops after one screenshot.</p>}
      {error && <p className="screen-capture-error" role="alert">{error}</p>}
    </section>
  );
}
