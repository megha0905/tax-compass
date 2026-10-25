// Rule-driven front end: the Orchestrator's view plan names components,
// and ONLY the components in this registry can ever be rendered.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Download, FileText, Trash2, Upload } from "lucide-react";
import { api } from "../api";
import { formatINR } from "../format";
import { Alert, Button, Field, Input, Panel, Select } from "./ui";

function useAction(refresh) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try { await fn(); await refresh(); return true; }
    catch (e) { setError(e.message); return false; }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

function EntryList({ rows, render, onDelete, locked }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing added yet.</p>;
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          {render(r)}
          {!locked && (
            <button onClick={() => onDelete(r)} className="text-muted-foreground hover:text-destructive" aria-label="Remove">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// One generic income form, configured per income type.
function IncomeForm({ type, title, help, sourceLabel, amountLabel, withTds, bundle, refresh, locked }) {
  const blank = { source_name: "", amount: "", tds_deducted: "" };
  const [f, setF] = useState(blank);
  const { busy, error, run } = useAction(refresh);
  const rows = bundle.incomes.filter((i) => i.income_type === type).map((i) => ({ ...i, key: i.income_id }));

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post("/api/incomes", {
        income_type: type,
        source_name: f.source_name,
        amount: Number(f.amount),
        tds_deducted: Number(f.tds_deducted || 0),
      });
      setF(blank);
    });
  };

  return (
    <Panel title={title}>
      {help && <p className="-mt-2 mb-4 text-sm text-muted-foreground">{help}</p>}
      <EntryList
        rows={rows}
        locked={locked}
        onDelete={(r) => run(() => api.del(`/api/incomes/${r.income_id}`))}
        render={(r) => (
          <span className="flex flex-1 flex-wrap justify-between gap-2">
            <span>{r.source_name || "—"}</span>
            <span className="num">
              {formatINR(r.amount)}
              {withTds && Number(r.tds_deducted) > 0 && <span className="text-muted-foreground"> · TDS {formatINR(r.tds_deducted)}</span>}
            </span>
          </span>
        )}
      />
      {!locked && (
        <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Field label={sourceLabel}>
            <Input value={f.source_name} onChange={(e) => setF({ ...f, source_name: e.target.value })} />
          </Field>
          <Field label={amountLabel}>
            <Input type="number" min="0" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </Field>
          {withTds ? (
            <Field label="TDS deducted (₹)">
              <Input type="number" min="0" value={f.tds_deducted} onChange={(e) => setF({ ...f, tds_deducted: e.target.value })} />
            </Field>
          ) : <span className="hidden sm:block" />}
          <Button busy={busy}>Add</Button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Panel>
  );
}

const SalaryForm = (p) => (
  <IncomeForm {...p} type="SALARY" title="Salary" withTds sourceLabel="Employer" amountLabel="Gross salary (₹)"
    help="Gross salary from Part B of your Form 16. Standard deduction is applied automatically." />
);
const HousePropertyForm = (p) => (
  <IncomeForm {...p} type="HOUSE_PROPERTY" title="House property" sourceLabel="Property" amountLabel="Annual rent received (₹)"
    help="Enter rent received for a let-out property (0 for self-occupied). Home-loan interest goes under deductions as 24B." />
);
const CapitalGainsForm = (p) => (
  <IncomeForm {...p} type="CAPITAL_GAINS" title="Capital gains" sourceLabel="Asset sold" amountLabel="Gain (₹)"
    help="Profit from selling shares, mutual funds or property. Special rates are checked by the reviewer." />
);
const BusinessForm = (p) => (
  <IncomeForm {...p} type="BUSINESS" title="Business / profession" sourceLabel="Business or profession" amountLabel="Net / presumptive income (₹)"
    help="For 44AD/44ADA, enter the presumptive income (e.g. 50% of gross receipts for professionals)." />
);
const OtherIncomeForm = (p) => (
  <IncomeForm {...p} type="OTHER" title="Other income" sourceLabel="Source (bank, FD…)" amountLabel="Amount (₹)" withTds
    help="Savings and FD interest, dividends and similar income." />
);

const SECTIONS = [
  ["80C", "80C — PF, PPF, ELSS, life insurance (max ₹1,50,000)"],
  ["80D", "80D — Health insurance (max ₹25,000)"],
  ["80CCD1B", "80CCD(1B) — Extra NPS (max ₹50,000)"],
  ["80TTA", "80TTA — Savings interest (max ₹10,000)"],
  ["24B", "24(b) — Home loan interest (max ₹2,00,000)"],
];

function DeductionForm({ bundle, refresh, locked }) {
  const [f, setF] = useState({ section_code: "80C", description: "", claimed_amount: "" });
  const { busy, error, run } = useAction(refresh);
  const rows = bundle.deductions.map((d) => ({ ...d, key: d.deduction_id }));

  const add = (e) => {
    e.preventDefault();
    run(async () => {
      await api.post("/api/deductions", { ...f, claimed_amount: Number(f.claimed_amount) });
      setF({ ...f, description: "", claimed_amount: "" });
    });
  };

  return (
    <Panel title="Deductions">
      <p className="-mt-2 mb-4 text-sm text-muted-foreground">
        Claim what you actually paid. The engine applies the legal limits and shows any cap as a flag.
        These count only in the old regime.
      </p>
      <EntryList
        rows={rows}
        locked={locked}
        onDelete={(r) => run(() => api.del(`/api/deductions/${r.deduction_id}`))}
        render={(r) => (
          <span className="flex flex-1 flex-wrap justify-between gap-2">
            <span><span className="font-medium">{r.section_code}</span> {r.description && `· ${r.description}`}</span>
            <span className="num">{formatINR(r.claimed_amount)}</span>
          </span>
        )}
      />
      {!locked && (
        <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-end">
          <Field label="Section">
            <Select value={f.section_code} onChange={(e) => setF({ ...f, section_code: e.target.value })}>
              {SECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Description">
            <Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <Field label="Amount claimed (₹)">
            <Input type="number" min="0" required value={f.claimed_amount} onChange={(e) => setF({ ...f, claimed_amount: e.target.value })} />
          </Field>
          <Button busy={busy}>Add</Button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Panel>
  );
}

function DocumentUpload({ docType, title, help, bundle, refresh, locked }) {
  const [file, setFile] = useState(null);
  const { busy, error, run } = useAction(refresh);
  const docs = bundle.documents.filter((d) => d.doc_type === docType);
  const salary = bundle.incomes.filter((i) => i.income_type === "SALARY");
  const declared = salary.reduce((s, i) => s + Number(i.amount), 0);

  const upload = (e) => {
    e.preventDefault();
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    if (docType === "form16" && salary[0]) fd.append("income_id", salary[0].income_id);
    run(async () => { await api.upload("/api/documents", fd); setFile(null); e.target.reset(); });
  };

  return (
    <Panel title={title}>
      <p className="-mt-2 mb-4 text-sm text-muted-foreground">{help}</p>
      {docs.length > 0 && (
        <ul className="mb-4 space-y-2">
          {docs.map((d) => {
            const ex = d.extracted_data;
            return (
              <li key={d.document_id} className="rounded-xl border border-border p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> {d.file_name}</span>
                  <button className="text-muted-foreground hover:text-primary" onClick={() => api.download(d.document_id, d.file_name)} aria-label="Download">
                    <Download className="h-4 w-4" />
                  </button>
                </div>
                {docType === "form16" && (
                  <div className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
                    <span>Declared salary: <b className="num">{formatINR(declared)}</b></span>
                    <span>Read from Form 16: <b className="num">{ex?.gross_salary != null ? formatINR(ex.gross_salary) : "not found"}</b></span>
                    <span>TDS: <b className="num">{ex?.tds != null ? formatINR(ex.tds) : "not found"}</b> · confidence {Math.round(Number(d.ocr_confidence || 0) * 100)}%</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!locked && (
        <form onSubmit={upload} className="flex flex-wrap items-center gap-3">
          <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-sm file:font-medium" />
          <Button variant="outline" busy={busy} disabled={!file}><Upload className="h-4 w-4" /> Upload</Button>
        </form>
      )}
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </Panel>
  );
}

const Form16Upload = (p) => (
  <DocumentUpload {...p} docType="form16" title="Form 16"
    help="Upload the PDF from your employer. We read gross salary, TDS and PAN, and flag any mismatch for the reviewer. Manual entry above always works." />
);
const CapitalGainsStatementUpload = (p) => (
  <DocumentUpload {...p} docType="capital_gains_statement" title="Capital gains statement"
    help="Broker or mutual fund capital gains statement, for the reviewer to check special tax rates." />
);

function SummaryPanel({ bundle }) {
  const sum = (t) => bundle.incomes.filter((i) => i.income_type === t).reduce((s, i) => s + Number(i.amount), 0);
  const rows = [
    ["Salary", sum("SALARY")], ["House property (rent)", sum("HOUSE_PROPERTY")], ["Capital gains", sum("CAPITAL_GAINS")],
    ["Business", sum("BUSINESS")], ["Other income", sum("OTHER")],
  ].filter(([, v]) => v > 0);
  const claimed = bundle.deductions.reduce((s, d) => s + Number(d.claimed_amount), 0);
  return (
    <Panel title="Summary" className="lg:sticky lg:top-20">
      <dl className="space-y-2 text-sm">
        {rows.length === 0 && <p className="text-muted-foreground">Add income to see your summary.</p>}
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between"><dt className="text-muted-foreground">{k}</dt><dd className="num">{formatINR(v)}</dd></div>
        ))}
        <div className="flex justify-between border-t border-border pt-2">
          <dt className="text-muted-foreground">Deductions claimed</dt><dd className="num">{formatINR(claimed)}</dd>
        </div>
      </dl>
      <Link to="/result" className="mt-5 block">
        <Button className="w-full" disabled={!bundle.incomes.length}>Continue to result</Button>
      </Link>
    </Panel>
  );
}

function IncomeSourceSelector() {
  return (
    <Alert variant="info">
      Change which income sources apply in <Link to="/intake" className="underline">Intake</Link>.
    </Alert>
  );
}

export const REGISTRY = {
  income_source_selector: IncomeSourceSelector,
  salary_form: SalaryForm,
  house_property_form: HousePropertyForm,
  capital_gains_form: CapitalGainsForm,
  business_form: BusinessForm,
  other_income_form: OtherIncomeForm,
  deduction_form: DeductionForm,
  form16_upload: Form16Upload,
  capital_gains_statement_upload: CapitalGainsStatementUpload,
  summary_panel: SummaryPanel,
};

// Renders a validated view plan. Unknown names are never rendered.
export function PlanRenderer({ plan, bundle, refresh, locked }) {
  const names = (plan?.components ?? []).filter((n) => n in REGISTRY);
  const main = names.filter((n) => n !== "summary_panel");
  const hasSummary = names.includes("summary_panel");
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-6">
        {main.map((name) => {
          const Comp = REGISTRY[name];
          return <Comp key={name} bundle={bundle} refresh={refresh} locked={locked} />;
        })}
      </div>
      {hasSummary && <div><SummaryPanel bundle={bundle} /></div>}
    </div>
  );
}
