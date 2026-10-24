import base64
import binascii
import json
import os
import re
import asyncio
import traceback
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from memory import init_db, save_message, get_recent_messages

PROJECT_DIR = Path(__file__).resolve().parent
load_dotenv(PROJECT_DIR / ".env")

MODEL = "gemini-3.5-flash-lite"
API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=API_KEY) if API_KEY else None

app = FastAPI(title="MathMate API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "null",
    ],
    allow_origin_regex=r"chrome-extension://[a-p]{32}",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

init_db()


# ==================================================
# REQUEST MODELS
# ==================================================

class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=10000)

    # FIX: The floating tutor sends worksheet analysis in this field.
    context: str | None = Field(default=None, max_length=20000)

    # Optional screenshot for direct visual follow-up questions.
    image_base64: str | None = None


class ImageSolveRequest(BaseModel):
    image_base64: str = Field(min_length=1)
    user_prompt: str = Field(
        default="Please solve the maths problem in this image.",
        max_length=3000,
    )


class WorkbookAnalysisRequest(BaseModel):
    image_base64: str = Field(min_length=1)
    user_prompt: str = Field(
        default="Read my worksheet and help me solve the problem.",
        max_length=3000,
    )


class AudioTranscriptionRequest(BaseModel):
    audio_base64: str = Field(min_length=1)
    mime_type: str = Field(default="audio/webm", max_length=100)


class PdfPageScanRequest(BaseModel):
    page_number: int = Field(ge=1, le=10000)
    image_base64: str = Field(min_length=1)


# ==================================================
# SHARED HELPERS
# ==================================================

def require_client():
    if client is None:
        raise HTTPException(
            status_code=500,
            detail=(
                "Gemini API key is not configured. "
                "Check GEMINI_API_KEY in your project's .env file."
            ),
        )


def open_gradium_request(request, timeout=60):
    """Retry once when the Gradium connection fails before a response arrives."""
    try:
        return urlopen(request, timeout=timeout)
    except (URLError, TimeoutError):
        time.sleep(0.5)
        return urlopen(request, timeout=timeout)


def get_friendly_api_error(error):
    message = str(error).lower()

    if (
        "429" in message
        or "quota" in message
        or "resource_exhausted" in message
    ):
        return (
            "Gemini's usage limit may have been reached. "
            "Please check your API quota and try again later."
        )

    if "503" in message or "unavailable" in message:
        return "Gemini is temporarily unavailable. Please try again shortly."

    if "timeout" in message or "timed out" in message:
        return "The request took too long. Please try again."

    if "401" in message or "403" in message or "api key" in message:
        return "Gemini authentication failed. Please check your API key."

    if "404" in message or "not found" in message:
        return (
            f"The configured model ({MODEL}) could not be found "
            "or is unavailable to this API key."
        )

    return "MathMate could not complete the request. Please try again."


def decode_image(image_base64):
    """Decode a Base64 image or a data URL."""

    encoded = image_base64.strip()
    mime_type = "image/png"

    if encoded.lower().startswith("data:"):
        try:
            header, encoded = encoded.split(",", 1)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail="The image data URL is invalid.",
            ) from exc

        match = re.match(
            r"^data:(image/(?:png|jpeg|jpg|webp));base64$",
            header,
            flags=re.IGNORECASE,
        )

        if not match:
            raise HTTPException(
                status_code=400,
                detail="Use a PNG, JPEG, or WebP image.",
            )

        mime_type = match.group(1).lower()

        if mime_type == "image/jpg":
            mime_type = "image/jpeg"

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(
            status_code=400,
            detail="The image is not valid Base64 data.",
        ) from exc

    if not image_bytes:
        raise HTTPException(
            status_code=400,
            detail="The image is empty.",
        )

    if len(image_bytes) > 10 * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail="The image is too large. Maximum size is 10 MB.",
        )

    return image_bytes, mime_type


def ask_gemini_about_image(image_bytes, mime_type, prompt):
    require_client()

    response = client.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(
                data=image_bytes,
                mime_type=mime_type,
            ),
            prompt,
        ],
    )

    answer = response.text

    if not answer or not answer.strip():
        raise ValueError("Gemini returned an empty response.")

    return answer.strip()


