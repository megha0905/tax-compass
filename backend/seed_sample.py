"""Fill the database with sample taxpayers, filings, reviews and audit history.

Run from the backend folder (safe to run more than once):
    .\\venv\\Scripts\\python seed_sample.py

All sample users have the password: Sample@123
Tax figures are computed by the real tax engine, not typed in by hand.
"""
from psycopg.types.json import Jsonb

from app import orchestrator, tax_engine
from app.db import DEFAULT_TAX_PERIOD, get_conn, init_db, log_action
from app.security import hash_password

PASSWORD = "Sample@123"

# name, email, pan, residential status, intake answers, incomes, deductions, final status, reviewer comment
SAMPLES = [
    {
        "name": "Rahul Sharma", "email": "rahul@sample.in", "pan": "BQRPS4521K",
        "answers": {"has_salary": True, "house_property_count": 0},
        "incomes": [("SALARY", "Infosys Ltd", 1000000, 42000)],
        "deductions": [("80C", "PPF + ELSS", 150000), ("80D", "Family health insurance", 25000)],
        "status": "READY_TO_FILE",
        "comment": "Form 16 and 80C/80D proofs checked. New regime is correct. Approved.",
    },
    {
        "name": "Priya Nair", "email": "priya@sample.in", "pan": "CKNPN7310M",
        "answers": {"has_salary": True, "house_property_count": 1},
        "incomes": [("SALARY", "TCS", 1800000, 150800)],
        "deductions": [("80C", "EPF + LIC", 150000), ("80D", "Health insurance", 25000),
                       ("80CCD1B", "NPS Tier 1", 50000), ("24B", "SBI home loan interest", 200000)],
        "status": "PENDING_REVIEW",
    },
    {
        "name": "Amit Verma", "email": "amit@sample.in", "pan": "DLVPA2288Q",
        "answers": {"has_salary": True, "house_property_count": 0, "has_other_income": True},
        "incomes": [("SALARY", "Wipro", 1285000, 10400), ("OTHER", "HDFC savings interest", 12000, 0)],
        "deductions": [("80TTA", "Savings interest", 12000)],
        "status": "CHANGES_REQUESTED",
        "comment": "Please add your FD interest from the AIS statement and upload Form 16, then recompute.",
    },
    {
        "name": "Sneha Iyer", "email": "sneha@sample.in", "pan": "EMIPS6604R",
        "answers": {"has_salary": True, "house_property_count": 0, "sold_assets": True, "has_other_income": True},
        "incomes": [("SALARY", "Accenture", 800000, 0), ("CAPITAL_GAINS", "Equity mutual fund units", 100000, 0),
                    ("OTHER", "FD interest", 40000, 4000)],
        "deductions": [("80C", "ELSS", 100000)],
        "status": "PENDING_REVIEW",
    },
    {
        "name": "Arjun Mehta", "email": "arjun@sample.in", "pan": "FAMPA9132T",
        "answers": {"has_salary": False, "house_property_count": 0, "has_business": True, "presumptive": True},
        "incomes": [("BUSINESS", "Freelance software consulting (44ADA)", 900000, 0)],
        "deductions": [],
        "status": "AI_VALIDATED",
    },
    {
        "name": "Rohan Gupta", "email": "rohan@sample.in", "pan": "GRGPR3375H",
        "answers": {"has_salary": True, "house_property_count": 1},
        "incomes": [("SALARY", "HCL Technologies", 1400000, 98000), ("HOUSE_PROPERTY", "Flat in Pune (let out)", 240000, 0)],
        "deductions": [("80C", "PPF", 300000)],
        "status": "REJECTED",
        "comment": "Rent agreement and 80C proofs do not match the amounts claimed. Rejected; please start a fresh filing.",
    },
    {
        "name": "Kavya Reddy", "email": "kavya@sample.in", "pan": "HKRPK8846D",
        "answers": {"has_salary": True, "house_property_count": 0},
        "incomes": [("SALARY", "Deloitte", 600000, 0)],
        "deductions": [("80C", "PPF + tuition fees", 200000)],
        "status": "DRAFT",
    },
]


