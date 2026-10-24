
import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).with_name("mathmate.db")


def get_connection():
    return sqlite3.connect(DB_PATH)


def init_db():
    with get_connection() as conn:
        cursor = conn.cursor()

        # Store tutor conversations.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Store practice attempts.
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT NOT NULL,
                question TEXT NOT NULL,
                student_answer TEXT NOT NULL,
                correct INTEGER NOT NULL,
                feedback TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Safely upgrade an existing database without deleting old attempts.
        cursor.execute("PRAGMA table_info(attempts)")
        existing_columns = {
            row[1] for row in cursor.fetchall()
        }

        if "mistake_category" not in existing_columns:
            cursor.execute("""
                ALTER TABLE attempts
                ADD COLUMN mistake_category TEXT DEFAULT 'unknown'
            """)


def save_message(role, content):
    with get_connection() as conn:
        conn.execute(
            "INSERT INTO messages (role, content) VALUES (?, ?)",
            (role, content),
        )


def get_recent_messages(limit=20):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT role, content
            FROM messages
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    # Return messages in chronological order.
    return list(reversed(rows))


def save_attempt(
    topic,
    question,
    student_answer,
    correct,
    feedback,
    mistake_category="unknown",
):
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO attempts (
                topic,
                question,
                student_answer,
                correct,
                feedback,
                mistake_category
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                topic,
                question,
                student_answer,
                int(correct),
                feedback,
                mistake_category,
            ),
        )


def get_recent_attempts(limit=10):
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                topic,
                question,
                student_answer,
                correct,
                feedback,
                mistake_category
            FROM attempts
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    # Preserve chronological order for adaptive learning.
    return list(reversed(rows))


if __name__ == "__main__":
    init_db()
    print("MathMate database initialized successfully.")

    attempts = get_recent_attempts(limit=5)
    print(f"Recent attempts available: {len(attempts)}")

    if attempts:
        print("Latest attempt:")
        print(f"Question: {attempts[-1][1]}")
        print(f"Answer: {attempts[-1][2]}")
        print(f"Category: {attempts[-1][5]}")
