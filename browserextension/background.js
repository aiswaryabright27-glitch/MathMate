console.log("MathMate service worker started.");

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => {
    console.error("Side panel setup error:", error);
  });
});

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || tab.windowId == null) {
    throw new Error("No active browser tab is available to capture.");
  }
  return tab;
}

function classifyPage(url = "", title = "") {
  if (/\.pdf(?:[?#].*)?$/i.test(url) || /pdf viewer|\.pdf\b/i.test(title)) return "pdf";
  if (/\.(png|jpe?g|gif|webp|bmp|avif)(?:[?#].*)?$/i.test(url) || /\.(png|jpe?g|gif|webp|bmp|avif)\b/i.test(title)) return "image";
  return "web";
}

function getPageNumber(url = "") {
  const match = url.match(/(?:#|%23|&)page=(\d+)/i);
  return match ? Number(match[1]) : null;
}

async function captureActiveScreen() {
  const tab = await getActiveTab();
  let screenshot = "";
  let page = {
    title: tab.title || "Current screen",
    url: tab.url || "",
    text: "",
    kind: classifyPage(tab.url || "", tab.title || ""),
    pageNumber: getPageNumber(tab.url || ""),
    tabId: tab.id,
  };

  try {
    screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 84,
    });
  } catch (error) {
    console.warn("MathMate screenshot capture was blocked:", error);
  }

  if (/^https?:\/\//i.test(tab.url || "")) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          title: document.title || "Webpage",
          url: location.href,
          text: document.body?.innerText?.slice(0, 18000) || "",
        }),
      });
      if (result?.result) page = { ...page, ...result.result, tabId: tab.id };
    } catch (error) {
      console.warn("MathMate could not read webpage text:", error);
    }
  }

  if (!screenshot && !page.text.trim()) {
    throw new Error(
      "Chrome couldn't capture this page. Switch to a normal webpage or PDF tab, grant MathMate access to the site, then try Read Screen again."
    );
  }

  return { ...page, screenshot };
}

async function prepareHandwrittenOverlay(message) {
  const tabId = Number(message.tabId);
  if (!Number.isInteger(tabId)) throw new Error("The captured webpage is no longer available.");
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//i.test(tab.url || "")) {
    throw new Error("Handwritten page overlays work on regular webpages. The captured page has changed or is a protected browser page.");
  }
  if (message.pageUrl && tab.url.split("#")[0] !== String(message.pageUrl).split("#")[0]) {
    throw new Error("The webpage changed after the screen capture. Capture the screen again, then ask MathMate to solve it.");
  }
  const text = String(message.text || "").trim().slice(0, 5000);
  if (!text) throw new Error("MathMate did not return any solution steps to write.");

  await chrome.scripting.executeScript({
    target: { tabId },
    args: [text],
    func: solutionText => {
      document.getElementById("mathmate-handwriting-root")?.remove();
      document.getElementById("mathmate-handwriting-prompt")?.remove();
      const prompt = document.createElement("div");
      prompt.id = "mathmate-handwriting-prompt";
      Object.assign(prompt.style, {
        position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
        padding: "12px 14px", borderRadius: "12px", background: "#fffafd",
        color: "#42364d", border: "1px solid #d9c4e5", boxShadow: "0 4px 20px #26143633",
        font: "13px/1.4 Segoe UI, Arial, sans-serif",
      });
      const hint = document.createElement("span");
      hint.textContent = "Click a blank spot on the page to write the steps";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      Object.assign(cancel.style, { marginLeft: "12px", border: "0", borderRadius: "7px", padding: "5px 8px", background: "#f1e8f5", color: "#513e61", cursor: "pointer" });
      prompt.append(hint, cancel);
      const placementLayer = document.createElement("div");
      placementLayer.id = "mathmate-handwriting-placement-layer";
      Object.assign(placementLayer.style, {
        position: "fixed", inset: "0", zIndex: "2147483646",
        background: "transparent", cursor: "crosshair",
      });
      document.documentElement.append(placementLayer, prompt);

      const cleanup = () => {
        placementLayer.removeEventListener("pointerdown", place);
        placementLayer.remove();
        prompt.remove();
      };
      const place = event => {
        if (prompt.contains(event.target)) return;
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        cleanup();

        const root = document.createElement("div");
        root.id = "mathmate-handwriting-root";
        Object.assign(root.style, {
          position: "fixed", left: `${Math.max(8, Math.min(innerWidth - 340, event.clientX))}px`,
          top: `${Math.max(8, Math.min(innerHeight - 180, event.clientY))}px`, width: "min(360px, 76vw)",
          maxHeight: "65vh", overflow: "auto", zIndex: "2147483647", padding: "7px 10px",
          color: "#1e3d8f", background: "transparent", border: "1px dashed transparent",
          borderRadius: "5px", font: "clamp(17px, 2vw, 23px)/1.48 'Segoe Print','Comic Sans MS',cursive",
          whiteSpace: "pre-wrap", overflowWrap: "anywhere", letterSpacing: ".15px",
          textShadow: "0 0 .25px #18377d", transform: "rotate(-0.35deg)", cursor: "move",
        });
        const toolbar = document.createElement("div");
        Object.assign(toolbar.style, { position: "sticky", top: "0", display: "flex", justifyContent: "flex-end", gap: "4px", opacity: ".25", transition: "opacity .15s", font: "12px Segoe UI,Arial,sans-serif", transform: "rotate(.35deg)" });
        root.addEventListener("mouseenter", () => { toolbar.style.opacity = "1"; root.style.borderColor = "#a79aba88"; });
        root.addEventListener("mouseleave", () => { toolbar.style.opacity = ".25"; root.style.borderColor = "transparent"; });
        const makeButton = (label, title) => {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.title = title;
          Object.assign(button.style, { border: "1px solid #d8cde1", borderRadius: "6px", padding: "3px 6px", background: "#fffdfbcc", color: "#443757", cursor: "pointer" });
          return button;
        };
        const edit = makeButton("Edit", "Edit the handwritten solution");
        const remove = makeButton("×", "Remove this solution");
        const body = document.createElement("div");
        body.textContent = solutionText;
        body.contentEditable = "false";
        body.spellcheck = false;
        body.setAttribute("aria-label", "Editable handwritten solution");
        body.style.outline = "none";
        edit.addEventListener("click", event => {
          event.stopPropagation();
          body.focus();
          body.contentEditable = body.contentEditable === "true" ? "false" : "true";
          edit.textContent = body.contentEditable === "true" ? "Done" : "Edit";
        });
        remove.addEventListener("click", event => { event.stopPropagation(); root.remove(); });
        toolbar.append(edit, remove);
        root.append(toolbar, body);

        let drag = null;
        root.addEventListener("pointerdown", event => {
          if (event.target.closest("button") || body.isContentEditable || event.button !== 0) return;
          drag = { x: event.clientX - root.offsetLeft, y: event.clientY - root.offsetTop };
          root.setPointerCapture(event.pointerId);
        });
        root.addEventListener("pointermove", event => {
          if (!drag) return;
          root.style.left = `${Math.max(0, Math.min(innerWidth - root.offsetWidth, event.clientX - drag.x))}px`;
          root.style.top = `${Math.max(0, Math.min(innerHeight - root.offsetHeight, event.clientY - drag.y))}px`;
        });
        const stopDrag = () => { drag = null; };
        root.addEventListener("pointerup", stopDrag);
        root.addEventListener("pointercancel", stopDrag);
        document.documentElement.appendChild(root);
      };
      cancel.addEventListener("click", cleanup);
      placementLayer.addEventListener("pointerdown", place);
    },
  });
  return { success: true };
}

