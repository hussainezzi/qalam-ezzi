/* Shared auth + API helpers for the LMS pages. */
(function () {
  const cfg = window.QALAM_CONFIG || {};
  const API = (cfg.API_URL || "").trim();
  const CLIENT_ID = (cfg.GOOGLE_CLIENT_ID || "").trim();
  const KEY = "qe_token";

  const store = {
    get: () => sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || "",
    set: (t, remember) => {
      sessionStorage.setItem(KEY, t);
      if (remember) localStorage.setItem(KEY, t);
    },
    clear: () => { sessionStorage.removeItem(KEY); localStorage.removeItem(KEY); },
  };

  function decode(token) {
    try {
      const p = token.split(".")[1];
      return JSON.parse(decodeURIComponent(atob(p.replace(/-/g, "+").replace(/_/g, "/"))));
    } catch (e) { return null; }
  }

  async function get(params) {
    const url = API + "?" + new URLSearchParams(params).toString();
    const r = await fetch(url);
    return r.json();
  }
  async function post(body) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  function user() {
    const t = store.get();
    if (!t) return null;
    const p = decode(t);
    if (!p || (p.exp && p.exp * 1000 < Date.now())) { store.clear(); return null; }
    return { email: p.email, name: p.name || p.email, picture: p.picture || "", token: t };
  }

  function loadGis() {
    return new Promise((resolve) => {
      if (window.google && google.accounts) return resolve();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = resolve;
      document.head.appendChild(s);
    });
  }

  async function mountButton(el, onUser) {
    if (!CLIENT_ID) {
      el.innerHTML = '<div class="notice err">Google sign-in is not configured yet.</div>';
      return;
    }
    await loadGis();
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: (res) => {
        store.set(res.credential, true);
        const u = user();
        if (u && onUser) onUser(u);
      },
    });
    google.accounts.id.renderButton(el, { theme: "outline", size: "large", text: "continue_with", shape: "pill" });
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function money(amount, currency) {
    if (!amount) return "Free";
    return (currency || "AED") + " " + amount;
  }

  window.QE = { API, CLIENT_ID, get, post, user, mountButton, store, esc, money, decode };
})();
