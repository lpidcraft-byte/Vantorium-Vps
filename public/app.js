let token = localStorage.getItem('token') || null;
let currentUser = null;
let authMode = 'login';
let selectedFile = null;
let pollInterval = null;

const ICON = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  danger: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  rocket: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>'
};

function switchAuth(mode) {
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabRegister').classList.toggle('active', mode === 'register');
  document.getElementById('emailField').classList.toggle('hidden', mode === 'login');
  document.getElementById('authHeading').textContent = mode === 'login' ? 'Welcome back' : 'Create your account';
  document.getElementById('authSub').textContent = mode === 'login'
    ? 'Sign in to manage your bots and deployments.'
    : 'Start deploying Telegram bots in minutes.';
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  document.getElementById('authError').classList.add('hidden');
  document.getElementById('inpEmail').required = mode === 'register';
}

function showAuthError(msg) {
  document.getElementById('authErrorMsg').textContent = msg;
  document.getElementById('authError').classList.remove('hidden');
}

async function submitAuth(e) {
  e.preventDefault();
  document.getElementById('authError').classList.add('hidden');
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  const body = {
    username: document.getElementById('inpUsername').value.trim(),
    password: document.getElementById('inpPassword').value
  };
  if (authMode === 'register') body.email = document.getElementById('inpEmail').value.trim();

  try {
    const r = await fetch(`/api/auth/${authMode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    await enterApp();
  } catch (ex) {
    showAuthError(ex.message);
    btn.disabled = false;
    btn.textContent = authMode === 'login' ? 'Sign in' : 'Create account';
  }
}

async function enterApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');

  document.getElementById('userName').textContent = currentUser.username;
  document.getElementById('userRole').textContent = currentUser.role;
  document.getElementById('userAvatar').textContent = currentUser.username[0].toUpperCase();
  if (currentUser.role === 'ADMIN') document.getElementById('adminBadge').classList.add('show');

  await Promise.all([loadBots(), loadNotifs()]);
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => { loadBots(); loadNotifs(); }, 4000);
}

function logout() {
  localStorage.removeItem('token');
  location.reload();
}

function authHeaders() {
  return { 'Authorization': 'Bearer ' + token };
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.className = 'toast show ' + type;
  el.innerHTML = (type === 'error' ? ICON.danger : ICON.success) + `<span>${esc(msg)}</span>`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// ===== UPLOAD =====
function onFilePicked(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (!f.name.endsWith('.zip')) return toast('Please select a .zip file', 'error');
  selectedFile = f;
  document.getElementById('fileName').textContent = f.name;
  document.getElementById('fileSize').textContent = `${(f.size / 1024 / 1024).toFixed(2)} MB`;
  document.getElementById('fileChip').classList.remove('hidden');
}

function clearFile(e) {
  if (e) e.stopPropagation();
  selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('fileChip').classList.add('hidden');
}

const dz = document.getElementById('dropzone');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
dz.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f) onFilePicked({ target: { files: [f] } });
});

async function uploadBot() {
  if (!selectedFile) return toast('Please select a zip file', 'error');
  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>Uploading...';

  const track = document.getElementById('progressTrack');
  const fill = document.getElementById('progressFill');
  track.classList.remove('hidden');
  fill.style.width = '30%';

  try {
    const fd = new FormData();
    fd.append('file', selectedFile);
    const tok = document.getElementById('botToken').value.trim();
    if (tok) fd.append('botToken', tok);

    fill.style.width = '60%';
    const r = await fetch('/api/bots/upload', { method: 'POST', headers: authHeaders(), body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    fill.style.width = '100%';
    setTimeout(() => { track.classList.add('hidden'); fill.style.width = '0'; }, 1000);

    toast('Bot submitted — awaiting admin approval');
    clearFile();
    document.getElementById('botToken').value = '';
    loadBots();
  } catch (ex) {
    toast(ex.message, 'error');
    track.classList.add('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload & Verify';
  }
}

// ===== DATA =====
async function loadBots() {
  const r = await fetch('/api/bots', { headers: authHeaders() });
  if (r.status === 401) return logout();
  const { bots } = await r.json();
  const el = document.getElementById('botList');
  if (!bots.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16.01"/><line x1="16" y1="16" x2="16" y2="16.01"/></svg>
        </div>
        <p>No bots submitted yet</p>
      </div>`;
    return;
  }
  el.innerHTML = bots.map(b => `
    <div class="bot-row">
      <img class="bot-avatar" src="${b.telegramPhotoUrl || fallback(b.name)}" onerror="this.src='${fallback(b.name)}'">
      <div class="bot-main">
        <div class="bot-title">${esc(b.name || 'Pending')}${b.username ? ' <span>@' + esc(b.username) + '</span>' : ''}</div>
        <div class="bot-meta">${esc(b.fileName || '')} · ${(b.fileSize / 1024).toFixed(0)} KB</div>
        ${b.rejectionReason ? `<div class="bot-reason">${ICON.danger}<span>${esc(b.rejectionReason)}</span></div>` : ''}
      </div>
      <span class="chip chip-${b.status}">${b.status.replace(/_/g, ' ')}</span>
    </div>
  `).join('');
}

async function loadNotifs() {
  const r = await fetch('/api/notifications', { headers: authHeaders() });
  if (r.status === 401) return;
  const { notifications } = await r.json();
  const el = document.getElementById('notifList');
  if (!notifications.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="es-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        </div>
        <p>No notifications yet</p>
      </div>`;
    return;
  }
  el.innerHTML = notifications.slice(0, 15).map(n => {
    const kind = n.type === 'BOT_REJECTED' || n.type === 'DEPLOY_FAILED' ? 'danger'
      : n.type === 'BOT_RUNNING' ? 'success'
      : n.type === 'BOT_APPROVED' ? 'info'
      : 'info';
    const icon = kind === 'danger' ? ICON.danger : kind === 'success' ? ICON.success : ICON.info;
    return `
      <div class="notif-row">
        <div class="notif-icon ${kind}">${icon}</div>
        <div class="notif-body">
          <div class="notif-title">${esc(n.title)}</div>
          <div class="notif-msg">${esc(n.message)}</div>
          <div class="notif-time">${new Date(n.createdAt).toLocaleString()}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ===== HELPERS =====
function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fallback(name) {
  const l = (name || 'B')[0].toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><rect width="42" height="42" rx="11" fill="#161920"/><text x="21" y="27" font-size="17" fill="#5a6273" text-anchor="middle" font-family="sans-serif" font-weight="600">${l}</text></svg>`);
}

// ===== BOOT =====
(async () => {
  if (!token) return;
  try {
    const r = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!r.ok) { token = null; localStorage.removeItem('token'); return; }
    currentUser = (await r.json()).user;
    await enterApp();
  } catch { token = null; localStorage.removeItem('token'); }
})();
