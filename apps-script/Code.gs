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
  progress: "Progress",
  badges: "Badges",
  certificates: "Certificates",
};

const HEADERS = {
  courses: ["id", "title", "slug", "description", "start_date", "sessions", "duration", "price", "currency", "status", "zoom_link", "access_type", "certificate", "created_at"],
  registrations: ["id", "course_id", "name", "email", "phone", "city", "status", "created_at", "paid_at", "amount", "payment_ref"],
  users: ["email", "name", "picture", "created_at", "last_login"],
  lessons: ["id", "course_id", "title", "video_url", "notes", "sort", "published_at", "duration_min"],
  payments: ["id", "registration_id", "email", "amount", "currency", "gateway", "gateway_ref", "status", "created_at"],
  progress: ["email", "course_id", "lesson_id", "completed", "watched_seconds", "updated_at"],
  badges: ["email", "badge", "course_id", "awarded_at"],
  certificates: ["code", "email", "name", "course_id", "course_title", "issued_at", "pdf_url"],
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
    if (action === "course") return courseDetail_(e.parameter);
    if (action === "admin_overview") return adminOverview_(e.parameter);
    if (action === "verify") return verifyCertificate_(e.parameter);
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
    if (action === "lesson_progress") return lessonProgress_(body);
    if (action === "issue_certificate") return issueCertificate_(body);
    if (action === "admin_lesson_save") return adminLessonSave_(body);
    if (action === "admin_mark_paid") return adminMarkPaid_(body);
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

/* --------------------------- LMS: progress --------------------------- */

const BADGES = {
  first_lesson: { label: "First Stroke", note: "Completed your first lesson" },
  half_way: { label: "Halfway", note: "Half of the course finished" },
  course_complete: { label: "Course Complete", note: "Every lesson finished" },
  first_paid: { label: "Committed", note: "Enrolled in a paid course" },
};

function canAccess_(email, course, regs) {
  if (String(course.access_type || "paid").toLowerCase() === "free") return true;
  const reg = regs.find((r) => String(r.email).toLowerCase() === email && String(r.course_id) === String(course.id));
  return !!reg && String(reg.status) === "paid";
}

function publishedLessons_(courseId) {
  return rows_("lessons")
    .filter((l) => String(l.course_id) === String(courseId) && String(l.published_at || "") !== "")
    .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0));
}

function awardBadge_(email, badge, courseId) {
  const all = rows_("badges");
  const has = all.some((b) => String(b.email).toLowerCase() === email && b.badge === badge && String(b.course_id) === String(courseId));
  if (has) return false;
  append_("badges", { email: email, badge: badge, course_id: courseId, awarded_at: new Date() });
  return true;
}

function progressFor_(email, courseId) {
  const done = rows_("progress").filter(
    (p) => String(p.email).toLowerCase() === email && String(p.course_id) === String(courseId) && String(p.completed) === "true"
  );
  return done.map((p) => String(p.lesson_id));
}

function lessonProgress_(body) {
  const info = verifyGoogleToken_(body.id_token);
  if (!info) return err_("not signed in", 401);
  const email = info.email.toLowerCase();

  const course = rows_("courses").find((c) => String(c.id) === String(body.course_id));
  if (!course) return err_("course not found", 404);
  const lesson = rows_("lessons").find((l) => String(l.id) === String(body.lesson_id));
  if (!lesson || String(lesson.course_id) !== String(course.id)) return err_("lesson not found", 404);
  if (!canAccess_(email, course, rows_("registrations"))) return err_("not enrolled", 403);

  const completed = body.completed === true || String(body.completed) === "true";
  const all = rows_("progress");
  const existing = all.find((p) => String(p.email).toLowerCase() === email && String(p.lesson_id) === String(lesson.id));
  if (existing) {
    updateRow_("progress", existing.lesson_id, {
      completed: completed,
      watched_seconds: body.watched_seconds || existing.watched_seconds || 0,
      updated_at: new Date(),
    });
  } else {
    append_("progress", {
      email: email,
      course_id: course.id,
      lesson_id: lesson.id,
      completed: completed,
      watched_seconds: body.watched_seconds || 0,
      updated_at: new Date(),
    });
  }

  const total = publishedLessons_(course.id).length;
  const done = progressFor_(email, course.id).length;
  const earned = [];
  if (done > 0 && awardBadge_(email, "first_lesson", course.id)) earned.push(BADGES.first_lesson);
  if (total && done / total >= 0.5 && awardBadge_(email, "half_way", course.id)) earned.push(BADGES.half_way);
  if (total && done >= total && awardBadge_(email, "course_complete", course.id)) earned.push(BADGES.course_complete);

  return ok_({ completed: done, total: total, percent: total ? Math.round((done / total) * 100) : 0, badges_earned: earned });
}