async function prepareNoteTextInsertion(message) {
  const tabId = Number(message.tabId);
  if (!Number.isInteger(tabId)) throw new Error("The captured webpage is no longer available.");
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//i.test(tab.url || "")) throw new Error("Open the note in a regular webpage first.");
  if (message.pageUrl && tab.url.split("#")[0] !== String(message.pageUrl).split("#")[0]) {
    throw new Error("The webpage changed after capture. Capture it again, then retry.");
  }
  const text = String(message.text || "").trim().slice(0, 5000);
  if (!text) throw new Error("MathMate did not return any solution steps to insert.");

  await chrome.scripting.executeScript({
    target: { tabId },
    args: [text, tabId, message.pageUrl || tab.url],
    func: (solutionText, owningTabId, owningPageUrl) => {
      document.getElementById("mathmate-note-insert-prompt")?.remove();
      const prompt = document.createElement("div");
      prompt.id = "mathmate-note-insert-prompt";
      Object.assign(prompt.style, {
        position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
        padding: "12px 14px", borderRadius: "12px", background: "#fffafd",
        color: "#42364d", border: "1px solid #d9c4e5", boxShadow: "0 4px 20px #26143633",
        font: "13px/1.4 Segoe UI, Arial, sans-serif",
      });
      const hint = document.createElement("span");
      hint.textContent = "Open or create a NotebookLM note, then click inside its editable text where the solution should go.";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      Object.assign(cancel.style, { marginLeft: "12px", border: "0", borderRadius: "7px", padding: "5px 8px", background: "#f1e8f5", color: "#513e61", cursor: "pointer" });
      prompt.append(hint, cancel);
      document.documentElement.append(prompt);
      const cleanup = () => {
        document.removeEventListener("pointerdown", onPageClick, true);
        prompt.remove();
      };
      cancel.addEventListener("click", cleanup);
      const onPageClick = event => {
        if (prompt.contains(event.target)) return;
        if (event.button !== 0) return;
        const clickedEditor = event.composedPath().some(node => node instanceof HTMLElement && (
          node.isContentEditable ||
          node.matches("textarea, input:not([type=button]):not([type=submit]), [role=textbox]")
        ));
        if (!clickedEditor) return;
        hint.textContent = "Inserting solution into the note…";
        cancel.hidden = true;
        document.removeEventListener("pointerdown", onPageClick, true);
        chrome.runtime.sendMessage({
          type: "INSERT_NOTE_TEXT_AT",
          tabId: owningTabId,
          pageUrl: owningPageUrl,
          text: solutionText,
        }).then(result => {
          hint.textContent = result?.success
            ? "Solution inserted into the note."
            : `Could not insert into the note: ${result?.error || "Unknown error."}`;
          setTimeout(cleanup, 4500);
        }).catch(error => {
          hint.textContent = `Could not insert into the note: ${error.message || "MathMate could not reach the extension."}`;
          setTimeout(cleanup, 4500);
        });
      };
      document.addEventListener("pointerdown", onPageClick, true);
    },
  });
  return { success: true };
}

