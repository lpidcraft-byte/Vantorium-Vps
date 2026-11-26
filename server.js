const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-prod-' + Date.now();

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ================= AUTH =================
function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    const u = db.db.users.get(p.id);
    if (!u) return res.status(401).json({ error: 'User not found' });
    req.user = u;
    next();
  } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ---------- AUTH ENDPOINTS ----------
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) return res.status(400).json({ error: 'username, email, password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username 3-20 alphanumeric/underscore' });
    const user = await db.createUser({ username, email, password });
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username, password required' });
  const user = db.findUserByUsername(username) || db.findUserByEmail(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await db.verifyPassword(user, password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: signToken(user), user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({ user: { id: req.user.id, username: req.user.username, email: req.user.email, role: req.user.role, createdAt: req.user.createdAt } });
});

// ================= UPLOAD =================
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function maskToken(t) {
  if (!t) return null;
  const [id, secret] = t.split(':');
  if (!secret) return t.slice(0, 8) + '••••';
  return `${id}:${secret.slice(0, 4)}••••••••${secret.slice(-3)}`;
}

async function verifyTelegramToken(token) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10000 });
    const d = await r.json();
    if (!d.ok) return { ok: false, error: d.description };
    return { ok: true, botId: String(d.result.id), username: d.result.username, firstName: d.result.first_name };
  } catch (e) { return { ok: false, error: 'Telegram unreachable' }; }
}

app.post('/api/bots/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file' });
    let zip;
    try { zip = new AdmZip(req.file.buffer); } catch { return res.status(400).json({ error: 'Invalid zip' }); }
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const fileTree = entries.map(e => ({ name: e.entryName, size: e.header.size }));

    // Token: formdan veya dosyalardan
    let token = req.body.botToken?.trim() || null;
    if (!token) {
      const re = /(\d{8,10}:[A-Za-z0-9_-]{35})/;
      for (const e of entries) {
        if (/\.(env|py|js|json|txt|cfg|ini)$/i.test(e.entryName)) {
          const m = e.getData().toString('utf8').match(re);
          if (m) { token = m[1]; break; }
        }
      }
    }
    if (!token) return res.status(400).json({ error: 'Telegram bot token not found' });

    const bot = db.createBot({
      userId: req.user.id,
      name: 'Pending',
      username: null,
      telegramBotId: null,
      telegramPhotoUrl: null,
      encryptedToken: token,
      runtime: req.body.runtime || 'python',
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileCount: entries.length,
      fileTree,
      fileBuffer: req.file.buffer,
      status: 'ANALYZING'
    });

    db.updateBot(bot.id, { status: 'VERIFYING' });
    const v = await verifyTelegramToken(token);
    if (!v.ok) {
      db.updateBot(bot.id, { status: 'REJECTED', rejectionReason: 'Token verification failed: ' + v.error, reviewedAt: new Date().toISOString() });
      return res.status(400).json({ error: 'Token invalid: ' + v.error });
    }

    // Avatar
    let photoUrl = null;
    try {
      const p = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${v.botId}&limit=1`).then(r => r.json());
      if (p.ok && p.result.total_count > 0) {
        const fid = p.result.photos[0][0].file_id;
        const fi = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fid}`).then(r => r.json());
        if (fi.ok) photoUrl = `https://api.telegram.org/file/bot${token}/${fi.result.file_path}`;
      }
    } catch {}

    db.updateBot(bot.id, {
      name: v.firstName, username: v.username, telegramBotId: v.botId,
      telegramPhotoUrl: photoUrl, status: 'PENDING_APPROVAL'
    });

    db.audit({ action: 'BOT_SUBMITTED', targetId: bot.id, userId: req.user.id, ip: req.ip });
    res.json({ ok: true, bot: publicBot(bot) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

function publicBot(b) {
  const { encryptedToken, fileBuffer, ...r } = b;
  return r;
}

// Kullanıcı botları
app.get('/api/bots', auth, (req, res) => {
  res.json({ bots: db.listUserBots(req.user.id).map(publicBot) });
});

// Bildirimler
app.get('/api/notifications', auth, (req, res) => {
  res.json({ notifications: db.listNotifs(req.user.id) });
});
app.post('/api/notifications/:id/read', auth, (req, res) => {
  const list = db.listNotifs(req.user.id);
  const n = list.find(x => x.id === req.params.id);
  if (n) n.read = true;
  res.json({ ok: true });
});

// ================= ADMIN =================
app.get('/api/admin/stats', auth, requireAdmin, (req, res) => {
  res.json({ stats: db.stats() });
});

app.get('/api/admin/approvals', auth, requireAdmin, (req, res) => {
  const f = req.query.status;
  let bots = !f || f === 'ALL' ? db.listAllBots() : db.listBotsByStatus(f);
  bots = bots.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json({ bots: bots.map(adminBot) });
});

app.get('/api/admin/approvals/:id', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json({ bot: adminBot(b, true) });
});

app.get('/api/admin/approvals/:id/files', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  res.json({ files: b.fileTree || [] });
});

app.get('/api/admin/approvals/:id/files/:name', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b?.fileBuffer) return res.status(404).json({ error: 'Not found' });
  try {
    const zip = new AdmZip(b.fileBuffer);
    const e = zip.getEntry(req.params.name);
    if (!e || e.isDirectory) return res.status(404).json({ error: 'File not found' });
    if (e.header.size > 500 * 1024) return res.status(413).json({ error: 'Too large (500KB max)' });
    const content = e.getData().toString('utf8');
    db.audit({ action: 'ADMIN_VIEWED_FILE', targetId: b.id, adminId: req.user.id, meta: { file: req.params.name }, ip: req.ip });
    res.json({ fileName: req.params.name, content });
  } catch { res.status(500).json({ error: 'Read error' }); }
});

