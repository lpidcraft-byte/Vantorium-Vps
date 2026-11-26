// server.js
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const AdmZip = require('adm-zip');
const path = require('path');
const crypto = require('crypto');

const store = require('./store');
const telegram = require('./telegram');
const queue = require('./queue');
const railway = require('./railway');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- AUTH (demo — basit session cookie) ----------
// Production'da JWT/session kullan. Burada header/cookie ile userId taşınır.
function getCurrentUser(req) {
  const uid = req.cookies?.uid || req.headers['x-user-id'];
  if (!uid) return null;
  return store.getUser(uid) || null;
}

function requireAuth(req, res, next) {
  const u = getCurrentUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  req.user = u;
  next();
}

// KRİTİK: Admin middleware — backend zorunlu kontrol
function requireAdmin(req, res, next) {
  const u = getCurrentUser(req);
  if (!u) return res.status(401).json({ error: 'Unauthorized' });
  if (u.role !== 'ADMIN') return res.status(403).json({ error: 'Forbidden — ADMIN only' });
  req.user = u;
  next();
}

// ---------- UPLOAD ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// ---------- TELEGRAM TOKEN MASK ----------
function maskToken(token) {
  if (!token) return null;
  const [id, secret] = token.split(':');
  if (!secret) return token.slice(0, 6) + '••••';
  const s = secret;
  const visible = s.length > 10 ? s.slice(0, 4) + '••••••••••••' + s.slice(-3) : '••••••••';
  return `${id}:${visible}`;
}

// =========================================================
// USER API
// =========================================================

// Mevcut kullanıcı
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Bot yükleme → PENDING_APPROVAL akışı
app.post('/api/bots/upload', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { runtime = 'python', botToken } = req.body;

    // 1) Zip parse + token bulma
    let zip;
    try {
      zip = new AdmZip(req.file.buffer);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid zip file' });
    }

    const entries = zip.getEntries().filter(e => !e.isDirectory);
    const fileTree = entries.map(e => ({
      name: e.entryName,
      size: e.header.size
    }));

    // 2) Token tespiti: env, config, .env veya kullanıcı formdan girdiyse
    let token = botToken || null;
    if (!token) {
      const tokenRegex = /(\d{8,10}:[A-Za-z0-9_-]{35})/;
      for (const e of entries) {
        if (/\.(env|py|js|json|txt|cfg|ini)$/i.test(e.entryName)) {
          const content = e.getData().toString('utf8');
          const m = content.match(tokenRegex);
          if (m) { token = m[1]; break; }
        }
      }
    }

    if (!token) {
      return res.status(400).json({ error: 'Telegram bot token not found in files or form' });
    }

    // 3) Bot kaydı (UPLOADING → ANALYZING)
    const bot = store.createBot({
      userId: req.user.id,
      name: 'Pending...',
      username: null,
      telegramBotId: null,
      telegramPhotoUrl: null,
      encryptedToken: token, // demo: gerçekte KMS ile şifrele
      runtime,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      fileCount: entries.length,
      fileTree,
      fileBuffer: req.file.buffer, // demo: gerçekte S3/obj storage
      status: 'ANALYZING'
    });

    // 4) Token doğrulama (VERIFYING)
    store.updateBot(bot.id, { status: 'VERIFYING' });
    const verify = await telegram.verifyToken(token);
    if (!verify.ok) {
      store.updateBot(bot.id, { status: 'REJECTED', rejectionReason: `Token verification failed: ${verify.error}` });
      return res.status(400).json({ error: `Token verification failed: ${verify.error}`, botId: bot.id });
    }

    // 5) Profil fotoğrafı
    const photoUrl = await telegram.getBotPhoto(token, verify.botId);

    // 6) PENDING_APPROVAL'a geç
    store.updateBot(bot.id, {
      name: verify.firstName,
      username: verify.username,
      telegramBotId: verify.botId,
      telegramPhotoUrl: photoUrl,
      status: 'PENDING_APPROVAL'
    });

    // 7) Admin bildirimi (audit + sayaç otomatik stats'tan gelir)
    store.addAudit({
      adminId: null,
      action: 'BOT_SUBMITTED',
      targetType: 'bot',
      targetId: bot.id,
      metadata: { userId: req.user.id },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || ''
    });

    res.json({
      ok: true,
      bot: publicBot(bot)
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Kullanıcı kendi botlarını görsün
app.get('/api/bots', requireAuth, (req, res) => {
  const bots = store.listBotsByUser(req.user.id).map(publicBot);
  res.json({ bots });
});

// Kullanıcı bildirimleri
app.get('/api/notifications', requireAuth, (req, res) => {
  res.json({ notifications: store.listNotifications(req.user.id) });
});
app.post('/api/notifications/:id/read', requireAuth, (req, res) => {
  store.markNotificationRead(req.params.id, req.user.id);
  res.json({ ok: true });
});

function publicBot(bot) {
  // Token asla public
  const { encryptedToken, fileBuffer, ...rest } = bot;
  return rest;
}

// =========================================================
// ADMIN API — tümü requireAdmin
// =========================================================

// Stats
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  res.json({ stats: store.stats() });
});

// Liste
app.get('/api/admin/approvals', requireAdmin, (req, res) => {
  const status = req.query.status; // PENDING_APPROVAL | APPROVED | REJECTED | ALL
  let bots = status && status !== 'ALL'
    ? store.listBotsByStatus(status)
    : store.listAllBots();

  // En son gönderilenler önce
  bots = bots.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  res.json({ bots: bots.map(adminBot) });
});

// Detay — token maskeli
app.get('/api/admin/approvals/:id', requireAdmin, (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Not found' });
  res.json({ bot: adminBot(bot, true) });
});

// Dosya ağacı
app.get('/api/admin/approvals/:id/files', requireAdmin, (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Not found' });
  res.json({ files: bot.fileTree || [] });
});

// Dosya içeriği (read-only viewer)
app.get('/api/admin/approvals/:id/files/:fileName', requireAdmin, (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot || !bot.fileBuffer) return res.status(404).json({ error: 'Not found' });
  const fileName = req.params.fileName;
  try {
    const zip = new AdmZip(bot.fileBuffer);
    const entry = zip.getEntry(fileName);
    if (!entry || entry.isDirectory) return res.status(404).json({ error: 'File not found in archive' });
    // Read-only: 500KB limit
    if (entry.header.size > 500 * 1024) {
      return res.status(413).json({ error: 'File too large for viewer (max 500KB)' });
    }
    const content = entry.getData().toString('utf8');
    store.addAudit({
      adminId: req.user.id,
      action: 'ADMIN_VIEWED_FILE',
      targetType: 'bot',
      targetId: bot.id,
      metadata: { fileName },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || ''
    });
    res.json({ fileName, content });
  } catch (e) {
    res.status(500).json({ error: 'Cannot read file' });
  }
});

