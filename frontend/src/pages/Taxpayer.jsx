import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, RefreshCw, Send } from "lucide-react";
import { api } from "../api";
import { EDITABLE, formatINR } from "../format";
import { useFiling } from "../useFiling";
import { AuditTimeline, FlagChips, StatusBadge, Stepper, stageOf } from "../components/filing-bits";
import { PlanRenderer } from "../components/registry";
import { Explanation, Headline, RegimeTable } from "../components/results";
import { Alert, Button, Input, Panel, Spinner, cn } from "../components/ui";

function ReviewerNote({ bundle }) {
  const last = bundle.reviews[0];
  const st = bundle.filing.status;
  if (!last || !["CHANGES_REQUESTED", "REJECTED", "READY_TO_FILE"].includes(st)) return null;
  const variant = st === "READY_TO_FILE" ? "success" : "danger";
  const title = { CHANGES_REQUESTED: "Your CA asked for changes", REJECTED: "Your filing was rejected", READY_TO_FILE: "Approved by your CA — Ready to File" }[st];
  return <Alert variant={variant} title={title}>“{last.comments}” — {last.reviewer_name}</Alert>;
}

function Header({ bundle, title }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold">{title}</h1>
        <StatusBadge status={bundle.filing.status} />
      </div>
      <Panel><Stepper current={stageOf(bundle.filing, bundle.incomes)} /></Panel>
      <ReviewerNote bundle={bundle} />
    </div>
  );
}

