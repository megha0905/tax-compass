"""Optional AI helpers. Everything works without an API key.

- polish_explanation: an LLM rewrites the template text, numbers untouched.
- extract_form16: reads a Form 16 PDF and finds gross salary, TDS and PAN.
"""
import os
import re

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-5-5")


def _numbers(text):
    return sorted(re.findall(r"\d[\d,]*", text))


def polish_explanation(template_text):
    """Return (text, source). Falls back to the template on any problem."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        return template_text, "template"
    try:
        import anthropic

        client = anthropic.Anthropic()
        msg = client.messages.create(
            model=MODEL,
            max_tokens=500,
            system=(
                "Rewrite this Indian income tax explanation in simple, friendly English for a "
                "taxpayer. Keep it under 120 words. Do not change, add or remove any number "
                "or rupee amount."
            ),
            messages=[{"role": "user", "content": template_text}],
        )
        text = msg.content[0].text.strip()
        # Safety check: the AI must not change any number.
        if _numbers(text) != _numbers(template_text):
            return template_text, "template"
        return text, "llm"
    except Exception:
        return template_text, "template"


# A money amount: Indian/Western grouping (12,95,000) or 4+ digits, optional paise.
# This skips section numbers like "17(1)".
AMOUNT = r"(?<![\d(])(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?|\d{4,}(?:\.\d{1,2})?)(?![\d)])"


def _find_amount(patterns, text):
    for p in patterns:
        m = re.search(p + r".{0,80}?" + AMOUNT, text, re.I | re.S)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except ValueError:
                continue
    return None


def extract_form16(path):
    """Best-effort text extraction from a text-based Form 16 PDF."""
    result = {"gross_salary": None, "tds": None, "employee_pan": None, "method": "pdf-text"}
    if not str(path).lower().endswith(".pdf"):
        result["method"] = "unsupported-file"
        return result, 0.0
    try:
        from pypdf import PdfReader

        text = " ".join(page.extract_text() or "" for page in PdfReader(path).pages)
    except Exception:
        result["method"] = "unreadable"
        return result, 0.0

    result["gross_salary"] = _find_amount([r"Gross\s+Salary", r"Total\s+Salary"], text)
    result["tds"] = _find_amount(
        [r"Total\s+amount\s+of\s+tax\s+deducted", r"Tax\s+deducted\s+at\s+source", r"\bTDS\b"], text
    )
    pans = re.findall(r"\b[A-Z]{5}\d{4}[A-Z]\b", text)
    result["employee_pan"] = pans[-1] if pans else None

    found = sum(v is not None for v in (result["gross_salary"], result["tds"], result["employee_pan"]))
    return result, round(found / 3, 2)