def extract_json_object(text):
    """Parse Gemini JSON and recover common invalid backslash escapes."""

    if not isinstance(text, str) or not text.strip():
        raise ValueError("Gemini returned an empty response.")

    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(
            r"^```(?:json)?[ \t]*\r?\n?",
            "",
            cleaned,
            count=1,
            flags=re.IGNORECASE,
        )
        cleaned = re.sub(
            r"\r?\n?[ \t]*```[ \t]*$",
            "",
            cleaned,
            count=1,
        )

    try:
        result = json.loads(cleaned)

        if isinstance(result, dict):
            return result

        raise ValueError("Gemini returned JSON, but it was not an object.")

    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")

        if start < 0 or end <= start:
            raise ValueError(
                "Gemini did not return a complete JSON object."
            )

    candidate = cleaned[start:end + 1]

    try:
        result = json.loads(candidate)

    except json.JSONDecodeError as original_error:
        repaired = re.sub(
            r'\\(?!["\\/bfnrtu])',
            r"\\\\",
            candidate,
        )

        try:
            result = json.loads(repaired)
            print(
                "MathMate: recovered invalid backslash escapes "
                "in Gemini JSON."
            )

        except json.JSONDecodeError as repaired_error:
            raise ValueError(
                f"Gemini returned malformed JSON. "
                f"Original error: {original_error}; "
                f"repaired error: {repaired_error}."
            ) from repaired_error

    if not isinstance(result, dict):
        raise ValueError("Gemini returned an unexpected JSON structure.")

    return result


def normalise_workbook_response(data):
    steps = data.get("handwritten_steps", [])

    if not isinstance(steps, list):
        steps = []

    steps = [
        str(step).strip()
        for step in steps
        if isinstance(step, (str, int, float)) and str(step).strip()
    ]

    try:
        y_start = float(data.get("y_start_percent", 60))
    except (TypeError, ValueError):
        y_start = 60.0

    y_start = max(0.0, min(100.0, y_start))

    try:
        x_start = float(data.get("x_start_percent", 8))
    except (TypeError, ValueError):
        x_start = 8.0
    x_start = max(0.0, min(100.0, x_start))

    recognized = data.get("recognized_problem", "")
    explanation = data.get("sidebar_explanation", "")
    speech = data.get("speech_text", "")

    return {
        "recognized_problem": (
            recognized.strip()
            if isinstance(recognized, str)
            else str(recognized)
        ),
        "handwritten_steps": steps,
        "y_start_percent": y_start,
        "x_start_percent": x_start,
        "sidebar_explanation": (
            explanation.strip()
            if isinstance(explanation, str)
            else str(explanation)
        ),
        "speech_text": (
            speech.strip()
            if isinstance(speech, str)
            else str(speech)
        ),
        "needs_clarification": bool(
            data.get("needs_clarification", False)
        ),
        "model": MODEL,
    }


# ==================================================
# HEALTH CHECK
# ==================================================

@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "gemini_configured": client is not None,
        "model": MODEL,
    }


# ==================================================
# TEXT CHAT — WORKS WITH WORKSHEET CONTEXT
# ==================================================

@app.post("/api/chat")
def chat(request: ChatRequest):
    """Chat using text, worksheet context, and optionally a screenshot."""

    require_client()

    user_message = request.message.strip()

    if not user_message:
        raise HTTPException(
            status_code=400,
            detail="Please enter a question.",
        )

    try:
        history = get_recent_messages(limit=12)
        conversation = []

        for role, content in history:
            if role in ("user", "assistant") and content:
                conversation.append({
                    "role": "model" if role == "assistant" else "user",
                    "parts": [{"text": content}],
                })

        # FIX: overlay.js sends `context`. Use it instead of discarding it.
        worksheet_context = (request.context or "").strip()

        user_parts = []

        # Optional direct image support.
        if request.image_base64:
            image_bytes, mime_type = decode_image(
                request.image_base64
            )

            user_parts.append(
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type,
                )
            )

        if worksheet_context:
            prompt_text = (
                "WORKSHEET CONTEXT FROM THE MOST RECENT SCREEN CAPTURE\n"
                "Use the following as the current problem context. Answer "
                "questions about the specific problem, equations, graph, "
                "and solution steps. Do not ask the student to retype the "
                "entire question when the context contains it. If one "
                "specific detail is missing or unreadable, ask only about "
                "that detail.\n\n"
                + worksheet_context
                + "\n\nSTUDENT'S CURRENT QUESTION\n"
                + user_message
            )
        else:
            prompt_text = user_message

        user_parts.append({"text": prompt_text})

        conversation.append({
            "role": "user",
            "parts": user_parts,
        })

        response = client.models.generate_content(
            model=MODEL,
            contents=conversation,
            config=types.GenerateContentConfig(
                system_instruction=(
                    "You are MathMate, a patient, encouraging mathematics "
                    "tutor. Explain reasoning step by step and teach the "
                    "method. Use valid LaTeX: inline math inside "
                    "\\( ... \\), display equations between $$ on separate "
                    "lines, and fractions as "
                    "\\frac{numerator}{denominator}. Use headings and "
                    "numbered steps with blank lines. When worksheet context "
                    "or an image is supplied, use it to answer follow-up "
                    "questions directly. Do not claim you cannot see the "
                    "worksheet when its context or image is included. Do not "
                    "ask the student to type the whole problem again unless "
                    "the supplied information is genuinely insufficient or "
                    "unreadable. If clarification is necessary, ask only "
                    "about the missing detail."
                )
            ),
        )

        answer = response.text

        if not answer or not answer.strip():
            raise ValueError("Gemini returned an empty response.")

        save_message("user", user_message)
        save_message("assistant", answer.strip())

        return {
            "response": answer.strip(),
            "model": MODEL,
        }

    except HTTPException:
        raise

    except Exception as error:
        print(f"/api/chat error: {error}")

        raise HTTPException(
            status_code=502,
            detail=get_friendly_api_error(error),
        )


