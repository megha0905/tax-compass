import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

// Loads the taxpayer's current filing with incomes, deductions, documents, reviews and audit log.
export function useFiling() {
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setBundle(await api.get("/api/filing")); setError(""); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  return { bundle, setBundle, refresh, error };
}
