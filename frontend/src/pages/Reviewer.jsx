import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Download, FileText, ShieldAlert, ShieldCheck } from "lucide-react";
import { api } from "../api";
import { formatDate, formatINR, titleCase } from "../format";
import { AuditTimeline, FlagChips, StatusBadge } from "../components/filing-bits";
import { Explanation, Headline, RegimeTable } from "../components/results";
import { Alert, Button, Panel, Spinner, Textarea, cn } from "../components/ui";

// ---------- Queue ----------
export function ReviewQueue() {
  const [tab, setTab] = useState("PENDING_REVIEW");
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setRows(null);
    api.get(`/api/review/queue?status=${tab}`).then(setRows).catch((e) => setError(e.message));
  }, [tab]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">Review queue</h1>
        <div className="flex rounded-lg bg-muted p-1 text-sm">
          {[["PENDING_REVIEW", "Pending"], ["ALL", "All reviewed"]].map(([v, l]) => (
            <button key={v} onClick={() => setTab(v)} className={cn("rounded-md px-4 py-1.5", tab === v ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>{l}</button>
          ))}
        </div>
      </div>
      {error && <Alert variant="danger">{error}</Alert>}
      <Panel>
        {!rows ? <Spinner /> : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No filings here right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 font-medium">Taxpayer</th><th className="font-medium">Form</th>
                  <th className="font-medium">Regime</th><th className="text-right font-medium">Tax</th>
                  <th className="text-center font-medium">Flags</th><th className="font-medium">Submitted</th><th className="font-medium">Status</th><th />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.filing_id}>
                    <td className="py-3"><p className="font-medium">{r.taxpayer_name}</p><p className="num text-xs text-muted-foreground">{r.pan ?? "PAN not given"}</p></td>
                    <td>{r.recommended_itr}</td>
                    <td className="capitalize">{r.recommended_regime}</td>
                    <td className="num text-right">{formatINR(r.recommended_regime === "old" ? r.tax_old : r.tax_new)}</td>
                    <td className="text-center">{r.flag_count > 0 ? <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning-foreground">{r.flag_count}</span> : "0"}</td>
                    <td className="text-muted-foreground">{formatDate(r.submitted_at)}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td className="text-right"><Link to={`/review/${r.filing_id}`}><Button size="sm" variant="outline">Open</Button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------- Filing detail + decision ----------
export function ReviewDetail() {
  const { id } = useParams();
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState("");
  const load = useCallback(() => api.get(`/api/review/filings/${id}`).then(setBundle).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!bundle) return <Spinner />;
  const f = bundle.filing;
  const b = f.breakdown;
  const declaredSalary = bundle.incomes.filter((i) => i.income_type === "SALARY").reduce((s, i) => s + Number(i.amount), 0);

  return (
    <div className="space-y-6">
      <Link to="/review" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to queue
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">{bundle.taxpayer.name}</h1>
          <p className="num text-sm text-muted-foreground">
            {bundle.taxpayer.pan ?? "PAN not given"} · {bundle.taxpayer.residential_status} · tax period {f.tax_period}
          </p>
        </div>
        <StatusBadge status={f.status} />
      </div>

      <Headline filing={f} />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Panel title="Flags to check"><FlagChips flags={f.flags} /></Panel>

          <Panel title="Income declared">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {bundle.incomes.map((i) => (
                  <tr key={i.income_id}>
                    <td className="py-2">{titleCase(i.income_type)}</td>
                    <td className="text-muted-foreground">{i.source_name}</td>
                    <td className="num text-right">{formatINR(i.amount)}</td>
                    <td className="num text-right text-muted-foreground">{Number(i.tds_deducted) ? `TDS ${formatINR(i.tds_deducted)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {b && (
            <Panel title="Deductions — claimed vs allowed">
              {b.old.deductions.length === 0 && !Number(b.old.home_loan_interest_allowed) ? (
                <p className="text-sm text-muted-foreground">No deductions claimed.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-muted-foreground"><tr><th className="py-1 font-medium">Section</th><th className="text-right font-medium">Claimed</th><th className="text-right font-medium">Allowed (old)</th><th className="text-right font-medium">Allowed (new)</th></tr></thead>
                  <tbody className="divide-y divide-border">
                    {b.old.deductions.map((d) => (
                      <tr key={d.section_code}>
                        <td className="py-2 font-medium">{d.section_code}</td>
                        <td className="num text-right">{formatINR(d.claimed)}</td>
                        <td className={cn("num text-right", d.allowed < d.claimed && "text-warning-foreground")}>{formatINR(d.allowed)}</td>
                        <td className="num text-right text-muted-foreground">{formatINR(0)}</td>
                      </tr>
                    ))}
                    {bundle.deductions.some((d) => d.section_code === "24B") && (
                      <tr>
                        <td className="py-2 font-medium">24B</td>
                        <td className="num text-right">{formatINR(bundle.deductions.filter((d) => d.section_code === "24B").reduce((s, d) => s + Number(d.claimed_amount), 0))}</td>
                        <td className="num text-right">{formatINR(b.old.home_loan_interest_allowed)}</td>
                        <td className="num text-right text-muted-foreground">{formatINR(0)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </Panel>
          )}

          <Panel title="Documents">
            {bundle.documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents uploaded.</p> : (
              <ul className="space-y-2">
                {bundle.documents.map((d) => (
                  <li key={d.document_id} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" /> {titleCase(d.doc_type)} · {d.file_name}</span>
                      <button className="text-muted-foreground hover:text-primary" onClick={() => api.download(d.document_id, d.file_name)} aria-label="Download"><Download className="h-4 w-4" /></button>
                    </div>
                    {d.doc_type === "form16" && (
                      <div className="mt-2 grid gap-1 text-xs sm:grid-cols-3">
                        <span>Declared: <b className="num">{formatINR(declaredSalary)}</b></span>
                        <span>Extracted: <b className="num">{d.extracted_data?.gross_salary != null ? formatINR(d.extracted_data.gross_salary) : "not found"}</b></span>
                        <span>Confidence: <b>{Math.round(Number(d.ocr_confidence || 0) * 100)}%</b></span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {b && <Panel title="Old vs new regime"><RegimeTable breakdown={b} /></Panel>}
          <Explanation filing={f} />

          <Panel title="Intake and view plan">
            <pre className="num overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify({ intake_answers: f.intake_answers, components: f.view_plan?.components, validated: f.view_plan?.validated }, null, 2)}
            </pre>
          </Panel>
        </div>

        <div className="space-y-6">
          <DecisionPanel bundle={bundle} onDone={setBundle} />
          <GateTest filingId={f.filing_id} status={f.status} />
          <Panel title="Audit trail"><AuditTimeline rows={bundle.audit} /></Panel>
        </div>
      </div>
    </div>
  );
}

function DecisionPanel({ bundle, onDone }) {
  const f = bundle.filing;
  const [decision, setDecision] = useState("APPROVE");
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (f.status !== "PENDING_REVIEW") {
    const last = bundle.reviews[0];
    return (
      <Panel title="Decision">
        {last ? (
          <div className="space-y-2 text-sm">
            <StatusBadge status={f.status} />
            <p>“{last.comments}”</p>
            <p className="text-xs text-muted-foreground">{last.reviewer_name} · {formatDate(last.created_at)}</p>
          </div>
        ) : <p className="text-sm text-muted-foreground">Waiting for the taxpayer.</p>}
      </Panel>
    );
  }

  const submit = async () => {
    setBusy(true);
    setErr("");
    try {
      await api.post(`/api/review/filings/${f.filing_id}`, { decision, comments });
      onDone(await api.get(`/api/review/filings/${f.filing_id}`));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  const OPTIONS = [
    ["APPROVE", "Approve", "border-success bg-success-soft text-success"],
    ["REQUEST_CHANGES", "Request changes", "border-warning bg-warning-soft text-warning-foreground"],
    ["REJECT", "Reject", "border-destructive bg-destructive-soft text-destructive"],
  ];

  return (
    <Panel title="Your decision" className="lg:sticky lg:top-20">
      <div className="grid gap-2">
        {OPTIONS.map(([v, l, on]) => (
          <button key={v} onClick={() => setDecision(v)}
            className={cn("rounded-lg border px-3 py-2 text-left text-sm", decision === v ? on + " font-medium" : "border-border")}>
            {l}
          </button>
        ))}
      </div>
      <label className="mt-4 block text-sm font-medium">Comments (required)</label>
      <Textarea className="mt-1.5" value={comments} onChange={(e) => setComments(e.target.value)}
        placeholder={decision === "APPROVE" ? "e.g. Checked Form 16 and 80C proofs." : "Explain what the taxpayer must fix."} />
      {err && <div className="mt-3"><Alert variant="danger">{err}</Alert></div>}
      <Button className="mt-4 w-full" busy={busy} disabled={!comments.trim()} onClick={submit}
        variant={decision === "APPROVE" ? "success" : decision === "REJECT" ? "danger" : "primary"}>
        Submit decision
      </Button>
    </Panel>
  );
}

// Demo of the database-level review gate.
function GateTest({ filingId, status }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { setRes(await api.post(`/api/review/filings/${filingId}/try-bypass`)); } finally { setBusy(false); }
  };
  return (
    <Panel title="Test the review gate">
      <p className="text-sm text-muted-foreground">
        Try to force this filing to “Ready to File” directly in PostgreSQL, skipping approval. The database trigger should refuse.
      </p>
      <Button variant="outline" size="sm" className="mt-3" busy={busy} onClick={run}>Try bypass</Button>
      {res && (
        <div className="mt-3">
          {res.blocked ? (
            <Alert variant="success" title={<span className="flex items-center gap-1.5"><ShieldCheck className="h-4 w-4" /> Blocked by the database</span>}>
              <span className="num text-xs">{res.database_error}</span>
            </Alert>
          ) : (
            <Alert variant="warning" title={<span className="flex items-center gap-1.5"><ShieldAlert className="h-4 w-4" /> Allowed</span>}>
              {res.note} (status: {status})
            </Alert>
          )}
        </div>
      )}
    </Panel>
  );
}
