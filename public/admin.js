let aToken = localStorage.getItem('aToken') || null;
let aUser = null;
let tab = 'overview';
let filter = 'PENDING_APPROVAL';
let search = '';
let pollTimer = null;

const ICON = {
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  file: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  download: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  eye: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  folder: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  box: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>'
};

async function adminLogin(e) {
  e.preventDefault();
  const err = document.getElementById('authError');
  err.classList.add('hidden');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div>';

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('aUser').value.trim(),
        password: document.getElementById('aPass').value
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.user.role !== 'ADMIN') throw new Error('This account does not have administrator privileges');
    aToken = data.token;
    aUser = data.user;
    localStorage.setItem('aToken', aToken);
    enterPanel();
  } catch (ex) {
    document.getElementById('authErrorMsg').textContent = ex.message;
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

function adminLogout() {
  localStorage.removeItem('aToken');
  location.reload();
}

function enterPanel() {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('panelScreen').classList.remove('hidden');
  document.getElementById('adminName').textContent = aUser.username;
  document.getElementById('adminAvatar').textContent = aUser.username[0].toUpperCase();
  setTab('overview');
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshBadge, 5000);
}

function ah() { return { 'Authorization': 'Bearer ' + aToken }; }

function setTab(t) {
  tab = t;
  document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.dataset.tab === t));
  render();
}

async function render() {
  const m = document.getElementById('main');
  m.innerHTML = '<div class="empty">Loading…</div>';
  if (tab === 'overview') return renderOverview(m);
  if (tab === 'approvals') return renderApprovals(m);
  if (tab === 'running') return renderRunning(m);
  if (tab === 'deployments') return renderDeployments(m);
  if (tab === 'audit') return renderAudit(m);
}

async function refreshBadge() {
  const r = await fetch('/api/admin/stats', { headers: ah() });
  if (!r.ok) return;
  const { stats } = await r.json();
  const b = document.getElementById('pendingBadge');
  b.textContent = stats.pending;
  b.classList.toggle('hidden', stats.pending === 0);
}

async function renderOverview(m) {
  const r = await fetch('/api/admin/stats', { headers: ah() });
  const { stats } = await r.json();
  refreshBadge();
  m.innerHTML = `
    <h1>Overview</h1>
    <p class="sub">System status at a glance</p>
    <div class="stats">
      <div class="stat"><div class="label">Pending approvals</div><div class="value v-warning">${stats.pending}</div></div>
      <div class="stat"><div class="label">Running bots</div><div class="value v-success">${stats.running}</div></div>
      <div class="stat"><div class="label">Users</div><div class="value">${stats.users}</div></div>
      <div class="stat"><div class="label">Deployments</div><div class="value v-accent">${stats.deployments}</div></div>
      <div class="stat"><div class="label">Failed</div><div class="value v-danger">${stats.failed}</div></div>
      <div class="stat"><div class="label">Rejected</div><div class="value">${stats.rejected}</div></div>
    </div>
    <div class="stat">
      <div class="label">Security</div>
      <div style="margin-top:10px;font-size:13px;color:var(--text-muted);line-height:1.65">
        All admin endpoints require backend <b style="color:var(--text)">requireAdmin()</b> middleware. Regular users receive <b style="color:#f87171">403 Forbidden</b>. Bots never deploy without administrator approval.
      </div>
    </div>
  `;
}

async function renderApprovals(m) {
  m.innerHTML = `
    <h1>Bot Approvals</h1>
    <p class="sub">Review and approve user-submitted Telegram bots before deployment.</p>
    <div class="filters">
      <button class="filter-btn ${filter === 'PENDING_APPROVAL' ? 'active' : ''}" data-f="PENDING_APPROVAL" onclick="setFilter('PENDING_APPROVAL',this)">Pending</button>
      <button class="filter-btn ${filter === 'APPROVED' ? 'active' : ''}" data-f="APPROVED" onclick="setFilter('APPROVED',this)">Approved</button>
      <button class="filter-btn ${filter === 'REJECTED' ? 'active' : ''}" data-f="REJECTED" onclick="setFilter('REJECTED',this)">Rejected</button>
      <button class="filter-btn ${filter === 'ALL' ? 'active' : ''}" data-f="ALL" onclick="setFilter('ALL',this)">All</button>
    </div>
    <div class="search-wrap">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input class="search-input" id="searchInp" placeholder="Search bot name or username..." oninput="applySearch(this.value)" value="${esc(search)}">
    </div>
    <div id="approvalList"><div class="empty">Loading…</div></div>
  `;
  await loadApprovals();
  refreshBadge();
}

