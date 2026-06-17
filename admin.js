/**
 * SAMY CLOUD BAKERY — admin.js
 * Order management, menu manager, daily stock control, analytics, reviews.
 */
import {
  adminLogin,
  adminLogout,
  adminFetchOrders,
  adminFetchOrderItems,
  adminUpdateOrderStatus,
  adminFetchMenuItems,
  adminUpdateMenu,
  adminDeleteMenuItem,
  adminSetDailyStock,
  adminResetAllStock,
  adminFetchAnalytics,
  adminFetchReviews,
  sendCustomerEmail,
  getConfig,
} from './api.js';

// ─── UTILITIES ────────────────────────────────────────────────
function esc(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#x27;' }[c]));
}
function truncate(str, len = 55) {
  if (!str) return '—';
  return str.length > len ? str.slice(0, len) + '…' : str;
}
function formatDate(str) {
  if (!str) return '—';
  try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(str)); }
  catch { return str; }
}
function formatDateTime(str) {
  if (!str) return '—';
  try { return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(str)); }
  catch { return str; }
}
function shortId(id) {
  return id ? String(id).slice(-8).toUpperCase() : '—';
}
function pwStrength(pw) {
  let s = 0;
  if (pw.length >= 8)  s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

// ─── TOAST ────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  let el = document.getElementById('admin-toast');
  if (!el) { el = document.createElement('div'); el.id = 'admin-toast'; el.className = 'admin-toast'; document.body.appendChild(el); }
  el.className = `admin-toast show${type !== 'success' ? ' ' + type : ''}`;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3500);
}

// ─── MODAL HELPERS ────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }

// ─── SESSION TIMER ────────────────────────────────────────────
const SESSION_MS  = 30 * 60 * 1000;
const WARNING_MS  = 5  * 60 * 1000;
let sessionExpiry = null;
let sessionInterval = null;
const ACT_EVENTS = ['click','keydown','mousemove','touchstart'];

function resetSession() { sessionExpiry = Date.now() + SESSION_MS; }
function startSession() {
  resetSession();
  ACT_EVENTS.forEach(e => document.addEventListener(e, resetSession, { passive: true }));
  const dot   = document.getElementById('session-dot');
  const label = document.getElementById('session-label');
  sessionInterval = setInterval(() => {
    const rem = sessionExpiry - Date.now();
    if (rem <= 0) { clearInterval(sessionInterval); toast('Session expired.', 'error'); setTimeout(doLogout, 1200); return; }
    const mins = Math.ceil(rem / 60000);
    if (label) label.textContent = `${mins}m remaining`;
    if (dot) dot.classList.toggle('warning', rem <= WARNING_MS);
  }, 10_000);
}
function stopSession() {
  clearInterval(sessionInterval);
  ACT_EVENTS.forEach(e => document.removeEventListener(e, resetSession));
}

function adminGetToken() {
  try {
    const keys = Object.keys(localStorage).filter(k => k.includes('-auth-token'));
    if (!keys.length) return null;
    return JSON.parse(localStorage.getItem(keys[0]))?.access_token || null;
  } catch { return null; }
}

