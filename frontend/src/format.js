const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export const formatINR = (n) => (n == null || n === "" ? "—" : inr.format(Number(n)));

export const formatDate = (s) =>
  s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export const titleCase = (s) =>
  (s || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

export const EDITABLE = ["DRAFT", "AI_VALIDATED", "CHANGES_REQUESTED"];
