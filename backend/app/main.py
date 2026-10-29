"""TaxCompass API (FastAPI + PostgreSQL)."""
import os
import uuid
from datetime import date
from pathlib import Path
from typing import Literal, Optional

import psycopg
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Jsonb
from pydantic import BaseModel, EmailStr, Field

from . import ai_services, orchestrator, tax_engine
from .db import DEFAULT_TAX_PERIOD, get_conn, init_db, log_action
from .security import hash_password, new_token, verify_password

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", BASE_DIR / "uploads"))
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", BASE_DIR.parent / "frontend" / "dist"))
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
EDITABLE = ("DRAFT", "AI_VALIDATED", "CHANGES_REQUESTED")

app = FastAPI(title="TaxCompass API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    init_db()


# ---------- auth helpers ----------

def public_user(u):
    return {k: u[k] for k in ("user_id", "name", "email", "pan", "phone", "dob", "residential_status", "role")}


def current_user(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(401, "Please log in")
    with get_conn() as conn:
        user = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u USING (user_id) WHERE s.token = %s", (token,)
        ).fetchone()
    if not user:
        raise HTTPException(401, "Session expired, please log in again")
    return user


def taxpayer(user=Depends(current_user)):
    if user["role"] != "taxpayer":
        raise HTTPException(403, "Taxpayer account required")
    return user


def reviewer(user=Depends(current_user)):
    if user["role"] != "reviewer":
        raise HTTPException(403, "Reviewer account required")
    return user


# ---------- filing helpers ----------

def get_or_create_filing(conn, user_id, period=DEFAULT_TAX_PERIOD):
    filing = conn.execute(
        "SELECT * FROM filings WHERE user_id = %s AND tax_period = %s", (user_id, period)
    ).fetchone()
    if filing:
        return filing
    filing = conn.execute(
        "INSERT INTO filings (user_id, tax_period) VALUES (%s, %s) RETURNING *", (user_id, period)
    ).fetchone()
    log_action(conn, filing["filing_id"], user_id, "FILING_CREATED", {"tax_period": period})
    return filing


def filing_bundle(conn, filing):
    fid, uid, period = filing["filing_id"], filing["user_id"], filing["tax_period"]
    owner = conn.execute("SELECT * FROM users WHERE user_id = %s", (uid,)).fetchone()
    return {
        "filing": filing,
        "taxpayer": public_user(owner),
        "incomes": conn.execute(
            "SELECT * FROM incomes WHERE user_id = %s AND tax_period = %s ORDER BY income_id", (uid, period)
        ).fetchall(),
        "deductions": conn.execute(
            "SELECT * FROM deductions WHERE user_id = %s AND tax_period = %s ORDER BY deduction_id", (uid, period)
        ).fetchall(),
        "documents": conn.execute(
            "SELECT document_id, income_id, deduction_id, doc_type, file_name, extracted_data, "
            "ocr_confidence, uploaded_at FROM documents WHERE user_id = %s ORDER BY document_id", (uid,)
        ).fetchall(),
        "reviews": conn.execute(
            "SELECT r.*, u.name AS reviewer_name FROM reviews r JOIN users u ON u.user_id = r.reviewer_id "
            "WHERE filing_id = %s ORDER BY review_id DESC", (fid,)
        ).fetchall(),
        "audit": conn.execute(
            "SELECT a.*, u.name AS actor_name, u.role AS actor_role FROM audit_log a "
            "LEFT JOIN users u ON u.user_id = a.actor_id WHERE filing_id = %s ORDER BY log_id", (fid,)
        ).fetchall(),
    }


def ensure_editable(conn, filing, actor_id, what):
    """Edits are allowed only before review; they make old results stale."""
    if filing["status"] not in EDITABLE:
        raise HTTPException(409, f"Filing is {filing['status']} and cannot be changed")
    if filing["status"] == "AI_VALIDATED":
        conn.execute("UPDATE filings SET status = 'DRAFT' WHERE filing_id = %s", (filing["filing_id"],))
    log_action(conn, filing["filing_id"], actor_id, what["action"], what.get("details"))


# ---------- models ----------

class RegisterIn(BaseModel):
    name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=6)
    role: Literal["taxpayer", "reviewer"] = "taxpayer"
    pan: Optional[str] = Field(default=None, pattern=r"^[A-Z]{5}[0-9]{4}[A-Z]$")
    phone: Optional[str] = None
    dob: Optional[date] = None
    residential_status: Literal["Resident", "Non-resident"] = "Resident"


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class IntakeIn(BaseModel):
    answers: dict


