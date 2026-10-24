const button = document.getElementById("enableMicrophone");
const status = document.getElementById("status");

button.addEventListener("click", async () => {
  button.disabled = true;
  status.classList.remove("error");
  status.textContent = "Waiting for Chrome microphone access…";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(track => track.stop());
    button.textContent = "Microphone enabled";
    status.textContent = "Access granted. Return to the MathMate side panel and click the microphone button again.";
  } catch (error) {
    button.disabled = false;
    status.classList.add("error");
    if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
      status.textContent = "Chrome still denied access. Open chrome://settings/content/microphone, allow microphone access for MathMate, and check Windows Settings → Privacy & security → Microphone → Let desktop apps access your microphone.";
    } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      status.textContent = "No microphone was found. Connect or enable a microphone, then try again.";
    } else {
      status.textContent = `Could not access the microphone: ${error.message}`;
    }
  }
});