async function insertTextAtPoint(message) {
  const tabId = Number(message.tabId);
  if (!Number.isInteger(tabId)) throw new Error("The note tab is no longer available.");
  const tab = await chrome.tabs.get(tabId);
  if (message.pageUrl && tab.url.split("#")[0] !== String(message.pageUrl).split("#")[0]) {
    throw new Error("The note page changed. Capture it again before inserting the solution.");
  }
  const text = String(message.text || "").trim().slice(0, 5000);
  if (!text) throw new Error("The solution text was empty.");

  let attached = false;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attached = true;
    const [focusResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        let active = document.activeElement;
        while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
        return Boolean(active && (
          active.isContentEditable ||
          active.matches("textarea, input:not([type=button]):not([type=submit]), [role=textbox]") ||
          active.tagName === "IFRAME"
        ));
      },
    });
    if (!focusResult?.result) {
      throw new Error("NotebookLM did not focus an editable note. Open or create a note, then click inside the note text area and try again.");
    }

    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
    return { success: true };
  } finally {
    if (attached) await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return;
  const supported = ["CAPTURE_SCREEN", "GET_PAGE_TEXT", "PLACE_HANDWRITTEN_SOLUTION", "INSERT_NOTE_TEXT", "INSERT_NOTE_TEXT_AT"];
  if (!supported.includes(message.type)) return;

  (async () => {
    try {
      if (message.type === "PLACE_HANDWRITTEN_SOLUTION") {
        sendResponse(await prepareHandwrittenOverlay(message));
        return;
      }
      if (message.type === "INSERT_NOTE_TEXT") {
        sendResponse(await prepareNoteTextInsertion(message));
        return;
      }
      if (message.type === "INSERT_NOTE_TEXT_AT") {
        if (sender.id !== chrome.runtime.id) throw new Error("The note insertion request was not sent by MathMate.");
        sendResponse(await insertTextAtPoint({ ...message, tabId: sender.tab?.id ?? message.tabId }));
        return;
      }
      if (message.type === "CAPTURE_SCREEN") {
        sendResponse({ success: true, page: await captureActiveScreen() });
        return;
      }

      const page = await captureActiveScreen();
      sendResponse({ success: true, page: { ...page, screenshot: "" } });
    } catch (error) {
      console.error("MathMate screen capture error:", error);
      sendResponse({ success: false, error: error?.message || "Screen capture failed." });
    }
  })();
  return true;
});
