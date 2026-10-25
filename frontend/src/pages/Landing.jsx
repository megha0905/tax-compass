import { Link } from "react-router-dom";
import { ArrowRight, FileCheck2, Scale, ShieldCheck } from "lucide-react";
import { Disclaimer, Logo } from "../components/shell";
import { Button } from "../components/ui";
import { useAuth } from "../auth";

const features = [
  { icon: Scale, title: "Old vs new, side by side", body: "Every rupee computed by a rules engine from the tax rules table — never guessed by AI." },
  { icon: FileCheck2, title: "The right ITR form", body: "ITR-1, 2, 3 or 4 picked from your income mix, with the reason shown." },
  { icon: ShieldCheck, title: "CA approval required", body: "Nothing is Ready to File until a qualified reviewer signs off. The database enforces it." },
];

export default function Landing() {
  const { user } = useAuth();
  const home = user ? (user.role === "reviewer" ? "/review" : "/dashboard") : "/login";
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-4">
        <Logo />
        <Link to={home}><Button variant="outline" size="sm">{user ? "Open dashboard" : "Sign in"}</Button></Link>
      </header>
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:pt-16">
          <div className="overflow-hidden rounded-3xl bg-hero px-6 py-14 text-primary-foreground shadow-card sm:px-12 sm:py-20">
            <p className="mb-4 inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-medium tracking-wide">
              Tax period 2025-26 · Resident individuals
            </p>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight sm:text-6xl">
              File your income tax with a compass, not a guess.
            </h1>
            <p className="mt-5 max-w-xl text-base text-white/80 sm:text-lg">
              Answer a few questions, add your income and deductions, and see which regime saves you more —
              then a CA reviews it before you file.
            </p>
            <div className="mt-8">
              <Link to={home}>
                <Button size="lg" variant="secondary">Start my filing <ArrowRight className="h-4 w-4" /></Button>
              </Link>
            </div>
            <p className="num mt-10 text-sm text-white/70">Salary ₹12,85,000 → new regime tax ₹10,400 (with marginal relief)</p>
          </div>
        </section>
        <section className="mx-auto grid max-w-6xl gap-4 px-4 pb-16 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>
      <Disclaimer />
    </div>
  );
}
