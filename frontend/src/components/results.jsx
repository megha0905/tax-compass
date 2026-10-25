import { Bot, FileCheck2, Sparkles } from "lucide-react";
import { formatINR } from "../format";
import { Badge, Panel, cn } from "./ui";

const ROWS = [
  ["Salary", "salary"],
  ["Standard deduction", "standard_deduction", true],
  ["House property income", "house_property_income"],
  ["Other income", "other_income"],
  ["Capital gains", "capital_gains"],
  ["Business income", "business_income"],
  ["Gross total income", "gross_total_income", false, true],
  ["Chapter VI-A deductions allowed", "chapter_via_allowed", true],
  ["Taxable income", "taxable_income", false, true],
  ["Slab tax", "slab_tax"],
  ["Rebate 87A", "rebate_87a", true],
  ["Marginal relief", "marginal_relief", true],
  ["Health & education cess (4%)", "cess"],
];

export function RegimeTable({ breakdown }) {
  if (!breakdown) return null;
  const { old, new: nw, recommended_regime: rec } = breakdown;
  const show = ROWS.filter(([, k]) => Number(old[k]) || Number(nw[k]));
  const head = (key, label) => (
    <th className={cn("px-3 py-3 text-right font-medium", rec === key && "bg-secondary")}>
      <div className="flex items-center justify-end gap-2">
        {label} {rec === key && <Badge variant="primary">Recommended</Badge>}
      </div>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[480px] text-sm">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="px-3 py-3 text-left font-medium">Line</th>
            {head("old", "Old regime")}
            {head("new", "New regime")}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {show.map(([label, k, minus, strong]) => (
            <tr key={k} className={strong ? "font-medium" : ""}>
              <td className="px-3 py-2">{label}</td>
              {[["old", old], ["new", nw]].map(([key, r]) => (
                <td key={key} className={cn("num px-3 py-2 text-right", rec === key && "bg-secondary/50")}>
                  {minus && Number(r[k]) ? "− " : ""}{formatINR(r[k])}
                </td>
              ))}
            </tr>
          ))}
          <tr className="bg-muted/40 text-base font-semibold">
            <td className="px-3 py-3">Total tax payable</td>
            <td className={cn("num px-3 py-3 text-right", rec === "old" && "bg-secondary text-primary")}>{formatINR(old.total_tax)}</td>
            <td className={cn("num px-3 py-3 text-right", rec === "new" && "bg-secondary text-primary")}>{formatINR(nw.total_tax)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Headline({ filing }) {
  const b = filing.breakdown;
  if (!b) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-2xl bg-hero p-5 text-primary-foreground shadow-card">
        <p className="text-sm text-white/80">Recommended</p>
        <p className="mt-1 font-display text-2xl font-semibold capitalize">{b.recommended_regime} regime</p>
        <p className="num mt-2 text-sm text-white/80">Tax {formatINR(b[b.recommended_regime].total_tax)}</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <p className="text-sm text-muted-foreground">You save</p>
        <p className="num mt-1 text-2xl font-semibold text-success">{formatINR(b.saving)}</p>
        <p className="mt-2 text-sm text-muted-foreground">compared with the {b.recommended_regime === "new" ? "old" : "new"} regime</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground"><FileCheck2 className="h-4 w-4" /> Form to file</p>
        <p className="mt-1 font-display text-2xl font-semibold">{filing.recommended_itr}</p>
        <p className="mt-2 text-sm text-muted-foreground">{filing.itr_reason}</p>
      </div>
    </div>
  );
}

export function Explanation({ filing }) {
  const b = filing.breakdown;
  if (!b) return null;
  const chosen = b[b.recommended_regime];
  const llm = b.explanation_source === "llm";
  return (
    <Panel
      title="Why these numbers"
      action={
        <Badge variant={llm ? "primary" : "muted"}>
          {llm ? <><Sparkles className="h-3 w-3" /> Explained by AI · numbers unchanged</> : <><Bot className="h-3 w-3" /> Template explanation</>}
        </Badge>
      }
    >
      <p className="text-sm leading-relaxed">{filing.explanation}</p>
      <p className="mt-4 text-xs font-medium text-muted-foreground">Rules applied ({b.act_version}, tax period {b.tax_period})</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {chosen.rules_applied.map((r) => <span key={r} className="num rounded border border-border bg-muted px-1.5 py-0.5 text-xs">{r}</span>)}
      </div>
    </Panel>
  );
}