function setFilter(f, btn) {
  filter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  loadApprovals();
}

function applySearch(v) {
  search = v.toLowerCase();
  document.querySelectorAll('.approval-card').forEach(c => {
    c.style.display = (c.dataset.search || '').includes(search) ? '' : 'none';
  });
}

async function loadApprovals() {
  const r = await fetch('/api/admin/approvals?status=' + filter, { headers: ah() });
  if (r.status === 403) return document.getElementById('approvalList').innerHTML = '<div class="empty">403 Forbidden</div>';
  const { bots } = await r.json();
  const el = document.getElementById('approvalList');
  if (!bots.length) return el.innerHTML = '<div class="empty">No bots in this category.</div>';
  el.innerHTML = bots.map(card).join('');
  applySearch(search);
}

function card(b) {
  const av = b.telegramPhotoUrl || fallback(b.name);
  const canAct = b.status === 'PENDING_APPROVAL';
  const s = ((b.name || '') + (b.username || '')).toLowerCase();
  return `
    <div class="approval-card" data-search="${esc(s)}">
      <div class="card-header">
        <img class="avatar" src="${av}" onerror="this.src='${fallback(b.name)}'">
        <div>
          <div class="bot-name">${esc(b.name || 'Unknown')}</div>
          <div class="bot-user">${b.username ? '@' + esc(b.username) : '—'}</div>
        </div>
        <span class="chip chip-${b.status}">${b.status.replace(/_/g, ' ')}</span>
      </div>
      <div class="card-body">
        <div>
          <div class="section-title">Bot details</div>
          <div class="info-list">
            <div class="info-item"><span class="lbl">Bot name</span><span class="val">${esc(b.name || '—')}</span></div>
            <div class="info-item"><span class="lbl">Username</span><span class="val">${b.username ? '@' + esc(b.username) : '—'}</span></div>
            <div class="info-item"><span class="lbl">Bot ID</span><span class="val mono">${esc(b.telegramBotId || '—')}</span></div>
            <div class="info-item"><span class="lbl">Token</span><span class="val mono" id="tok-${b.id}">${esc(b.maskedToken || '—')}</span></div>
            <div class="info-item"><span class="lbl">Sender</span><span class="val">${b.submitter ? `<a href="#" onclick="viewUser('${b.submitter.id}');return false">@${esc(b.submitter.username)}</a>` : '—'}</span></div>
            <div class="info-item"><span class="lbl">Runtime</span><span class="val">${esc(b.runtime || '—')}</span></div>
            <div class="info-item"><span class="lbl">Submitted</span><span class="val">${new Date(b.submittedAt).toLocaleString()}</span></div>
            ${b.rejectionReason ? `<div class="info-item"><span class="lbl">Rejected</span><span class="val bad">${esc(b.rejectionReason)}</span></div>` : ''}
          </div>
          <button class="reveal-btn" style="margin-top:12px" onclick="reveal('${b.id}')">Reveal token</button>
        </div>
        <div>
          <div class="section-title">Uploaded file</div>
          <div class="file-box">
            <div class="file-box-head">${ICON.box}<span class="file-box-name">${esc(b.fileName || '—')}</span></div>
            <div class="file-box-meta">${b.fileSize ? (b.fileSize / 1024 / 1024).toFixed(2) + ' MB' : '—'} · ${b.fileCount || 0} files · ${esc(b.runtime || '')}</div>
            <div class="file-box-actions">
              <button class="action-btn" onclick="viewFiles('${b.id}')">${ICON.folder} View files</button>
              <button class="action-btn" onclick="downloadFile('${b.id}')">${ICON.download} Download</button>
            </div>
          </div>
          ${b.deployment ? `<div class="section-title" style="margin-top:14px">Deployment</div><div class="dep-bar">${b.deployment.steps.map(st => `<span class="dep-step ${st.status}">${st.step.replace(/_/g, ' ')}</span>`).join('')}</div>` : ''}
        </div>
      </div>
      ${canAct ? `<div class="card-actions">
        <button class="btn btn-reject" onclick="openReject('${b.id}','${esc(b.name)}','${esc(b.username || '')}')">${ICON.x} Reject</button>
        <button class="btn btn-approve" onclick="openApprove('${b.id}','${esc(b.name)}','${esc(b.username || '')}','${esc(b.submitter?.username || '')}')">${ICON.check} Approve</button>
      </div>` : ''}
    </div>
  `;
}

