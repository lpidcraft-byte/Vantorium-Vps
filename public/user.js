// user.js
async function login(userId) {
  const r = await fetch('/api/demo/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  if (r.ok) { document.getElementById('login').style.display = 'none'; document.getElementById('app').style.display = 'block'; loadAll(); }
}

async function upload() {
  const fileInput = document.getElementById('file');
  const tokenInput = document.getElementById('botToken').value.trim();
  if (!fileInput.files[0]) return alert('Dosya seç');
  const fd = new FormData();
  fd.append('file', fileInput.files[0]);
  if (tokenInput) fd.append('botToken', tokenInput);
  const r = await fetch('/api/bots/upload', { method: 'POST', body: fd });
  const data = await r.json();
  if (!r.ok) return alert('Hata: ' + data.error);
  alert('Bot gönderildi! Admin onayı bekleniyor.');
  loadAll();
}

async function loadAll() { await Promise.all([loadBots(), loadNotifs()]); }

async function loadBots() {
  const r = await fetch('/api/bots');
  if (!r.ok) return;
  const { bots } = await r.json();
  const el = document.getElementById('bots');
  if (!bots.length) return el.innerHTML = '<p class="muted">Henüz bot yok.</p>';
  el.innerHTML = bots.map(b => `
    <div class="bot-row">
      <img class="avatar" src="${b.telegramPhotoUrl || fallbackAvatar(b.name)}" alt="">
      <div style="flex:1;">
        <div style="font-weight:600;">${esc(b.name || 'Pending')} ${b.username ? '@'+esc(b.username) : ''}</div>
        <div class="muted">${esc(b.fileName || '')} · ${(b.fileSize/1024).toFixed(1)} KB</div>
        ${b.rejectionReason ? `<div class="muted" style="color:#f87171;margin-top:4px;">Reason: ${esc(b.rejectionReason)}</div>` : ''}
      </div>
      <span class="status s-${b.status}">● ${b.status.replace(/_/g,' ')}</span>
    </div>
  `).join('');
}

async function loadNotifs() {
  const r = await fetch('/api/notifications');
  if (!r.ok) return;
  const { notifications } = await r.json();
  const el = document.getElementById('notifications');
  if (!notifications.length) return el.innerHTML = '<p class="muted">Bildirim yok.</p>';
  el.innerHTML = notifications.slice(0,10).map(n => `
    <div class="notif">
      <strong>${esc(n.title)}</strong><br>
      <span style="white-space:pre-line;">${esc(n.message)}</span>
      <div class="muted" style="margin-top:4px;">${new Date(n.createdAt).toLocaleString()}</div>
    </div>
  `).join('');
}

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fallbackAvatar(name) {
  const letter = (name || 'B')[0].toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="24" fill="#334155"/><text x="24" y="32" font-size="22" fill="#94a3b8" text-anchor="middle" font-family="sans-serif">${letter}</text></svg>`);
}
</script>