// Download (audit'li, çalıştırılamaz)
app.get('/api/admin/approvals/:id/download', requireAdmin, (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot || !bot.fileBuffer) return res.status(404).json({ error: 'Not found' });
  store.addAudit({
    adminId: req.user.id,
    action: 'ADMIN_DOWNLOADED_BOT',
    targetType: 'bot',
    targetId: bot.id,
    metadata: { fileName: bot.fileName },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || ''
  });
  res.setHeader('Content-Disposition', `attachment; filename="${bot.fileName}"`);
  res.setHeader('Content-Type', 'application/zip');
  res.send(bot.fileBuffer);
});

// Token reveal — audit + backend auth
app.post('/api/admin/approvals/:id/reveal-token', requireAdmin, (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Not found' });
  store.addAudit({
    adminId: req.user.id,
    action: 'ADMIN_VIEWED_TOKEN',
    targetType: 'bot',
    targetId: bot.id,
    metadata: {}, // token ASLA yazılmaz
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || ''
  });
  // Geçici gösterim — frontend kullanımdan sonra silmeli
  res.json({ token: bot.encryptedToken, expiresIn: 60 });
});

// ---------- APPROVE ----------
app.post('/api/admin/approvals/:id/approve', requireAdmin, async (req, res) => {
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Not found' });

  // Atomic status transition
  const result = store.atomicApprove(bot.id, req.user.id);
  if (!result.ok) {
    if (result.error === 'INVALID_STATUS') {
      return res.status(409).json({ error: `Cannot approve bot in status ${bot.status}` });
    }
    return res.status(400).json({ error: result.error });
  }

  store.addAudit({
    adminId: req.user.id,
    action: 'ADMIN_APPROVED_BOT',
    targetType: 'bot',
    targetId: bot.id,
    metadata: { botUsername: bot.username },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || ''
  });

  // Kullanıcı bildirimi
  store.addNotification(bot.userId, {
    type: 'BOT_APPROVED',
    title: 'Your bot has been approved',
    message: 'Your bot has been approved and deployment has started.',
    botId: bot.id
  });

  // Queue'ya DEPLOY_BOT job
  queue.enqueue({ type: 'DEPLOY_BOT', data: { botId: bot.id } });

  res.json({ ok: true, status: 'APPROVED' });
});

// ---------- REJECT ----------
app.post('/api/admin/approvals/:id/reject', requireAdmin, (req, res) => {
  const { reason } = req.body || {};
  if (!reason || typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'Rejection reason required' });
  }
  const bot = store.getBot(req.params.id);
  if (!bot) return res.status(404).json({ error: 'Not found' });

  const result = store.atomicReject(bot.id, req.user.id, reason.trim());
  if (!result.ok) {
    if (result.error === 'INVALID_STATUS') {
      return res.status(409).json({ error: `Cannot reject bot in status ${bot.status}` });
    }
    return res.status(400).json({ error: result.error });
  }

  store.addAudit({
    adminId: req.user.id,
    action: 'ADMIN_REJECTED_BOT',
    targetType: 'bot',
    targetId: bot.id,
    metadata: { reason: reason.trim(), botUsername: bot.username },
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || ''
  });

  store.addNotification(bot.userId, {
    type: 'BOT_REJECTED',
    title: 'Your bot submission was rejected',
    message: `Your bot submission was rejected.\nReason: ${reason.trim()}`,
    botId: bot.id,
    reason: reason.trim()
  });

  res.json({ ok: true, status: 'REJECTED' });
});

