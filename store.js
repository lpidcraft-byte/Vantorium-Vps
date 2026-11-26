// store.js
const crypto = require('crypto');

const db = {
  users: new Map(),          // id -> user
  bots: new Map(),           // id -> bot (submission + status)
  auditLogs: [],             // array
  notifications: new Map(),  // userId -> [notif]
  deployments: new Map(),    // botId -> deployment
  counters: { user: 0, bot: 0, audit: 0, notif: 0 }
};

// Seed admin
const admin = {
  id: 'admin-1',
  username: 'admin',
  email: 'admin@system.local',
  role: 'ADMIN',
  createdAt: new Date().toISOString()
};
db.users.set(admin.id, admin);

// Seed demo user
const demoUser = {
  id: 'user-1',
  username: 'baba3101',
  email: 'user@example.com',
  role: 'USER',
  createdAt: new Date().toISOString()
};
db.users.set(demoUser.id, demoUser);

function genId(prefix) {
  return `${prefix}-${crypto.randomBytes(8).toString('hex')}`;
}

// ---------- USERS ----------
function getUser(id) { return db.users.get(id); }
function getUserByUsername(u) {
  for (const user of db.users.values()) if (user.username === u) return user;
  return null;
}

// ---------- BOTS ----------
function createBot(data) {
  const bot = {
    id: genId('bot'),
    status: 'UPLOADING',
    submittedAt: new Date().toISOString(),
    reviewedAt: null,
    reviewedBy: null,
    rejectionReason: null,
    deployment: null,
    ...data
  };
  db.bots.set(bot.id, bot);
  return bot;
}
function getBot(id) { return db.bots.get(id); }
function updateBot(id, patch) {
  const b = db.bots.get(id);
  if (!b) return null;
  Object.assign(b, patch);
  return b;
}
function listBotsByUser(userId) {
  return [...db.bots.values()].filter(b => b.userId === userId);
}
function listBotsByStatus(status) {
  return [...db.bots.values()].filter(b => b.status === status);
}
function listAllBots() { return [...db.bots.values()]; }

// ---------- ATOMIC APPROVE/REJECT (race condition önleme) ----------
function atomicApprove(botId, adminId) {
  const bot = db.bots.get(botId);
  if (!bot) return { ok: false, error: 'NOT_FOUND' };
  if (bot.status !== 'PENDING_APPROVAL') return { ok: false, error: 'INVALID_STATUS' };
  // JS single-threaded — set işlemi atomik
  bot.status = 'APPROVED';
  bot.reviewedAt = new Date().toISOString();
  bot.reviewedBy = adminId;
  return { ok: true, bot };
}
function atomicReject(botId, adminId, reason) {
  const bot = db.bots.get(botId);
  if (!bot) return { ok: false, error: 'NOT_FOUND' };
  if (bot.status !== 'PENDING_APPROVAL') return { ok: false, error: 'INVALID_STATUS' };
  bot.status = 'REJECTED';
  bot.reviewedAt = new Date().toISOString();
  bot.reviewedBy = adminId;
  bot.rejectionReason = reason;
  return { ok: true, bot };
}

// ---------- AUDIT ----------
function addAudit(entry) {
  const log = {
    id: genId('audit'),
    createdAt: new Date().toISOString(),
    ...entry
  };
  db.auditLogs.push(log);
  return log;
}
function listAudit() { return [...db.auditLogs].reverse(); }

// ---------- NOTIFICATIONS ----------
function addNotification(userId, data) {
  const n = {
    id: genId('notif'),
    userId,
    read: false,
    createdAt: new Date().toISOString(),
    ...data
  };
  if (!db.notifications.has(userId)) db.notifications.set(userId, []);
  db.notifications.get(userId).unshift(n);
  return n;
}
function listNotifications(userId) {
  return db.notifications.get(userId) || [];
}
function markNotificationRead(id, userId) {
  const list = db.notifications.get(userId) || [];
  const n = list.find(x => x.id === id);
  if (n) n.read = true;
  return n;
}

// ---------- DEPLOYMENTS ----------
function setDeployment(botId, dep) {
  db.deployments.set(botId, dep);
  return dep;
}
function getDeployment(botId) { return db.deployments.get(botId); }

// ---------- COUNTERS / STATS ----------
function stats() {
  const bots = [...db.bots.values()];
  return {
    pendingApprovals: bots.filter(b => b.status === 'PENDING_APPROVAL').length,
    approved: bots.filter(b => b.status === 'APPROVED').length,
    running: bots.filter(b => b.status === 'RUNNING').length,
    rejected: bots.filter(b => b.status === 'REJECTED').length,
    totalUsers: [...db.users.values()].filter(u => u.role === 'USER').length,
    totalDeployments: db.deployments.size,
    failedDeployments: [...db.deployments.values()].filter(d => d.status === 'FAILED').length
  };
}

module.exports = {
  db,
  getUser, getUserByUsername,
  createBot, getBot, updateBot, listBotsByUser, listBotsByStatus, listAllBots,
  atomicApprove, atomicReject,
  addAudit, listAudit,
  addNotification, listNotifications, markNotificationRead,
  setDeployment, getDeployment,
  stats
};