class IncomeIn(BaseModel):
    income_type: Literal["SALARY", "HOUSE_PROPERTY", "CAPITAL_GAINS", "BUSINESS", "OTHER"]
    source_name: str = ""
    amount: float = Field(ge=0)
    tds_deducted: float = Field(default=0, ge=0)


class DeductionIn(BaseModel):
    section_code: Literal["80C", "80D", "80CCD1B", "80TTA", "24B"]
    description: str = ""
    claimed_amount: float = Field(ge=0)


class ReviewIn(BaseModel):
    decision: Literal["APPROVE", "REQUEST_CHANGES", "REJECT"]
    comments: str = Field(min_length=1)


# ---------- routes: auth ----------

@app.get("/api/health")
def health():
    with get_conn() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.post("/api/auth/register")
def register(body: RegisterIn):
    with get_conn() as conn:
        try:
            user = conn.execute(
                """INSERT INTO users (name, email, password_hash, role, pan, phone, dob, residential_status)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (body.name, body.email.lower(), hash_password(body.password), body.role,
                 body.pan, body.phone, body.dob, body.residential_status),
            ).fetchone()
        except psycopg.errors.UniqueViolation:
            raise HTTPException(409, "Email or PAN already registered")
        token = new_token()
        conn.execute("INSERT INTO sessions (token, user_id) VALUES (%s, %s)", (token, user["user_id"]))
    return {"token": token, "user": public_user(user)}


@app.post("/api/auth/login")
def login(body: LoginIn):
    with get_conn() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = %s", (body.email.lower(),)).fetchone()
        if not user or not verify_password(body.password, user["password_hash"]):
            raise HTTPException(401, "Wrong email or password")
        token = new_token()
        conn.execute("INSERT INTO sessions (token, user_id) VALUES (%s, %s)", (token, user["user_id"]))
    return {"token": token, "user": public_user(user)}


@app.post("/api/auth/logout")
def logout(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    with get_conn() as conn:
        conn.execute("DELETE FROM sessions WHERE token = %s", (token,))
    return {"ok": True}


@app.get("/api/me")
def me(user=Depends(current_user)):
    return public_user(user)


# ---------- routes: reference data ----------

@app.get("/api/rules")
def rules(tax_period: str = DEFAULT_TAX_PERIOD, user=Depends(current_user)):
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM tax_rules WHERE tax_period = %s ORDER BY rule_type, section_code", (tax_period,)
        ).fetchall()


@app.get("/api/intake/questions")
def intake_questions(user=Depends(current_user)):
    return {
        "questions": orchestrator.INTAKE_QUESTIONS,
        "allowed_components": sorted(orchestrator.ALLOWED_COMPONENTS),
    }


# ---------- routes: taxpayer ----------

@app.get("/api/filing")
def my_filing(user=Depends(taxpayer)):
    with get_conn() as conn:
        return filing_bundle(conn, get_or_create_filing(conn, user["user_id"]))


@app.post("/api/filing/intake")
def submit_intake(body: IntakeIn, user=Depends(taxpayer)):
    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        if filing["status"] not in EDITABLE:
            raise HTTPException(409, f"Filing is {filing['status']} and cannot be changed")
        plan = orchestrator.validate_view_plan(orchestrator.build_view_plan(body.answers))
        filing = conn.execute(
            """UPDATE filings SET intake_answers = %s, view_plan = %s,
                      status = CASE WHEN status = 'AI_VALIDATED' THEN 'DRAFT' ELSE status END
               WHERE filing_id = %s RETURNING *""",
            (Jsonb(body.answers), Jsonb(plan), filing["filing_id"]),
        ).fetchone()
        log_action(conn, filing["filing_id"], user["user_id"], "INTAKE_SAVED",
                   {"components": plan["components"], "validated": plan["validated"]})
        return filing_bundle(conn, filing)


@app.get("/api/deductions/suggestions")
def deduction_suggestions(user=Depends(taxpayer)):
    """Which deductions this taxpayer can claim, how much room is left, and whether it matters."""
    with get_conn() as conn:
        bundle = filing_bundle(conn, get_or_create_filing(conn, user["user_id"]))
        rules = tax_engine.load_rules(conn, bundle["filing"]["tax_period"])
        return tax_engine.suggest_deductions(
            bundle["filing"]["intake_answers"], bundle["incomes"], bundle["deductions"], rules
        )


@app.post("/api/incomes")
def add_income(body: IncomeIn, user=Depends(taxpayer)):
    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        row = conn.execute(
            """INSERT INTO incomes (user_id, tax_period, income_type, source_name, amount, tds_deducted)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
            (user["user_id"], filing["tax_period"], body.income_type, body.source_name, body.amount, body.tds_deducted),
        ).fetchone()
        ensure_editable(conn, filing, user["user_id"], {"action": "INCOME_ADDED", "details": body.model_dump()})
        return row