// ---------- Dashboard ----------
export function Dashboard() {
  const { bundle, error } = useFiling();
  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!bundle) return <Spinner />;
  const f = bundle.filing;
  const stage = stageOf(f, bundle.incomes);
  const next = !f.view_plan ? ["/intake", "Start intake"]
    : f.status === "AI_VALIDATED" ? ["/result", "Review result & send to CA"]
    : EDITABLE.includes(f.status) ? ["/details", "Continue with details"]
    : ["/result", "View result"];

  return (
    <div className="space-y-6">
      <Header bundle={bundle} title={`Tax period ${f.tax_period}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Panel title={stage === 0 ? "Let's begin" : "Your filing"}>
          {f.tax_new != null ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="New regime" value={formatINR(f.tax_new)} strong={f.recommended_regime === "new"} />
              <Stat label="Old regime" value={formatINR(f.tax_old)} strong={f.recommended_regime === "old"} />
              <Stat label="Form" value={f.recommended_itr} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Answer a few questions, and TaxCompass shows only the screens and documents that apply to you.
            </p>
          )}
          {f.flags?.length > 0 && <div className="mt-4"><FlagChips flags={f.flags} /></div>}
          <Link to={next[0]} className="mt-5 inline-block">
            <Button>{next[1]} <ArrowRight className="h-4 w-4" /></Button>
          </Link>
        </Panel>
        <Panel title="Activity"><AuditTimeline rows={bundle.audit.slice(-6)} /></Panel>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className={cn("rounded-xl border p-4", strong ? "border-primary bg-secondary" : "border-border")}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

// ---------- Intake (Workflow Orchestrator) ----------
export function Intake() {
  const { bundle, error } = useFiling();
  const navigate = useNavigate();
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { api.get("/api/intake/questions").then((r) => setQuestions(r.questions)); }, []);
  useEffect(() => {
    if (bundle) setAnswers(bundle.filing.intake_answers ?? { has_salary: true, house_property_count: 0 });
  }, [bundle]);

  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!bundle || !questions) return <Spinner />;
  const locked = !EDITABLE.includes(bundle.filing.status);

  const save = async () => {
    setBusy(true);
    setErr("");
    try { await api.post("/api/filing/intake", { answers }); navigate("/details"); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <Header bundle={bundle} title="Tell us about your income" />
      <Panel>
        <div className="divide-y divide-border">
          {questions.map((q) => {
            if (q.depends_on && !answers[q.depends_on]) return null;
            return (
              <div key={q.key} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <p className="text-sm font-medium">{q.label}</p>
                {q.type === "number" ? (
                  <div className="w-24">
                    <Input type="number" min="0" max="20" disabled={locked}
                      value={answers[q.key] ?? 0} onChange={(e) => setAnswers({ ...answers, [q.key]: Number(e.target.value) })} />
                  </div>
                ) : (
                  <div className="flex rounded-lg bg-muted p-1 text-sm">
                    {[[true, "Yes"], [false, "No"]].map(([v, l]) => (
                      <button key={l} type="button" disabled={locked}
                        onClick={() => setAnswers({ ...answers, [q.key]: v })}
                        className={cn("rounded-md px-4 py-1.5", !!answers[q.key] === v ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                        {l}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {err && <div className="mt-3"><Alert variant="danger">{err}</Alert></div>}
        {locked ? (
          <p className="mt-4 text-sm text-muted-foreground">Your filing is with the reviewer, so answers are locked.</p>
        ) : (
          <Button className="mt-4" busy={busy} onClick={save}>Build my screens <ArrowRight className="h-4 w-4" /></Button>
        )}
      </Panel>
    </div>
  );
}

// ---------- Details (renders the view plan) ----------
export function Details() {
  const { bundle, refresh, error } = useFiling();
  const [open, setOpen] = useState(false);
  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!bundle) return <Spinner />;
  const plan = bundle.filing.view_plan;
  const locked = !EDITABLE.includes(bundle.filing.status);

  if (!plan) {
    return (
      <div className="space-y-6">
        <Header bundle={bundle} title="Your details" />
        <Alert variant="info">Complete the <Link to="/intake" className="underline">intake questions</Link> first.</Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header bundle={bundle} title="Your details" />
      <Panel>
        <button className="flex w-full items-center justify-between text-left text-sm font-medium" onClick={() => setOpen(!open)}>
          Why am I seeing these screens?
          <ChevronDown className={cn("h-4 w-4 transition", open && "rotate-180")} />
        </button>
        {open && (
          <div className="mt-3 space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {Object.entries(plan.reasons ?? {}).map(([k, v]) => <li key={k}><span className="num text-foreground">{k}</span>: {v}</li>)}
            </ul>
            <pre className="num overflow-x-auto rounded-lg bg-muted p-3 text-xs">
              {JSON.stringify({ step: plan.step, components: plan.components, required_documents: plan.required_documents, validated: plan.validated }, null, 2)}
            </pre>
            <p className="text-xs text-muted-foreground">
              The Workflow Orchestrator picks component names; the front end only renders names from its fixed library.
            </p>
          </div>
        )}
      </Panel>
      {locked && <Alert variant="info">Your filing is {bundle.filing.status.replace(/_/g, " ").toLowerCase()} — details are locked.</Alert>}
      <PlanRenderer plan={plan} bundle={bundle} refresh={refresh} locked={locked} />
    </div>
  );
}

// ---------- Result ----------
export function Result() {
  const { bundle, setBundle, error } = useFiling();
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!bundle) return <Spinner />;
  const f = bundle.filing;
  const editable = EDITABLE.includes(f.status);
  const stale = editable && f.status !== "AI_VALIDATED";

  const act = async (kind, path) => {
    setBusy(kind);
    setErr("");
    try { setBundle(await api.post(path)); } catch (e) { setErr(e.message); } finally { setBusy(""); }
  };

  return (
    <div className="space-y-6">
      <Header bundle={bundle} title="Your result" />
      {err && <Alert variant="danger">{err}</Alert>}
      {!f.breakdown ? (
        <Panel>
          <p className="text-sm text-muted-foreground">Run the tax engine on what you entered. Both regimes are computed from the rules table.</p>
          <Button className="mt-4" busy={busy === "compute"} disabled={!bundle.incomes.length}
            onClick={() => act("compute", "/api/filing/compute")}>
            Compute my tax
          </Button>
          {!bundle.incomes.length && <p className="mt-2 text-xs text-muted-foreground">Add at least one income in Details first.</p>}
        </Panel>
      ) : (
        <>
          {stale && <Alert variant="warning" title="Your details changed">Recompute to update the numbers before sending for review.</Alert>}
          <Headline filing={f} />
          <Panel title="Old vs new regime"><RegimeTable breakdown={f.breakdown} /></Panel>
          <Explanation filing={f} />
          <Panel title="Flags for the reviewer"><FlagChips flags={f.flags} /></Panel>
          <div className="flex flex-wrap gap-3">
            {editable && (
              <Button variant="outline" busy={busy === "compute"} onClick={() => act("compute", "/api/filing/compute")}>
                <RefreshCw className="h-4 w-4" /> Recompute
              </Button>
            )}
            {f.status === "AI_VALIDATED" && (
              <Button busy={busy === "submit"} onClick={() => act("submit", "/api/filing/submit")}>
                <Send className="h-4 w-4" /> Send to CA for review
              </Button>
            )}
          </div>
        </>
      )}
      <Panel title="Audit trail"><AuditTimeline rows={bundle.audit} /></Panel>
    </div>
  );
}
