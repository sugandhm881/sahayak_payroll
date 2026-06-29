// server.js — Salary Slip SMTP Relay
// ─────────────────────────────────────────────────────────────
// Browsers cannot talk to SMTP servers directly, so this small
// Node.js service accepts requests from the Salary Slip Generator
// page and forwards each email through your mail provider.
//
//   1. Save this file as server.js
//   2. Install deps:   npm install nodemailer express cors
//   3. Set your password (it is NEVER hardcoded in this file):
//        Windows (PowerShell):  $env:SMTP_PASS = "your-mail-password"
//        Windows (cmd):         set SMTP_PASS=your-mail-password
//        macOS / Linux:         export SMTP_PASS="your-mail-password"
//   4. Start it:        node server.js
//   5. Keep this terminal open while sending emails.
//
// Optional environment overrides (defaults shown):
//   SMTP_HOST   = smtp.gmail.com
//   SMTP_PORT   = 587            (587 = STARTTLS, 465 = SSL/TLS)
//   SMTP_USER   = you@gmail.com
//   FROM_NAME   = Accounts Department
//   RELAY_PORT  = 3001
//   RELAY_TOKEN = (if set, callers must send header x-relay-token)
// ─────────────────────────────────────────────────────────────

// Load variables from a local .env file if present (optional).
try { require('dotenv').config(); } catch (_) { /* dotenv not installed — env vars only */ }

const express    = require('express');
const nodemailer = require('nodemailer');
const cors       = require('cors');
const path       = require('path');

const env = process.env;
// Folder that holds index.html and the static assets. On Vercel (serverless)
// the included files sit at the deployment root (process.cwd()); locally they
// sit next to this file (__dirname).
const ROOT = env.VERCEL ? process.cwd() : __dirname;

// ── Configuration ──
// Read from environment / .env. Both naming styles are accepted:
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS   (preferred)
//   EMAIL_HOST / EMAIL_PORT / EMAIL_USER / EMAIL_PASSWORD
const CONFIG = {
  host:      env.SMTP_HOST || env.EMAIL_HOST || 'smtp.gmail.com',
  port:      Number(env.SMTP_PORT || env.EMAIL_PORT) || 587,
  user:      env.SMTP_USER || env.EMAIL_USER || 'you@gmail.com',
  pass:      env.SMTP_PASS || env.EMAIL_PASSWORD || env.EMAIL_PASS || '',
  fromName:  env.FROM_NAME || 'Accounts Department',
  relayPort: Number(env.RELAY_PORT) || 3001,
  token:     env.RELAY_TOKEN || ''   // optional shared secret
};

// ── Supabase (login/signup + saving profile & slip history) ──
// Uses the service_role key from .env — server-side ONLY, never sent to the
// browser. Auth and data endpoints below are gated on this being configured.
const SB = {
  url: (env.SUPABASE_URL || '').replace(/\/+$/, ''),
  key: env.SUPABASE_KEY || env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_ROLE || ''
};
const sbReady = !!(SB.url && SB.key);