def create_sample(conn, s, reviewer_id, rules):
    if conn.execute("SELECT 1 FROM users WHERE email = %s", (s["email"],)).fetchone():
        print(f"  skip  {s['name']} (already exists)")
        return

    uid = conn.execute(
        """INSERT INTO users (name, email, password_hash, role, pan, phone, residential_status)
           VALUES (%s, %s, %s, 'taxpayer', %s, %s, 'Resident') RETURNING user_id""",
        (s["name"], s["email"], hash_password(PASSWORD), s["pan"], "98765" + s["pan"][5:10]),
    ).fetchone()["user_id"]
    period = DEFAULT_TAX_PERIOD

    plan = orchestrator.validate_view_plan(orchestrator.build_view_plan(s["answers"]))
    fid = conn.execute(
        "INSERT INTO filings (user_id, tax_period, intake_answers, view_plan) VALUES (%s, %s, %s, %s) RETURNING filing_id",
        (uid, period, Jsonb(s["answers"]), Jsonb(plan)),
    ).fetchone()["filing_id"]
    log_action(conn, fid, uid, "FILING_CREATED", {"tax_period": period})
    log_action(conn, fid, uid, "INTAKE_SAVED", {"components": plan["components"], "validated": plan["validated"]})

    incomes = []
    for itype, source, amount, tds in s["incomes"]:
        row = conn.execute(
            """INSERT INTO incomes (user_id, tax_period, income_type, source_name, amount, tds_deducted)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING *""",
            (uid, period, itype, source, amount, tds),
        ).fetchone()
        incomes.append(row)
        log_action(conn, fid, uid, "INCOME_ADDED", {"income_type": itype, "amount": amount})

    deductions = []
    for code, desc, amount in s["deductions"]:
        row = conn.execute(
            """INSERT INTO deductions (user_id, tax_period, section_code, description, claimed_amount)
               VALUES (%s, %s, %s, %s, %s) RETURNING *""",
            (uid, period, code, desc, amount),
        ).fetchone()
        deductions.append(row)
        log_action(conn, fid, uid, "DEDUCTION_ADDED", {"section_code": code, "claimed_amount": amount})

    if s["status"] == "DRAFT":
        print(f"  added {s['name']:<13} DRAFT (not computed yet)")
        return

    # Tax Intelligence Agent: the same engine the app uses.
    result = tax_engine.compare(incomes, deductions, rules, {**s["answers"], "residential_status": "Resident"})
    explanation = tax_engine.template_explanation(result)
    result["explanation_source"] = "template"
    result["template_explanation"] = explanation
    chosen = result[result["recommended_regime"]]
    conn.execute(
        """UPDATE filings SET gross_total_income = %s, total_deductions = %s, taxable_old = %s, taxable_new = %s,
                  tax_old = %s, tax_new = %s, breakdown = %s, recommended_regime = %s, recommended_itr = %s,
                  itr_reason = %s, explanation = %s, flags = %s, status = 'AI_VALIDATED'
           WHERE filing_id = %s""",
        (chosen["gross_total_income"], chosen["total_deductions"], result["old"]["taxable_income"],
         result["new"]["taxable_income"], result["old"]["total_tax"], result["new"]["total_tax"], Jsonb(result),
         result["recommended_regime"], result["recommended_itr"], result["itr_reason"], explanation,
         Jsonb(result["flags"]), fid),
    )
    log_action(conn, fid, uid, "TAX_COMPUTED", {
        "tax_old": result["old"]["total_tax"], "tax_new": result["new"]["total_tax"],
        "regime": result["recommended_regime"], "itr": result["recommended_itr"], "flags": len(result["flags"]),
    })

    if s["status"] != "AI_VALIDATED":
        conn.execute("UPDATE filings SET status = 'PENDING_REVIEW', submitted_at = now() WHERE filing_id = %s", (fid,))
        log_action(conn, fid, uid, "SUBMITTED_FOR_REVIEW")

    decision = {"READY_TO_FILE": "APPROVE", "CHANGES_REQUESTED": "REQUEST_CHANGES", "REJECTED": "REJECT"}.get(s["status"])
    if decision:
        # Review row first: the database trigger only allows READY_TO_FILE after an approving review.
        conn.execute(
            "INSERT INTO reviews (filing_id, reviewer_id, decision, comments) VALUES (%s, %s, %s, %s)",
            (fid, reviewer_id, decision, s["comment"]),
        )
        conn.execute("UPDATE filings SET status = %s WHERE filing_id = %s", (s["status"], fid))
        log_action(conn, fid, reviewer_id, f"REVIEW_{decision}", {"comments": s["comment"]})

    print(f"  added {s['name']:<13} {s['status']:<17} new ₹{result['new']['total_tax']:>9,}  "
          f"old ₹{result['old']['total_tax']:>9,}  {result['recommended_itr']}")


def main():
    init_db()  # make sure tables, rules and demo users exist
    with get_conn() as conn:
        reviewer = conn.execute("SELECT user_id FROM users WHERE email = 'reviewer@taxcompass.demo'").fetchone()
        rules = tax_engine.load_rules(conn, DEFAULT_TAX_PERIOD)
        print("Adding sample data...")
        for s in SAMPLES:
            create_sample(conn, s, reviewer["user_id"], rules)
    print(f"\nDone. Sample taxpayers log in with their email and password {PASSWORD}")
    print("Reviewer: reviewer@taxcompass.demo / Reviewer@123")


if __name__ == "__main__":
    main()
