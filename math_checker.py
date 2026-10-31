import re
import sympy as sp
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


def solve_equation_step_by_step(raw_equation: str):
    """
    Solve algebraic equations step-by-step for direct writing onto the MathMate notebook.
    Handles linear and polynomial equations with clean, human-readable steps.
    """
    raw = raw_equation.strip()
    if "=" not in raw:
        return {"success": False, "error": "Please include an '=' sign (e.g., 2x + 9 = 11)."}

    # Identify variable (default to x)
    letters = re.findall(r"[a-zA-Z]", raw)
    var_name = letters[0] if letters else "x"
    var = Symbol(var_name)

    # Preprocess implicit multiplication: 2x -> 2*x, 3(x) -> 3*(x)
    cleaned = raw
    cleaned = re.sub(r"(\d)([a-zA-Z])", r"\1*\2", cleaned)
    cleaned = re.sub(r"([a-zA-Z])(\d)", r"\1*\2", cleaned)
    cleaned = re.sub(r"(\))(\()", r"\1*\2", cleaned)
    cleaned = re.sub(r"(\d)(\()", r"\1*\2", cleaned)
    cleaned = re.sub(r"(\))([a-zA-Z])", r"\1*\2", cleaned)

    left_str, right_str = cleaned.split("=", 1)

    try:
        left_expr = sympify(left_str.replace("^", "**"))
        right_expr = sympify(right_str.replace("^", "**"))

        diff = sympify(left_expr - right_expr)
        solutions = solve(Eq(left_expr, right_expr), var)

        if not solutions:
            return {"success": False, "error": "No solution exists for this equation."}

        steps = [raw]

        # Check degree for linear equations
        try:
            poly = diff.as_poly(var) if diff.has(var) else None
        except Exception:
            poly = None

        if poly and poly.degree() == 1:
            try:
                left_poly = left_expr.as_poly(var) if left_expr.has(var) else None
                right_poly = right_expr.as_poly(var) if right_expr.has(var) else None

                lhs_c = left_poly.coeff_monomial(1) if left_poly else left_expr
                rhs_c = right_poly.coeff_monomial(1) if right_poly else right_expr

                lhs_var_coeff = left_poly.coeff_monomial(var) if left_poly else 0
                rhs_var_coeff = right_poly.coeff_monomial(var) if right_poly else 0

                # Variable only on left
                if rhs_var_coeff == 0:
                    if lhs_c != 0:
                        if lhs_c > 0:
                            steps.append(f"{lhs_var_coeff}{var_name} = {rhs_c} - {lhs_c}")
                        else:
                            steps.append(f"{lhs_var_coeff}{var_name} = {rhs_c} + {-lhs_c}")
                        calc_rhs = rhs_c - lhs_c
                        steps.append(f"{lhs_var_coeff}{var_name} = {calc_rhs}")
                    else:
                        calc_rhs = rhs_c

                    if lhs_var_coeff != 1:
                        steps.append(f"{var_name} = {calc_rhs} / {lhs_var_coeff}")

                # Variable on both sides
                elif lhs_var_coeff != 0 and rhs_var_coeff != 0:
                    steps.append(f"{lhs_var_coeff}{var_name} - {rhs_var_coeff}{var_name} = {rhs_c} - ({lhs_c})")
                    net_coeff = lhs_var_coeff - rhs_var_coeff
                    net_const = rhs_c - lhs_c
                    steps.append(f"{net_coeff}{var_name} = {net_const}")
                    if net_coeff != 1:
                        steps.append(f"{var_name} = {net_const} / {net_coeff}")

            except Exception:
                pass

            sol_val = solutions[0]
            steps.append(f"{var_name} = {sol_val}")

            # Remove duplicate adjacent steps
            clean_steps = []
            for s in steps:
                if not clean_steps or clean_steps[-1] != s:
                    clean_steps.append(s)

            return {
                "success": True,
                "equation": raw,
                "steps": clean_steps,
                "answer": f"{var_name} = {sol_val}",
                "variable": var_name,
                "solution_value": str(sol_val),
            }
        else:
            steps.append(f"{var_name} = {solutions[0]}")
            return {
                "success": True,
                "equation": raw,
                "steps": steps,
                "answer": f"{var_name} = {solutions[0]}",
                "variable": var_name,
                "solution_value": str(solutions[0]),
            }
    except Exception as e:
        return {"success": False, "error": str(e)}


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

    print("\nStep by step solving test:")
    print(solve_equation_step_by_step("2x + 9 = 11"))
