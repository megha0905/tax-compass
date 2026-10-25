"""Workflow Orchestrator Agent: intake answers -> validated view plan.

The plan says WHAT the front end shows (component names). The front end has a
fixed component library, so it never decides HOW things look.
"""

ALLOWED_COMPONENTS = {
    "income_source_selector",
    "salary_form",
    "house_property_form",
    "capital_gains_form",
    "business_form",
    "other_income_form",
    "deduction_form",
    "form16_upload",
    "capital_gains_statement_upload",
    "summary_panel",
}

DEFAULT_PLAN = {
    "step": 2,
    "components": ["salary_form", "other_income_form", "deduction_form", "summary_panel"],
    "required_documents": [],
    "reasons": {"default": "Fallback plan used because the generated plan was invalid."},
}

INTAKE_QUESTIONS = [
    {"key": "has_salary", "type": "boolean", "label": "Do you earn a salary or pension?"},
    {"key": "house_property_count", "type": "number", "label": "How many house properties do you own or rent out?"},
    {"key": "sold_assets", "type": "boolean", "label": "Did you sell shares, mutual funds or property this year?"},
    {"key": "has_business", "type": "boolean", "label": "Do you run a business or work as a freelancer/professional?"},
    {"key": "presumptive", "type": "boolean", "label": "If yes, do you use the presumptive scheme (44AD/44ADA)?", "depends_on": "has_business"},
    {"key": "has_other_income", "type": "boolean", "label": "Do you earn interest, dividends or other income?"},
    {"key": "has_foreign_assets", "type": "boolean", "label": "Do you hold any assets outside India?"},
]


def build_view_plan(answers):
    """Rule-based plan. An LLM could produce this instead; the validator still applies."""
    a = answers or {}
    components, docs, reasons = [], [], {}

    if a.get("has_salary"):
        components.append("salary_form")
        docs.append("form16_upload")
        reasons["salary_form"] = "You earn a salary"
    if int(a.get("house_property_count") or 0) >= 1:
        components.append("house_property_form")
        reasons["house_property_form"] = "You own or rent out house property"
    if a.get("sold_assets"):
        components.append("capital_gains_form")
        docs.append("capital_gains_statement_upload")
        reasons["capital_gains_form"] = "You sold shares, funds or property"
    if a.get("has_business"):
        components.append("business_form")
        reasons["business_form"] = "You have business or professional income"
    if a.get("has_other_income"):
        components.append("other_income_form")
        reasons["other_income_form"] = "You have interest or other income"
    components += docs
    components += ["deduction_form", "summary_panel"]
    reasons["deduction_form"] = "Everyone can check eligible deductions"
    reasons["summary_panel"] = "Running summary of what you entered"

    return {"step": 2, "components": components, "required_documents": docs, "reasons": reasons}


def validate_view_plan(plan):
    """Reject any plan that names a component outside the fixed library."""
    try:
        comps = plan["components"]
        if not isinstance(comps, list) or not comps:
            raise ValueError
        if any(c not in ALLOWED_COMPONENTS for c in comps):
            raise ValueError
        docs = plan.get("required_documents", [])
        if any(d not in ALLOWED_COMPONENTS for d in docs):
            raise ValueError
        return {**plan, "validated": True}
    except (KeyError, TypeError, ValueError):
        return {**DEFAULT_PLAN, "validated": False}
