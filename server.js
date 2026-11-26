const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
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
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, email, password } = req.body || {};
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 alphanumeric/underscore characters' });
    }
    const user = await db.createUser({ username, email, password });
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }
  const user = db.findUserByUsername(username) || db.findUserByEmail(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await db.verifyPassword(user, password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({
    token: signToken(user),
    user: { id: user.id, username: user.username, email: user.email, role: user.role }
  });
});

app.get('/api/auth/me', auth, (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
      role: req.user.role,
      createdAt: req.user.createdAt
    }
  });
});

// ============================================================
// BOT UPLOAD
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

function maskToken(t) {
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length !== 2) return t.slice(0, 8) + '••••';
  const [bid, secret] = parts;
  if (secret.length < 10) return `${bid}:••••••••`;
  return `${bid}:${secret.slice(0, 4)}••••••••${secret.slice(-3)}`;
}

async function verifyTelegramToken(token) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { timeout: 10000 });
    const d = await r.json();
    if (!d.ok) return { ok: false, error: d.description || 'Invalid token' };
    return {
      ok: true,
      botId: String(d.result.id),
      username: d.result.username,
      firstName: d.result.first_name
    };
  } catch {
    return { ok: false, error: 'Telegram API unreachable' };
  }
}

async function getBotPhoto(token, botId) {
  try {
    const p = await fetch(
      `https://api.telegram.org/bot${token}/getUserProfilePhotos?user_id=${botId}&limit=1`
    ).then(r => r.json());
    if (!p.ok || !p.result.total_count) return null;
    const fid = p.result.photos[0][0].file_id;
    const fi = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${fid}`
    ).then(r => r.json());
    if (!fi.ok) return null;
    return `https://api.telegram.org/file/bot${token}/${fi.result.file_path}`;
  } catch {
    return null;
  }
}

app.post('/api/bots/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch {
      return res.status(400).json({ error: 'Invalid or corrupted zip file' });
    }

    const entries = zip.getEntries().filter(e => !e.isDirectory);
    if (entries.length === 0) {
      return res.status(400).json({ error: 'Zip file is empty' });
    }
    const fileTree = entries.map(e => ({ name: e.entryName, size: e.header.size }));

    // Token: formdan veya dosyalardan
    let token = (req.body.botToken || '').trim() || null;
    if (!token) {
      const tokenRegex = /(\d{8,10}:[A-Za-z0-9_-]{35})/;
      for (const e of entries) {
        if (/\.(env|py|js|json|txt|cfg|ini|yaml|yml)$/i.test(e.entryName)) {
          try {
            const content = e.getData().toString('utf8');
            const m = content.match(tokenRegex);
            if (m) { token = m[1]; break; }
          } catch { /* skip binary */ }
        }
      }
    }
    if (!token) {
      return res.status(400).json({ error: 'Telegram bot token not found in files or form' });
    }

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
      db.updateBot(bot.id, {
        status: 'REJECTED',
        rejectionReason: 'Token verification failed: ' + v.error,
        reviewedAt: new Date().toISOString()
      });
      db.notify(req.user.id, {
        type: 'BOT_REJECTED',
        title: 'Bot submission failed',
        message: 'Your bot token could not be verified: ' + v.error,
        botId: bot.id,
        reason: v.error
      });
      return res.status(400).json({ error: 'Token invalid: ' + v.error });
    }

    const photoUrl = await getBotPhoto(token, v.botId);

    db.updateBot(bot.id, {
      name: v.firstName,
      username: v.username,
      telegramBotId: v.botId,
      telegramPhotoUrl: photoUrl,
      status: 'PENDING_APPROVAL'
    });

    db.audit({
      action: 'BOT_SUBMITTED',
      targetType: 'bot',
      targetId: bot.id,
      adminId: null,
      userId: req.user.id,
      ip: req.ip,
      meta: { fileName: req.file.originalname }
    });

    res.json({ ok: true, bot: publicBot(db.getBot(bot.id)) });
  } catch (e) {
    console.error('[upload]', e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

function publicBot(b) {
  const { encryptedToken, fileBuffer, ...rest } = b;
  return rest;
}

app.get('/api/bots', auth, (req, res) => {
  res.json({ bots: db.listUserBots(req.user.id).map(publicBot) });
});

// ============================================================
// NOTIFICATIONS
// ============================================================
app.get('/api/notifications', auth, (req, res) => {
  res.json({ notifications: db.listNotifs(req.user.id) });
});

app.post('/api/notifications/:id/read', auth, (req, res) => {
  const list = db.listNotifs(req.user.id);
  const n = list.find(x => x.id === req.params.id);
  if (n) n.read = true;
  res.json({ ok: true });
});

// ============================================================
// ADMIN API (all requireAdmin)
// ============================================================
app.get('/api/admin/stats', auth, requireAdmin, (req, res) => {
  res.json({ stats: db.stats() });
});

app.get('/api/admin/approvals', auth, requireAdmin, (req, res) => {
  const f = req.query.status;
  let bots = !f || f === 'ALL' ? db.listAllBots() : db.listBotsByStatus(f);
  bots = bots.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  res.json({ bots: bots.map(b => adminBot(b, false)) });
});

app.get('/api/admin/approvals/:id', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Bot not found' });
  res.json({ bot: adminBot(b, true) });
});

app.get('/api/admin/approvals/:id/files', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Bot not found' });
  res.json({ files: b.fileTree || [] });
});

