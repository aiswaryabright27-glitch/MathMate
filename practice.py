
from memory import (
    init_db,
    save_attempt,
    get_recent_attempts,
)
from math_checker import check_linear_answer


QUESTIONS = [
    {
        "topic": "linear equations",
        "difficulty": 1,
        "equation": "2*x + 3 = 11",
        "display": "2x + 3 = 11",
    },
    {
        "topic": "linear equations",
        "difficulty": 2,
        "equation": "5*x - 6 = 14",
        "display": "5x - 6 = 14",
    },
    {
        "topic": "linear equations",
        "difficulty": 3,
        "equation": "3*(x - 2) = 18",
        "display": "3(x - 2) = 18",
    },
]


def choose_question():
    attempts = get_recent_attempts(limit=10)

    if not attempts:
        return QUESTIONS[0]

    last_attempt = attempts[-1]
    last_question = last_attempt[1]
    last_correct = bool(last_attempt[3])

    last_difficulty = 1

    for question in QUESTIONS:
        if question["equation"] == last_question:
            last_difficulty = question["difficulty"]
            break

    if last_correct:
        target_difficulty = min(last_difficulty + 1, 3)
    else:
        target_difficulty = last_difficulty

    candidates = [
        question
        for question in QUESTIONS
        if question["difficulty"] == target_difficulty
        and question["equation"] != last_question
    ]

    if not candidates:
        candidates = [
            question for question in QUESTIONS
            if question["difficulty"] == target_difficulty
        ]

    return candidates[0]


def get_hint(difficulty):
    hints = {
        1: "Try undoing addition or subtraction first.",
        2: "What can you add to both sides to isolate the term containing x?",
        3: "Expand the brackets first, then isolate x.",
    }
    return hints.get(difficulty, "Isolate x one step at a time.")


def practice_question():
    init_db()
    question = choose_question()

    print("\nMathMate Adaptive Practice")
    print("-" * 35)
    print("Solve:", question["display"])
    print("Difficulty:", question["difficulty"])

    student_answer = input("Your answer (e.g. x = 4): ").strip()

    correct, feedback, category = check_linear_answer(
        question["equation"],
        student_answer,
    )

    print("\nMathMate:", feedback)

    if correct is None:
        print("Attempt not saved. Please check your answer format.")
        return

    if not correct:
        print("Hint:", get_hint(question["difficulty"]))

    save_attempt(
        topic=question["topic"],
        question=question["equation"],
        student_answer=student_answer,
        correct=correct,
        feedback=feedback,
        mistake_category=category,
    )

    print("Attempt saved.")
    print("Mistake category:", category)

    if correct:
        print("Great work! Let's keep building your skills.")
    else:
        print("Use the hint to think through your next attempt.")


if __name__ == "__main__":
    practice_question()
