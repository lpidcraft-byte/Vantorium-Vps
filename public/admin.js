// admin.js
let currentTab = 'overview';
let approvalsFilter = 'PENDING_APPROVAL';

async function login(userId) {
  const r = await fetch('/api/demo/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  if (!r.ok) return alert('Login failed');
  // Admin kontrolü
  const me = await fetch('/api/admin/stats');
  if (!me.ok) {
    document.getElementById('login').style.display = 'block';
    return alert('Bu kullanıcı ADMIN değil — 403. Backend doğru şekilde korumalı.');
  }
  document.getElementById('login').style.display = 'none';
  const root = document.getElementById('adminRoot');
  root.style.display = 'flex';
  setTab('overview');
}

function setTab(tab, el) {
  currentTab = tab;
  if (el) {
    document.querySelectorAll('.nav a').forEach(a => a.classList.remove('active'));
    el.classList.add('active');
  }
  render();
}

async function render() {
  const main = document.getElementById('main');
  if (currentTab === 'overview') return renderOverview(main);
  if (currentTab === 'approvals') return renderApprovals(main);
  if (currentTab === 'users') return renderUsers(main);
  if (currentTab === 'bots') return renderRunningBots(main);
  if (currentTab === 'deployments') return renderDeployments(main);
  if (currentTab === 'audit') return renderAudit(main);
  main.innerHTML = `<h1>${currentTab}</h1><p class="subtitle">Bu bölüm henüz boş.</p>`;
}

async function refreshBadge() {
  const r = await fetch('/api/admin/stats');
  if (!r.ok) return;
  const { stats } = await r.json();
  document.getElementById('pendingBadge').textContent = stats.pendingApprovals;
  document.getElementById('pendingBadge').style.display = stats.pendingApprovals > 0 ? '' : 'none';
}

async function renderOverview(main) {
  const r = await fetch('/api/admin/stats');
  const { stats } = await r.json();
  await refreshBadge();
  main.innerHTML = `
    <h1>Overview</h1>
    <p class="subtitle">System status at a glance</p>
    <div class="stats">
      <div class="stat"><div class="label">Pending Approvals</div><div class="value" style="color:#fbbf24;">${stats.pendingApprovals}</div></div>
      <div class="stat"><div class="label">Running Bots</div><div class="value" style="color:#4ade80;">${stats.running}</div></div>
      <div class="stat"><div class="label">Users</div><div class="value">${stats.totalUsers}</div></div>
      <div class="stat"><div class="label">Deployments</div><div class="value" style="color:#60a5fa;">${stats.totalDeployments}</div></div>
      <div class="stat"><div class="label">Failed Deployments</div><div class="value" style="color:#f87171;">${stats.failedDeployments}</div></div>
      <div class="stat"><div class="label">Rejected</div><div class="value">${stats.rejected}</div></div>
    </div>
    <div class="stat" style="margin-top:24px;">
      <div class="label">Security</div>
      <div style="margin-top:8px; font-size:13px; color:#94a3b8;">Tüm admin endpoint'leri backend <code>requireAdmin()</code> middleware ile korunuyor. Botlar admin onayı olmadan çalışmaz.</div>
    </div>
  `;
}

async function renderApprovals(main) {
  main.innerHTML = `
    <h1>Bot Approvals</h1>
    <p class="subtitle">Review and approve user-submitted Telegram bots before deployment.</p>
    <div class="filters">
      <button data-f="PENDING_APPROVAL" onclick="setFilter('PENDING_APPROVAL',this)">Pending</button>
      <button data-f="APPROVED" onclick="setFilter('APPROVED',this)">Approved</button>
      <button data-f="REJECTED" onclick="setFilter('REJECTED',this)">Rejected</button>
      <button data-f="ALL" onclick="setFilter('ALL',this)">All</button>
    </div>
    <input class="search" id="searchInput" placeholder="Search bot name or username..." oninput="applySearch()">
    <div id="approvalList"></div>
  `;
  // Aktif filter
  document.querySelectorAll('.filters button').forEach(b => {
    b.classList.toggle('active', b.dataset.f === approvalsFilter);
  });
  await loadApprovals();
  await refreshBadge();
}

function setFilter(f, btn) {
  approvalsFilter = f;
  document.querySelectorAll('.filters button').forEach(b => b.classList.toggle('active', b === btn));
  loadApprovals();
}

async function loadApprovals() {
  const r = await fetch('/api/admin/approvals?status=' + approvalsFilter);
  if (r.status === 403) { document.getElementById('approvalList').innerHTML = '<div class="empty">403 Forbidden — ADMIN only</div>'; return; }
  const { bots } = await r.json();
  const list = document.getElementById('approvalList');
  if (!bots.length) return list.innerHTML = '<div class="empty">No bots in this category.</div>';
  list.innerHTML = bots.map(cardHTML).join('');
}

let searchQuery = '';
function applySearch() {
  searchQuery = document.getElementById('searchInput').value.toLowerCase();
  document.querySelectorAll('.approval-card').forEach(card => {
    const t = card.dataset.search || '';
    card.style.display = t.includes(searchQuery) ? '' : 'none';
  });
}

function cardHTML(bot) {
  const avatar = bot.telegramPhotoUrl || fallbackAvatar(bot.name);
  const canAct = bot.status === 'PENDING_APPROVAL';
  const searchText = ((bot.name || '') + (bot.username || '')).toLowerCase();
  const dep = bot.deployment;
  return `
    <div class="approval-card" data-search="${esc(searchText)}">
      <div class="card-header">
        <img class="avatar" src="${avatar}" alt="">
        <div>
          <div class="bot-name">${esc(bot.name || 'Unknown')}</div>
          <div class="bot-username">${bot.username ? '@' + esc(bot.username) : '—'}</div>
        </div>
        <span class="badge-status st-${bot.status}">● ${bot.status.replace(/_/g,' ')}</span>
      </div>
      <div class="card-body">
        <div>
          <div class="section-title">Bot Details</div>
          <div class="info-grid">
            <div class="label">Bot Name</div><div class="value">${esc(bot.name || '—')}</div>
            <div class="label">Username</div><div class="value">${bot.username ? '@'+esc(bot.username) : '—'}</div>
            <div class="label">Bot ID</div><div class="value mono">${esc(bot.telegramBotId || '—')}</div>
            <div class="label">Token</div><div class="value mono" id="token-${bot.id}">${esc(bot.maskedToken || '—')}</div>
            <div class="label"></div><div class="value"><button class="btn" style="font-size:11px;padding:4px 10px;" onclick="revealToken('${bot.id}')">Reveal</button></div>
            <div class="label">Sender</div><div class="value">${bot.submitter ? `<a href="#" style="color:#60a5fa;" onclick="viewUser('${bot.submitter.id}')">@${esc(bot.submitter.username)}</a>` : '—'}</div>
            <div class="label">Runtime</div><div class="value">${esc(bot.runtime || '—')}</div>
            <div class="label">Submitted</div><div class="value">${new Date(bot.submittedAt).toLocaleString()}</div>
            ${bot.rejectionReason ? `<div class="label">Rejection</div><div class="value" style="color:#f87171;">${esc(bot.rejectionReason)}</div>` : ''}
          </div>
        </div>
        <div>
          <div class="section-title">Uploaded File</div>
          <div class="file-box">
            <div style="font-size:14px;font-weight:600;">📦 ${esc(bot.fileName || '—')}</div>
            <div class="muted" style="margin-top:4px;">Size: ${bot.fileSize ? (bot.fileSize/1024/1024).toFixed(2) + ' MB' : '—'} · ${bot.fileCount || 0} files</div>
            <div class="file-actions">
              <button class="btn" onclick="viewFiles('${bot.id}')">View Files</button>
              <button class="btn" onclick="downloadFile('${bot.id}')">Download</button>
            </div>
          </div>
          ${dep && (bot.status === 'DEPLOYING' || bot.status === 'RUNNING') ? `
            <div class="section-title" style="margin-top:12px;">Deployment Progress</div>
            <div class="deployment-bar">
              ${dep.steps.map(s => `<span class="dep-step ${s.status.toLowerCase()}">${s.step.replace(/_/g,' ')}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      </div>
      ${canAct ? `
        <div class="actions">
          <button class="btn btn-reject" onclick="openRejectModal('${bot.id}', '${esc(bot.name)}', '${esc(bot.username||'')}')">✕ Reject</button>
          <button class="btn btn-approve" onclick="openApproveModal('${bot.id}', '${esc(bot.name)}', '${esc(bot.username||'')}', '${esc(bot.submitter?.username||'')}')">✓ Approve</button>
        </div>
      ` : ''}
    </div>
  `;
}

function openApproveModal(botId, name, username, submitter) {
  const m = document.getElementById('modal');
  document.getElementById('modalContent').innerHTML = `
    <h3>Approve Bot</h3>
    <p>Are you sure you want to approve this bot?<br><br>
    <strong>Bot:</strong> @${esc(username)}<br>
    <strong>Name:</strong> ${esc(name)}<br>
    <strong>Sender:</strong> @${esc(submitter)}</p>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-approve" onclick="doApprove('${botId}')">Approve Bot</button>
    </div>
  `;
  m.classList.add('active');
}

function openRejectModal(botId, name, username) {
  const m = document.getElementById('modal');
  document.getElementById('modalContent').innerHTML = `
    <h3>Reject Bot</h3>
    <p>@${esc(username)} — ${esc(name)}</p>
    <textarea id="rejectReason" placeholder="Reason for rejection (required)..."></textarea>
    <div class="modal-actions">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-reject" onclick="doReject('${botId}')">Reject Bot</button>
    </div>
  `;
  m.classList.add('active');
}

function closeModal() { document.getElementById('modal').classList.remove('active'); }

async function doApprove(botId) {
  const r = await fetch(`/api/admin/approvals/${botId}/approve`, { method: 'POST' });
  const data = await r.json();
  closeModal();
  if (!r.ok) return toast('Error: ' + data.error, true);
  toast('Bot approved — deployment queued');
  loadApprovals();
  refreshBadge();
}

async function doReject(botId) {
  const reason = document.getElementById('rejectReason').value.trim();
  if (!reason) return alert('Rejection reason is required');
  const r = await fetch(`/api/admin/approvals/${botId}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  const data = await r.json();
  closeModal();
  if (!r.ok) return toast('Error: ' + data.error, true);
  toast('Bot rejected');
  loadApprovals();
  refreshBadge();
}

async function revealToken(botId) {
  const r = await fetch(`/api/admin/approvals/${botId}/reveal-token`, { method: 'POST' });
  const data = await r.json();
  if (!r.ok) return toast('Error: ' + data.error, true);
  const el = document.getElementById('token-' + botId);
  el.textContent = data.token;
  el.dataset.revealed = '1';
  setTimeout(() => {
    el.textContent = el.textContent.slice(0, 12) + '••••••••';
    delete el.dataset.revealed;
  }, 30000);
  toast('Token revealed for 30s (audit logged)');
}

async function viewFiles(botId) {
  const r = await fetch(`/api/admin/approvals/${botId}/files`);
  const { files } = await r.json();
  const m = document.getElementById('modal');
  document.getElementById('modalContent').innerHTML = `
    <h3>Files (${files.length})</h3>
    <div style="max-height:400px;overflow:auto;">${files.map(f => `
      <div style="padding:6px 0;border-bottom:1px solid #334155;cursor:pointer;font-size:13px;" onclick="viewFile('${botId}','${esc(f.name).replace(/'/g,'&#39;')}')">
        📄 ${esc(f.name)} <span class="muted">(${(f.size/1024).toFixed(1)} KB)</span>
      </div>
    `).join('')}</div>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>
  `;
  m.classList.add('active');
}

async function viewFile(botId, fileName) {
  const r = await fetch(`/api/admin/approvals/${botId}/files/${encodeURIComponent(fileName)}`);
  const data = await r.json();
  if (!r.ok) return toast('Error: ' + data.error, true);
  document.getElementById('modalContent').innerHTML = `
    <h3>${esc(fileName)} <span style="font-size:11px;color:#64748b;">READ-ONLY</span></h3>
    <pre class="viewer">${esc(data.content)}</pre>
    <div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>
  `;
}

function downloadFile(botId) {
  window.location.href = `/api/admin/approvals/${botId}/download`;
}

async function viewUser(userId) {
  const r = await fetch(`/api/admin/users/${userId}`);
  if (!r.ok) return toast('User not found', true);
  const { user, bots } = await r.json();
  const m = document.getElementById('modal');
  document.getElementById('modalContent').innerHTML = `
    <h3>User: @${esc(user.username)}</h3>
    <div class="info-grid" style="margin-bottom:16px;">
      <div class="label">User ID</div><div class="value mono">${esc(user.id)}</div>
      <div class="label">Email</div><div class="value">${esc(user.email)}</div>
      <div class="label">Role</div><div class="value">${esc(user.role)}</div>
      <div class="label">Joined</div><div class="value">${new Date(user.createdAt).toLocaleString()}</div>
      <div class="label">Bots</div><div class="value">${bots.length}</div>
    </div>
    <div class="section-title">Submitted Bots</div>
    ${bots.map(b => `<div style="padding:6px 0;font-size:13px;">${esc(b.name)} — <span class="badge-status st-${b.status}" style="font-size:10px;padding:2px 8px;">${b.status}</span></div>`).join('') || '<div class="muted">None</div>'}
    <div class="modal-actions" style="margin-top:16px;"><button class="btn" onclick="closeModal()">Close</button></div>
  `;
  m.classList.add('active');
}

async function renderUsers(main) {
  main.innerHTML = `<h1>Users</h1><p class="subtitle">Admin user management</p><div class="empty">User list from /api/admin/users — demo users: admin-1, user-1</div>`;
}

async function renderRunningBots(main) {
  const r = await fetch('/api/admin/approvals?status=RUNNING');
  const { bots } = await r.json();
  main.innerHTML = `<h1>Running Bots</h1><p class="subtitle">${bots.length} active</p>` +
    bots.map(b => `<div class="approval-card" style="padding:16px;display:flex;align-items:center;gap:12px;">
      <img class="avatar" src="${b.telegramPhotoUrl || fallbackAvatar(b.name)}" style="width:40px;height:40px;">
      <div style="flex:1;"><div style="font-weight:600;">${esc(b.name)}</div><div class="muted">@${esc(b.username)}</div></div>
      <span class="badge-status st-RUNNING">● RUNNING</span>
    </div>`).join('') || '<div class="empty">No running bots.</div>';
}

async function renderDeployments(main) {
  const r = await fetch('/api/admin/approvals?status=ALL');
  const { bots } = await r.json();
  const deploys = bots.filter(b => b.deployment);
  main.innerHTML = `<h1>Deployments</h1><p class="subtitle">${deploys.length} total</p>` +
    deploys.map(b => `<div class="approval-card" style="padding:16px;">
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="flex:1;font-weight:600;">${esc(b.name)} @${esc(b.username||'')}</div>
        <span class="badge-status st-${b.status}">${b.status}</span>
      </div>
      <div class="deployment-bar">${(b.deployment.steps||[]).map(s => `<span class="dep-step ${s.status.toLowerCase()}">${s.step}</span>`).join('')}</div>
    </div>`).join('') || '<div class="empty">No deployments.</div>';
}

async function renderAudit(main) {
  const r = await fetch('/api/admin/audit');
  const { logs } = await r.json();
  main.innerHTML = `<h1>Audit Log</h1><p class="subtitle">Last ${logs.length} events</p>
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#0f172a;"><th style="padding:10px;text-align:left;">Time</th><th style="padding:10px;text-align:left;">Action</th><th style="padding:10px;text-align:left;">Admin</th><th style="padding:10px;text-align:left;">Target</th></tr></thead>
        <tbody>${logs.slice(0,100).map(l => `<tr style="border-top:1px solid #334155;">
          <td style="padding:8px 10px;">${new Date(l.createdAt).toLocaleString()}</td>
          <td style="padding:8px 10px;"><code>${esc(l.action)}</code></td>
          <td style="padding:8px 10px;">${esc(l.adminId || '—')}</td>
          <td style="padding:8px 10px;">${esc(l.targetType)}:${esc((l.targetId||'').slice(0,12))}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

function toast(msg, isError) {
  const t = document.createElement('div');
  t.className = 'toast';
  if (isError) t.style.borderLeftColor = '#dc2626';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

function esc(s) { return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function fallbackAvatar(name) {
  const letter = (name||'B')[0].toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56"><circle cx="28" cy="28" r="28" fill="#334155"/><text x="28" y="38" font-size="26" fill="#94a3b8" text-anchor="middle" font-family="sans-serif">${letter}</text></svg>`);
}
