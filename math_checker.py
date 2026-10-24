
import re
from sympy import Eq, Symbol, sympify, solve

x = Symbol("x")


def check_linear_answer(equation, student_answer):
    try:
        # Parse the equation.
        left, right = equation.split("=")

        left_expr = sympify(left.strip().replace("^", "**"))
        right_expr = sympify(right.strip().replace("^", "**"))

        equation_obj = Eq(left_expr, right_expr)
        expected = solve(equation_obj, x)

        if len(expected) != 1:
            return None, "This equation doesn't have one unique solution.", "invalid_equation"

        # Accept answers such as x=4 or x = 4.
        match = re.fullmatch(
            r"x\s*=\s*(.+)",
            student_answer.strip(),
            re.IGNORECASE,
        )

        if not match:
            return (
                None,
                "Enter your answer in the form x = 4.",
                "invalid_format",
            )

        proposed = sympify(match.group(1).replace("^", "**"))
        comparison = proposed.equals(expected[0])

        if comparison is True:
            return (
                True,
                "Correct! Your value of x satisfies the equation.",
                "correct",
            )

        # A wrong final answer doesn't always reveal the exact mistake.
        # Use cautious, rule-based feedback rather than claiming certainty.
        hint = get_mistake_hint(
            left_expr, right_expr, proposed, expected[0]
        )

        return False, hint, "incorrect"

    except Exception:
        return (
            None,
            "I couldn't understand that equation or answer. "
            "Please check the format and try again.",
            "invalid_input",
        )


def get_mistake_hint(left_expr, right_expr, proposed, expected):
    try:
        # Check the student's proposed value in the original equation.
        left_value = left_expr.subs(x, proposed)
        right_value = right_expr.subs(x, proposed)

        if left_value != right_value:
            # For simple linear equations, identify common wrong results
            # caused by adding/subtracting or dividing incorrectly.
            expanded = left_expr - right_expr
            coefficient = expanded.coeff(x)
            constant = expanded.subs(x, 0)

            if coefficient != 0:
                intermediate = -constant

                # Check if the student's answer matches the result before
                # dividing by the coefficient of x.
                if proposed == intermediate:
                    return (
                        "You may have stopped before dividing by the "
                        f"coefficient of x. After isolating x, divide "
                        f"{intermediate} by {coefficient}. "
                        "Try completing that last step."
                    )

        return (
            "Not quite. Substitute your answer into the original "
            "equation to check it. Then undo addition or subtraction "
            "first, followed by multiplication or division."
        )

    except Exception:
        return (
            "Not quite. Check your arithmetic and isolate x one step "
            "at a time."
        )


if __name__ == "__main__":
    tests = [
        ("2*x + 3 = 11", "x = 4"),
        ("2*x + 3 = 11", "x = 8"),
        ("5*x - 6 = 14", "x = 20"),
        ("5*x - 6 = 14", "hello"),
    ]

    print("MathMate Mistake-Checking Tests")
    print("-" * 38)

    for equation, answer in tests:
        result, feedback, category = check_linear_answer(
            equation, answer
        )
        print(f"\nEquation: {equation}")
        print(f"Answer: {answer}")
        print(f"Result: {result}")
        print(f"Category: {category}")
        print(f"Feedback: {feedback}")