// Thin helper around the Supabase REST / Auth API.
async function sb(path, opts = {}) {
  const headers = Object.assign(
    { apikey: SB.key, Authorization: 'Bearer ' + SB.key, 'Content-Type': 'application/json' },
    opts.headers || {}
  );
  const r = await fetch(SB.url + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  const txt = await r.text();
  try { data = txt ? JSON.parse(txt) : null; } catch (_) { data = txt; }
  return { ok: r.ok, status: r.status, data };
}
function sbErr(out, fallback) {
  const d = out && out.data;
  return (d && (d.msg || d.error_description || d.message || d.error)) || fallback;
}

// Require a valid Supabase session (Bearer token) on protected endpoints.
// If Supabase isn't configured, the tool runs open (local-only mode).
async function requireAuth(req, res, next) {
  if (!sbReady) return next();
  const h = req.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return res.status(401).json({ ok: false, error: 'Not logged in' });
  try {
    const r = await fetch(SB.url + '/auth/v1/user', { headers: { apikey: SB.key, Authorization: 'Bearer ' + token } });
    if (!r.ok) return res.status(401).json({ ok: false, error: 'Session expired — please log in again' });
    req.user = await r.json().catch(() => null);
    next();
  } catch (e) {
    res.status(503).json({ ok: false, error: 'Auth check failed: ' + e.message });
  }
}

// Port 465 implies implicit TLS; 587/25 use STARTTLS.
const secure = CONFIG.port === 465;

// Live mail settings — start from .env, but can be updated at runtime from the
// app's Email Configuration tab (saved to Supabase). This lets the tool run
// online/hosted where you can't set environment variables on each machine.
const mailCfg = {
  host: CONFIG.host, port: CONFIG.port, user: CONFIG.user,
  pass: CONFIG.pass, fromName: CONFIG.fromName
};
let transporter = buildTransport();
function buildTransport() {
  return nodemailer.createTransport({
    host: mailCfg.host,
    port: mailCfg.port,
    secure: mailCfg.port === 465,            // 465 = implicit TLS, else STARTTLS
    auth: { user: mailCfg.user, pass: mailCfg.pass }
  });
}
function mailReady() { return !!(mailCfg.user && mailCfg.pass); }

// ── Per-user mailers (multi-tenant) ──
// Each logged-in user sends with the SMTP credentials saved in their own
// salary_profile row. Falls back to the global .env mailer if they haven't set
// their own. Cached per user; invalidated when they save new settings.
const userMailers = new Map();   // user_id -> { cfg, transporter } | null
function makeTransport(cfg) {
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }
  });
}
async function getUserMailer(uid) {
  if (userMailers.has(uid)) return userMailers.get(uid);
  let m = null;
  if (sbReady && uid) {
    const out = await sb('/rest/v1/salary_profile?user_id=eq.' + uid + '&select=*');
    const p = out.ok && Array.isArray(out.data) ? out.data[0] : null;
    if (p && p.smtp_pass && (p.smtp_user || p.from_email)) {
      const cfg = {
        host: p.smtp_host || 'smtp.gmail.com', port: p.smtp_port || 587,
        user: p.smtp_user || p.from_email, pass: p.smtp_pass,
        fromName: p.from_name || 'Accounts Department'
      };
      m = { cfg, transporter: makeTransport(cfg) };
    }
  }
  if (!m && mailReady()) m = { cfg: { ...mailCfg }, transporter };   // global .env fallback
  userMailers.set(uid, m);
  return m;
}

if (!CONFIG.pass) {
  console.warn('\n⚠ No mail password in .env. Email sending is disabled until you set');
  console.warn('  the Gmail App Password in the app (Email Configuration → Save Settings),');
  console.warn('  or set SMTP_PASS / EMAIL_PASSWORD in .env and restart.\n');
}

const app = express();
app.use(cors({ origin: true }));            // reflect caller origin; relay is local-only
app.use(express.json({ limit: '15mb' }));   // room for base64 PDF attachments & logos

// Reject oversized/invalid bodies cleanly instead of crashing.
app.use((err, _req, res, next) => {
  if (err) return res.status(400).json({ ok: false, error: 'Invalid request body' });
  next();
});

