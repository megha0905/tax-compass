"""Database connection, schema setup and seed data."""
import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .security import hash_password

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://taxcompass:taxcompass@localhost:5432/taxcompass"
)
DEFAULT_TAX_PERIOD = os.getenv("TAX_PERIOD", "2025-26")

SCHEMA_FILE = Path(__file__).with_name("schema.sql")


@contextmanager
def get_conn():
    """Open a connection; commit on success, roll back on error."""
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# (section_code, rule_type, limit_amount, rate, description)
# limit_amount = upper edge of a slab (None = no upper limit) or a deduction cap.
RULES = [
    ("NEW_SLAB_1", "SLAB_NEW", 400000, 0.00, "New regime: up to 4L nil"),
    ("NEW_SLAB_2", "SLAB_NEW", 800000, 0.05, "New regime: 4L-8L at 5%"),
    ("NEW_SLAB_3", "SLAB_NEW", 1200000, 0.10, "New regime: 8L-12L at 10%"),
    ("NEW_SLAB_4", "SLAB_NEW", 1600000, 0.15, "New regime: 12L-16L at 15%"),
    ("NEW_SLAB_5", "SLAB_NEW", 2000000, 0.20, "New regime: 16L-20L at 20%"),
    ("NEW_SLAB_6", "SLAB_NEW", 2400000, 0.25, "New regime: 20L-24L at 25%"),
    ("NEW_SLAB_7", "SLAB_NEW", None, 0.30, "New regime: above 24L at 30%"),
    ("OLD_SLAB_1", "SLAB_OLD", 250000, 0.00, "Old regime: up to 2.5L nil"),
    ("OLD_SLAB_2", "SLAB_OLD", 500000, 0.05, "Old regime: 2.5L-5L at 5%"),
    ("OLD_SLAB_3", "SLAB_OLD", 1000000, 0.20, "Old regime: 5L-10L at 20%"),
    ("OLD_SLAB_4", "SLAB_OLD", None, 0.30, "Old regime: above 10L at 30%"),
    ("STD_NEW", "STD_DEDUCTION", 75000, None, "Standard deduction on salary, new regime"),
    ("STD_OLD", "STD_DEDUCTION", 50000, None, "Standard deduction on salary, old regime"),
    ("REBATE_NEW", "REBATE_87A", 1200000, 60000, "87A rebate (max in rate) if taxable <= limit, new regime"),
    ("REBATE_OLD", "REBATE_87A", 500000, 12500, "87A rebate (max in rate) if taxable <= limit, old regime"),
    ("CESS", "CESS", None, 0.04, "Health and education cess on tax"),
    ("HP_STD", "HP_STD_DEDUCTION", None, 0.30, "30% standard deduction on rent received"),
    ("80C", "DEDUCTION_LIMIT", 150000, None, "PF, PPF, ELSS, life insurance (old regime only)"),
    ("80D", "DEDUCTION_LIMIT", 25000, None, "Health insurance, self/family under 60 (old regime only)"),
    ("80CCD1B", "DEDUCTION_LIMIT", 50000, None, "Additional NPS contribution (old regime only)"),
    ("80TTA", "DEDUCTION_LIMIT", 10000, None, "Savings account interest (old regime only)"),
    ("24B", "DEDUCTION_LIMIT", 200000, None, "Home loan interest, self-occupied (old regime only)"),
]

PERIODS = [
    ("2025-26", "Income-tax Act, 1961"),
    ("2026-27", "Income-tax Act, 2025"),
]

DEMO_USERS = [
    ("Demo Taxpayer", "taxpayer@taxcompass.demo", "Taxpayer@123", "taxpayer", "ABCDE1234F"),
    ("Demo Reviewer (CA)", "reviewer@taxcompass.demo", "Reviewer@123", "reviewer", None),
]


def init_db():
    """Create tables and triggers, then seed rules and demo users."""
    with get_conn() as conn:
        conn.execute(SCHEMA_FILE.read_text())
        for period, act in PERIODS:
            for code, rtype, limit, rate, desc in RULES:
                conn.execute(
                    """INSERT INTO tax_rules (section_code, tax_period, act_version, rule_type,
                                              limit_amount, rate, description, source_reference)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (section_code, tax_period) DO NOTHING""",
                    (code, period, act, rtype, limit, rate, desc, "incometax.gov.in; Union Budget 2025 and 2026"),
                )
        for name, email, pwd, role, pan in DEMO_USERS:
            conn.execute(
                """INSERT INTO users (name, email, password_hash, role, pan)
                   VALUES (%s, %s, %s, %s, %s) ON CONFLICT (email) DO NOTHING""",
                (name, email, hash_password(pwd), role, pan),
            )


def log_action(conn, filing_id, actor_id, action, details=None):
    """Write one append-only audit row."""
    conn.execute(
        "INSERT INTO audit_log (filing_id, actor_id, action, details) VALUES (%s, %s, %s, %s)",
        (filing_id, actor_id, action, Jsonb(details or {})),
    )


if __name__ == "__main__":
    init_db()
    print("Database ready.")
