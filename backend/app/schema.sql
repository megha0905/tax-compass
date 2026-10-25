-- TaxCompass schema (PostgreSQL). Safe to run many times.

CREATE TABLE IF NOT EXISTS users (
    user_id            SERIAL PRIMARY KEY,
    name               TEXT NOT NULL,
    pan                TEXT UNIQUE,
    email              TEXT UNIQUE NOT NULL,
    phone              TEXT,
    dob                DATE,
    residential_status TEXT NOT NULL DEFAULT 'Resident'
                       CHECK (residential_status IN ('Resident', 'Non-resident')),
    role               TEXT NOT NULL CHECK (role IN ('taxpayer', 'reviewer')),
    password_hash      TEXT NOT NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tax rules are data, not code. Versioned by tax period and Act.
CREATE TABLE IF NOT EXISTS tax_rules (
    section_code     TEXT NOT NULL,
    tax_period       TEXT NOT NULL,
    act_version      TEXT NOT NULL,
    rule_type        TEXT NOT NULL,
    limit_amount     NUMERIC(14, 2),
    rate             NUMERIC(14, 4),
    description      TEXT,
    source_reference TEXT,
    PRIMARY KEY (section_code, tax_period)
);

CREATE TABLE IF NOT EXISTS incomes (
    income_id    SERIAL PRIMARY KEY,
    user_id      INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    tax_period   TEXT NOT NULL,
    income_type  TEXT NOT NULL
                 CHECK (income_type IN ('SALARY', 'HOUSE_PROPERTY', 'CAPITAL_GAINS', 'BUSINESS', 'OTHER')),
    source_name  TEXT NOT NULL DEFAULT '',
    amount       NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    tds_deducted NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tds_deducted >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deductions (
    deduction_id   SERIAL PRIMARY KEY,
    user_id        INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    tax_period     TEXT NOT NULL,
    section_code   TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    claimed_amount NUMERIC(14, 2) NOT NULL CHECK (claimed_amount >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (section_code, tax_period) REFERENCES tax_rules (section_code, tax_period)
);

CREATE TABLE IF NOT EXISTS filings (
    filing_id          SERIAL PRIMARY KEY,
    user_id            INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    tax_period         TEXT NOT NULL,
    intake_answers     JSONB,
    view_plan          JSONB,
    gross_total_income NUMERIC(14, 2),
    total_deductions   NUMERIC(14, 2),
    taxable_old        NUMERIC(14, 2),
    taxable_new        NUMERIC(14, 2),
    tax_old            NUMERIC(14, 2),
    tax_new            NUMERIC(14, 2),
    breakdown          JSONB,
    recommended_regime TEXT,
    recommended_itr    TEXT,
    itr_reason         TEXT,
    explanation        TEXT,
    flags              JSONB NOT NULL DEFAULT '[]'::jsonb,
    status             TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT', 'AI_VALIDATED', 'PENDING_REVIEW',
                                         'CHANGES_REQUESTED', 'READY_TO_FILE', 'REJECTED')),
    submitted_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, tax_period)
);

CREATE TABLE IF NOT EXISTS documents (
    document_id    SERIAL PRIMARY KEY,
    user_id        INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    income_id      INT REFERENCES incomes(income_id) ON DELETE SET NULL,
    deduction_id   INT REFERENCES deductions(deduction_id) ON DELETE SET NULL,
    doc_type       TEXT NOT NULL,
    file_name      TEXT NOT NULL,
    file_path      TEXT NOT NULL,
    extracted_data JSONB,
    ocr_confidence NUMERIC(4, 2),
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reviews and audit rows are kept for traceability (no cascade delete).
CREATE TABLE IF NOT EXISTS reviews (
    review_id   SERIAL PRIMARY KEY,
    filing_id   INT NOT NULL REFERENCES filings(filing_id) ON DELETE RESTRICT,
    reviewer_id INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    decision    TEXT NOT NULL CHECK (decision IN ('APPROVE', 'REQUEST_CHANGES', 'REJECT')),
    comments    TEXT NOT NULL CHECK (length(trim(comments)) > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    log_id     BIGSERIAL PRIMARY KEY,
    filing_id  INT REFERENCES filings(filing_id) ON DELETE RESTRICT,
    actor_id   INT REFERENCES users(user_id) ON DELETE RESTRICT,
    action     TEXT NOT NULL,
    details    JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Human review gate: no Ready to File without an approving review.
CREATE OR REPLACE FUNCTION gate_ready_to_file() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'READY_TO_FILE' AND NOT EXISTS (
        SELECT 1 FROM reviews WHERE filing_id = NEW.filing_id AND decision = 'APPROVE'
    ) THEN
        RAISE EXCEPTION 'Approving review required before Ready to File';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gate_ready_to_file ON filings;
CREATE TRIGGER trg_gate_ready_to_file
    BEFORE INSERT OR UPDATE ON filings
    FOR EACH ROW EXECUTE FUNCTION gate_ready_to_file();

-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
