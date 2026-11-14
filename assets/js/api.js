/* Live backend glue: courses, registration, Google sign-in, my courses.
   Falls back to the static demo when config.js is empty. */
(function () {
  const cfg = window.QALAM_CONFIG || {};
  const API = (cfg.API_URL || "").trim();
  const live = !!API;

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function apiGet(params) {
    const url = API + "?" + new URLSearchParams(params).toString();
    const res = await fetch(url);
    return res.json();
  }
  async function apiPost(body) {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  /* ---------------- courses ---------------- */
  async function loadCourses() {
    if (!live) return;
    try {
      const r = await apiGet({ action: "courses" });
      if (!r.ok || !r.data.courses.length) return;
      renderCourses(r.data.courses);
    } catch (e) {
      console.warn("courses unavailable", e);
    }
  }

  function renderCourses(courses) {
    const host = document.getElementById("courseList");
    if (!host) return;
    host.innerHTML = courses.map((c) => {
      const date = c.start_date ? esc(c.start_date) : "Date to be announced";
      const price = c.price ? esc(c.currency || "AED") + " " + esc(c.price) : "Fee on enrolment";
      return `
      <div class="course-card">
        <div class="course-card__top">
          <span class="pill">Enrolment open</span>
          <span class="course-card__seats">Limited seats</span>
        </div>
        <h3>${esc(c.title)}</h3>
        <p class="course-card__desc">${esc(c.description || "")}</p>
        <div class="course-card__meta">
          <div><span class="k">Starts</span><span class="v">${date}</span></div>
          <div><span class="k">Length</span><span class="v">${esc(c.duration || "2.5 hours per session")}</span></div>
          <div><span class="k">Sessions</span><span class="v">${esc(c.sessions || "—")}</span></div>
          <div><span class="k">Fee</span><span class="v">${price}</span></div>
        </div>
        <div class="course-card__foot">
          <button class="btn btn--gold" data-open-register data-course-id="${esc(c.id)}">Register &amp; pay</button>
          <span class="course-card__hint">Secure payment · Card details never touch our servers</span>
        </div>
      </div>`;
    }).join("");
    document.querySelectorAll("[data-open-register]").forEach((el) => {
      el.addEventListener("click", () => {
        selectedCourse = el.getAttribute("data-course-id") || "";
      });
    });
  }

  let selectedCourse = "";

  /* ---------------- registration ---------------- */
  const form = document.getElementById("regForm");
  const done = document.getElementById("regDone");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!live) return; // demo handler in main.js
      e.stopImmediatePropagation();

      const fd = new FormData(form);
      const payload = {
        action: "register",
        course_id: selectedCourse,
        name: (fd.get("name") || "").trim(),
        email: (fd.get("email") || "").trim(),
        phone: (fd.get("phone") || "").trim(),
        city: (fd.get("city") || "").trim(),
      };
      const btn = form.querySelector("button[type=submit]");
      btn.textContent = "Sending…";
      btn.disabled = true;
      try {
        const r = await apiPost(payload);
        if (!r.ok) throw new Error(r.error || "Could not register");
        form.hidden = true;
        done.hidden = false;
        const nameEl = document.getElementById("regName");
        if (nameEl) nameEl.textContent = ", " + payload.name.split(" ")[0];
      } catch (err) {
        btn.textContent = "Try again";
        btn.disabled = false;
        alert("Sorry, we could not send that. " + err.message);
      }
    }, true);
  }

  /* ---------------- Google sign-in ---------------- */
  function loadGoogle() {
    if (!live || !cfg.GOOGLE_CLIENT_ID) return;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = initGoogle;
    document.head.appendChild(s);
  }

  function initGoogle() {
    if (!window.google || !google.accounts) return;
    google.accounts.id.initialize({
      client_id: cfg.GOOGLE_CLIENT_ID,
      callback: async (res) => {
        const r = await apiPost({ action: "login", id_token: res.credential });
        if (!r.ok) return;
        renderPortal(r.data);
      },
    });
    const btn = document.getElementById("googleBtn");
    if (btn) {
      btn.textContent = "Signed in with Google";
      google.accounts.id.renderButton(btn, { theme: "outline", size: "large", text: "continue_with", shape: "pill" });
    }
  }

  function renderPortal(data) {
    const card = document.querySelector(".portal__card");
    if (!card) return;
    const rows = (data.enrolments || []).map((en) => `
      <div class="portal__row">
        <div class="portal__thumb"></div>
        <div><b>${esc(en.course.title)}</b><span>${en.status === "paid" ? "Confirmed" : "Awaiting payment"}</span></div>
        <em>${en.status === "paid" ? "Paid" : "Pending"}</em>
      </div>`).join("");
    card.innerHTML = `
      <div class="portal__card-head"><span>My courses</span><span class="dot"></span></div>
      ${rows || `<div class="portal__row portal__row--muted"><div class="portal__thumb"></div><div><b>No enrolments yet</b><span>Register for a course to begin</span></div><em>—</em></div>`}
      <div class="portal__card-foot">Signed in as <b>${esc(data.user.email)}</b></div>`;
  }

  if (live) {
    loadCourses();
    loadGoogle();
  }
})();