/* --------------------------- LMS: certificate --------------------------- */

function issueCertificate_(body) {
  const info = verifyGoogleToken_(body.id_token);
  if (!info) return err_("not signed in", 401);
  const email = info.email.toLowerCase();

  const course = rows_("courses").find((c) => String(c.id) === String(body.course_id));
  if (!course) return err_("course not found", 404);
  if (String(course.certificate || "") === "false") return err_("this course does not offer a certificate", 400);
  if (!canAccess_(email, course, rows_("registrations"))) return err_("not enrolled", 403);

  const lessons = publishedLessons_(course.id);
  const done = progressFor_(email, course.id);
  if (!lessons.length || done.length < lessons.length) return err_("finish every lesson first", 400);

  const existing = rows_("certificates").find((c) => String(c.email).toLowerCase() === email && String(c.course_id) === String(course.id));
  if (existing) return ok_({ code: existing.code, url: existing.pdf_url, existing: true });

  const code = "QE-" + new Date().getFullYear() + "-" + Utilities.getUuid().replace(/-/g, "").slice(0, 6).toUpperCase();
  const name = info.name || email;

  const doc = DocumentApp.create("Certificate " + code + " — " + name);
  const b = doc.getBody();
  b.setMarginTop(90).setMarginBottom(90).setMarginLeft(90).setMarginRight(90);
  b.clear();
  b.appendParagraph("QALAM EZZI").setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(14).setBold(true);
  b.appendParagraph("Certificate of Completion").setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(30);
  b.appendParagraph("\n");
  b.appendParagraph("This certifies that").setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(12);
  b.appendParagraph(name).setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(26).setBold(true);
  b.appendParagraph("has completed the course").setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(12);
  b.appendParagraph(String(course.title)).setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(18);
  b.appendParagraph("\n");
  b.appendParagraph(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "d MMMM yyyy"))
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(12);
  b.appendParagraph("\nVerify: " + code).setAlignment(DocumentApp.HorizontalAlignment.CENTER).editAsText().setFontFamily("Georgia").setFontSize(10);
  doc.saveAndClose();

  const file = DriveApp.getFileById(doc.getId());
  const pdf = file.getAs(MimeType.PDF);
  const pdfFile = DriveApp.createFile(pdf).setName("Qalam Ezzi Certificate — " + name + " — " + code + ".pdf");
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  file.setTrashed(true);

  append_("certificates", {
    code: code,
    email: email,
    name: name,
    course_id: course.id,
    course_title: course.title,
    issued_at: new Date(),
    pdf_url: pdfFile.getUrl(),
  });

  MailApp.sendEmail({
    to: email,
    subject: "Your certificate — " + course.title,
    htmlBody:
      "<p>Dear " + escapeHtml_(String(name).split(" ")[0]) + ",</p>" +
      "<p>Congratulations — you have completed <b>" + escapeHtml_(course.title) + "</b>.</p>" +
      "<p><a href='" + pdfFile.getUrl() + "'>Download your certificate</a><br>Share it with code <b>" + code + "</b>.</p>" +
      "<p>— Qalam Ezzi</p>",
  });

  return ok_({ code: code, url: pdfFile.getUrl() });
}

function verifyCertificate_(p) {
  const code = String(p.code || "").trim().toUpperCase();
  if (!code) return err_("code required");
  const c = rows_("certificates").find((x) => String(x.code).toUpperCase() === code);
  if (!c) return err_("certificate not found", 404);
  return ok_({ code: c.code, name: c.name, course: c.course_title, issued_at: c.issued_at, valid: true });
}

