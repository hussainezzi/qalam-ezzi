# Qalam Ezzi — backend setup (10 minutes, one Google account)

The site is static. The backend is a Google Apps Script Web App + one Google Sheet.

## 1. Create the sheet
1. With the Qalam Ezzi Google account, create a new Sheet: **Qalam Ezzi — Data**.
2. Extensions → Apps Script.
3. Delete the default `Code.gs` and paste `apps-script/Code.gs`.
4. Run `setupSheets` once (authorise when asked). It creates tabs:
   `Courses`, `Registrations`, `Users`, `Lessons`, `Payments` and one live course.

## 2. Script properties
Project Settings → Script properties:

| Key | Value |
|---|---|
| `SHEET_ID` | id from the sheet URL (`/d/<id>/edit`) |
| `ADMIN_EMAIL` | the owner's Gmail (can add courses, see registrations) |
| `GOOGLE_CLIENT_ID` | from step 4 |

## 3. Deploy
Deploy → New deployment → Web app
- Execute as: **Me**
- Who has access: **Anyone**
Copy the `/exec` URL.

## 4. Google Sign-In (student accounts)
1. console.cloud.google.com → new project (or reuse).
2. APIs & Services → OAuth consent screen → External → add the site domain.
3. Credentials → Create credentials → OAuth client ID → **Web application**.
4. Authorised JavaScript origins: `https://hussainezzi.github.io` (and the final domain).
5. Copy the client id into Script properties **and** into `assets/js/config.js`.

## 5. Point the site at the backend
`assets/js/config.js`:
```js
window.QALAM_CONFIG = {
  API_URL: "https://script.google.com/macros/s/XXXX/exec",
  GOOGLE_CLIENT_ID: "XXXX.apps.googleusercontent.com",
};
```
Commit and push. The static demo card is replaced by live courses.

## 6. Add a course
Edit the **Courses** tab directly (or POST `admin_course_save` with an admin ID token).
Set `status = live` and it appears on the site. Leave `zoom_link` empty until the class is confirmed.

## 7. Payments (when the gateway arrives)
The gateway calls the web app with:
```json
{ "action": "payment_webhook", "registration_id": "REG-xxxx",
  "gateway": "telr", "gateway_ref": "…", "amount": 350, "currency": "AED", "status": "paid" }
```
That marks the registration paid and emails the student the Zoom link. Keep the gateway secret in
Script properties and verify the signature inside `paymentWebhook_` before trusting the call.

## Notes / limits
- Apps Script: ~20k requests/day, 1–2 s cold start, 6 min per execution. Fine for a first cohort; move to a real DB at scale.
- Never store passwords or card numbers. Accounts are Gmail identities; payments are hosted by the gateway.
- Recordings: put the (unlisted) video link in the **Lessons** tab; only paid students see it through `me_`.