function openApprove(id, name, user, sender) {
  document.getElementById('modalContent').innerHTML = `
    <h3>Approve this bot?</h3>
    <p>You are about to approve <strong>@${esc(user)}</strong> (${esc(name)}) submitted by <strong>@${esc(sender)}</strong>. Deployment will begin immediately after approval.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-success" onclick="doApprove('${id}')">Approve bot</button>
    </div>`;
  document.getElementById('modalBg').classList.add('active');
}

function openReject(id, name, user) {
  document.getElementById('modalContent').innerHTML = `
    <h3>Reject bot</h3>
    <p>@${esc(user)} — ${esc(name)}</p>
    <textarea id="rejectReason" placeholder="Reason for rejection (required)..."></textarea>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="doReject('${id}')">Reject bot</button>
    </div>`;
  document.getElementById('modalBg').classList.add('active');
}

function closeModal() { document.getElementById('modalBg').classList.remove('active'); }

async function doApprove(id) {
  const r = await fetch(`/api/admin/approvals/${id}/approve`, { method: 'POST', headers: ah() });
  const d = await r.json();
  closeModal();
  if (!r.ok) return toast('Error: ' + d.error, 'error');
  toast('Bot approved — deployment started', 'success');
  loadApprovals();
  refreshBadge();
}