// Audit listesi
app.get('/api/admin/audit', requireAdmin, (req, res) => {
  res.json({ logs: store.listAudit().slice(0, 500) });
});

// Kullanıcı detay (admin panelinden link)
app.get('/api/admin/users/:id', requireAdmin, (req, res) => {
  const u = store.getUser(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const bots = store.listBotsByUser(u.id).map(publicBot);
  res.json({ user: { id: u.id, username: u.username, email: u.email, role: u.role, createdAt: u.createdAt }, bots });
});

function adminBot(bot, detail = false) {
  const base = {
    id: bot.id,
    name: bot.name,
    username: bot.username,
    telegramBotId: bot.telegramBotId,
    telegramPhotoUrl: bot.telegramPhotoUrl,
    status: bot.status,
    runtime: bot.runtime,
    fileName: bot.fileName,
    fileSize: bot.fileSize,
    fileCount: bot.fileCount,
    submittedAt: bot.submittedAt,
    reviewedAt: bot.reviewedAt,
    rejectionReason: bot.rejectionReason,
    userId: bot.userId,
    maskedToken: maskToken(bot.encryptedToken),
    deployment: store.getDeployment(bot.id) || null
  };
  if (detail) {
    const submitter = store.getUser(bot.userId);
    base.submitter = submitter ? {
      id: submitter.id,
      username: submitter.username,
      email: submitter.email
    } : null;
    base.fileTree = bot.fileTree;
  }
  return base;
}

// =========================================================
// QUEUE HANDLER — Deployment
// =========================================================

queue.register('DEPLOY_BOT', async ({ botId }) => {
  const bot = store.getBot(botId);
  if (!bot) return;

  const steps = ['CREATING_SERVICE', 'UPLOADING', 'BUILDING', 'STARTING', 'HEALTH_CHECK', 'ONLINE'];
  const dep = {
    botId,
    status: 'CREATING_SERVICE',
    steps: steps.map(s => ({ step: s, status: 'PENDING', at: null })),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null
  };
  store.setDeployment(botId, dep);
  store.updateBot(botId, { status: 'DEPLOYING' });

  try {
    // Gerçek Railway çağrısı (env yoksa simulate)
    if (process.env.RAILWAY_TOKEN && process.env.RAILWAY_PROJECT_ID) {
      await railway.createRailwayService({
        botName: bot.username || bot.id,
        envVars: {
          TELEGRAM_BOT_TOKEN: bot.encryptedToken,
          BOT_ID: bot.id
        }
      });
    } else {
      // Demo simulate
      await new Promise(r => setTimeout(r, 400));
    }

    for (const s of steps) {
      dep.status = s;
      const stepObj = dep.steps.find(x => x.step === s);
      stepObj.status = 'RUNNING';
      stepObj.at = new Date().toISOString();
      await new Promise(r => setTimeout(r, 700));
      stepObj.status = 'DONE';
    }

    dep.status = 'ONLINE';
    dep.finishedAt = new Date().toISOString();
    store.updateBot(botId, { status: 'RUNNING' });

    store.addNotification(bot.userId, {
      type: 'BOT_RUNNING',
      title: 'Your bot is now online',
      message: `Your bot @${bot.username} is now online.`,
      botId: bot.id
    });

    store.addAudit({
      adminId: null,
      action: 'DEPLOYMENT_COMPLETED',
      targetType: 'bot',
      targetId: bot.id,
      metadata: {},
      ipAddress: 'system',
      userAgent: 'queue-worker'
    });
  } catch (e) {
    dep.status = 'FAILED';
    dep.error = e.message;
    dep.finishedAt = new Date().toISOString();
    store.updateBot(botId, { status: 'DEPLOY_FAILED' });
    store.addNotification(bot.userId, {
      type: 'BOT_DEPLOY_FAILED',
      title: 'Deployment failed',
      message: `Your bot @${bot.username} could not be deployed. Contact support.`,
      botId: bot.id
    });
  }
});

// =========================================================
// AUTH DEMO — rol değiştirme
// =========================================================
app.post('/api/demo/login', (req, res) => {
  const { userId } = req.body;
  const u = store.getUser(userId);
  if (!u) return res.status(404).json({ error: 'User not found' });
  res.cookie('uid', u.id, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: { id: u.id, username: u.username, role: u.role } });
});

// Admin paneli route koruması — HTML de servis edilir ama API'de veri yok
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.listen(PORT, () => {
  console.log(`Server on :${PORT}`);
  console.log('Admin: userId=admin-1 | User: userId=user-1');
});