function doLogout() {
  stopSession();
  adminLogout();
  document.getElementById('dashboard').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-form')?.reset();
  const btn = document.getElementById('login-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'SIGN IN'; }
  document.getElementById('two-fa-wrap').style.display = 'none';
}

// ──────────────────────────────────────
// MAIN
// ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  const loginScreen = document.getElementById('login-screen');
  const dashboard   = document.getElementById('dashboard');
  const loginForm   = document.getElementById('login-form');
  const loginError  = document.getElementById('login-error');
  const loginBtn    = document.getElementById('login-btn');
  const pwInput     = document.getElementById('admin-password');
  const twoFaWrap   = document.getElementById('two-fa-wrap');

  // Already logged in?
  if (adminGetToken()) showDashboard();

  // ── Password strength ──
  pwInput?.addEventListener('focus', () => { document.getElementById('pw-strength-wrap').style.display = 'block'; });
  pwInput?.addEventListener('input', () => {
    const score = pwStrength(pwInput.value);
    const bar   = document.getElementById('pw-strength-bar');
    const lbl   = document.getElementById('pw-strength-label');
    const colors = ['#ef5350','#ff7043','#ffa726','#66bb6a','#42a5f5'];
    const labels = ['Very weak','Weak','Fair','Strong','Very strong'];
    if (bar) { bar.style.width = `${(score/5)*100}%`; bar.style.background = colors[Math.min(score-1,4)] || '#555'; }
    if (lbl) lbl.textContent = score > 0 ? labels[Math.min(score-1,4)] : '';
  });

  // ── OTP ──
  document.querySelectorAll('.otp-digit').forEach((inp, i, all) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '');
      if (inp.value && i < all.length - 1) all[i+1].focus();
      if (i === all.length - 1 && inp.value) attemptOtp();
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Backspace' && !inp.value && i > 0) all[i-1].focus(); });
  });

  function attemptOtp() {
    const code  = [...document.querySelectorAll('.otp-digit')].map(i => i.value).join('');
    const errEl = document.getElementById('otp-error');
    if (code.length < 6) { if (errEl) errEl.textContent = 'Enter all 6 digits.'; return; }
    if (errEl) errEl.textContent = '';
    twoFaWrap.style.display = 'none';
    showDashboard();
  }

  // ── Forgot password ──
  document.getElementById('forgot-pw-link')?.addEventListener('click', () => {
    const w = document.getElementById('forgot-pw-wrap');
    w.style.display = w.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('send-reset-btn')?.addEventListener('click', async () => {
    const email = document.getElementById('reset-email').value.trim();
    const msgEl = document.getElementById('reset-msg');
    const btn   = document.getElementById('send-reset-btn');
    if (!email) { msgEl.style.color = '#ef9a9a'; msgEl.textContent = 'Please enter an email.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const cfg = await getConfig();
      const res = await fetch(`${cfg.supabaseUrl}/auth/v1/recover`, {
        method: 'POST',
        headers: { 'apikey': cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      msgEl.style.color = res.ok ? '#a5d6a7' : '#ef9a9a';
      msgEl.textContent = res.ok ? 'Reset link sent if account exists.' : 'Could not send reset link.';
    } catch {
      msgEl.style.color = '#ef9a9a'; msgEl.textContent = 'Network error.';
    }
    btn.disabled = false; btn.textContent = 'Send';
  });

  // ── Login form ──
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const trap = loginForm.querySelector('[name="website"]');
    if (trap?.value) return;
    if (twoFaWrap.style.display !== 'none') { attemptOtp(); return; }

    const email    = document.getElementById('admin-email').value.trim();
    const password = pwInput.value;
    loginBtn.disabled    = true;
    loginBtn.textContent = 'SIGNING IN…';
    loginError.textContent = '';

    const result = await adminLogin(email, password);
    if (result.ok) {
      showDashboard();
    } else {
      loginError.textContent = result.message;
      loginBtn.disabled      = false;
      loginBtn.textContent   = 'SIGN IN';
    }
  });

  document.getElementById('logout-btn')?.addEventListener('click', doLogout);

  function showDashboard() {
    loginScreen.style.display = 'none';
    dashboard.style.display   = 'block';
    startSession();
    initDashboard();
  }

  // ──────────────────────────────────────
  // SIDEBAR NAVIGATION
  // ──────────────────────────────────────
  const pageMeta = {
    orders:    { title: 'ORDERS',       sub: 'Manage customer orders and allocations' },
    analytics: { title: 'ANALYTICS',    sub: 'Order trends and revenue metrics' },
    menu:      { title: 'MENU MANAGER', sub: 'Create and manage menu items' },
    stock:     { title: 'DAILY STOCK',  sub: 'Control per-item stock for today\'s drop' },
    reviews:   { title: 'REVIEWS',      sub: 'Private customer feedback and ratings' },
  };

  function initDashboard() {
    document.querySelectorAll('.nav-item').forEach(link => {
      link.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(l => l.classList.remove('active'));
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        link.classList.add('active');
        const key = link.getAttribute('data-section');
        document.getElementById(`section-${key}`)?.classList.add('active');
        const meta = pageMeta[key] || {};
        document.getElementById('page-title').textContent = meta.title || key.toUpperCase();
        document.getElementById('page-sub').textContent   = meta.sub   || '';
        loadSection(key);
      });
    });
    loadSection('orders');
  }

  function loadSection(key) {
    switch (key) {
      case 'orders':    loadOrders('all');   break;
      case 'analytics': loadAnalytics();     break;
      case 'menu':      loadMenuItems();     break;
      case 'stock':     loadStockManager();  break;
      case 'reviews':   loadReviews();       break;
    }
  }

  // ──────────────────────────────────────
  // ORDERS
  // ──────────────────────────────────────
  let currentOrderFilter = 'all';
  let allOrders          = [];
  let openOrderId        = null;
  let pendingCancelId    = null;

  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentOrderFilter = btn.getAttribute('data-filter');
      loadOrders(currentOrderFilter);
    });
  });

  async function loadOrders(filter) {
    const wrap = document.getElementById('orders-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading orders…</p>';
    closeOrderDetail();

    try {
      let rows = await adminFetchOrders();
      if (!rows) rows = [];
      allOrders = rows;

      if (filter && filter !== 'all') {
        rows = rows.filter(r => r.status === filter);
      }

      if (!rows.length) {
        wrap.innerHTML = '<p class="empty">No orders found.</p>';
        return;
      }

      wrap.innerHTML = `
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr>
                <th>Ticket ID</th>
                <th>Customer</th>
                <th>Contact</th>
                <th>Type</th>
                <th>Total</th>
                <th>Status</th>
                <th>Placed</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => renderOrderRow(r)).join('')}
            </tbody>
          </table>
        </div>`;

      wrap.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => handleOrderAction(btn.dataset.action, btn.dataset.id, allOrders));
      });

    } catch (err) {
      wrap.innerHTML = `<p class="loading-msg" style="color:#ef9a9a">${esc(err.message)}</p>`;
    }
  }

  function renderOrderRow(r) {
    const tid    = shortId(r.id);
    const status = r.status || 'confirmed';
    const badgeCls = {
      confirmed: 'badge-confirmed',
      preparing: 'badge-preparing',
      fulfilled: 'badge-fulfilled',
      cancelled: 'badge-cancelled',
      pending:   'badge-pending',
    }[status] || 'badge-pending';

    const canCancel  = !['cancelled','fulfilled'].includes(status);
    const canPrepare = status === 'confirmed';
    const canFulfill = status === 'preparing';

    return `
      <tr data-id="${r.id}">
        <td><span class="ticket-code">${tid}</span></td>
        <td class="td-name">${esc(r.name)}</td>
        <td style="font-size:0.78rem">
          ${esc(r.email)}<br>
          <span style="color:var(--text-muted)">${esc(r.phone || '')}</span>
        </td>
        <td style="text-transform:capitalize">${esc(r.delivery_type || 'pickup')}</td>
        <td style="font-weight:600;color:white">$${parseFloat(r.total || 0).toFixed(2)}</td>
        <td><span class="badge ${badgeCls}">${status}</span></td>
        <td style="font-size:0.75rem">${formatDateTime(r.created_at)}</td>
        <td style="white-space:nowrap">
          <button class="tb view"   data-action="details"  data-id="${r.id}">Details</button>
          ${canPrepare ? `<button class="tb warn"   data-action="prepare"  data-id="${r.id}">Preparing</button>` : ''}
          ${canFulfill ? `<button class="tb ok"     data-action="fulfill"  data-id="${r.id}">Fulfilled</button>` : ''}
          ${canCancel  ? `<button class="tb danger" data-action="cancel"   data-id="${r.id}">Cancel</button>` : ''}
        </td>
      </tr>`;
  }

  // ── Order Detail Panel ──────────────────────────────────────
  async function showOrderDetail(r) {
    openOrderId = r.id;
    const slot  = document.getElementById('order-detail-slot');
    slot.innerHTML = `<div class="detail-panel"><p class="loading-msg">Loading items…</p></div>`;
    slot.style.display = 'block';

    let items = [];
    try {
      items = await adminFetchOrderItems(r.id) || [];
    } catch { /* ignore */ }

    const tid      = shortId(r.id);
    const status   = r.status || 'confirmed';
    const canCancel  = !['cancelled','fulfilled'].includes(status);
    const canPrepare = status === 'confirmed';
    const canFulfill = status === 'preparing';

    slot.innerHTML = `
      <div class="detail-panel">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.2rem;flex-wrap:wrap;gap:0.8rem">
          <div>
            <div style="font-family:'Oswald',sans-serif;font-size:1.1rem;letter-spacing:0.15em;color:white">${esc(r.name)}</div>
            <div style="font-size:0.68rem;color:var(--red);letter-spacing:0.15em;margin-top:0.2rem">TICKET: ${tid}</div>
          </div>
          <button id="detail-close" style="background:transparent;border:none;color:var(--text-muted);font-size:1.2rem;cursor:pointer;padding:0.2rem 0.5rem;">✕</button>
        </div>

        <div class="detail-grid">
          <div class="detail-field"><label>Email</label><span>${esc(r.email)}</span></div>
          <div class="detail-field"><label>Phone</label><span>${esc(r.phone || '—')}</span></div>
          <div class="detail-field"><label>Type</label><span style="text-transform:capitalize">${esc(r.delivery_type || 'pickup')}</span></div>
          <div class="detail-field"><label>Status</label><span>${status}</span></div>
          <div class="detail-field"><label>Placed</label><span>${formatDateTime(r.created_at)}</span></div>
          <div class="detail-field"><label>Total</label><span style="color:white;font-weight:600">$${parseFloat(r.total || 0).toFixed(2)}</span></div>
          ${r.address ? `<div class="detail-field" style="grid-column:1/-1"><label>Delivery Address</label><span>${esc(r.address)}</span></div>` : ''}
          ${r.notes   ? `<div class="detail-field" style="grid-column:1/-1"><label>Special Instructions</label><span>${esc(r.notes)}</span></div>` : ''}
          ${r.cancel_reason ? `<div class="detail-field" style="grid-column:1/-1"><label>Cancellation Reason</label><span style="color:#ef9a9a">${esc(r.cancel_reason)}</span></div>` : ''}
        </div>

        ${items.length ? `
        <div style="margin-top:1rem">
          <p style="font-size:0.62rem;font-weight:700;letter-spacing:0.2em;color:var(--text-muted);text-transform:uppercase;margin-bottom:0.6rem">Items Ordered</p>
          <div class="order-items-mini">
            <table>
              <thead><tr><th>Item</th><th>Unit Price</th><th>Qty</th><th>Subtotal</th></tr></thead>
              <tbody>
                ${items.map(i => `
                  <tr>
                    <td class="td-name">${esc(i.item_name)}</td>
                    <td>$${parseFloat(i.price || 0).toFixed(2)}</td>
                    <td>${i.qty}</td>
                    <td style="color:white;font-weight:500">$${(parseFloat(i.price || 0) * i.qty).toFixed(2)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : '<p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.8rem">No item details found.</p>'}

        <div style="display:flex;gap:0.6rem;margin-top:1.5rem;flex-wrap:wrap">
          ${canPrepare ? `<button class="tb warn"   data-action="prepare" data-id="${r.id}">Mark Preparing</button>` : ''}
          ${canFulfill ? `<button class="tb ok"     data-action="fulfill" data-id="${r.id}">Mark Fulfilled</button>` : ''}
          ${canCancel  ? `<button class="tb danger" data-action="cancel"  data-id="${r.id}">Cancel Order</button>` : ''}
        </div>
      </div>`;

    document.getElementById('detail-close')?.addEventListener('click', closeOrderDetail);
    slot.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleOrderAction(btn.dataset.action, btn.dataset.id, allOrders));
    });
  }

  function closeOrderDetail() {
    const slot = document.getElementById('order-detail-slot');
    if (slot) { slot.innerHTML = ''; slot.style.display = 'none'; }
    openOrderId = null;
  }

  async function handleOrderAction(action, id, rows) {
    const order = rows?.find(r => String(r.id) === String(id));

    if (action === 'details') {
      if (openOrderId === id) { closeOrderDetail(); return; }
      if (order) await showOrderDetail(order);
      return;
    }

    if (action === 'prepare') {
      try {
        await adminUpdateOrderStatus(id, 'preparing');
        toast('Order marked as preparing.');
        if (openOrderId === id) closeOrderDetail();
        loadOrders(currentOrderFilter);
      } catch (err) { toast(err.message, 'error'); }

    } else if (action === 'fulfill') {
      try {
        await adminUpdateOrderStatus(id, 'fulfilled');
        toast('Order marked as fulfilled.');
        if (order) sendCustomerEmail(order, 'fulfilled', '').catch(() => {});
        if (openOrderId === id) closeOrderDetail();
        loadOrders(currentOrderFilter);
      } catch (err) { toast(err.message, 'error'); }

    } else if (action === 'cancel') {
      pendingCancelId = id;
      document.getElementById('cancel-reason').value     = '';
      document.getElementById('cancel-error').textContent = '';
      openModal('cancel-modal');
    }
  }

  // Cancel modal
  document.getElementById('cancel-modal-dismiss')?.addEventListener('click', () => {
    closeModal('cancel-modal'); pendingCancelId = null;
  });
  document.getElementById('cancel-modal')?.addEventListener('click', e => {
    if (e.target.id === 'cancel-modal') { closeModal('cancel-modal'); pendingCancelId = null; }
  });
  document.getElementById('cancel-modal-confirm')?.addEventListener('click', async () => {
    const reason = document.getElementById('cancel-reason').value.trim();
    const errEl  = document.getElementById('cancel-error');
    if (!reason) { errEl.textContent = 'Please provide a cancellation reason.'; return; }
    const btn = document.getElementById('cancel-modal-confirm');
    btn.disabled = true;
    try {
      await adminUpdateOrderStatus(pendingCancelId, 'cancelled', reason);
      const order = allOrders.find(r => String(r.id) === String(pendingCancelId));
      if (order) sendCustomerEmail({ ...order, status: 'cancelled' }, 'cancelled', reason).catch(() => {});
      closeModal('cancel-modal');
      toast('Order cancelled.');
      if (openOrderId === pendingCancelId) closeOrderDetail();
      pendingCancelId = null;
      loadOrders(currentOrderFilter);
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ──────────────────────────────────────
  // ANALYTICS
  // ──────────────────────────────────────
  async function loadAnalytics() {
    const wrap = document.getElementById('analytics-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading analytics…</p>';
    try {
      const rows = await adminFetchAnalytics();
      wrap.innerHTML = renderAnalytics(rows);
    } catch (err) {
      wrap.innerHTML = `<p class="loading-msg" style="color:#ef9a9a">${esc(err.message)}</p>`;
    }
  }

  function renderAnalytics(rows) {
    const total     = rows.length;
    const confirmed = rows.filter(r => r.status === 'confirmed').length;
    const preparing = rows.filter(r => r.status === 'preparing').length;
    const fulfilled = rows.filter(r => r.status === 'fulfilled').length;
    const cancelled = rows.filter(r => r.status === 'cancelled').length;
    const revenue   = rows.filter(r => r.status !== 'cancelled').reduce((s,r) => s + parseFloat(r.total || 0), 0);
    const avgOrder  = fulfilled > 0 ? revenue / fulfilled : 0;

    const dayNames  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayCount  = Array(7).fill(0);
    const monthCount = {};
    const typeCount  = { pickup: 0, delivery: 0 };

    rows.forEach(r => {
      if (!r.created_at) return;
      const d = new Date(r.created_at);
      dayCount[d.getDay()]++;
      const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      monthCount[mk] = (monthCount[mk] || 0) + 1;
      if (r.delivery_type === 'delivery') typeCount.delivery++;
      else typeCount.pickup++;
    });

    const maxDay  = Math.max(...dayCount, 1);
    const busyDay = dayNames[dayCount.indexOf(Math.max(...dayCount))];
    const sortedMonths = Object.keys(monthCount).sort().slice(-6);
    const monthMax = Math.max(...sortedMonths.map(m => monthCount[m]), 1);
    const fulfillRate = total ? Math.round(fulfilled / total * 100) : 0;
    const cancelRate  = total ? Math.round(cancelled / total * 100) : 0;

    return `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-value">${total}</div>
          <div class="kpi-label">Total Orders</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" style="color:var(--red)">$${revenue.toFixed(0)}</div>
          <div class="kpi-label">Total Revenue</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${fulfillRate}%</div>
          <div class="kpi-label">Fulfillment Rate</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${cancelRate}%</div>
          <div class="kpi-label">Cancellation Rate</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">$${avgOrder.toFixed(0)}</div>
          <div class="kpi-label">Avg Order Value</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">${fulfilled}</div>
          <div class="kpi-label">Fulfilled Orders</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div class="chart-card">
          <p class="chart-title">Orders by Day of Week</p>
          <div class="bar-chart">
            ${dayCount.map((count, i) => `
              <div class="bar-col">
                <div class="bar-track">
                  <div class="bar-fill${dayNames[i] === busyDay ? ' accent' : ''}" style="height:${Math.round(count/maxDay*100)}%" title="${count}"></div>
                </div>
                <div class="bar-label${dayNames[i] === busyDay ? ' peak' : ''}">${dayNames[i]}</div>
              </div>`).join('')}
          </div>
          <p class="chart-note">Busiest day: <strong class="accent">${busyDay}</strong></p>
        </div>

        <div class="chart-card">
          <p class="chart-title">Pickup vs Delivery</p>
          <div style="display:flex;align-items:center;justify-content:center;gap:2rem;height:100px">
            <div style="text-align:center">
              <div style="font-family:'Oswald',sans-serif;font-size:2rem;color:white">${typeCount.pickup}</div>
              <div style="font-size:0.65rem;color:var(--text-muted);letter-spacing:0.15em;text-transform:uppercase;margin-top:0.3rem">Pickup</div>
            </div>
            <div style="width:1px;height:50px;background:var(--border)"></div>
            <div style="text-align:center">
              <div style="font-family:'Oswald',sans-serif;font-size:2rem;color:var(--red)">${typeCount.delivery}</div>
              <div style="font-size:0.65rem;color:var(--text-muted);letter-spacing:0.15em;text-transform:uppercase;margin-top:0.3rem">Delivery</div>
            </div>
          </div>
        </div>
      </div>

      ${sortedMonths.length ? `
      <div class="chart-card">
        <p class="chart-title">Monthly Order Volume (last 6 months)</p>
        <div class="bar-chart" style="height:120px">
          ${sortedMonths.map(m => {
            const count = monthCount[m];
            const label = new Date(m+'-15').toLocaleDateString('en-US',{month:'short',year:'2-digit'});
            return `<div class="bar-col">
              <div class="bar-count">${count}</div>
              <div class="bar-track" style="flex:1"><div class="bar-fill accent" style="height:${Math.round(count/monthMax*100)}%"></div></div>
              <div class="bar-label">${label}</div>
            </div>`;
          }).join('')}
        </div>
      </div>` : ''}

      <div class="chart-card">
        <p class="chart-title">Status Breakdown</p>
        ${[
          {label:'Confirmed', count:confirmed, color:'#a5d6a7'},
          {label:'Preparing', count:preparing, color:'#ce93d8'},
          {label:'Fulfilled', count:fulfilled, color:'#90caf9'},
          {label:'Cancelled', count:cancelled, color:'#ef9a9a'},
        ].map(s => `
          <div class="rating-row" style="margin-bottom:0.8rem">
            <span class="rating-row-label" style="width:70px;color:${s.color};font-size:0.7rem;font-weight:600;letter-spacing:0.05em">${s.label}</span>
            <div class="rating-row-track" style="flex:1"><div class="rating-row-fill" style="width:${total?Math.round(s.count/total*100):0}%;background:${s.color}"></div></div>
            <span class="rating-row-count" style="width:30px;text-align:right">${s.count}</span>
          </div>`).join('')}
      </div>`;
  }

  // ──────────────────────────────────────
  // MENU MANAGER
  // ──────────────────────────────────────
  let cachedMenuItems = [];

  document.getElementById('add-item-btn')?.addEventListener('click', () => openMenuForm(null));
  document.getElementById('cancel-menu-form')?.addEventListener('click', () => {
    document.getElementById('menu-form-panel').style.display = 'none';
  });

  document.getElementById('menu-item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'SAVING…';
    try {
      const result = await adminUpdateMenu({
        id:          document.getElementById('mi-id').value || null,
        name:        document.getElementById('mi-name').value,
        category:    document.getElementById('mi-category').value,
        subcategory: document.getElementById('mi-subcategory').value,
        price:       document.getElementById('mi-price').value,
        description: document.getElementById('mi-description').value,
        available:   document.getElementById('mi-available').value === 'true',
        image_url:   document.getElementById('mi-image').value || null,
      });
      document.getElementById('menu-form-panel').style.display = 'none';
      e.target.reset();
      toast('Menu item saved.');
      loadMenuItems();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'SAVE ITEM';
    }
  });

  function openMenuForm(item) {
    document.getElementById('menu-form-title').textContent = item ? 'EDIT MENU ITEM' : 'ADD MENU ITEM';
    document.getElementById('mi-id').value          = item?.id          || '';
    document.getElementById('mi-name').value        = item?.name        || '';
    document.getElementById('mi-category').value    = item?.category    || 'desserts';
    document.getElementById('mi-subcategory').value = item?.subcategory || '';
    document.getElementById('mi-price').value       = item?.price       || '';
    document.getElementById('mi-description').value = item?.description || '';
    document.getElementById('mi-available').value   = String(item?.available ?? true);
    document.getElementById('mi-image').value       = item?.image_url   || '';
    document.getElementById('menu-form-panel').style.display = 'block';
    document.getElementById('mi-name').focus();
    document.getElementById('menu-form-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadMenuItems() {
    const wrap = document.getElementById('menu-table-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading…</p>';
    try {
      const items = await adminFetchMenuItems();
      cachedMenuItems = items || [];
      if (!items?.length) {
        wrap.innerHTML = '<p class="empty">No menu items yet. Add your first item above.</p>';
        return;
      }

      // Group by category
      const cats = ['starters','mains','desserts','drinks'];
      const grouped = {};
      cats.forEach(c => { grouped[c] = []; });
      items.forEach(i => {
        const cat = i.category?.toLowerCase() || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(i);
      });

      let html = '';
      Object.entries(grouped).forEach(([cat, catItems]) => {
        if (!catItems.length) return;
        html += `
          <div style="margin-bottom:2rem">
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.8rem">
              <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;letter-spacing:0.25em;color:var(--text-muted);text-transform:uppercase">${cat}</span>
              <div style="flex:1;height:1px;background:var(--border)"></div>
              <span style="font-size:0.65rem;color:var(--text-muted)">${catItems.length} item${catItems.length !== 1 ? 's' : ''}</span>
            </div>
            <div class="tbl-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item ID</th>
                    <th>Name</th>
                    <th>Subcategory</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Available</th>
                    <th>Description</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${catItems.map(item => `
                    <tr style="${!item.available ? 'opacity:0.5' : ''}">
                      <td><span class="ticket-code" style="font-size:0.65rem">${String(item.id || '').slice(-6).toUpperCase()}</span></td>
                      <td class="td-name">${esc(item.name)}</td>
                      <td style="color:var(--text-muted);font-size:0.78rem">${esc(item.subcategory || '—')}</td>
                      <td style="color:white;font-weight:600">$${parseFloat(item.price || 0).toFixed(2)}</td>
                      <td style="color:${item.daily_stock === 0 ? '#ef9a9a' : item.daily_stock <= 5 && item.daily_stock > 0 ? '#ffcc80' : '#a5d6a7'};font-size:0.8rem;font-weight:500">
                        ${item.daily_stock === null || item.daily_stock === undefined ? '∞' : item.daily_stock}
                      </td>
                      <td>${item.available
                        ? '<span style="color:#a5d6a7;font-size:0.8rem;font-weight:600">✓ YES</span>'
                        : '<span style="color:var(--text-muted);font-size:0.8rem">— NO</span>'}</td>
                      <td class="td-wide" title="${esc(item.description || '')}">${truncate(item.description)}</td>
                      <td style="white-space:nowrap">
                        <button class="tb edit"   data-action="edit"   data-id="${item.id}">Edit</button>
                        <button class="tb danger" data-action="delete" data-id="${item.id}">Delete</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
      });

      wrap.innerHTML = html;

      wrap.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = cachedMenuItems.find(i => String(i.id) === String(btn.dataset.id));
          if (row) openMenuForm(row);
        });
      });
      wrap.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Delete this menu item? This cannot be undone.')) return;
          btn.disabled = true;
          try {
            await adminDeleteMenuItem(btn.dataset.id);
            toast('Item deleted.');
            loadMenuItems();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false;
          }
        });
      });

    } catch (err) {
      wrap.innerHTML = `<p class="loading-msg" style="color:#ef9a9a">${esc(err.message)}</p>`;
    }
  }

  // ──────────────────────────────────────
  // DAILY STOCK MANAGER
  // ──────────────────────────────────────
  async function loadStockManager() {
    const wrap = document.getElementById('stock-table-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading stock…</p>';
    try {
      const items = await adminFetchMenuItems();
      if (!items?.length) {
        wrap.innerHTML = '<p class="empty">No menu items found. Add items in Menu Manager first.</p>';
        return;
      }

      const cats = ['starters','mains','desserts','drinks'];
      const grouped = {};
      cats.forEach(c => { grouped[c] = []; });
      items.forEach(i => {
        const cat = i.category?.toLowerCase() || 'other';
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(i);
      });

      // Toolbar
      wrap.innerHTML = `
        <div style="display:flex;gap:0.8rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem;padding:1rem 1.2rem;background:rgba(255,255,255,0.02);border:1px solid var(--border);border-radius:10px">
          <span style="font-size:0.7rem;color:var(--text-muted);letter-spacing:0.15em;text-transform:uppercase;flex:1">Quick Reset: set all items to</span>
          <input type="number" id="global-stock-val" min="0" max="999" value="20" class="s-input" style="width:80px;padding:0.4rem 0.6rem;font-size:0.85rem;text-align:center">
          <button id="global-reset-btn" class="btn-ghost" style="white-space:nowrap;padding:0.5rem 1rem;font-size:0.72rem">RESET ALL</button>
          <button id="global-zero-btn" class="btn-ghost" style="white-space:nowrap;padding:0.5rem 1rem;font-size:0.72rem;color:#ef9a9a;border-color:rgba(229,37,37,0.2)">SET ALL TO 0</button>
        </div>
        <div id="stock-items-wrap"></div>`;

      const stockWrap = wrap.querySelector('#stock-items-wrap');

      Object.entries(grouped).forEach(([cat, catItems]) => {
        if (!catItems.length) return;
        let html = `
          <div style="margin-bottom:2rem">
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.8rem">
              <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;letter-spacing:0.25em;color:var(--text-muted);text-transform:uppercase">${cat}</span>
              <div style="flex:1;height:1px;background:var(--border)"></div>
            </div>
            <div class="tbl-wrap">
              <table>
                <thead><tr><th>Name</th><th>Price</th><th>Current Stock</th><th>Status</th><th>Set Stock</th></tr></thead>
                <tbody>
                  ${catItems.map(item => {
                    const stock = item.daily_stock;
                    const isNull = stock === null || stock === undefined;
                    const isOut  = !isNull && stock <= 0;
                    const isLow  = !isNull && stock > 0 && stock <= 5;
                    const statusText = isNull ? 'Unlimited' : isOut ? 'Sold Out' : isLow ? `Low (${stock})` : `OK (${stock})`;
                    const statusColor = isOut ? '#ef9a9a' : isLow ? '#ffcc80' : isNull ? 'var(--text-muted)' : '#a5d6a7';
                    return `
                      <tr>
                        <td class="td-name">${esc(item.name)}</td>
                        <td>$${parseFloat(item.price||0).toFixed(2)}</td>
                        <td style="font-family:'Oswald',sans-serif;font-size:1rem;color:white">${isNull ? '∞' : stock}</td>
                        <td><span style="color:${statusColor};font-size:0.72rem;font-weight:600;letter-spacing:0.1em">${statusText}</span></td>
                        <td>
                          <div class="stock-ctrl">
                            <input type="number" min="0" max="999" value="${isNull ? '' : stock}" placeholder="∞"
                              class="stock-input" data-item-id="${item.id}" style="width:70px">
                            <button class="stock-save-btn" data-item-id="${item.id}">SAVE</button>
                          </div>
                        </td>
                      </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>`;
        const div = document.createElement('div');
        div.innerHTML = html;
        stockWrap.appendChild(div);
      });

      // Save individual stock
      wrap.querySelectorAll('.stock-save-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
          const itemId = btn.dataset.itemId;
          const input  = wrap.querySelector(`.stock-input[data-item-id="${itemId}"]`);
          const val    = input?.value;
          btn.disabled = true; btn.textContent = '…';
          try {
            await adminSetDailyStock(itemId, val === '' ? null : parseInt(val));
            toast('Stock updated.');
            loadStockManager();
          } catch (err) {
            toast(err.message, 'error');
            btn.disabled = false; btn.textContent = 'SAVE';
          }
        });
      });

      // Global reset
      document.getElementById('global-reset-btn')?.addEventListener('click', async () => {
        const val = parseInt(document.getElementById('global-stock-val').value);
        if (isNaN(val) || val < 0) { toast('Invalid stock value.', 'error'); return; }
        if (!confirm(`Reset ALL items to ${val} units?`)) return;
        try {
          await adminResetAllStock(val);
          toast(`All items reset to ${val} units.`);
          loadStockManager();
        } catch (err) { toast(err.message, 'error'); }
      });

      document.getElementById('global-zero-btn')?.addEventListener('click', async () => {
        if (!confirm('Set ALL items to 0 (sold out)?')) return;
        try {
          await adminResetAllStock(0);
          toast('All items set to 0 (sold out).');
          loadStockManager();
        } catch (err) { toast(err.message, 'error'); }
      });

    } catch (err) {
      wrap.innerHTML = `<p class="loading-msg" style="color:#ef9a9a">${esc(err.message)}</p>`;
    }
  }

  // ──────────────────────────────────────
  // REVIEWS
  // ──────────────────────────────────────
  async function loadReviews() {
    const wrap = document.getElementById('reviews-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading reviews…</p>';
    try {
      const rows = await adminFetchReviews();
      if (!rows?.length) { wrap.innerHTML = '<p class="empty">No reviews yet.</p>'; return; }

      const total  = rows.length;
      const avg    = (rows.reduce((s,r) => s + r.rating, 0) / total).toFixed(1);
      const dist   = [5,4,3,2,1].map(star => ({ star, count: rows.filter(r => r.rating === star).length }));
      const maxDist = Math.max(...dist.map(d => d.count), 1);

      wrap.innerHTML = `
        <div class="kpi-grid" style="margin-bottom:1.5rem">
          <div class="kpi-card">
            <div class="kpi-value">${total}</div>
            <div class="kpi-label">Total Reviews</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-value" style="color:var(--red)">${avg} <span style="font-size:1.2rem">★</span></div>
            <div class="kpi-label">Average Rating</div>
          </div>
          <div class="kpi-card">
            <p class="chart-title" style="margin-bottom:0.8rem">Rating Distribution</p>
            ${dist.map(d => `
              <div class="rating-row">
                <span class="rating-row-label">${d.star}★</span>
                <div class="rating-row-track"><div class="rating-row-fill" style="width:${Math.round(d.count/maxDist*100)}%"></div></div>
                <span class="rating-row-count">${d.count}</span>
              </div>`).join('')}
          </div>
        </div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Rating</th><th>Feedback</th><th>Date</th></tr></thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td><span class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span></td>
                  <td class="td-wide" style="max-width:360px">${esc(r.message || '—')}</td>
                  <td style="font-size:0.75rem">${formatDate(r.created_at)}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (err) {
      wrap.innerHTML = `<p class="loading-msg" style="color:#ef9a9a">${esc(err.message)}</p>`;
    }
  }

}); // end DOMContentLoaded
