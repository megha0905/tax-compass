import { createContext, useContext, useEffect, useState } from "react";
import { api, getToken, setToken } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get("/api/me")
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setReady(true));
  }, []);

  const login = async (email, password) => {
    const res = await api.post("/api/auth/login", { email, password });
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const register = async (form) => {
    const res = await api.post("/api/auth/register", form);
    setToken(res.token);
    setUser(res.user);
    return res.user;
  };

  const logout = async () => {
    try { await api.post("/api/auth/logout"); } catch { /* already logged out */ }
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, login, register, logout, isReviewer: user?.role === "reviewer" }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
