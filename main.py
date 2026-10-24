

import os
from dotenv import load_dotenv
from google import genai
from memory import init_db, save_message, get_recent_messages

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("API key not found. Check your .env file.")

client = genai.Client(api_key=api_key)

SYSTEM_INSTRUCTION = """
You are MathMate, a patient and encouraging math tutor.
Explain concepts step by step.
Help students understand why each step works.
Ask questions when that helps students learn.
Use previous messages to maintain context.
"""

# Create the database table if it does not exist.
init_db()

# Restore the most recent conversation from the database.
conversation = [
    {
        "role": role,
        "parts": [{"text": content}]
    }
    for role, content in get_recent_messages(20)
]

print("=" * 40)
print("Welcome to MathMate!")
print("Your personal AI math tutor")
print("Type 'exit' to quit.")
print("=" * 40)

while True:
    question = input("\nYou: ").strip()

    if question.lower() == "exit":
        print("MathMate: Great work today. See you next time!")
        break

    if not question:
        print("MathMate: Type a question whenever you're ready.")
        continue

    # Add and persist the student's question.
    conversation.append({
        "role": "user",
        "parts": [{"text": question}]
    })
    save_message("user", question)

    print("\nMathMate is thinking...")

    try:
        response = client.models.generate_content(
            model="gemini-3.5-flash-lite",
            contents=conversation,
            config={"system_instruction": SYSTEM_INSTRUCTION},
        )

        answer = response.text or "I couldn't generate a response."

        print("\nMathMate:", answer)

        # Add and persist MathMate's response.
        conversation.append({
            "role": "model",
            "parts": [{"text": answer}]
        })
        save_message("model", answer)

    except Exception as error:
        # Remove the failed question from in-memory history.
        conversation.pop()
        print(f"\nSomething went wrong: {error}")
# -------------------------------------------------------------
# ADD THIS TO THE BOTTOM OF YOUR EXISTING main.py
# -------------------------------------------------------------
import base64

class ImageSolveRequest(BaseModel):
    image_base64: str
    user_prompt: str = "Solve this step-by-step and explain why each step works."

@app.post("/api/solve-image")
async def solve_image(req: ImageSolveRequest):
    try:
        # Strip header if present (e.g., 'data:image/png;base64,...')
        raw_b64 = req.image_base64.split(",")[-1]
        image_bytes = base64.b64decode(raw_b64)

        model = genai.GenerativeModel("gemini-1.5-flash")

        system_prompt = (
            "You are MathMate, a warm and encouraging Socratic math tutor. "
            "1. Transcribe the mathematical expressions or drawings in the image into clear LaTeX. "
            "2. Explain the main math concept needed to solve it. "
            "3. Show clean, step-by-step derivations using LaTeX ($...$ for inline, $$...$$ for block formulas). "
            "4. End with the final answer clearly bolded, followed by a gentle follow-up question to test understanding."
        )

        response = model.generate_content([
            {"mime_type": "image/png", "data": image_bytes},
            f"{system_prompt}\nUser message: {req.user_prompt}"
        ])

        return {"status": "success", "solution": response.text}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vision processing failed: {str(e)}")