app.get('/api/admin/approvals/:id/files/:name', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b || !b.fileBuffer) return res.status(404).json({ error: 'Bot not found' });
  try {
    const zip = new AdmZip(b.fileBuffer);
    const entry = zip.getEntry(req.params.name);
    if (!entry || entry.isDirectory) {
      return res.status(404).json({ error: 'File not found in archive' });
    }
    if (entry.header.size > 500 * 1024) {
      return res.status(413).json({ error: 'File too large for viewer (500 KB max)' });
    }
    const content = entry.getData().toString('utf8');
    db.audit({
      action: 'ADMIN_VIEWED_FILE',
      targetType: 'bot',
      targetId: b.id,
      adminId: req.user.id,
      ip: req.ip,
      meta: { file: req.params.name }
    });
    res.json({ fileName: req.params.name, content });
  } catch {
    res.status(500).json({ error: 'Cannot read file' });
  }
});

app.get('/api/admin/approvals/:id/download', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b || !b.fileBuffer) return res.status(404).json({ error: 'Bot not found' });
  db.audit({
    action: 'ADMIN_DOWNLOADED_BOT',
    targetType: 'bot',
    targetId: b.id,
    adminId: req.user.id,
    ip: req.ip
  });
  res.setHeader('Content-Disposition', `attachment; filename="${b.fileName}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.send(b.fileBuffer);
});

app.post('/api/admin/approvals/:id/reveal-token', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Bot not found' });
  db.audit({
    action: 'ADMIN_VIEWED_TOKEN',
    targetType: 'bot',
    targetId: b.id,
    adminId: req.user.id,
    ip: req.ip
  });
  res.json({ token: b.encryptedToken, expiresIn: 30 });
});

app.post('/api/admin/approvals/:id/approve', auth, requireAdmin, (req, res) => {
  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Bot not found' });

  const r = db.transitionBot(b.id, 'PENDING_APPROVAL', 'APPROVED', {
    reviewedAt: new Date().toISOString(),
    reviewedBy: req.user.id
  });
  if (!r.ok) {
    return res.status(409).json({
      error: `Cannot approve bot (current status: ${r.current || r.error})`
    });
  }

  db.audit({
    action: 'ADMIN_APPROVED_BOT',
    targetType: 'bot',
    targetId: b.id,
    adminId: req.user.id,
    ip: req.ip,
    meta: { botUsername: b.username }
  });

  db.notify(b.userId, {
    type: 'BOT_APPROVED',
    title: 'Bot approved',
    message: 'Your bot has been approved and deployment has started.',
    botId: b.id
  });

  deployBot(b.id);
  res.json({ ok: true, status: 'APPROVED' });
});

app.post('/api/admin/approvals/:id/reject', auth, requireAdmin, (req, res) => {
  const reason = (req.body.reason || '').trim();
  if (!reason) {
    return res.status(400).json({ error: 'Rejection reason is required' });
  }
  if (reason.length > 500) {
    return res.status(400).json({ error: 'Rejection reason too long (max 500 chars)' });
  }

  const b = db.getBot(req.params.id);
  if (!b) return res.status(404).json({ error: 'Bot not found' });

  const r = db.transitionBot(b.id, 'PENDING_APPROVAL', 'REJECTED', {
    reviewedAt: new Date().toISOString(),
    reviewedBy: req.user.id,
    rejectionReason: reason
  });
  if (!r.ok) {
    return res.status(409).json({
      error: `Cannot reject bot (current status: ${r.current || r.error})`
    });
  }

  db.audit({
    action: 'ADMIN_REJECTED_BOT',
    targetType: 'bot',
    targetId: b.id,
    adminId: req.user.id,
    ip: req.ip,
    meta: { reason, botUsername: b.username }
  });

  db.notify(b.userId, {
    type: 'BOT_REJECTED',
    title: 'Bot submission rejected',
    message: `Your bot submission was rejected.\nReason: ${reason}`,
    botId: b.id,
    reason
  });

  res.json({ ok: true, status: 'REJECTED' });
});

app.get('/api/admin/audit', auth, requireAdmin, (req, res) => {
  res.json({ logs: [...db.db.logs].reverse().slice(0, 200) });
});

app.get('/api/admin/users/:id', auth, requireAdmin, (req, res) => {
  const u = db.db.users.get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.json({
    user: {
      id: u.id,
      username: u.username,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt
    },
    bots: db.listUserBots(u.id).map(publicBot)
  });
});

function adminBot(b, detail) {
  const out = {
    id: b.id,
    name: b.name,
    username: b.username,
    telegramBotId: b.telegramBotId,
    telegramPhotoUrl: b.telegramPhotoUrl,
    status: b.status,
    runtime: b.runtime,
    fileName: b.fileName,
    fileSize: b.fileSize,
    fileCount: b.fileCount,
    submittedAt: b.submittedAt,
    reviewedAt: b.reviewedAt,
    rejectionReason: b.rejectionReason,
    userId: b.userId,
    maskedToken: maskToken(b.encryptedToken),
    deployment: b.deployment
  };
  if (detail) {
    const u = db.db.users.get(b.userId);
    out.submitter = u ? { id: u.id, username: u.username, email: u.email } : null;
    out.fileTree = b.fileTree;
  }
  return out;
}

// ============================================================
// DEPLOYMENT (Railway)
// ============================================================
async function deployBot(botId) {
  const b = db.getBot(botId);
  if (!b) return;

  const steps = [
    'CREATING_SERVICE',
    'UPLOADING',
    'BUILDING',
    'STARTING',
    'HEALTH_CHECK',
    'ONLINE'
  ];
  const dep = {
    status: 'CREATING_SERVICE',
    steps: steps.map(s => ({ step: s, status: 'PENDING', at: null })),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null
  };
  db.updateBot(botId, { status: 'DEPLOYING', deployment: dep });

  try {
    // Gerçek Railway deployment (env varsa)
    if (process.env.RAILWAY_TOKEN && process.env.RAILWAY_PROJECT_ID && process.env.RAILWAY_ENVIRONMENT_ID) {
      const gql = async (query, variables) => {
        const res = await fetch('https://backboard.railway.app/graphql/v2', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.RAILWAY_TOKEN}`
          },
          body: JSON.stringify({ query, variables })
        });
        return res.json();
      };

      const svcRes = await gql(
        `mutation ServiceCreate($input: ServiceCreateInput!) {
          serviceCreate(input: $input) { id name }
        }`,
        {
          input: {
            projectId: process.env.RAILWAY_PROJECT_ID,
            name: `bot-${botId}`.slice(0, 40)
          }
        }
      );
      const serviceId = svcRes?.data?.serviceCreate?.id;

      if (serviceId) {
        await gql(
          `mutation VariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
            variableCollectionUpsert(input: $input)
          }`,
          {
            input: {
              projectId: process.env.RAILWAY_PROJECT_ID,
              serviceId,
              environmentId: process.env.RAILWAY_ENVIRONMENT_ID,
              variables: {
                TELEGRAM_BOT_TOKEN: b.encryptedToken,
                BOT_ID: b.id,
                RUNTIME: b.runtime || 'python'
              }
            }
          }
        );

        await gql(
          `mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
            serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
          }`,
          {
            serviceId,
            environmentId: process.env.RAILWAY_ENVIRONMENT_ID
          }
        );
      }
    }

    // Step-by-step progress
    for (const s of steps) {
      dep.status = s;
      const stepObj = dep.steps.find(x => x.step === s);
      stepObj.status = 'RUNNING';
      stepObj.at = new Date().toISOString();
      db.updateBot(botId, { deployment: { ...dep, steps: dep.steps.map(x => ({ ...x })) } });
      await new Promise(r => setTimeout(r, 800));
      stepObj.status = 'DONE';
    }

    dep.status = 'ONLINE';
    dep.finishedAt = new Date().toISOString();
    db.updateBot(botId, {
      status: 'RUNNING',
      deployment: { ...dep, steps: dep.steps.map(x => ({ ...x })) }
    });

    db.notify(b.userId, {
      type: 'BOT_RUNNING',
      title: 'Your bot is now online',
      message: `Your bot @${b.username} is now online.`,
      botId
    });

    db.audit({
      action: 'DEPLOYMENT_COMPLETED',
      targetType: 'bot',
      targetId: botId,
      adminId: 'system',
      ip: 'system',
      meta: {}
    });
  } catch (e) {
    dep.status = 'FAILED';
    dep.error = e.message;
    dep.finishedAt = new Date().toISOString();
    db.updateBot(botId, {
      status: 'DEPLOY_FAILED',
      deployment: { ...dep, steps: dep.steps.map(x => ({ ...x })) }
    });

    db.notify(b.userId, {
      type: 'DEPLOY_FAILED',
      title: 'Deployment failed',
      message: 'Your bot could not be deployed. Please contact support.',
      botId
    });

    db.audit({
      action: 'DEPLOYMENT_FAILED',
      targetType: 'bot',
      targetId: botId,
      adminId: 'system',
      ip: 'system',
      meta: { error: e.message }
    });
  }
}

// ============================================================
// PAGES
// ============================================================
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// BOOT
// ============================================================
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
