const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db = {
  users: new Map(),
  bots: new Map(),
  logs: [],
  notifs: new Map()
};

function id(p) { return `${p}_${crypto.randomBytes(8).toString('hex')}`; }

// Seed admin
(async () => {
  const hash = await bcrypt.hash('admin123', 10);
  const admin = {
    id: 'admin_1',
    username: 'admin',
    email: 'admin@bot.local',
    passwordHash: hash,
    role: 'ADMIN',
    createdAt: new Date().toISOString()
  };
  db.users.set(admin.id, admin);
})();

const findUserByUsername = (u) => {
  for (const x of db.users.values()) if (x.username === u) return x;
  return null;
};
const findUserByEmail = (e) => {
  for (const x of db.users.values()) if (x.email === e) return x;
  return null;
};

async function createUser({ username, email, password }) {
  if (findUserByUsername(username)) throw new Error('Username taken');
  if (findUserByEmail(email)) throw new Error('Email already registered');
  const user = {
    id: id('usr'),
    username,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'USER',
    createdAt: new Date().toISOString()
  };
  db.users.set(user.id, user);
  return user;
}

async function verifyPassword(user, password) {
  return bcrypt.compare(password, user.passwordHash);
}

// ---- BOTS ----
function createBot(data) {
  const bot = {
    id: id('bot'),
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
const getBot = (id) => db.bots.get(id);
const updateBot = (id, patch) => {
  const b = db.bots.get(id);
  if (!b) return null;
  Object.assign(b, patch);
  return b;
};
const listUserBots = (uid) => [...db.bots.values()].filter(b => b.userId === uid);
const listBotsByStatus = (s) => [...db.bots.values()].filter(b => b.status === s);
const listAllBots = () => [...db.bots.values()];

// Atomic transitions (JS single-thread)
function transitionBot(botId, fromStatus, toStatus, patch = {}) {
  const b = db.bots.get(botId);
  if (!b) return { ok: false, error: 'NOT_FOUND' };
  if (b.status !== fromStatus) return { ok: false, error: 'INVALID_STATUS', current: b.status };
  Object.assign(b, patch, { status: toStatus });
  return { ok: true, bot: b };
}

// ---- AUDIT ----
function audit(entry) {
  db.logs.push({ id: id('log'), createdAt: new Date().toISOString(), ...entry });
}

// ---- NOTIF ----
function notify(userId, data) {
  if (!db.notifs.has(userId)) db.notifs.set(userId, []);
  const n = { id: id('ntf'), read: false, createdAt: new Date().toISOString(), ...data };
  db.notifs.get(userId).unshift(n);
  return n;
}
const listNotifs = (uid) => db.notifs.get(uid) || [];

function stats() {
  const bots = [...db.bots.values()];
  return {
    pending: bots.filter(b => b.status === 'PENDING_APPROVAL').length,
    running: bots.filter(b => b.status === 'RUNNING').length,
    rejected: bots.filter(b => b.status === 'REJECTED').length,
    users: [...db.users.values()].filter(u => u.role === 'USER').length,
    deployments: bots.filter(b => b.deployment).length,
    failed: bots.filter(b => b.status === 'DEPLOY_FAILED').length
  };
}

module.exports = {
  db,
  findUserByUsername, findUserByEmail,
  createUser, verifyPassword,
  createBot, getBot, updateBot, listUserBots, listBotsByStatus, listAllBots, transitionBot,
  audit, notify, listNotifs, stats
};
