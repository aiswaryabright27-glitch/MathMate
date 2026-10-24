
const {
  app,
  BrowserWindow,
  ipcMain,
  desktopCapturer,
  dialog,
  shell,
  session,
} = require("electron");

const path = require("node:path");
const fs = require("node:fs");

let mainWindow;
let overlayWindow;

const isDev = !app.isPackaged;
const VITE_URL = "http://127.0.0.1:5173";

function isMathMatePage(webContents) {
  const url = webContents?.getURL?.() || "";

  return (
    url.startsWith("file://") ||
    url.startsWith("http://127.0.0.1:5173/") ||
    url.startsWith("http://localhost:5173/")
  );
}

function configureMicrophonePermissions() {
  const defaultSession = session.defaultSession;

  defaultSession.setPermissionCheckHandler(
    (webContents, permission, _origin, details) => {
      if (permission !== "media" || !isMathMatePage(webContents)) {
        return false;
      }

      const mediaTypes = details?.mediaTypes || [];
      return mediaTypes.includes("audio");
    }
  );

  defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (permission !== "media" || !isMathMatePage(webContents)) {
        callback(false);
        return;
      }

      const mediaTypes = details?.mediaTypes || [];
      const wantsAudio = mediaTypes.includes("audio");
      const wantsVideo = mediaTypes.includes("video");

      callback(wantsAudio && !wantsVideo);
    }
  );
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1250,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    title: "MathMate",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL(VITE_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description) => {
      console.error("MathMate window failed to load:", code, description);
    }
  );
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 430,
    height: 690,
    minWidth: 360,
    minHeight: 480,
    x: 40,
    y: 70,
    title: "MathMate Floating Tutor",
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: "#fffafc",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "floating");
  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));

  overlayWindow.webContents.on(
    "did-fail-load",
    (_event, code, description) => {
      console.error("MathMate overlay failed to load:", code, description);
    }
  );
}

ipcMain.handle("mathmate:get-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 1600, height: 1000 },
    fetchWindowIcons: false,
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL(),
  }));
});

ipcMain.handle("mathmate:capture-source", async (_event, sourceId) => {
  if (typeof sourceId !== "string" || !sourceId) {
    throw new Error("Please select a screen or application window first.");
  }

  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 1920, height: 1200 },
    fetchWindowIcons: false,
  });

  const source = sources.find((item) => item.id === sourceId);

  if (!source) {
    throw new Error(
      "That screen or window is no longer available. Refresh the list and try again."
    );
  }

  return {
    name: source.name,
    imageDataUrl: source.thumbnail.toDataURL(),
  };
});

// Always return an object because voice.js checks result.granted.
ipcMain.handle(
  "mathmate:request-microphone-permission",
  async (event) => {
    if (!isMathMatePage(event.sender)) {
      return { granted: false };
    }

    try {
      const result = await dialog.showMessageBox(
        BrowserWindow.fromWebContents(event.sender) || undefined,
        {
          type: "question",
          title: "MathMate microphone access",
          message: "Allow MathMate to use your microphone?",
          detail:
            "MathMate needs microphone access to hear your spoken questions. You can cancel if you do not want to use voice input.",
          buttons: ["Allow", "Cancel"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        }
      );

      return { granted: result.response === 0 };
    } catch (error) {
      console.error("Microphone permission dialog failed:", error);
      return { granted: false };
    }
  }
);

ipcMain.handle("mathmate:save-pdf", async (_event, payload) => {
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

  if (!payload || typeof payload.text !== "string" || !payload.text.trim()) {
    throw new Error("There is no solution text to save.");
  }

  const inputResult = await dialog.showOpenDialog({
    title: "Choose the PDF to add your solution to",
    properties: ["openFile"],
    filters: [{ name: "PDF documents", extensions: ["pdf"] }],
  });

  if (inputResult.canceled || !inputResult.filePaths.length) {
    return { canceled: true };
  }

  const inputPath = inputResult.filePaths[0];

  const outputResult = await dialog.showSaveDialog({
    title: "Save solved PDF as",
    defaultPath: path.join(
      path.dirname(inputPath),
      `${path.basename(inputPath, ".pdf")}-MathMate.pdf`
    ),
    filters: [{ name: "PDF documents", extensions: ["pdf"] }],
  });

  if (outputResult.canceled || !outputResult.filePath) {
    return { canceled: true };
  }

  const bytes = fs.readFileSync(inputPath);
  const pdf = await PDFDocument.load(bytes);
  const pages = pdf.getPages();

  if (!pages.length) {
    throw new Error("The selected PDF has no pages.");
  }

  const requestedPage = Number.isInteger(payload.pageIndex)
    ? payload.pageIndex
    : 0;

  const pageIndex = Math.max(
    0,
    Math.min(requestedPage, pages.length - 1)
  );

  const page = pages[pageIndex];
  const { width, height } = page.getSize();

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;
  const margin = 32;
  const lineHeight = 14;
  const maxWidth = width - margin * 2;

  const words = payload.text.replace(/\r/g, "").split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }

  if (line) {
    lines.push(line);
  }

  const maxLines = Math.max(
    1,
    Math.floor((height - margin * 2) / lineHeight)
  );

  const visibleLines = lines.slice(0, maxLines);
  let y = height - margin - fontSize;

  for (const textLine of visibleLines) {
    page.drawText(textLine, {
      x: margin,
      y,
      size: fontSize,
      font,
      color: rgb(0.15, 0.15, 0.22),
      maxWidth,
    });

    y -= lineHeight;
  }

  const savedBytes = await pdf.save();
  fs.writeFileSync(outputResult.filePath, savedBytes);

  return {
    canceled: false,
    filePath: outputResult.filePath,
    truncated: lines.length > visibleLines.length,
  };
});

ipcMain.handle(
  "mathmate:open-file-location",
  async (_event, filePath) => {
    if (typeof filePath !== "string" || !filePath) {
      return false;
    }

    shell.showItemInFolder(filePath);
    return true;
  }
);

app.whenReady().then(() => {
  configureMicrophonePermissions();

  createMainWindow();
  createOverlayWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createOverlayWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
