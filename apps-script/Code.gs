/**
 * Qalam Ezzi — course platform backend (Google Apps Script)
 *
 * Deploy: Extensions > Apps Script (bound to a Google Sheet), paste this file,
 * set Script Properties:
 *   SHEET_ID        - the spreadsheet id
 *   ADMIN_EMAIL     - who can add courses / see registrations
 *   GOOGLE_CLIENT_ID- OAuth client id used by the website (Google Sign-In)
 * Deploy as Web App: Execute as "Me", access "Anyone". Copy the /exec URL
 * into assets/js/config.js (API_URL).
 */

const SHEETS = {
  courses: "Courses",
  registrations: "Registrations",
  users: "Users",
  lessons: "Lessons",
  payments: "Payments",
};

const HEADERS = {
  courses: ["id", "title", "slug", "description", "start_date", "sessions", "duration", "price", "currency", "status", "zoom_link", "created_at"],
  registrations: ["id", "course_id", "name", "email", "phone", "city", "status", "created_at", "paid_at", "amount", "payment_ref"],
  users: ["email", "name", "picture", "created_at", "last_login"],
  lessons: ["id", "course_id", "title", "video_url", "notes", "sort", "published_at"],
  payments: ["id", "registration_id", "email", "amount", "currency", "gateway", "gateway_ref", "status", "created_at"],
};

/* ------------------------------ helpers ------------------------------ */

function props_() {
  const p = PropertiesService.getScriptProperties();
  return {
    sheetId: p.getProperty("SHEET_ID"),
    admin: (p.getProperty("ADMIN_EMAIL") || "").toLowerCase(),
    clientId: p.getProperty("GOOGLE_CLIENT_ID") || "",
  };
}

function ss_() {
  const id = props_().sheetId;
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function rows_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const head = values[0];
  return values.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => (o[h] = r[i]));
    return o;
  });
}

function append_(name, obj) {
  const sh = sheet_(name);
  const head = sh.getDataRange().getValues()[0] || HEADERS[name];
  const row = head.map((h) => (obj[h] === undefined ? "" : obj[h]));
  sh.appendRow(row);
  return obj;
}

function updateRow_(name, id, patch) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  const head = values[0];
  const idCol = head.indexOf("id");
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][idCol]) === String(id)) {
      Object.keys(patch).forEach((k) => {
        const c = head.indexOf(k);
        if (c > -1) sh.getRange(r + 1, c + 1).setValue(patch[k]);
      });
      return true;
    }
  }
  return false;
}

