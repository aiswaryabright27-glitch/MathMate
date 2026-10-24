# MathMate

MathMate is an AI math study companion with a local Python API, a React website, and a Chrome extension side panel. It can explain math questions, analyze a captured screen, and provide voice input/output when the required services are configured.

## Features

- Ask math questions and get step-by-step tutoring from Gemini.
- Capture the active webpage or screen and ask about its contents.
- Use voice input through Gradium speech recognition. Voice questions can receive spoken answers using the browser's speech engine; pause and stop controls are available in the side panel.
- Keep chat and practice history in a local SQLite database (`mathmate.db`).
- Use the React website or open the Chrome side panel alongside a webpage.
- Handwriting-style solution placement is experimental. It depends on the target page and Chrome permissions; embedded canvas editors such as NotebookLM may not accept injected writing.

## Requirements

- Python 3.10 or newer
- Node.js 20.19+ or 22.12+ (Vite 8 requirement)
- Google Gemini API key
- Gradium API key for voice transcription (optional)
- Google Chrome to use the extension

## Configure API keys

Create a private `.env` file in the project root. You can copy `.env.example` and replace the placeholders:

```dotenv
GEMINI_API_KEY=your_gemini_api_key
GRADIUM_API_KEY=your_gradium_api_key
```

`GRADIUM_API_KEY` is optional if you do not need voice transcription. Never commit `.env` or paste API keys into issues or chat. The `.gitignore` excludes it.

## Run the API

From the project root, create and activate a virtual environment, then install the Python dependencies:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

If PowerShell blocks activation, run the API using the environment's interpreter directly:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Start the local API:

```powershell
python -m uvicorn api:app --reload --host 127.0.0.1 --port 8000
```

The health endpoint is [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health). Keep this terminal running while using the app.

## Run the website

In a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL Vite prints (normally [http://localhost:5173](http://localhost:5173)). The API should already be running on port 8000.

## Install the Chrome extension

1. Start the API as described above.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Choose **Load unpacked** and select this repository's `browserextension` folder.
4. Pin MathMate if desired, open a regular webpage, and click the MathMate toolbar icon to open its side panel.
5. When Chrome asks, grant the extension microphone access for voice and site access for the page you want MathMate to inspect or annotate.

The extension talks to the local API at `http://127.0.0.1:8000`. Browser-protected pages such as `chrome://` pages cannot be captured or modified. Screen capture and handwritten placement vary by site; NotebookLM and other canvas-based note apps may block page overlays or writing.

## Desktop app

The Electron desktop shell is available from the frontend package:

```powershell
cd frontend
npm install
npm run desktop
```

Run the Python API separately before launching the desktop shell.

## Build and lint the website

```powershell
cd frontend
npm run build
npm run lint
```

## Project layout

```text
api.py                  FastAPI service for chat, image analysis, and voice
memory.py               Local SQLite conversation and practice storage
math_checker.py         Symbolic answer checking
practice.py             Practice question flow
frontend/               React + Vite website and Electron shell
browserextension/       Chrome Manifest V3 extension and side panel
requirements.txt        Python API dependencies
```

## Privacy and data

API keys belong in the ignored root `.env` file. Chat and practice history are stored locally in `mathmate.db`. Questions, captured images, or audio are sent to the configured Gemini or Gradium service when you use the corresponding feature. Review each provider's terms and privacy policy before sending sensitive material.

See [SECURITY.md](SECURITY.md) for reporting security issues and [CONTRIBUTING.md](CONTRIBUTING.md) for development notes.
