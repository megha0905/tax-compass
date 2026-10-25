// Small client for the FastAPI back end. The token is kept in localStorage.
const BASE = import.meta.env.VITE_API_URL || "";

export function getToken() {
  try { return localStorage.getItem("tc_token"); } catch { return null; }
}
export function setToken(token) {
  try {
    if (token) localStorage.setItem("tc_token", token);
    else localStorage.removeItem("tc_token");
  } catch { /* storage blocked: session only lasts this page */ }
}

async function request(method, path, body, isForm = false) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    let msg = data?.detail ?? `Request failed (${res.status})`;
    if (Array.isArray(msg)) msg = msg.map((d) => d.msg).join("; ");
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  del: (p) => request("DELETE", p),
  upload: (p, formData) => request("POST", p, formData, true),
  async download(documentId, fileName) {
    const res = await fetch(`${BASE}/api/documents/${documentId}/file`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) throw new Error("Could not download file");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  },
};
