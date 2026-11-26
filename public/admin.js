let aToken = localStorage.getItem('aToken') || null;
let aUser = null;
let tab = 'overview';
let filter = 'PENDING_APPROVAL';
let search = '';
let pollTimer = null;

async function adminLogin(e) {
  e.preventDefault();
  const err = document.getElementById('authError');
  err.classList.add('hidden');
  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('aUser').value.trim(),
        password: document.getElementById('aPass').value
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.user.role !== 'ADMIN') throw new Error('This account is not an ADMIN');
    aToken = data.token; aUser = data.user;
    localStorage.setItem('aToken', aToken);
    enterPanel();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
}

function adminLogout() {
  localStorage.removeItem('aToken');
  location.reload();
}

function enterPanel() {
  document.getElementById('authScreen').classList.add('hidden');
  const p = document.getElementById('panelScreen');
  p.classList.remove('hidden');
  p.style.display = 'flex';
  setTab('overview');
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshBadge, 5000);
}

function ah() { return { 'Authorization': 'Bearer ' + aToken }; }

function setTab(t) {
  tab = t;
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === t));
  render();
}

async function render() {
  const m = document.getElementById('main');
  m.innerHTML = '<div class="empty">Loading...</div>';
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
      <div class="stat"><div class="label">Pending Approvals</div><div class="value" style="color:#fbbf24">${stats.pending}</div></div>
      <div class="stat"><div class="label">Running Bots</div><div class="value" style="color:#4ade80">${stats.running}</div></div>
      <div class="stat"><div class="label">Users</div><div class="value">${stats.users}</div></div>
      <div class="stat"><div class="label">Deployments</div><div class="value" style="color:#60a5fa">${stats.deployments}</div></div>
      <div class="stat"><div class="label">Failed</div><div class="value" style="color:#f87171">${stats.failed}</div></div>
      <div class="stat"><div class="label">Rejected</div><div class="value">${stats.rejected}</div></div>
    </div>
    <div class="stat" style="background:#111827">
      <div class="label">Security Note</div>
      <div style="margin-top:8px;font-size:13px;color:#94a3b8;line-height:1.6">
        All admin endpoints protected by <code style="background:#0a0e1a;padding:2px 6px;border-radius:4px">requireAdmin()</code> backend middleware. Regular users receive <b style="color:#f87171">403 Forbidden</b>. Bot deployment requires admin approval.
      </div>
    </div>
  `;
}

async function renderApprovals(m) {
  m.innerHTML = `
    <h1>Bot Approvals</h1>
    <p class="sub">Review and approve user-submitted Telegram bots before deployment.</p>
    <div class="filters">
      <button data-f="PENDING_APPROVAL" onclick="setFilter('PENDING_APPROVAL',this)" class="${filter==='PENDING_APPROVAL'?'active':''}">Pending</button>
      <button data-f="APPROVED" onclick="setFilter('APPROVED',this)" class="${filter==='APPROVED'?'active':''}">Approved</button>
      <button data-f="REJECTED" onclick="setFilter('REJECTED',this)" class="${filter==='REJECTED'?'active':''}">Rejected</button>
      <button data-f="ALL" onclick="setFilter('ALL',this)" class="${filter==='ALL'?'active':''}">All</button>
    </div>
    <input class="search" id="searchInp" placeholder="Search bot name or username..." oninput="applySearch(this.value)" value="${esc(search)}">
    <div id="approvalList"><div class="empty">Loading...</div></div>
  `;
  await loadApprovals();
  refreshBadge();
}

function setFilter(f, btn) {
  filter = f;
  document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b.dataset.f === f));
  loadApprovals();
}

function applySearch(v) {
  search = v.toLowerCase();
  document.querySelectorAll('.approval-card').forEach(c => {
    c.style.display = (c.dataset.search||'').includes(search) ? '' : 'none';
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
  const search = ((b.name||'') + (b.username||'')).toLowerCase();
  return `
    <div class="approval-card" data-search="${esc(search)}">
      <div class="card-header">
        <img class="avatar" src="${av}" onerror="this.src='${fallback(b.name)}'">
        <div>
          <div class="bot-name">${esc(b.name||'Unknown')}</div>
          <div class="bot-user">${b.username?'@'+esc(b.username):'—'}</div>
        </div>
        <span class="badge-status st-${b.status}">${b.status.replace(/_/g,' ')}</span>
      </div>
      <div class="card-body">
        <div>
          <div class="section-title">Bot Details</div>
          <div class="info">
            <div class="lbl">Bot Name</div><div class="val">${esc(b.name||'—')}</div>
            <div class="lbl">Username</div><div class="val">${b.username?'@'+esc(b.username):'—'}</div>
            <div class="lbl">Bot ID</div><div class="val mono">${esc(b.telegramBotId||'—')}</div>
            <div class="lbl">Token</div><div class="val mono" id="tok-${b.id}">${esc(b.maskedToken||'—')}</div>
            <div class="lbl"></div><div class="val"><button class="btn" style="padding:4px 10px;font-size:11px" onclick="reveal('${b.id}')">Reveal</button></div>
            <div class="lbl">Sender</div><div class="val">${b.submitter?`<a href="#" style="color:#60a5fa" onclick="viewUser('${b.submitter.id}');return false">@${esc(b.submitter.username)}</a>`:'—'}</div>
            <div class="lbl">Runtime</div><div class="val">${esc(b.runtime||'—')}</div>
            <div class="lbl">Submitted</div><div class="val">${new Date(b.submittedAt).toLocaleString()}</div>
            ${b.rejectionReason?`<div class="lbl">Rejected</div><div class="val" style="color:#f87171">${esc(b.rejectionReason)}</div>`:''}
          </div>
        </div>
        <div>
          <div class="section-title">Uploaded File</div>
          <div class="file-box">
            <div style="font-size:13px;font-weight:600">📦 ${esc(b.fileName||'—')}</div>
            <div style="color:#64748b;font-size:11px;margin-top:4px">${b.fileSize?(b.fileSize/1024/1024).toFixed(2)+' MB':'—'} · ${b.fileCount||0} files · ${esc(b.runtime||'')}</div>
            <div class="file-actions">
              <button class="btn" onclick="viewFiles('${b.id}')">View Files</button>
              <button class="btn" onclick="downloadFile('${b.id}')">Download</button>
            </div>
          </div>
          ${b.deployment?`<div class="section-title" style="margin-top:10px">Deployment</div><div class="dep-bar">${b.deployment.steps.map(s=>`<span class="dep-step ${s.status}">${s.step.replace(/_/g,' ')}</span>`).join('')}</div>`:''}
        </div>
      </div>
      ${canAct?`<div class="actions">
        <button class="btn btn-reject" onclick="openReject('${b.id}','${esc(b.name)}','${esc(b.username||'')}')">✕ Reject</button>
        <button class="btn btn-approve" onclick="openApprove('${b.id}','${esc(b.name)}','${esc(b.username||'')}','${esc(b.submitter?.username||'')}')">✓ Approve</button>
      </div>`:''}
    </div>
  `;
}

function openApprove(id, name, user, sender) {
  document.getElementById('modalContent').innerHTML = `
    <h3>Approve Bot?</h3>
    <p>Bot: <b>@${esc(user)}</b> (${esc(name)})<br>Sender: <b>@${esc(sender)}</b></p>
    <p style="color:#fbbf24;font-size:12px">Onay sonrası deployment başlar.</p>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-approve" onclick="doApprove('${id}')">Approve Bot</button>
    </div>`;
  document.getElementById('modalBg').classList.add('active');
}

function openReject(id, name, user) {
  document.getElementById('modalContent').innerHTML = `
    <h3>Reject Bot</h3>
    <p>@${esc(user)} — ${esc(name)}</p>
    <textarea id="rejectReason" placeholder="Reason for rejection (required)..." ></textarea>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-reject" onclick="doReject('${id}')">Reject Bot</button>
    </div>`;
  document.getElementById('modalBg').classList.add('active');
}

function closeModal() { document.getElementById('modalBg').classList.remove('active'); }

async function doApprove(id) {
  const r = await fetch(`/api/admin/approvals/${id}/approve`, { method: 'POST', headers: ah() });
  const d = await r.json();
  closeModal();
  if (!r.ok) return toast('Error: ' + d.error, true);
  toast('✓ Bot approved — deployment started');
  loadApprovals(); refreshBadge();
}

async function doReject(id) {
  const reason = document.getElementById('rejectReason').value.trim();
  if (!reason) return alert('Rejection reason required');
  const r = await fetch(`/api/admin/approvals/${id}/reject`, {
    method: 'POST', headers: { ...ah(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  const d = await r.json();
  closeModal();
  if (!r.ok) return toast('Error: ' + d.error, true);
  toast('Bot rejected');
  loadApprovals(); refreshBadge();
}

async function reveal(id) {
  const r = await fetch(`/api/admin/approvals/${id}/reveal-token`, { method: 'POST', headers: ah() });
  const d = await r.json();
  if (!r.ok) return toast('Error: ' + d.error, true);
  const el = document.getElementById('tok-' + id);
  el.textContent = d.token;
  setTimeout(() => { el.textContent = d.token.slice(0,12) + '••••••••'; }, 30000);
  toast('Token revealed for 30s (audit logged)');
}

async function viewFiles(id) {
  const r = await fetch(`/api/admin/approvals/${id}/files`, { headers: ah() });
  const { files } = await r.json();
  document.getElementById('modalContent').innerHTML = `
    <h3>Files (${files.length})</h3>
    <div style="max-height:400px;overflow:auto">
      ${files.map(f=>`<div style="padding:8px 0;border-bottom:1px solid #1f2937;cursor:pointer;font-size:13px" onclick="viewFile('${id}','${esc(f.name).replace(/'/g,'&#39;')}')">📄 ${esc(f.name)} <span style="color:#64748b;font-size:11px">(${(f.size/1024).toFixed(1)} KB)</span></div>`).join('') || '<div class="empty">No files</div>'}
    </div>
    <div class="modal-actions" style="margin-top:16px"><button class="btn" onclick="closeModal()">Close</button></div>`;
  document.getElementById('modalBg').classList.add('active');
}

async function viewFile(botId, name) {
  const r = await fetch(`/api/admin/approvals/${botId}/files/${encodeURIComponent(name)}`, { headers: ah() });
  const d = await r.json();
  if (!r.ok) return toast('Error: ' + d.error, true);
  document.getElementById('modalContent').innerHTML = `
    <h3>${esc(name)} <span style="font-size:10px;color:#64748b">READ-ONLY</span></h3>
    <pre class="viewer">${esc(d.content)}</pre>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`;
}

function downloadFile(id) {
  fetch(`/api/admin/approvals/${id}/download`, { headers: ah() })
    .then(r => { if (!r.ok) throw new Error('Download failed'); return r.blob(); })
    .then(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'bot.zip'; a.click();
      URL.revokeObjectURL(url);
      toast('Downloaded (audit logged)');
    })
    .catch(e => toast(e.message, true));
}

async function viewUser(id) {
  const r = await fetch('/api/admin/users/' + id, { headers: ah() });
  if (!r.ok) return toast('User not found', true);
  const { user, bots } = await r.json();
  document.getElementById('modalContent').innerHTML = `
    <h3>@${esc(user.username)}</h3>
    <div class="info" style="margin-bottom:16px">
      <div class="lbl">User ID</div><div class="val mono">${esc(user.id)}</div>
      <div class="lbl">Email</div><div class="val">${esc(user.email)}</div>
      <div class="lbl">Role</div><div class="val">${esc(user.role)}</div>
      <div class="lbl">Joined</div><div class="val">${new Date(user.createdAt).toLocaleString()}</div>
    </div>
    <div class="section-title">Bots (${bots.length})</div>
    ${bots.map(b=>`<div style="padding:6px 0;font-size:13px">${esc(b.name)} <span class="badge-status st-${b.status}" style="font-size:9px;padding:2px 8px">${b.status}</span></div>`).join('') || '<div style="color:#64748b;font-size:12px">None</div>'}
    <div class="modal-actions" style="margin-top:16px"><button class="btn" onclick="closeModal()">Close</button></div>`;
  document.getElementById('modalBg').classList.add('active');
}

async function renderRunning(m) {
  const r = await fetch('/api/admin/approvals?status=RUNNING', { headers: ah() });
  const { bots } = await r.json();
  m.innerHTML = `<h1>Running Bots</h1><p class="sub">${bots.length} active</p>` +
    (bots.length ? bots.map(b=>`<div class="approval-card" style="padding:16px;display:flex;align-items:center;gap:12px">
      <img class="avatar" src="${b.telegramPhotoUrl||fallback(b.name)}" style="width:40px;height:40px;border-radius:10px">
      <div style="flex:1"><div style="font-weight:600">${esc(b.name)}</div><div style="color:#64748b;font-size:12px">@${esc(b.username)}</div></div>
      <span class="badge-status st-RUNNING">RUNNING</span>
    </div>`).join('') : '<div class="empty">No running bots</div>');
}

async function renderDeployments(m) {
  const r = await fetch('/api/admin/approvals?status=ALL', { headers: ah() });
  const { bots } = await r.json();
  const deps = bots.filter(b => b.deployment);
  m.innerHTML = `<h1>Deployments</h1><p class="sub">${deps.length} total</p>` +
    (deps.length ? deps.map(b=>`<div class="approval-card" style="padding:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="flex:1;font-weight:600">${esc(b.name)} @${esc(b.username||'')}</div>
        <span class="badge-status st-${b.status}">${b.status}</span>
      </div>
      <div class="dep-bar">${b.deployment.steps.map(s=>`<span class="dep-step ${s.status}">${s.step.replace(/_/g,' ')}</span>`).join('')}</div>
    </div>`).join('') : '<div class="empty">No deployments</div>');
}

async function renderAudit(m) {
  const r = await fetch('/api/admin/audit', { headers: ah() });
  const { logs } = await r.json();
  m.innerHTML = `<h1>Audit Log</h1><p class="sub">Last ${logs.length} events</p>
    <div style="background:#111827;border:1px solid #1f2937;border-radius:12px;overflow:hidden">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#0a0e1a"><th style="padding:10px;text-align:left">Time</th><th style="padding:10px;text-align:left">Action</th><th style="padding:10px;text-align:left">Admin</th><th style="padding:10px;text-align:left">Target</th></tr></thead>
        <tbody>${logs.slice(0,100).map(l=>`<tr style="border-top:1px solid #1f2937">
          <td style="padding:8px 10px;color:#94a3b8">${new Date(l.createdAt).toLocaleString()}</td>
          <td style="padding:8px 10px"><code style="background:#0a0e1a;padding:2px 6px;border-radius:4px">${esc(l.action)}</code></td>
          <td style="padding:8px 10px">${esc(l.adminId||'—')}</td>
          <td style="padding:8px 10px;color:#64748b">${esc(l.targetId||'')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' error' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function esc(s) { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fallback(name) {
  const l = (name||'B')[0].toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52"><rect width="52" height="52" rx="14" fill="#1f2937"/><text x="26" y="33" font-size="22" fill="#64748b" text-anchor="middle" font-family="sans-serif">${l}</text></svg>`);
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
