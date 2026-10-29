# TaxCompass

AI-assisted, human-reviewed income tax filing assistant (FY 2025-26).

- **Back end:** Python FastAPI + PostgreSQL (`backend/`)
- **Front end:** React + Vite + Tailwind (`frontend/`), theme designed with Lovable
- **Tax engine:** deterministic Python, rules stored in the `tax_rules` table
- **Review gate:** a PostgreSQL trigger blocks "Ready to File" without an approving CA review
- **Audit log:** append-only (a trigger blocks UPDATE and DELETE)

The front end is already built (`frontend/dist`), so to run the app you only need PostgreSQL and Python.

---

## 1. Install (once)

| Tool | Download | Note |
|---|---|---|
| Python 3.11+ | python.org/downloads | Tick **"Add Python to PATH"** |
| PostgreSQL 16 | postgresql.org/download/windows | Remember the password you set for the `postgres` user |
| Node.js LTS (optional) | nodejs.org | Only needed if you change the front end |

## 2. Create the database (once)

Open **SQL Shell (psql)** from the Start menu, press Enter for the defaults, type your `postgres` password, then run:

```sql
CREATE USER taxcompass WITH PASSWORD 'taxcompass';
CREATE DATABASE taxcompass OWNER taxcompass;
```

## 3. Set up the back end (once)

Open Command Prompt in the `taxcompass\backend` folder:

```bat
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

(Mac/Linux: `source venv/bin/activate`.)

## 4. Run

Double-click **`start.bat`** (Windows) or, in `backend` with the venv active:

```bat
uvicorn app.main:app --port 8000
```

Open **http://localhost:8000**. Tables, triggers, tax rules and demo users are created automatically on first start.

| Demo login | Email | Password |
|---|---|---|
| Taxpayer | taxpayer@taxcompass.demo | Taxpayer@123 |
| Reviewer (CA) | reviewer@taxcompass.demo | Reviewer@123 |

The login page also has one-click demo buttons. API docs: http://localhost:8000/docs

## Sample data (optional)

With the database created, run this in the `backend` folder:

```bat
.\venv\Scripts\python seed_sample.py
```

It adds 7 sample taxpayers with filings in every status (Draft, Computed, Pending review, Changes requested, Ready to File, Rejected), reviews and a full audit trail. Tax figures come from the real tax engine. Sample logins: `rahul@sample.in`, `priya@sample.in`, `amit@sample.in`, `sneha@sample.in`, `arjun@sample.in`, `rohan@sample.in`, `kavya@sample.in`, all with password `Sample@123`. Safe to run more than once.

## 5. Run the tests

```bat
cd backend
venv\Scripts\activate
python -m pytest -q
```

9 tests check the tax engine against the expected answers (profiles A–G).

---

## Optional settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgresql://taxcompass:taxcompass@localhost:5432/taxcompass` | Database connection |
| `ANTHROPIC_API_KEY` | not set | If set, an LLM rewrites the explanation in simpler English. Numbers are checked and never changed; without a key, the template explanation is used |
| `TAX_PERIOD` | `2025-26` | Tax period for new filings (`2026-27` rules are also seeded) |

On Windows: `set ANTHROPIC_API_KEY=your-key` before starting.

## Changing the front end

```bat
cd frontend
npm install
npm run dev        :: http://localhost:5173 (keep the back end running)
npm run build      :: updates frontend\dist, served by the back end
```

## Demo script (5 minutes)

1. **Landing → Sign in → Create account** as a taxpayer.
2. **Intake:** salary = Yes. Click *Build my screens*. Open *Why am I seeing these screens?* to show the view plan JSON (Workflow Orchestrator).
3. **Details:** salary ₹12,85,000 (TDS ₹10,400); 80C ₹2,00,000; upload a Form 16 PDF.
4. **Result:** *Compute my tax* → new regime ₹10,400 with marginal relief, old regime ₹1,43,520, ITR-1, flags (80C capped). *Send to CA for review.*
5. Sign out, then **Demo reviewer (CA)** → open the filing → **Try bypass** (blocked by the database) → *Request changes* or *Approve* with a comment.
6. Back as the taxpayer: the comment shows; fix, recompute and resubmit. Reviewer approves → **Ready to File**. The audit trail shows every step.

## Project structure

```
backend/app/
  schema.sql        tables, review-gate trigger, append-only audit trigger
  db.py             connection, seed tax rules and demo users
  tax_engine.py     Tax Intelligence Agent (old vs new regime, caps, ITR form, flags)
  orchestrator.py   Workflow Orchestrator Agent (intake -> validated view plan)
  ai_services.py    optional LLM explanation + Form 16 PDF reader
  main.py           FastAPI routes
backend/tests/      tax engine tests
frontend/src/
  components/registry.jsx   component library + PlanRenderer (rule-driven UI)
  pages/                    Landing, Login, Taxpayer (Dashboard/Intake/Details/Result), Reviewer
```

Prototype for academic use. Not tax advice. Verify figures on incometax.gov.in.