# ==================================================
# IMAGE SOLVING
# ==================================================

@app.post("/api/solve-image")
def solve_image(request: ImageSolveRequest):
    image_bytes, mime_type = decode_image(
        request.image_base64
    )

    prompt = f"""
You are MathMate, a careful mathematics tutor.

Student's request:
{request.user_prompt}

Read the image accurately, including handwritten symbols, signs,
exponents, fractions, limits, derivatives, and integrals.

Solve step by step. Explain the method in student-friendly language.
Format mathematics using readable LaTeX and clearly identify the
final answer.

If any handwriting is ambiguous, state exactly what is unclear
instead of guessing.
"""

    try:
        solution = ask_gemini_about_image(
            image_bytes,
            mime_type,
            prompt,
        )

        return {
            "solution": solution,
            "model": MODEL,
        }

    except HTTPException:
        raise

    except Exception as error:
        print(f"/api/solve-image error: {error}")

        raise HTTPException(
            status_code=502,
            detail=get_friendly_api_error(error),
        )


# ==================================================
# WORKSHEET ANALYSIS
# ==================================================

@app.post("/api/analyze-workbook")
def analyze_workbook(request: WorkbookAnalysisRequest):
    image_bytes, mime_type = decode_image(
        request.image_base64
    )

    prompt = f"""
You are MathMate's vision and mathematics engine.
The image is a screenshot of a student's worksheet or digital notebook.

Student's request:
{request.user_prompt}

Return ONLY valid JSON with exactly these fields:

{{
  "recognized_problem": "The mathematical question read from the image",
  "handwritten_steps": [
    "First line",
    "Second line",
    "Final answer line"
  ],
  "x_start_percent": 8,
  "y_start_percent": 65,
  "sidebar_explanation": "A student-friendly step-by-step explanation using Markdown and LaTeX",
  "speech_text": "The explanation in natural spoken language",
  "needs_clarification": false
}}

Rules:

- Transcribe the relevant problem and any work already attempted accurately.
- Solve carefully and check calculations.
- Explain why each formula or probability rule applies.
- handwritten_steps must be an ordered list of short, legible lines suitable
  for writing on a worksheet. Use plain text and Unicode math symbols; do not
  put raw LaTeX or Markdown in these lines. Write fractions with `/`.
- Estimate a genuinely blank rectangular area for the complete solution.
  x_start_percent and y_start_percent locate its top-left corner within the
  image, from 0 to 100. If no safe blank area exists, return 100 for both.
  y_start_percent otherwise estimates the vertical position from 0 (top) to 100
  (bottom).
- sidebar_explanation should use headings, numbered steps, valid LaTeX,
  inline maths inside \\( ... \\), and display equations between $$
  on separate lines. Every fraction must use
  \\frac{{numerator}}{{denominator}}.
- speech_text should be natural spoken language without raw LaTeX
  or Markdown.
- If the problem cannot be read reliably, set needs_clarification
  to true, explain what is unclear, and return an empty
  handwritten_steps array.
- Do not claim you edited the original PDF or wrote on the screenshot.

Return JSON only, without Markdown fences.
"""

    try:
        require_client()

        response = client.models.generate_content(
            model=MODEL,
            contents=[
                types.Part.from_bytes(
                    data=image_bytes,
                    mime_type=mime_type,
                ),
                prompt,
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
            ),
        )

        result = normalise_workbook_response(
            extract_json_object(response.text or "")
        )

        if result["needs_clarification"]:
            result["handwritten_steps"] = []

        return result

    except HTTPException:
        raise

    except Exception as error:
        print("\n========== WORKBOOK ANALYSIS ERROR ==========")
        traceback.print_exc()
        print("==============================================\n")

        raise HTTPException(
            status_code=502,
            detail=get_friendly_api_error(error),
        )