app.get('/api/admin/approvals/:id/download', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b?.fileBuffer) return res.status(404).json({ error: 'Not found' });
  db.audit({ action: 'ADMIN_DOWNLOADED_BOT', targetId: b.id, adminId: req.user.id, ip: req.ip });
  res.setHeader('Content-Disposition', `attachment; filename="${b.fileName}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.send(b.fileBuffer);
});

app.post('/api/admin/approvals/:id/reveal-token', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  db.audit({ action: 'ADMIN_VIEWED_TOKEN', targetId: b.id, adminId: req.user.id, ip: req.ip });
  res.json({ token: b.encryptedToken, expiresIn: 30 });
});

app.post('/api/admin/approvals/:id/approve', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const r = db.transitionBot(b.id, 'PENDING_APPROVAL', 'APPROVED', {
    reviewedAt: new Date().toISOString(),
    reviewedBy: req.user.id
  });
  if (!r.ok) return res.status(409).json({ error: `Cannot approve (current: ${r.current || r.error})` });

  db.audit({ action: 'ADMIN_APPROVED_BOT', targetId: b.id, adminId: req.user.id, ip: req.ip });
  db.notify(b.userId, { type: 'BOT_APPROVED', title: 'Bot approved', message: 'Your bot has been approved and deployment has started.', botId: b.id });

  // Deploy simulation (Railway env varsa gerçek çağrı eklenir)
  deployBot(b.id);
  res.json({ ok: true });
});

app.post('/api/admin/approvals/:id/reject', auth, requireAdmin, (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Rejection reason required' });
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  const r = db.transitionBot(b.id, 'PENDING_APPROVAL', 'REJECTED', {
    reviewedAt: new Date().toISOString(),
    reviewedBy: req.user.id,
    rejectionReason: reason
  });
  if (!r.ok) return res.status(409).json({ error: `Cannot reject (current: ${r.current || r.error})` });

  db.audit({ action: 'ADMIN_REJECTED_BOT', targetId: b.id, adminId: req.user.id, meta: { reason }, ip: req.ip });
  db.notify(b.userId, { type: 'BOT_REJECTED', title: 'Bot rejected', message: `Your bot was rejected.\nReason: ${reason}`, botId: b.id, reason });
  res.json({ ok: true });
});

app.get('/api/admin/audit', auth, requireAdmin, (req, res) => {
  res.json({ logs: [...db.db.logs].reverse().slice(0, 200) });
});

app.get('/api/admin/users/:id', auth, requireAdmin, (req, res) => {
  const u = db.db.users.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({
    user: { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt },
    bots: db.listUserBots(u.id).map(publicBot)
  });
});

function adminBot(b, detail = false) {
  const out = {
    id: b.id, name: b.name, username: b.username, telegramBotId: b.telegramBotId,
    telegramPhotoUrl: b.telegramPhotoUrl, status: b.status, runtime: b.runtime,
    fileName: b.fileName, fileSize: b.fileSize, fileCount: b.fileCount,
    submittedAt: b.submittedAt, reviewedAt: b.reviewedAt,
    rejectionReason: b.rejectionReason, userId: b.userId,
    maskedToken: maskToken(b.encryptedToken), deployment: b.deployment
  };
  if (detail) {
    const u = db.db.users.get(b.userId);
    out.submitter = u ? { id: u.id, username: u.username, email: u.email } : null;
    out.fileTree = b.fileTree;
  }
  return out;
}

// ================= DEPLOYMENT =================
async function deployBot(botId) {
  const b = db.getBot(botId);
  if (!b) return;
  const steps = ['CREATING_SERVICE', 'UPLOADING', 'BUILDING', 'STARTING', 'HEALTH_CHECK', 'ONLINE'];
  const dep = { status: 'CREATING_SERVICE', steps: steps.map(s => ({ step: s, status: 'PENDING', at: null })), startedAt: new Date().toISOString(), error: null };
  db.updateBot(botId, { status: 'DEPLOYING', deployment: dep });

  try {
    // Railway gerçek deployment
    if (process.env.RAILWAY_TOKEN && process.env.RAILWAY_PROJECT_ID) {
      const q = `mutation { serviceCreate(input:{projectId:"${process.env.RAILWAY_PROJECT_ID}", name:"bot-${botId}"}) { id } }`;
      await fetch('https://backboard.railway.app/graphql/v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.RAILWAY_TOKEN}` },
        body: JSON.stringify({ query: q })
      }).catch(() => {});
    }

    for (const s of steps) {
      dep.status = s;
      const step = dep.steps.find(x => x.step === s);
      step.status = 'RUNNING';
      step.at = new Date().toISOString();
      db.updateBot(botId, { deployment: { ...dep } });
      await new Promise(r => setTimeout(r, 800));
      step.status = 'DONE';
    }

    dep.status = 'ONLINE';
    db.updateBot(botId, { status: 'RUNNING', deployment: { ...dep } });
    db.notify(b.userId, { type: 'BOT_RUNNING', title: 'Bot online', message: `Your bot @${b.username} is now online.`, botId });
    db.audit({ action: 'DEPLOYMENT_COMPLETED', targetId: botId, adminId: 'system' });
  } catch (e) {
    dep.status = 'FAILED';
    dep.error = e.message;
    db.updateBot(botId, { status: 'DEPLOY_FAILED', deployment: { ...dep } });
    db.notify(b.userId, { type: 'DEPLOY_FAILED', title: 'Deployment failed', message: 'Your bot could not be deployed.', botId });
  }
}

// ================= PAGES =================
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => {
  console.log(`\n✅ Server: http://localhost:${PORT}`);
  console.log(`👤 Admin: username=admin password=admin123\n`);
});
