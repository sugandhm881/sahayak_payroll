# Sahayak Pay Roll

A self-contained tool to generate, download (PDF), and email monthly salary slips
for **any company or organization** from a payroll Excel file. Set your company
name, address and logo right in the app — nothing is hard-coded.

It has two parts:

| File | What it is |
|------|------------|
| `index.html` | The whole app — UI, slip layout, Excel parsing (SheetJS is embedded, no internet needed). Served by `server.js`, or open it directly for PDF-only use. |
| `Start Salary Slip Tool.bat` | **Double-click this to run everything.** Starts the local server and opens the tool at `http://localhost:3001` — no typing. |
| `Stop Salary Slip Tool.bat` | Double-click when you're done to stop the server. |
| `server.js` | A tiny local Node server. It **hosts the app** at `http://localhost:3001` and forwards each email through your mail provider (browsers can't talk to SMTP directly). The launcher starts it for you. |

---

## Quick start — just double-click

You do **not** need to use the terminal.

1. **Double-click `Start Salary Slip Tool.bat`.**
   - The first time, it installs the components automatically (one-time, ~1 min).
   - A small minimized **"Salary Slip Tool"** window appears — that's the local server. Leave it running.
   - Your browser opens the app at `http://localhost:3001` automatically.
2. **Upload your payroll Excel**, pick the staff, then **Download PDF** or **Send Email**.
3. When you're finished for the day, **double-click `Stop Salary Slip Tool.bat`** (or just close the minimized server window).

> **Only making PDFs, not sending email?** You can skip all of the above and just
> double-click **`index.html`** — the server is only needed for the in-app
> **Send Email** button.

> **First-time email setup:** put your Gmail App Password in the `.env` file (see
> [the email section](#sending-slips-by-email-the-relay) below). It's already set up
> on this machine, so the launcher just works.

---

## Using the app (no install needed)

1. Double-click **`index.html`** to open it in your browser (PDF-only), or run the
   server and visit **`http://localhost:3001`** for the full app incl. email.
2. (Optional) Upload the school logo (`lps_logo.png`).
3. Click **Upload Excel** and pick the payroll file.
   Expected columns (auto-detected, order doesn't matter):
   `S.No · Name · Designation · Basic Pay · DA · HRA · TPT · PF · Income Tax · Advance · Net Amount · Email`
4. Select one or more employees from the list.
5. Use the top bar:
   - **Preview** — see the slips on screen.
   - **Download PDF** — saves a PDF file straight to your Downloads (one slip per page).
   - **Send Email** — email each selected employee their slip as a **PDF attachment** (needs the relay below).

That's the entire workflow for printing/saving PDFs. The email relay is optional.

---

## Sending slips by email (the relay)

Email needs the relay running on your computer.

### One-time setup

```sh
npm install
```

(installs `nodemailer`, `express`, `cors`, `dotenv` — listed in `package.json`)

### Easiest: a `.env` file (recommended)

Create a file named `.env` next to `server.js` with your settings, then every
time you just run `npm start` — no need to retype anything.

```ini
# .env  (kept out of git via .gitignore — do not share this file)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=you@gmail.com
EMAIL_PASSWORD=your-16-char-app-password
FROM_NAME=Accounts Department
```

Then:

```sh
npm start
```

You should see `✓ SMTP authenticated`. The relay accepts either `EMAIL_*` or
`SMTP_*` names (see the table below).

> **Gmail note:** use a [Google App Password](https://myaccount.google.com/apppasswords),
> not your normal Google password. App passwords are 16 characters and can be
> revoked any time without changing your real password.

### Alternative: environment variables (no `.env` file)

Set the password in the terminal, then start the relay. The password is **never**
written into any file.

**Windows — PowerShell**
```powershell
$env:SMTP_PASS = "your-mail-password"
npm start
```

**Windows — Command Prompt (cmd)**
```cmd
set SMTP_PASS=your-mail-password
npm start
```

**macOS / Linux**
```sh
export SMTP_PASS="your-mail-password"
npm start
```

Leave that terminal open. You should see `✓ Relay running at http://localhost:3001`
and `✓ SMTP authenticated`. Then in the app:

1. Open the **Email Configuration** tab and confirm the **From Email** (your
   Gmail address), then click **Save Settings**.
2. Click **Test Relay Connection** — it should turn green.
3. Select employees → **Send Email**.

---

## Configuration (environment variables)

All optional except `SMTP_PASS`. Defaults shown.

Can be set in `.env` or as real environment variables. All optional except the
password. Each row shows the accepted names (either works).

| Variable | Default | Notes |
|----------|---------|-------|
| `SMTP_PASS` / `EMAIL_PASSWORD` | _(required)_ | Your mail account password / app password. Relay won't start without it. |
| `SMTP_HOST` / `EMAIL_HOST` | `smtp.gmail.com` | SMTP server. |
| `SMTP_PORT` / `EMAIL_PORT` | `587` | `587` = STARTTLS, `465` = SSL/TLS. |
| `SMTP_USER` / `EMAIL_USER` | `you@gmail.com` | The "From" address you send as. |
| `FROM_NAME` | `Accounts Department` | Display name on outgoing mail. |
| `RELAY_PORT` | `3001` | Port the relay listens on. |
| `RELAY_TOKEN` | _(unset)_ | If set, callers must send header `x-relay-token`. Leave unset for local use. |

Example using a different provider/account:
```powershell
$env:SMTP_HOST = "smtp.gmail.com"
$env:SMTP_USER = "accounts@gmail.com"
$env:SMTP_PASS = "app-password"
npm start
```

---

## No relay? Use your mail app instead

Inside the **Send Email** dialog there's an **Open in Mail App** button. It opens
Outlook / Thunderbird / your default mail client with recipients, subject, and
message pre-filled — no relay or password needed. Note: `mailto:` cannot carry
attachments, so with this option you'd attach the downloaded PDF yourself.

---

## Login & saved data (Supabase)

If `SUPABASE_URL` and `SUPABASE_KEY` are set in `.env`, the tool requires a
**login** and saves your data to Supabase. With those keys absent, the tool runs
open (local-only, nothing saved) — so this is optional.

- **First use:** on the login screen click **Sign up**, enter an email + password
  (min 6 chars). The account is created instantly (no email confirmation) and
  you're logged straight in. Next time, just **Log in**.
- **What's saved:**
  - **Company profile** (`salary_profile`) — company name, address, logo, and
    email/From settings. Loaded automatically when you log in, so you set it once.
  - **Slip history** (`salary_slip_history`) — one row each time you download a
    PDF (`action=pdf`) or email a slip (`action=email`, with sent/failed status).
  - **Email settings** — host, port, From name/address, and the **Gmail App
    Password** you enter under *Email Configuration → Save Settings*. Stored on
    the server (and in `salary_profile`) so email works **even when hosted
    online**, with no `.env` editing. Add the password column support by running
    [`supabase_schema.sql`](supabase_schema.sql) again (it's safe to re-run).
- **Setup:** run [`supabase_schema.sql`](supabase_schema.sql) once in your
  Supabase project's SQL Editor (creates the two tables). The keys are already in
  `.env`. The `service_role` key is used **server-side only** (in `server.js`) and
  is never exposed to the browser; the tables have RLS on so only the server can
  read/write them.
- **Security note:** anyone who can open the page can self-register. For an
  internal machine that's usually fine; to lock it down, remove the
  `SUPABASE_*` keys (disables login + saving) or restrict who can reach the page.

---

## Email deliverability (avoiding spam)

Slips are sent as a **PDF attachment** with a short plain-text message — already
much less spam-prone than a big inline-HTML email. The relay also sets a
`Reply-To`, a matching `From` (the authenticated Gmail account, so Gmail's DKIM
signs it), and a plain-text + HTML body. What still helps:

- **First send:** ask each recipient to mark the first email **“Not spam”** and
  **add the sender to contacts** — this trains their provider and fixes it going
  forward. This is the single most effective step.
- **Keep volume sane:** Gmail allows ~500 messages/day; don't blast hundreds at
  once from a fresh account.
- **Best long-term fix:** send from your **own domain** with SPF, DKIM and DMARC
  DNS records configured. (A plain `@gmail.com` sender is inherently more likely
  to be filtered for bulk mail, even though Gmail signs it.)
- Avoid spammy subject lines (ALL CAPS, “FREE”, lots of `!!!`).

---

## Notes & safety

- The relay is meant to run **locally** on the accounts computer while sending,
  then be stopped. It has no built-in authentication unless you set `RELAY_TOKEN`.
- Your password lives only in the environment of the running terminal — it is not
  saved in `server.js`, the HTML, or the browser.
- All data stays on your machine; nothing is uploaded anywhere except the emails
  you explicitly send.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `SMTP_PASS is not set` on start | Set the env var (see above) in the **same** terminal before `npm start`. |
| `Test Relay Connection` stays red | The relay isn't running, or it's on a different port. Check the terminal for `Relay running`. |
| `SMTP verify failed` | Wrong host/user/password, or your provider blocks the port. Confirm credentials and try port `465`. |
| Emailed slip looks unstyled | Slips are now sent as a **PDF attachment**, not inline HTML — open the attached PDF for a pixel-perfect copy. |
| Emails land in spam | See **Email deliverability** below. The biggest help: recipients mark the first one "Not spam" / add the sender to contacts. |