@app.post("/api/scan-pdf-page")
def scan_pdf_page(request: PdfPageScanRequest):
    """Read a rendered PDF page, including scans and image-only pages."""
    image_bytes, mime_type = decode_image(request.image_base64)
    prompt = (
        "Read this rendered page from a mathematics workbook. Transcribe all "
        "legible printed and handwritten text, equations, labels, table entries, "
        "and diagram descriptions. Preserve the page's structure and do not "
        "solve problems. Mark unclear symbols as [unclear] instead of guessing. "
        f"This is PDF page {request.page_number}. Return concise, faithful text."
    )
    try:
        text = ask_gemini_about_image(image_bytes, mime_type, prompt)
        return {"page_number": request.page_number, "text": text, "model": MODEL}
    except HTTPException:
        raise
    except Exception as error:
        print(f"/api/scan-pdf-page error: {error}")
        raise HTTPException(status_code=502, detail=get_friendly_api_error(error))


# ==================================================
# AUDIO TRANSCRIPTION
# ==================================================

@app.post("/api/transcribe-audio")
def transcribe_audio(request: AudioTranscriptionRequest):
    """Transcribe a Base64 WAV recording using Gradium speech recognition."""

    api_key = os.getenv("GRADIUM_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Gradium voice is not configured. Add GRADIUM_API_KEY to the project's .env file.",
        )

    try:
        encoded = request.audio_base64.strip()

        if encoded.lower().startswith("data:"):
            try:
                header, encoded = encoded.split(",", 1)
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid audio data URL: missing comma separator.",
                ) from exc

            if ";base64" not in header.lower():
                raise HTTPException(
                    status_code=400,
                    detail="Audio data URL must contain Base64 data.",
                )

            mime_match = re.match(
                r"^data:(audio/[a-zA-Z0-9.+_-]+)",
                header,
                flags=re.IGNORECASE,
            )

            if not mime_match:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid audio MIME type in data URL.",
                )

            mime_type = mime_match.group(1).lower()

        else:
            mime_type = request.mime_type.strip() or "audio/webm"

        try:
            audio_bytes = base64.b64decode(
                encoded,
                validate=True,
            )
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail="Audio is not valid Base64 data.",
            ) from exc

        if not audio_bytes:
            raise HTTPException(
                status_code=400,
                detail="The recording is empty.",
            )

        if len(audio_bytes) > 15 * 1024 * 1024:
            raise HTTPException(
                status_code=413,
                detail="Recording too large. Keep it under 15 MB.",
            )

        if mime_type not in {"audio/wav", "audio/x-wav", "audio/wave"}:
            raise HTTPException(
                status_code=415,
                detail="Gradium transcription expects the WAV recording captured by the MathMate extension.",
            )

        query = urlencode({
            "json_config": json.dumps({
                "language": "en",
                "delay_in_frames": 16,
            })
        })
        gradium_request = Request(
            f"https://api.gradium.ai/api/post/speech/asr?{query}",
            data=audio_bytes,
            headers={
                "x-api-key": api_key,
                "Content-Type": "audio/wav",
            },
            method="POST",
        )
        transcript_parts = []
        with open_gradium_request(gradium_request, timeout=60) as response:
            for line in response:
                if not line.strip():
                    continue
                message = json.loads(line.decode("utf-8"))
                if message.get("type") == "error":
                    raise ValueError("Gradium reported a transcription error.")
                if message.get("type") in {"text", "end_text"}:
                    value = str(message.get("text", "")).strip()
                    if value and (not transcript_parts or value != transcript_parts[-1]):
                        transcript_parts.append(value)

        transcript = " ".join(transcript_parts).strip().strip('"')

        if not transcript:
            raise HTTPException(
                status_code=422,
                detail="No speech was recognized. Please try again.",
            )

        return {
            "transcript": transcript,
            "provider": "Gradium",
        }

    except HTTPException:
        raise

    except HTTPError as error:
        messages = {
            400: "Gradium rejected the WAV audio or transcription settings (HTTP 400).",
            401: "Gradium rejected the configured API key (HTTP 401).",
            402: "The Gradium account needs transcription credits (HTTP 402).",
            403: "The Gradium account does not have access to speech recognition (HTTP 403).",
            413: "The recording is too large for Gradium (HTTP 413).",
            415: "Gradium rejected the recording format (HTTP 415).",
            429: "Gradium is rate limiting or has exhausted available credits (HTTP 429).",
        }
        detail = messages.get(error.code, f"Gradium speech recognition returned HTTP {error.code}.")
        print(f"/api/transcribe-audio failed with Gradium HTTP {error.code}.")
        raise HTTPException(status_code=502, detail=detail) from error

    except (URLError, TimeoutError) as error:
        print(f"/api/transcribe-audio network failure ({type(error).__name__}).")
        raise HTTPException(
            status_code=502,
            detail="MathMate could not reach Gradium speech recognition. Check your internet connection and try again.",
        ) from error

    except (ValueError, json.JSONDecodeError) as error:
        print(f"/api/transcribe-audio received an invalid Gradium response ({type(error).__name__}).")
        raise HTTPException(
            status_code=502,
            detail="Gradium returned an unreadable transcription response. Try recording again; if it repeats, check Gradium service status.",
        ) from error