function uid_(prefix) {
  return prefix + "-" + Utilities.getUuid().slice(0, 8);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ok_(data) { return json_({ ok: true, data: data }); }
function err_(msg, code) { return json_({ ok: false, error: msg, code: code || 400 }); }

/* ------------------------- Google ID token check ------------------------- */

function verifyGoogleToken_(idToken) {
  if (!idToken) return null;
  const res = UrlFetchApp.fetch(
    "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (res.getResponseCode() !== 200) return null;
  const info = JSON.parse(res.getContentText());
  const cfg = props_();
  if (cfg.clientId && info.aud !== cfg.clientId) return null;
  if (!info.email || info.email_verified !== "true") return null;
  return info;
}

function upsertUser_(info) {
  const users = rows_("users");
  const existing = users.find((u) => String(u.email).toLowerCase() === info.email.toLowerCase());
  if (existing) {
    updateRow_("users", existing.email, { last_login: new Date(), name: info.name || existing.name, picture: info.picture || existing.picture });
    return existing;
  }
  return append_("users", {
    email: info.email,
    name: info.name || "",
    picture: info.picture || "",
    created_at: new Date(),
    last_login: new Date(),
  });
}

/* ------------------------------- endpoints ------------------------------- */

function doGet(e) {
  const action = (e.parameter.action || "").trim();
  try {
    if (action === "courses") return listCourses_(e.parameter);
    if (action === "me") return me_(e.parameter);
    if (action === "admin_registrations") return adminRegistrations_(e.parameter);
    return ok_({ service: "qalam-ezzi", time: new Date() });
  } catch (ex) {
    return err_(String(ex.message || ex), 500);
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents || "{}"); } catch (ex) { return err_("bad json"); }
  const action = body.action || "";
  try {
    if (action === "register") return register_(body);
    if (action === "login") return me_({ id_token: body.id_token });
    if (action === "admin_course_save") return adminCourseSave_(body);
    if (action === "payment_webhook") return paymentWebhook_(body);
    return err_("unknown action");
  } catch (ex) {
    return err_(String(ex.message || ex), 500);
  }
}

function listCourses_(p) {
  const all = rows_("courses");
  const live = all.filter((c) => String(c.status || "").toLowerCase() === "live");
  const courses = (p.all === "1" ? all : live).map((c) => ({
    id: c.id, title: c.title, slug: c.slug, description: c.description,
    start_date: c.start_date, sessions: c.sessions, duration: c.duration,
    price: c.price, currency: c.currency, status: c.status,
  }));
  return ok_({ courses: courses });
}

function me_(p) {
  const info = verifyGoogleToken_(p.id_token);
  if (!info) return err_("not signed in", 401);
  upsertUser_(info);

  const regs = rows_("registrations").filter((r) => String(r.email).toLowerCase() === info.email.toLowerCase() && String(r.status) !== "cancelled");
  const courses = rows_("courses");
  const lessons = rows_("lessons");

  const mine = regs.map((r) => {
    const course = courses.find((c) => String(c.id) === String(r.course_id)) || {};
    const paid = String(r.status) === "paid";
    return {
      registration_id: r.id,
      status: r.status,
      course: {
        id: course.id, title: course.title, start_date: course.start_date,
        duration: course.duration, sessions: course.sessions,
      },
      zoom_link: paid ? course.zoom_link : "",
      lessons: paid
        ? lessons.filter((l) => String(l.course_id) === String(r.course_id))
            .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
        : [],
    };
  });

  return ok_({
    user: { email: info.email, name: info.name || "", picture: info.picture || "" },
    enrolments: mine,
  });
}

function register_(body) {
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim();
  const city = String(body.city || "").trim();
  const courseId = String(body.course_id || "").trim();

  if (!name || !email || !phone) return err_("name, email and phone are required");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err_("invalid email");
  if (courseId && !rows_("courses").some((c) => String(c.id) === courseId)) return err_("course not found");

  const regs = rows_("registrations");
  const dupe = regs.find(
    (r) => String(r.email).toLowerCase() === email && String(r.course_id) === courseId && String(r.status) !== "cancelled"
  );
  if (dupe) return ok_({ registration_id: dupe.id, duplicate: true, status: dupe.status });

  const reg = append_("registrations", {
    id: uid_("REG"),
    course_id: courseId,
    name: name,
    email: email,
    phone: phone,
    city: city,
    status: "pending",
    created_at: new Date(),
  });

  MailApp.sendEmail({
    to: email,
    subject: "You are on the list — Qalam Ezzi",
    htmlBody:
      "<p>Dear " + escapeHtml_(name.split(" ")[0]) + ",</p>" +
      "<p>Thank you for registering. Your seat is reserved and we will email your payment link and Zoom details as soon as enrolment opens.</p>" +
      "<p>You can sign in to your student account any time with this Gmail address.</p>" +
      "<p>— Qalam Ezzi</p>",
  });

  const cfg = props_();
  if (cfg.admin) {
    MailApp.sendEmail({
      to: cfg.admin,
      subject: "New registration: " + name,
      body: name + " <" + email + "> " + phone + " — course " + courseId,
    });
  }

  return ok_({ registration_id: reg.id, status: "pending" });
}

function adminRegistrations_(p) {
  const info = verifyGoogleToken_(p.id_token);
  const cfg = props_();
  if (!info || info.email.toLowerCase() !== cfg.admin) return err_("admin only", 403);
  return ok_({ registrations: rows_("registrations") });
}

function adminCourseSave_(body) {
  const info = verifyGoogleToken_(body.id_token);
  const cfg = props_();
  if (!info || info.email.toLowerCase() !== cfg.admin) return err_("admin only", 403);

  const c = body.course || {};
  if (!c.title) return err_("title required");
  const data = {
    title: c.title,
    slug: c.slug || String(c.title).toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    description: c.description || "",
    start_date: c.start_date || "",
    sessions: c.sessions || "",
    duration: c.duration || "",
    price: c.price || "",
    currency: c.currency || "AED",
    status: c.status || "draft",
    zoom_link: c.zoom_link || "",
  };
  if (c.id) {
    updateRow_("courses", c.id, data);
    return ok_({ id: c.id, updated: true });
  }
  data.id = uid_("CRS");
  data.created_at = new Date();
  append_("courses", data);
  return ok_({ id: data.id, created: true });
}

/**
 * Payment gateway webhook (Telr / PayTabs / Network Intl — whichever is chosen).
 * The gateway posts { registration_id, gateway_ref, amount, currency, status }.
 * We mark the registration paid and email the student their Zoom link.
 */
function paymentWebhook_(body) {
  const regs = rows_("registrations");
  const reg = regs.find((r) => String(r.id) === String(body.registration_id));
  if (!reg) return err_("registration not found", 404);

  if (String(body.status).toLowerCase() !== "paid") return ok_({ ignored: true });

  updateRow_("registrations", reg.id, {
    status: "paid",
    paid_at: new Date(),
    amount: body.amount || "",
    payment_ref: body.gateway_ref || "",
  });
  append_("payments", {
    id: uid_("PAY"),
    registration_id: reg.id,
    email: reg.email,
    amount: body.amount || "",
    currency: body.currency || "",
    gateway: body.gateway || "",
    gateway_ref: body.gateway_ref || "",
    status: "paid",
    created_at: new Date(),
  });

  const course = rows_("courses").find((c) => String(c.id) === String(reg.course_id)) || {};
  MailApp.sendEmail({
    to: reg.email,
    subject: "Payment received — your seat is confirmed",
    htmlBody:
      "<p>Dear " + escapeHtml_(String(reg.name).split(" ")[0]) + ",</p>" +
      "<p>Your payment has been received and your seat is confirmed.</p>" +
      "<p><b>" + escapeHtml_(course.title || "") + "</b><br>" +
      (course.start_date ? "Starts: " + course.start_date + "<br>" : "") +
      (course.zoom_link ? "Zoom link: <a href='" + course.zoom_link + "'>" + course.zoom_link + "</a>" : "") +
      "</p><p>Sign in to your account to see your course.</p><p>— Qalam Ezzi</p>",
  });

  return ok_({ confirmed: true });
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* --------------------------- one-time setup --------------------------- */

function setupSheets() {
  Object.keys(SHEETS).forEach((k) => sheet_(SHEETS[k]));
  const courses = rows_("courses");
  if (!courses.length) {
    append_("courses", {
      id: uid_("CRS"),
      title: "Foundations of Arabic Calligraphy",
      slug: "foundations",
      description: "A guided start in the classical scripts: how to hold the qalam, cut the nib, sit, breathe and form the letters.",
      start_date: "TBA",
      sessions: 6,
      duration: "2.5 hours",
      price: "",
      currency: "AED",
      status: "live",
      zoom_link: "",
      created_at: new Date(),
    });
  }
}
