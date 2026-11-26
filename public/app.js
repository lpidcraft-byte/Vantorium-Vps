let token = localStorage.getItem('token') || null;
let currentUser = null;
let authMode = 'login';
let selectedFile = null;
let pollInterval = null;

function switchAuth(mode) {
  authMode = mode;
  document.getElementById('tabLogin').classList.toggle('active', mode === 'login');
  document.getElementById('tabRegister').classList.toggle('active', mode === 'register');
  document.getElementById('emailGroup').classList.toggle('hidden', mode === 'login');
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Login' : 'Create Account';
  document.getElementById('authError').classList.add('hidden');
  document.getElementById('inpEmail').required = mode === 'register';
}

async function submitAuth(e) {
  e.preventDefault();
  const err = document.getElementById('authError');
  err.classList.add('hidden');
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  const body = {
    username: document.getElementById('inpUsername').value.trim(),
    password: document.getElementById('inpPassword').value
  };
  if (authMode === 'register') body.email = document.getElementById('inpEmail').value.trim();

  try {
    const r = await fetch(`/api/auth/${authMode}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    await enterApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function enterApp() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appScreen').classList.remove('hidden');
  document.getElementById('userName').textContent = currentUser.username;
  document.getElementById('userRole').textContent = currentUser.role;
  document.getElementById('userAvatar').textContent = currentUser.username[0].toUpperCase();
  if (currentUser.role === 'ADMIN') document.getElementById('adminLink').style.display = '';

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

// ============ UPLOAD ============
function onFilePicked(e) {
  const f = e.target.files[0];
  if (!f) return;
  if (!f.name.endsWith('.zip')) return alert('Please select a .zip file');
  selectedFile = f;
  document.getElementById('fileChosenName').textContent = `${f.name} (${(f.size/1024/1024).toFixed(2)} MB)`;
  document.getElementById('fileChosen').classList.remove('hidden');
}
function clearFile(e) {
  e.stopPropagation();
  selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('fileChosen').classList.add('hidden');
}

// Drag & drop
const dz = document.getElementById('dropzone');
['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('dragover'); }));
dz.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f) { document.getElementById('fileInput').files = e.dataTransfer.files; onFilePicked({ target: { files: [f] } }); }
});

async function uploadBot() {
  if (!selectedFile) return alert('Please select a zip file');
  const btn = document.getElementById('uploadBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Uploading...';
  const bar = document.getElementById('uploadProgress');
  bar.classList.remove('hidden');
  bar.firstElementChild.style.width = '30%';

  try {
    const fd = new FormData();
    fd.append('file', selectedFile);
    const tok = document.getElementById('botToken').value.trim();
    if (tok) fd.append('botToken', tok);

    bar.firstElementChild.style.width = '60%';
    const r = await fetch('/api/bots/upload', { method: 'POST', headers: authHeaders(), body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Upload failed');
    bar.firstElementChild.style.width = '100%';
    setTimeout(() => {
      bar.classList.add('hidden');
      bar.firstElementChild.style.width = '0';
    }, 1200);
    alert('✅ Bot submitted! Waiting for admin approval.');
    clearFile({ stopPropagation: () => {} });
    document.getElementById('botToken').value = '';
    loadBots();
  } catch (ex) {
    alert('Error: ' + ex.message);
    bar.classList.add('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload & Verify';
  }
}

// ============ DATA ============
async function loadBots() {
  const r = await fetch('/api/bots', { headers: authHeaders() });
  if (r.status === 401) return logout();
  const { bots } = await r.json();
  const el = document.getElementById('botList');
  if (!bots.length) { el.innerHTML = '<div class="empty">No bots submitted yet</div>'; return; }
  el.innerHTML = bots.map(b => `
    <div class="bot-item">
      <img class="bot-avatar" src="${b.telegramPhotoUrl || fallbackAvatar(b.name)}" onerror="this.src='${fallbackAvatar(b.name)}'">
      <div class="bot-info">
        <strong>${esc(b.name || 'Pending')} ${b.username ? '<span style="color:#64748b;font-weight:400">@'+esc(b.username)+'</span>' : ''}</strong>
        <small>${esc(b.fileName || '')} · ${(b.fileSize/1024).toFixed(0)} KB</small>
        ${b.rejectionReason ? `<div class="reason">⚠ ${esc(b.rejectionReason)}</div>` : ''}
      </div>
      <span class="status-badge s-${b.status}">${b.status.replace(/_/g,' ')}</span>
    </div>
  `).join('');
}

async function loadNotifs() {
  const r = await fetch('/api/notifications', { headers: authHeaders() });
  if (r.status === 401) return;
  const { notifications } = await r.json();
  const el = document.getElementById('notifList');
  if (!notifications.length) { el.innerHTML = '<div class="empty">No notifications</div>'; return; }
  el.innerHTML = notifications.slice(0, 15).map(n => `
    <div class="notif-item ${n.read ? '' : 'unread'} ${n.type === 'BOT_REJECTED' ? 'rejected' : n.type === 'BOT_RUNNING' ? 'running' : ''}">
      <div class="title">${esc(n.title)}</div>
      <div style="white-space:pre-line;color:#94a3b8">${esc(n.message)}</div>
      <div class="time">${new Date(n.createdAt).toLocaleString()}</div>
    </div>
  `).join('');
}

// ============ HELPERS ============
function esc(s) { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fallbackAvatar(name) {
  const l = (name||'B')[0].toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="44" height="44" rx="12" fill="#1f2937"/><text x="22" y="28" font-size="18" fill="#64748b" text-anchor="middle" font-family="sans-serif">${l}</text></svg>`);
}

// ============ BOOT ============
(async () => {
  if (!token) return;
  try {
    const r = await fetch('/api/auth/me', { headers: authHeaders() });
    if (!r.ok) { token = null; localStorage.removeItem('token'); return; }
    currentUser = (await r.json()).user;
    await enterApp();
  } catch { token = null; localStorage.removeItem('token'); }
})();