@app.delete("/api/incomes/{income_id}")
def delete_income(income_id: int, user=Depends(taxpayer)):
    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        row = conn.execute(
            "DELETE FROM incomes WHERE income_id = %s AND user_id = %s RETURNING *", (income_id, user["user_id"])
        ).fetchone()
        if not row:
            raise HTTPException(404, "Income not found")
        ensure_editable(conn, filing, user["user_id"], {"action": "INCOME_REMOVED", "details": {"income_id": income_id}})
        return {"ok": True}


@app.post("/api/deductions")
def add_deduction(body: DeductionIn, user=Depends(taxpayer)):
    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        row = conn.execute(
            """INSERT INTO deductions (user_id, tax_period, section_code, description, claimed_amount)
               VALUES (%s, %s, %s, %s, %s) RETURNING *""",
            (user["user_id"], filing["tax_period"], body.section_code, body.description, body.claimed_amount),
        ).fetchone()
        ensure_editable(conn, filing, user["user_id"], {"action": "DEDUCTION_ADDED", "details": body.model_dump()})
        return row


@app.delete("/api/deductions/{deduction_id}")
def delete_deduction(deduction_id: int, user=Depends(taxpayer)):
    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        row = conn.execute(
            "DELETE FROM deductions WHERE deduction_id = %s AND user_id = %s RETURNING *",
            (deduction_id, user["user_id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Deduction not found")
        ensure_editable(conn, filing, user["user_id"], {"action": "DEDUCTION_REMOVED", "details": {"deduction_id": deduction_id}})
        return {"ok": True}


@app.post("/api/documents")
async def upload_document(
    file: UploadFile = File(...),
    doc_type: Literal["form16", "capital_gains_statement", "investment_proof", "other"] = Form("form16"),
    income_id: Optional[int] = Form(None),
    user=Depends(taxpayer),
):
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 10 MB)")
    safe_name = Path(file.filename or "upload").name
    path = UPLOAD_DIR / f"{uuid.uuid4().hex}_{safe_name}"
    path.write_bytes(data)

    extracted, confidence = (None, None)
    if doc_type == "form16":
        extracted, confidence = ai_services.extract_form16(path)

    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        if income_id is not None and not conn.execute(
            "SELECT 1 FROM incomes WHERE income_id = %s AND user_id = %s", (income_id, user["user_id"])
        ).fetchone():
            raise HTTPException(404, "Income not found")
        row = conn.execute(
            """INSERT INTO documents (user_id, income_id, doc_type, file_name, file_path, extracted_data, ocr_confidence)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               RETURNING document_id, income_id, doc_type, file_name, extracted_data, ocr_confidence, uploaded_at""",
            (user["user_id"], income_id, doc_type, safe_name, str(path),
             Jsonb(extracted) if extracted else None, confidence),
        ).fetchone()
        ensure_editable(conn, filing, user["user_id"],
                        {"action": "DOCUMENT_UPLOADED", "details": {"doc_type": doc_type, "file": safe_name}})
        return row


@app.get("/api/documents/{document_id}/file")
def download_document(document_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        doc = conn.execute("SELECT * FROM documents WHERE document_id = %s", (document_id,)).fetchone()
    if not doc or (user["role"] != "reviewer" and doc["user_id"] != user["user_id"]):
        raise HTTPException(404, "Document not found")
    return FileResponse(doc["file_path"], filename=doc["file_name"])


def document_flags(incomes, documents):
    """Compare declared salary with Form 16 values for the reviewer."""
    flags = []
    declared = sum(float(i["amount"]) for i in incomes if i["income_type"] == "SALARY")
    for d in documents:
        if d["doc_type"] != "form16":
            continue
        ex = d["extracted_data"] or {}
        conf = float(d["ocr_confidence"] or 0)
        if ex.get("gross_salary") is not None and abs(ex["gross_salary"] - declared) > 1000:
            flags.append({"code": f"F16_MISMATCH_{d['document_id']}", "severity": "warning",
                          "message": f"Form 16 shows gross salary ₹{tax_engine._rupees(ex['gross_salary'])}, "
                                     f"but ₹{tax_engine._rupees(declared)} was declared"})
        elif conf < 0.67:
            flags.append({"code": f"F16_LOWCONF_{d['document_id']}", "severity": "info",
                          "message": f"Form 16 '{d['file_name']}' could not be read fully — reviewer should check it manually"})
    return flags


@app.post("/api/filing/compute")
def compute(user=Depends(taxpayer)):
    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        if filing["status"] not in EDITABLE:
            raise HTTPException(409, f"Filing is {filing['status']} and cannot be recomputed")
        bundle = filing_bundle(conn, filing)
        if not bundle["incomes"]:
            raise HTTPException(400, "Add at least one income before computing")
        rules = tax_engine.load_rules(conn, filing["tax_period"])
        profile = {**(filing["intake_answers"] or {}), "residential_status": user["residential_status"]}
        result = tax_engine.compare(bundle["incomes"], bundle["deductions"], rules, profile)
        result["flags"] += document_flags(bundle["incomes"], bundle["documents"])

        template = tax_engine.template_explanation(result)
        explanation, source = ai_services.polish_explanation(template)
        result["explanation_source"] = source
        result["template_explanation"] = template
        chosen = result[result["recommended_regime"]]

        filing = conn.execute(
            """UPDATE filings SET gross_total_income = %s, total_deductions = %s,
                      taxable_old = %s, taxable_new = %s, tax_old = %s, tax_new = %s, breakdown = %s,
                      recommended_regime = %s, recommended_itr = %s, itr_reason = %s,
                      explanation = %s, flags = %s, status = 'AI_VALIDATED'
               WHERE filing_id = %s RETURNING *""",
            (chosen["gross_total_income"], chosen["total_deductions"],
             result["old"]["taxable_income"], result["new"]["taxable_income"],
             result["old"]["total_tax"], result["new"]["total_tax"], Jsonb(result),
             result["recommended_regime"], result["recommended_itr"], result["itr_reason"],
             explanation, Jsonb(result["flags"]), filing["filing_id"]),
        ).fetchone()
        log_action(conn, filing["filing_id"], user["user_id"], "TAX_COMPUTED", {
            "tax_old": result["old"]["total_tax"], "tax_new": result["new"]["total_tax"],
            "regime": result["recommended_regime"], "itr": result["recommended_itr"],
            "flags": len(result["flags"]), "explanation_source": source,
        })
        return filing_bundle(conn, filing)


@app.post("/api/filing/submit")
def submit_for_review(user=Depends(taxpayer)):
    with get_conn() as conn:
        filing = get_or_create_filing(conn, user["user_id"])
        if filing["status"] != "AI_VALIDATED":
            raise HTTPException(409, "Compute your tax first (status must be AI_VALIDATED)")
        filing = conn.execute(
            "UPDATE filings SET status = 'PENDING_REVIEW', submitted_at = now() WHERE filing_id = %s RETURNING *",
            (filing["filing_id"],),
        ).fetchone()
        log_action(conn, filing["filing_id"], user["user_id"], "SUBMITTED_FOR_REVIEW")
        return filing_bundle(conn, filing)


# ---------- routes: reviewer ----------

@app.get("/api/review/queue")
def review_queue(status: str = "PENDING_REVIEW", user=Depends(reviewer)):
    statuses = ["PENDING_REVIEW", "CHANGES_REQUESTED", "READY_TO_FILE", "REJECTED"] if status == "ALL" else [status]
    with get_conn() as conn:
        return conn.execute(
            """SELECT f.filing_id, f.tax_period, f.status, f.recommended_itr, f.recommended_regime,
                      f.tax_old, f.tax_new, jsonb_array_length(f.flags) AS flag_count,
                      f.submitted_at, f.updated_at, u.name AS taxpayer_name, u.pan
               FROM filings f JOIN users u USING (user_id)
               WHERE f.status = ANY(%s) ORDER BY f.submitted_at NULLS LAST, f.filing_id""",
            (statuses,),
        ).fetchall()


@app.get("/api/review/filings/{filing_id}")
def review_detail(filing_id: int, user=Depends(reviewer)):
    with get_conn() as conn:
        filing = conn.execute("SELECT * FROM filings WHERE filing_id = %s", (filing_id,)).fetchone()
        if not filing or filing["status"] in ("DRAFT", "AI_VALIDATED"):
            raise HTTPException(404, "Filing not found or not submitted")
        bundle = filing_bundle(conn, filing)
        bundle["rules"] = conn.execute(
            "SELECT * FROM tax_rules WHERE tax_period = %s ORDER BY rule_type, section_code", (filing["tax_period"],)
        ).fetchall()
        return bundle


DECISION_STATUS = {"APPROVE": "READY_TO_FILE", "REQUEST_CHANGES": "CHANGES_REQUESTED", "REJECT": "REJECTED"}


@app.post("/api/review/filings/{filing_id}")
def review_decide(filing_id: int, body: ReviewIn, user=Depends(reviewer)):
    with get_conn() as conn:
        filing = conn.execute("SELECT * FROM filings WHERE filing_id = %s FOR UPDATE", (filing_id,)).fetchone()
        if not filing:
            raise HTTPException(404, "Filing not found")
        if filing["status"] != "PENDING_REVIEW":
            raise HTTPException(409, f"Filing is {filing['status']}, not pending review")
        # Review row first, so the database gate can see the approval.
        conn.execute(
            "INSERT INTO reviews (filing_id, reviewer_id, decision, comments) VALUES (%s, %s, %s, %s)",
            (filing_id, user["user_id"], body.decision, body.comments),
        )
        filing = conn.execute(
            "UPDATE filings SET status = %s WHERE filing_id = %s RETURNING *",
            (DECISION_STATUS[body.decision], filing_id),
        ).fetchone()
        log_action(conn, filing_id, user["user_id"], f"REVIEW_{body.decision}", {"comments": body.comments})
        return filing_bundle(conn, filing)


@app.post("/api/review/filings/{filing_id}/try-bypass")
def try_bypass(filing_id: int, user=Depends(reviewer)):
    """Demo: try to force READY_TO_FILE without approval. The database must refuse."""
    with get_conn() as conn:
        filing = conn.execute("SELECT status FROM filings WHERE filing_id = %s", (filing_id,)).fetchone()
        if not filing:
            raise HTTPException(404, "Filing not found")
        try:
            with conn.transaction():
                conn.execute("UPDATE filings SET status = 'READY_TO_FILE' WHERE filing_id = %s", (filing_id,))
                raise RuntimeError("rollback")  # never keep the change, even if it went through
        except psycopg.errors.RaiseException as e:
            return {"blocked": True, "database_error": str(e).split("\n")[0]}
        except RuntimeError:
            return {"blocked": False, "database_error": None,
                    "note": "Allowed because this filing already has an approving review"}


@app.get("/api/filings/{filing_id}/audit")
def audit(filing_id: int, user=Depends(current_user)):
    with get_conn() as conn:
        filing = conn.execute("SELECT * FROM filings WHERE filing_id = %s", (filing_id,)).fetchone()
        if not filing or (user["role"] != "reviewer" and filing["user_id"] != user["user_id"]):
            raise HTTPException(404, "Filing not found")
        return filing_bundle(conn, filing)["audit"]


# ---------- serve the built React app (optional, one server for everything) ----------

if FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        candidate = FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIST / "index.html")