function escapeHtml_(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* --------------------------- LMS: course page --------------------------- */

function courseDetail_(p) {
  const info = verifyGoogleToken_(p.id_token);
  if (!info) return err_("not signed in", 401);
  const email = info.email.toLowerCase();

  const course = rows_("courses").find((c) => String(c.id) === String(p.id));
  if (!course) return err_("course not found", 404);

  const regs = rows_("registrations");
  const reg = regs.find((r) => String(r.email).toLowerCase() === email && String(r.course_id) === String(course.id));
  const access = canAccess_(email, course, regs);
  const done = progressFor_(email, course.id);

  const lessons = publishedLessons_(course.id).map((l) => ({
    id: l.id,
    title: l.title,
    sort: l.sort,
    duration_min: l.duration_min || "",
    video_url: access ? l.video_url : "",
    notes: access ? l.notes : "",
    completed: done.indexOf(String(l.id)) > -1,
  }));

  const cert = rows_("certificates").find((c) => String(c.email).toLowerCase() === email && String(c.course_id) === String(course.id));

  return ok_({
    course: {
      id: course.id, title: course.title, description: course.description,
      start_date: course.start_date, duration: course.duration, sessions: course.sessions,
      price: course.price, currency: course.currency, access_type: course.access_type || "paid",
      zoom_link: access ? course.zoom_link : "",
    },
    access: access,
    status: reg ? reg.status : "none",
    lessons: lessons,
    completed: done.length,
    certificate: cert ? { code: cert.code, url: cert.pdf_url } : null,
    badges: rows_("badges").filter((b) => String(b.email).toLowerCase() === email && String(b.course_id) === String(course.id)),
  });
}

/* --------------------------- admin panel --------------------------- */

function requireAdmin_(idToken) {
  const info = verifyGoogleToken_(idToken);
  const cfg = props_();
  if (!info) return { error: err_("not signed in", 401) };
  if (!cfg.admin || info.email.toLowerCase() !== cfg.admin) return { error: err_("admin only", 403) };
  return { info: info };
}

function adminOverview_(p) {
  const gate = requireAdmin_(p.id_token);
  if (gate.error) return gate.error;

  const regs = rows_("registrations");
  const paid = regs.filter((r) => String(r.status) === "paid");
  return ok_({
    admin: gate.info.email,
    courses: rows_("courses").map((c) => ({
      id: c.id, title: c.title, status: c.status, price: c.price, currency: c.currency,
      start_date: c.start_date, access_type: c.access_type || "paid", certificate: c.certificate || "",
      lessons: publishedLessons_(c.id).length,
      registrations: regs.filter((r) => String(r.course_id) === String(c.id)).length,
    })),
    registrations: regs.slice().reverse().slice(0, 100),
    lessons: rows_("lessons").map((l) => ({ id: l.id, course_id: l.course_id, title: l.title, sort: l.sort, published_at: l.published_at, video_url: l.video_url })),
    stats: {
      registrations: regs.length,
      paid: paid.length,
      revenue: paid.reduce((s, r) => s + Number(r.amount || 0), 0),
      students: rows_("users").length,
      certificates: rows_("certificates").length,
    },
  });
}

function adminLessonSave_(body) {
  const gate = requireAdmin_(body.id_token);
  if (gate.error) return gate.error;

  const l = body.lesson || {};
  if (!l.course_id || !l.title) return err_("course and title required");
  const data = {
    course_id: l.course_id,
    title: l.title,
    video_url: l.video_url || "",
    notes: l.notes || "",
    sort: l.sort || 0,
    duration_min: l.duration_min || "",
    published_at: l.published === false ? "" : (l.published_at || new Date()),
  };
  if (l.id) {
    updateRow_("lessons", l.id, data);
    return ok_({ id: l.id, updated: true });
  }
  data.id = uid_("LSN");
  append_("lessons", data);
  return ok_({ id: data.id, created: true });
}

function adminMarkPaid_(body) {
  const gate = requireAdmin_(body.id_token);
  if (gate.error) return gate.error;

  const reg = rows_("registrations").find((r) => String(r.id) === String(body.registration_id));
  if (!reg) return err_("registration not found", 404);
  const course = rows_("courses").find((c) => String(c.id) === String(reg.course_id)) || {};

  updateRow_("registrations", reg.id, {
    status: "paid",
    paid_at: new Date(),
    amount: body.amount || course.price || "",
    payment_ref: body.payment_ref || "manual",
  });
  awardBadge_(String(reg.email).toLowerCase(), "first_paid", reg.course_id);

  MailApp.sendEmail({
    to: reg.email,
    subject: "Seat confirmed — " + (course.title || "your course"),
    htmlBody:
      "<p>Dear " + escapeHtml_(String(reg.name).split(" ")[0]) + ",</p>" +
      "<p>Your seat is confirmed for <b>" + escapeHtml_(course.title || "") + "</b>.</p>" +
      (course.start_date ? "<p>Starts: " + escapeHtml_(course.start_date) + "</p>" : "") +
      (course.zoom_link ? "<p>Zoom: <a href='" + course.zoom_link + "'>" + course.zoom_link + "</a></p>" : "") +
      "<p>Sign in on the site to open your lessons.</p><p>— Qalam Ezzi</p>",
  });

  return ok_({ registration_id: reg.id, status: "paid" });
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
      access_type: "paid",
      certificate: "true",
      created_at: new Date(),
    });
  }
}