async function doReject(id) {
  const reason = document.getElementById('rejectReason').value.trim();
  if (!reason) return alert('Rejection reason required');
  const r = await fetch(`/api/admin/approvals/${id}/reject`, {
    method: 'POST',
    headers: { ...ah(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  const d = await r.json();
  closeModal();
  if (!r.ok) return toast('Error: ' + d.error, 'error');
  toast('Bot rejected', 'success');
  loadApprovals();
  refreshBadge();
}

async function reveal(id) {
  const r = await fetch(`/api/admin/approvals/${id}/reveal-token`, { method: 'POST', headers: ah() });
  const d = await r.json();
  if (!r.ok) return toast('Error: ' + d.error, 'error');
  const el = document.getElementById('tok-' + id);
  el.textContent = d.token;
  setTimeout(() => { el.textContent = d.token.slice(0, 12) + '••••••••'; }, 30000);
  toast('Token revealed for 30 seconds', 'success');
}

async function viewFiles(id) {
  const r = await fetch(`/api/admin/approvals/${id}/files`, { headers: ah() });
  const { files } = await r.json();
  document.getElementById('modalContent').innerHTML = `
    <h3>Archive contents <span style="font-size:11px;color:var(--text-muted);font-weight:400">${files.length} files</span></h3>
    <div style="max-height:420px;overflow:auto;margin-bottom:16px">
      ${files.map(f => `<div class="file-tree-item" onclick="viewFile('${id}','${esc(f.name).replace(/'/g, '&#39;')}')">${ICON.file}<span class="name">${esc(f.name)}</span><span class="size">${(f.size / 1024).toFixed(1)} KB</span></div>`).join('') || '<div class="empty">No files</div>'}
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`;
  document.getElementById('modalBg').classList.add('active');
}

async function viewFile(botId, name) {
  const r = await fetch(`/api/admin/approvals/${botId}/files/${encodeURIComponent(name)}`, { headers: ah() });
  const d = await r.json();
  if (!r.ok) return toast('Error: ' + d.error, 'error');
  document.getElementById('modalContent').innerHTML = `
    <h3>${esc(name)} <span style="font-size:10.5px;color:var(--text-dim);font-weight:600;letter-spacing:.5px">READ-ONLY</span></h3>
    <pre class="viewer">${esc(d.content)}</pre>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`;
}

function downloadFile(id) {
  fetch(`/api/admin/approvals/${id}/download`, { headers: ah() })
    .then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bot.zip';
      a.click();
      URL.revokeObjectURL(url);
      toast('Downloaded (audit logged)', 'success');
    })
    .catch(e => toast(e.message, 'error'));
}

async function viewUser(id) {
  const r = await fetch('/api/admin/users/' + id, { headers: ah() });
  if (!r.ok) return toast('User not found', 'error');
  const { user, bots } = await r.json();
  document.getElementById('modalContent').innerHTML = `
    <h3>@${esc(user.username)}</h3>
    <div class="info-list" style="margin-bottom:18px">
      <div class="info-item"><span class="lbl">User ID</span><span class="val mono">${esc(user.id)}</span></div>
      <div class="info-item"><span class="lbl">Email</span><span class="val">${esc(user.email)}</span></div>
      <div class="info-item"><span class="lbl">Role</span><span class="val">${esc(user.role)}</span></div>
      <div class="info-item"><span class="lbl">Joined</span><span class="val">${new Date(user.createdAt).toLocaleString()}</span></div>
    </div>
    <div class="section-title">Bots (${bots.length})</div>
    ${bots.map(b => `<div class="file-tree-item" style="cursor:default">${ICON.file}<span class="name">${esc(b.name)}</span><span class="chip chip-${b.status}">${b.status}</span></div>`).join('') || '<div class="empty">None</div>'}
    <div class="modal-actions" style="margin-top:16px"><button class="btn btn-ghost" onclick="closeModal()">Close</button></div>`;
  document.getElementById('modalBg').classList.add('active');
}

async function renderRunning(m) {
  const r = await fetch('/api/admin/approvals?status=RUNNING', { headers: ah() });
  const { bots } = await r.json();
  m.innerHTML = `<h1>Running Bots</h1><p class="sub">${bots.length} active</p>` +
    (bots.length ? bots.map(b => `<div class="approval-card" style="padding:16px 20px;display:flex;align-items:center;gap:14px">
      <img class="avatar" src="${b.telegramPhotoUrl || fallback(b.name)}" style="width:40px;height:40px;border-radius:11px">
      <div style="flex:1"><div style="font-weight:600;font-size:14px">${esc(b.name)}</div><div style="color:var(--text-muted);font-size:12px">@${esc(b.username)}</div></div>
      <span class="chip chip-RUNNING">RUNNING</span>
    </div>`).join('') : '<div class="empty">No running bots.</div>');
}

async function renderDeployments(m) {
  const r = await fetch('/api/admin/approvals?status=ALL', { headers: ah() });
  const { bots } = await r.json();
  const deps = bots.filter(b => b.deployment);
  m.innerHTML = `<h1>Deployments</h1><p class="sub">${deps.length} total</p>` +
    (deps.length ? deps.map(b => `<div class="approval-card" style="padding:18px 22px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="flex:1;font-weight:600">${esc(b.name)} <span style="color:var(--text-muted);font-weight:400;font-size:12px">@${esc(b.username || '')}</span></div>
        <span class="chip chip-${b.status}">${b.status}</span>
      </div>
      <div class="dep-bar">${b.deployment.steps.map(s => `<span class="dep-step ${s.status}">${s.step.replace(/_/g, ' ')}</span>`).join('')}</div>
    </div>`).join('') : '<div class="empty">No deployments yet.</div>');
}

async function renderAudit(m) {
  const r = await fetch('/api/admin/audit', { headers: ah() });
  const { logs } = await r.json();
  m.innerHTML = `<h1>Audit Log</h1><p class="sub">Last ${logs.length} events</p>
    <table class="audit-table">
      <thead><tr><th>Time</th><th>Action</th><th>Admin</th><th>Target</th></tr></thead>
      <tbody>${logs.slice(0, 100).map(l => `<tr>
        <td class="muted">${new Date(l.createdAt).toLocaleString()}</td>
        <td><code>${esc(l.action)}</code></td>
        <td>${esc(l.adminId || '—')}</td>
        <td class="muted">${esc(l.targetId || '')}</td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function toast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = 'toast show ' + type;
  t.innerHTML = (type === 'error' ? ICON.x : ICON.check) + `<span>${esc(msg)}</span>`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

function esc(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fallback(name) {
  const l = (name || 'B')[0].toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" rx="14" fill="#161920"/><text x="26" y="33" font-size="21" fill="#5a6273" text-anchor="middle" font-family="sans-serif" font-weight="600">${l}</text></svg>`);
}

(async () => {
  if (!aToken) return;
  try {
    const r = await fetch('/api/auth/me', { headers: ah() });
    if (!r.ok) { localStorage.removeItem('aToken'); return; }
    const u = (await r.json()).user;
    if (u.role !== 'ADMIN') { localStorage.removeItem('aToken'); return; }
    aUser = u;
    enterPanel();
  } catch { localStorage.removeItem('aToken'); }
})();
