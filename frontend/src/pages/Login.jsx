import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Disclaimer, Logo } from "../components/shell";
import { Alert, Button, Field, Input, Select, cn } from "../components/ui";
import { useAuth } from "../auth";

const DEMO = [
  { label: "Demo taxpayer", email: "taxpayer@taxcompass.demo", password: "Taxpayer@123" },
  { label: "Demo reviewer (CA)", email: "reviewer@taxcompass.demo", password: "Reviewer@123" },
];

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [f, setF] = useState({
    email: "", password: "", name: "", pan: "", phone: "", dob: "", residential_status: "Resident", role: "taxpayer",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const go = (user) => navigate(user.role === "reviewer" ? "/review" : "/dashboard", { replace: true });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tab === "signin") go(await login(f.email, f.password));
      else {
        if (f.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(f.pan)) throw new Error("PAN should look like ABCDE1234F");
        const body = { ...f, pan: f.pan || null, phone: f.phone || null, dob: f.dob || null };
        go(await register(body));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const demo = async (d) => {
    setBusy(true);
    setError("");
    try { go(await login(d.email, d.password)); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="mx-auto w-full max-w-6xl px-4 py-4"><Logo /></div>
      <main className="flex flex-1 items-start justify-center px-4 py-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-card">
          <div className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
            {[["signin", "Sign in"], ["signup", "Create account"]].map(([v, l]) => (
              <button key={v} type="button" onClick={() => setTab(v)}
                className={cn("rounded-md py-2", tab === v ? "bg-card font-medium shadow-sm" : "text-muted-foreground")}>
                {l}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-4">
            {tab === "signup" && (
              <>
                <Field label="I am a">
                  <div className="grid grid-cols-2 gap-2">
                    {[["taxpayer", "Taxpayer"], ["reviewer", "Reviewer (CA)"]].map(([v, l]) => (
                      <button key={v} type="button" onClick={() => setF({ ...f, role: v })}
                        className={cn("rounded-lg border p-3 text-sm", f.role === v ? "border-primary bg-secondary font-medium" : "border-border")}>
                        {l}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Full name"><Input required value={f.name} onChange={set("name")} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="PAN (optional)">
                    <Input value={f.pan} maxLength={10} placeholder="ABCDE1234F" onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="Phone"><Input type="tel" value={f.phone} onChange={set("phone")} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date of birth"><Input type="date" value={f.dob} onChange={set("dob")} /></Field>
                  <Field label="Residential status">
                    <Select value={f.residential_status} onChange={set("residential_status")}>
                      <option>Resident</option><option>Non-resident</option>
                    </Select>
                  </Field>
                </div>
              </>
            )}
            <Field label="Email"><Input type="email" required value={f.email} onChange={set("email")} /></Field>
            <Field label="Password"><Input type="password" required minLength={6} value={f.password} onChange={set("password")} /></Field>
            {error && <Alert variant="danger">{error}</Alert>}
            <Button className="w-full" busy={busy}>{tab === "signin" ? "Sign in" : "Create account"}</Button>
          </form>

          <div className="mt-6 border-t border-border pt-4">
            <p className="mb-2 text-xs text-muted-foreground">For the demo:</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <Button key={d.email} variant="outline" size="sm" onClick={() => demo(d)} disabled={busy}>{d.label}</Button>
              ))}
            </div>
          </div>
        </div>
      </main>
      <Disclaimer />
    </div>
  );
}
