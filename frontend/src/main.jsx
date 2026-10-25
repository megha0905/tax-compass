import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "./styles.css";
import { AuthProvider, useAuth } from "./auth";
import { AppShell } from "./components/shell";
import { Spinner } from "./components/ui";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import { Dashboard, Details, Intake, Result } from "./pages/Taxpayer";
import { ReviewDetail, ReviewQueue } from "./pages/Reviewer";

function Protected({ role, children }) {
  const { user, ready } = useAuth();
  if (!ready) return <div className="mx-auto max-w-6xl px-4"><Spinner /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to={user.role === "reviewer" ? "/review" : "/dashboard"} replace />;
  return <AppShell>{children}</AppShell>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<Protected role="taxpayer"><Dashboard /></Protected>} />
      <Route path="/intake" element={<Protected role="taxpayer"><Intake /></Protected>} />
      <Route path="/details" element={<Protected role="taxpayer"><Details /></Protected>} />
      <Route path="/result" element={<Protected role="taxpayer"><Result /></Protected>} />
      <Route path="/review" element={<Protected role="reviewer"><ReviewQueue /></Protected>} />
      <Route path="/review/:id" element={<Protected role="reviewer"><ReviewDetail /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
