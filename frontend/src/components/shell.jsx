import { Link, NavLink, useNavigate } from "react-router-dom";
import { Compass, LogOut } from "lucide-react";
import { useAuth } from "../auth";
import { Button, cn } from "./ui";

export function Disclaimer() {
  return (
    <footer className="border-t border-border bg-muted/60 px-4 py-5 text-center text-xs text-muted-foreground">
      Prototype for academic use. Not tax advice. Verify on{" "}
      <a className="underline underline-offset-2" href="https://www.incometax.gov.in" target="_blank" rel="noreferrer">
        incometax.gov.in
      </a>
      .
    </footer>
  );
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-hero text-primary-foreground">
        <Compass className="h-4 w-4" />
      </span>
      TaxCompass
    </Link>
  );
}

const navClass = ({ isActive }) =>
  cn("whitespace-nowrap rounded-md px-3 py-1.5 text-sm",
     isActive ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground");

export function AppShell({ children }) {
  const { user, isReviewer, logout } = useAuth();
  const navigate = useNavigate();
  const signOut = async () => { await logout(); navigate("/login", { replace: true }); };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
          <Logo />
          <nav className="ml-4 flex flex-1 items-center gap-1 overflow-x-auto">
            {isReviewer ? (
              <NavLink to="/review" className={navClass}>Review queue</NavLink>
            ) : (
              <>
                <NavLink to="/dashboard" className={navClass}>My filing</NavLink>
                <NavLink to="/intake" className={navClass}>Intake</NavLink>
                <NavLink to="/details" className={navClass}>Details</NavLink>
                <NavLink to="/result" className={navClass}>Result</NavLink>
              </>
            )}
          </nav>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user?.name}
            {isReviewer && <span className="ml-1 rounded bg-accent px-1.5 py-0.5 text-xs text-accent-foreground">CA</span>}
          </span>
          <Button variant="ghost" size="sm" onClick={signOut} aria-label="Sign out">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-8">{children}</main>
      <Disclaimer />
    </div>
  );
}