// Optional shared-secret check (only enforced when RELAY_TOKEN is set).
function authorized(req) {
  if (!CONFIG.token) return true;
  return req.get('x-relay-token') === CONFIG.token;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Serve the Salary Slip Generator app itself, so the whole tool runs from a
// single place: start this relay and open http://localhost:<port> in a browser.
// The page and the /send + /health endpoints are then same-origin.
app.get('/', (_req, res) => {
  res.sendFile(path.join(ROOT, 'index.html'));
});

// Static assets the page needs (logo + the PDF/Excel libraries). Listed
// explicitly so source files like .env and server.js are never served.
['/lps_logo.png', '/sayahak_logo.png', '/sayahak_logo_2.5.png', '/jspdf.umd.min.js', '/html2canvas.min.js'].forEach(file => {
  app.get(file, (_req, res) => {
    res.sendFile(path.join(ROOT, file.slice(1)), err => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
});

// Health check — used by the page's "Test Relay Connection" button and to tell
// the page whether login is required (auth = Supabase configured).
app.get('/health', (_req, res) => {
  res.json({ ok: true, host: mailCfg.host, port: mailCfg.port, user: mailCfg.user, auth: sbReady, mailReady: mailReady() });
});

// ── Auth: sign up & log in (Supabase) ──
// Sign up creates an already-confirmed user via the admin API (no email
// confirmation step needed for this internal tool), then logs them in.
app.post('/auth/signup', async (req, res) => {
  if (!sbReady) return res.status(500).json({ ok: false, error: 'Login is not configured (no Supabase in .env)' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  const made = await sb('/auth/v1/admin/users', { method: 'POST', body: { email, password, email_confirm: true } });
  if (!made.ok) return res.status(made.status || 400).json({ ok: false, error: sbErr(made, 'Sign up failed') });
  return loginAndRespond(email, password, res);
});

app.post('/auth/login', async (req, res) => {
  if (!sbReady) return res.status(500).json({ ok: false, error: 'Login is not configured (no Supabase in .env)' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ ok: false, error: 'Email and password are required' });
  return loginAndRespond(email, password, res);
});

async function loginAndRespond(email, password, res) {
  const out = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password } });
  if (!out.ok) return res.status(401).json({ ok: false, error: sbErr(out, 'Invalid email or password') });
  res.json({ ok: true, access_token: out.data.access_token, email: out.data.user && out.data.user.email });
}

// ── Data: company profile (one row PER USER) ──
app.get('/api/profile', requireAuth, async (req, res) => {
  const uid = req.user && req.user.id;
  const out = await sb('/rest/v1/salary_profile?user_id=eq.' + uid + '&select=*');
  if (!out.ok) return res.status(out.status).json({ ok: false, error: sbErr(out, 'Could not load profile') });
  res.json({ ok: true, profile: Array.isArray(out.data) ? out.data[0] || null : null });
});

app.post('/api/profile', requireAuth, async (req, res) => {
  const uid = req.user && req.user.id;
  const b = req.body || {};
  const row = {
    company_name: b.company_name, company_address: b.company_address, logo_data_url: b.logo_data_url,
    from_name: b.from_name, from_email: b.from_email, smtp_host: b.smtp_host,
    smtp_port: b.smtp_port, currency_symbol: b.currency_symbol
  };
  Object.keys(row).forEach(k => row[k] === undefined && delete row[k]);
  row.user_id = uid;   // owner + upsert conflict target
  // Upsert this user's profile (insert first time, update thereafter).
  const out = await sb('/rest/v1/salary_profile?on_conflict=user_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: [row]
  });
  if (!out.ok) return res.status(out.status).json({ ok: false, error: sbErr(out, 'Could not save profile') });
  res.json({ ok: true, profile: Array.isArray(out.data) ? out.data[0] : out.data });
});

// ── Data: slip history (audit log, PER USER) ──
app.get('/api/history', requireAuth, async (req, res) => {
  const uid = req.user && req.user.id;
  const out = await sb('/rest/v1/salary_slip_history?user_id=eq.' + uid + '&select=*&order=created_at.desc&limit=300');
  if (!out.ok) return res.status(out.status).json({ ok: false, error: sbErr(out, 'Could not load history') });
  res.json({ ok: true, history: out.data || [] });
});

app.post('/api/history', requireAuth, async (req, res) => {
  const uid = req.user && req.user.id;
  const rows = (Array.isArray(req.body) ? req.body : [req.body]).map(r => Object.assign({}, r, { user_id: uid }));
  if (!rows.length) return res.json({ ok: true, inserted: 0 });
  const out = await sb('/rest/v1/salary_slip_history', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: rows });
  if (!out.ok) return res.status(out.status).json({ ok: false, error: sbErr(out, 'Could not save history') });
  res.json({ ok: true, inserted: rows.length });
});

// ── Email settings: set the Gmail App Password from the app (for online use) ──
// Updates the live transporter and (if Supabase is configured) saves the
// credentials to salary_profile so they persist across restarts.
app.get('/api/smtp', requireAuth, async (req, res) => {
  const m = await getUserMailer(req.user && req.user.id);
  if (m) return res.json({ ok: true, host: m.cfg.host, port: m.cfg.port, user: m.cfg.user, fromName: m.cfg.fromName, hasPassword: !!m.cfg.pass });
  res.json({ ok: true, host: mailCfg.host, port: mailCfg.port, user: mailCfg.user, fromName: mailCfg.fromName, hasPassword: false });
});
app.post('/api/smtp', requireAuth, async (req, res) => {
  const uid = req.user && req.user.id;
  const b = req.body || {};
  // Base on the user's current settings (or sensible defaults).
  const cur = await getUserMailer(uid);
  const cfg = Object.assign({ host: 'smtp.gmail.com', port: 587, user: '', pass: '', fromName: 'Accounts Department' }, cur ? cur.cfg : {});
  if (b.host) cfg.host = String(b.host).trim();
  if (b.port) cfg.port = Number(b.port) || cfg.port;
  if (b.user) cfg.user = String(b.user).trim();
  if (b.fromName) cfg.fromName = String(b.fromName).trim();
  if (b.pass) cfg.pass = String(b.pass);          // only change when a new password is provided
  // Persist to THIS user's profile (upsert). smtp_user/smtp_pass are optional
  // columns — fall back to the safe fields if they don't exist yet.
  const row = { user_id: uid, smtp_host: cfg.host, smtp_port: cfg.port, smtp_user: cfg.user, from_email: cfg.user, from_name: cfg.fromName };
  if (b.pass) row.smtp_pass = cfg.pass;
  let out = await sb('/rest/v1/salary_profile?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [row] });
  if (!out.ok) {
    const safe = { user_id: uid, smtp_host: cfg.host, smtp_port: cfg.port, from_email: cfg.user, from_name: cfg.fromName };
    await sb('/rest/v1/salary_profile?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: [safe] }).catch(() => {});
  }
  // Update this user's cached mailer and verify the login.
  const tr = makeTransport(cfg);
  userMailers.set(uid, { cfg, transporter: tr });
  try { await tr.verify(); res.json({ ok: true, verified: true, hasPassword: !!cfg.pass }); }
  catch (err) { res.json({ ok: true, verified: false, hasPassword: !!cfg.pass, error: err.message }); }
});

app.post('/send', requireAuth, async (req, res) => {
  if (!authorized(req))
    return res.status(401).json({ ok: false, error: 'Unauthorized' });

  const { to, subject, text, html, fromName, from, filename, pdfBase64 } = req.body || {};

  const m = await getUserMailer(req.user && req.user.id);
  if (!m)
    return res.status(400).json({ ok: false, error: 'Email password not set — open Email Configuration and save your Gmail App Password.' });
  if (!to || !subject || (!text && !html && !pdfBase64))
    return res.status(400).json({ ok: false, error: 'Missing fields: need to, subject, and one of text/html/pdfBase64' });
  if (!EMAIL_RE.test(String(to)))
    return res.status(400).json({ ok: false, error: `Invalid recipient address: ${to}` });

  // Build the message. We send as a normal transactional mail: a plain-text
  // body (+ a simple HTML alternative) and the salary slip as a PDF attachment.
  // Plain text + attachment is far less likely to be marked as spam than a
  // large inline-HTML document.
  const bodyText = text || (html ? html.replace(/<[^>]+>/g, ' ') : subject);
  const bodyHtml = html || textToHtml(bodyText);
  // Reply-To: prefer a real monitored address (the configured "from" the user
  // entered, else the authenticated account). Helps recipients reply and
  // improves deliverability/trust.
  const replyTo = (from && EMAIL_RE.test(String(from))) ? from : m.cfg.user;

  const mail = {
    from: `"${fromName || m.cfg.fromName}" <${m.cfg.user}>`,  // must match the authenticated account (DKIM/SPF alignment)
    to,
    replyTo,
    subject,
    text: bodyText,
    html: bodyHtml
  };
  if (pdfBase64) {
    mail.attachments = [{
      filename: (filename || 'Salary Slip.pdf').replace(/[\\/:*?"<>|]/g, ''),
      content: Buffer.from(String(pdfBase64), 'base64'),
      contentType: 'application/pdf'
    }];
  }

  try {
    const info = await m.transporter.sendMail(mail);
    console.log('✓ Sent to', to, '·', info.messageId);
    res.json({ ok: true, messageId: info.messageId });
  } catch (err) {
    console.error('✗ Error sending to', to, '·', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// Minimal, safe text -> HTML for the alternative body part.
function textToHtml(t) {
  const esc = String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.5;white-space:pre-wrap">'
    + esc + '</div>';
}

// Open a URL in the default browser, cross-platform. Best-effort: a failure
// here never stops the server — the user can always open the URL manually.
function openBrowser(url) {
  const { spawn } = require('child_process');
  const p = process.platform;
  const cmd = p === 'win32' ? 'cmd'   : p === 'darwin' ? 'open' : 'xdg-open';
  const args = p === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch (_) { /* ignore — open manually */ }
}

// ── Start the HTTP server ONLY when run directly (local: `npm start`). ──
// On Vercel the app is imported as a serverless handler (see api/index.js),
// so we must NOT call app.listen() there — we just export `app`.
if (require.main === module) {
  if (mailReady()) {
    transporter.verify()
      .then(() => console.log('✓ Fallback SMTP authenticated with', mailCfg.host, 'as', mailCfg.user))
      .catch(err => console.warn('⚠ Fallback SMTP verify failed:', err.message, '\n  (users with their own email settings are unaffected)'));
  } else {
    console.warn('⚠ No fallback email password in .env — each user must set their own in Email Configuration.');
  }

  app.listen(CONFIG.relayPort, () => {
    const url = `http://localhost:${CONFIG.relayPort}`;
    console.log(`\n✓ Sahayak Pay Roll running`);
    console.log(`  Open  : ${url}  (the app + email engine)`);
    console.log(`  Email : ${mailReady() ? mailCfg.fromName + ' <' + mailCfg.user + '>' : 'password not set — add it in the app'}`);
    console.log(`  Login : ${sbReady ? 'enabled (Supabase) — sign up / log in to use' : 'disabled (no Supabase in .env)'}`);
    console.log(`  Data  : ${sbReady ? 'profile, history & email settings saved to Supabase' : 'not saved (no Supabase in .env)'}\n`);

    // Open the app in the default browser so `npm start` is one step.
    // Set NO_OPEN=1 to skip (e.g. on a headless server).
    if (!env.NO_OPEN) openBrowser(url);
  });
}

// Export the Express app so Vercel (api/index.js) can use it as the handler.
module.exports = app;
