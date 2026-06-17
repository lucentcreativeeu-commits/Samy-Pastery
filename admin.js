/**
 * SAMY CLOUD BAKERY — admin.js (v3)
 * ─────────────────────────────────────────────────────────────
 * Full admin dashboard: orders (pending → in_making → delivered),
 * analytics (delivered-only revenue), category manager, menu manager
 * (multi-image upload via Cloudinary, flavor/variant editor, stock),
 * daily stock control, reviews.
 * ─────────────────────────────────────────────────────────────
 */
import {
  adminLogin,
  adminLogout,
  adminFetchCategories,
  adminCreateCategory,
  adminUpdateCategory,
  adminDeleteCategory,
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
function statusLabel(status) {
  return { pending: 'Pending', in_making: 'In Making', delivered: 'Delivered', cancelled: 'Cancelled' }[status] || status;
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

// ─── CLOUDINARY UPLOAD ────────────────────────────────────────
async function uploadImageToCloudinary(file) {
  const cfg = await getConfig();
  if (!cfg.cloudinaryCloudName || !cfg.cloudinaryUploadPreset) {
    throw new Error('Image upload is not configured (missing Cloudinary settings).');
  }
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', cfg.cloudinaryUploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudinaryCloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Image upload failed.');
  }
  const data = await res.json();
  return data.secure_url;
}

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
    orders:     { title: 'ORDERS',         sub: 'Manage customer orders and allocations' },
    analytics:  { title: 'ANALYTICS',      sub: 'Order trends and delivered-revenue metrics' },
    categories: { title: 'CATEGORIES',     sub: 'Manage storefront category filters' },
    menu:       { title: 'MENU MANAGER',   sub: 'Create and manage menu items' },
    stock:      { title: 'DAILY STOCK',    sub: 'Control per-item stock for today\'s drop' },
    reviews:    { title: 'REVIEWS',        sub: 'Private customer feedback and ratings' },
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
      case 'orders':      loadOrders(currentOrderFilter); break;
      case 'analytics':   loadAnalytics();                break;
      case 'categories':  loadCategoriesManager();         break;
      case 'menu':        loadMenuItems();                 break;
      case 'stock':       loadStockManager();              break;
      case 'reviews':     loadReviews();                   break;
    }
  }

  // ──────────────────────────────────────
  // ORDERS  (pending → in_making → delivered | cancelled)
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
    const status = r.status || 'pending';
    const badgeCls = {
      pending:   'badge-pending',
      in_making: 'badge-in_making',
      delivered: 'badge-delivered',
      cancelled: 'badge-cancelled',
    }[status] || 'badge-pending';

    const canCancel = !['cancelled', 'delivered'].includes(status);
    const canAccept = status === 'pending';
    const canDeliver = status === 'in_making';

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
        <td><span class="badge ${badgeCls}">${statusLabel(status)}</span></td>
        <td style="font-size:0.75rem">${formatDateTime(r.created_at)}</td>
        <td style="white-space:nowrap">
          <button class="tb view"   data-action="details"  data-id="${r.id}">Details</button>
          ${canAccept  ? `<button class="tb warn"   data-action="accept"  data-id="${r.id}">Accept Order</button>` : ''}
          ${canDeliver ? `<button class="tb ok"     data-action="deliver" data-id="${r.id}">Delivered</button>` : ''}
          ${canCancel  ? `<button class="tb danger" data-action="cancel"  data-id="${r.id}">Cancel</button>` : ''}
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

    const tid    = shortId(r.id);
    const status = r.status || 'pending';
    const canCancel  = !['cancelled', 'delivered'].includes(status);
    const canAccept  = status === 'pending';
    const canDeliver = status === 'in_making';

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
          <div class="detail-field"><label>Status</label><span>${statusLabel(status)}</span></div>
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
              <thead><tr><th>Item</th><th>Flavor/Variant</th><th>Unit Price</th><th>Qty</th><th>Subtotal</th></tr></thead>
              <tbody>
                ${items.map(i => `
                  <tr>
                    <td class="td-name">${esc(i.item_name)}</td>
                    <td style="color:var(--text-muted)">${esc(i.variant || '—')}</td>
                    <td>$${parseFloat(i.price || 0).toFixed(2)}</td>
                    <td>${i.qty}</td>
                    <td style="color:white;font-weight:500">$${(parseFloat(i.price || 0) * i.qty).toFixed(2)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>` : '<p style="color:var(--text-muted);font-size:0.8rem;margin-top:0.8rem">No item details found.</p>'}

        <div style="display:flex;gap:0.6rem;margin-top:1.5rem;flex-wrap:wrap">
          ${canAccept  ? `<button class="tb warn"   data-action="accept"  data-id="${r.id}">Accept Order</button>` : ''}
          ${canDeliver ? `<button class="tb ok"     data-action="deliver" data-id="${r.id}">Mark Delivered</button>` : ''}
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

    if (action === 'accept') {
      try {
        await adminUpdateOrderStatus(id, 'in_making');
        toast('Order accepted — now in making.');
        if (openOrderId === id) closeOrderDetail();
        loadOrders(currentOrderFilter);
      } catch (err) { toast(err.message, 'error'); }

    } else if (action === 'deliver') {
      try {
        await adminUpdateOrderStatus(id, 'delivered');
        toast('Order marked as delivered.');
        // Best-effort customer email — safe no-op until /api/notify has an order-specific template.
        if (order) sendCustomerEmail({ ...order, status: 'delivered' }, 'delivered', '').catch(() => {});
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
  // ANALYTICS  (revenue counts delivered orders only)
  // ──────────────────────────────────────
  async function loadAnalytics() {
    const wrap = document.getElementById('analytics-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading analytics…</p>';
    try {
      const rows = await adminFetchAnalytics();
      wrap.innerHTML = renderAnalytics(rows || []);
    } catch (err) {
      wrap.innerHTML = `<p class="loading-msg" style="color:#ef9a9a">${esc(err.message)}</p>`;
    }
  }

  function renderAnalytics(rows) {
    const total     = rows.length;
    const pending    = rows.filter(r => r.status === 'pending').length;
    const inMaking   = rows.filter(r => r.status === 'in_making').length;
    const delivered  = rows.filter(r => r.status === 'delivered').length;
    const cancelled  = rows.filter(r => r.status === 'cancelled').length;

    // Only delivered orders count as completed sales / revenue.
    const deliveredRows = rows.filter(r => r.status === 'delivered');
    const revenue   = deliveredRows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
    const avgOrder  = delivered > 0 ? revenue / delivered : 0;

    const dayNames   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayCount   = Array(7).fill(0);
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
    const deliveredRate = total ? Math.round(delivered / total * 100) : 0;
    const cancelRate    = total ? Math.round(cancelled / total * 100) : 0;

    return `
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-value">${total}</div>
          <div class="kpi-label">Total Orders</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" style="color:#ffcc80">${pending}</div>
          <div class="kpi-label">Pending</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" style="color:#ce93d8">${inMaking}</div>
          <div class="kpi-label">In Making</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" style="color:#90caf9">${delivered}</div>
          <div class="kpi-label">Delivered (Completed Sales)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value" style="color:var(--red)">$${revenue.toFixed(0)}</div>
          <div class="kpi-label">Revenue (Delivered Only)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-value">$${avgOrder.toFixed(0)}</div>
          <div class="kpi-label">Avg Delivered Order Value</div>
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
          {label:'Pending',   count:pending,   color:'#ffcc80'},
          {label:'In Making', count:inMaking,  color:'#ce93d8'},
          {label:'Delivered', count:delivered, color:'#90caf9'},
          {label:'Cancelled', count:cancelled, color:'#ef9a9a'},
        ].map(s => `
          <div class="rating-row" style="margin-bottom:0.8rem">
            <span class="rating-row-label" style="width:80px;color:${s.color};font-size:0.7rem;font-weight:600;letter-spacing:0.05em">${s.label}</span>
            <div class="rating-row-track" style="flex:1"><div class="rating-row-fill" style="width:${total?Math.round(s.count/total*100):0}%;background:${s.color}"></div></div>
            <span class="rating-row-count" style="width:30px;text-align:right">${s.count}</span>
          </div>`).join('')}
        <p class="chart-note">Delivered rate: <strong class="accent">${deliveredRate}%</strong> · Cancellation rate: <strong class="accent">${cancelRate}%</strong></p>
      </div>`;
  }

  // ──────────────────────────────────────
  // CATEGORY MANAGER
  // ──────────────────────────────────────
  let cachedCategories = [];
  let editingCategoryId = null;

  document.getElementById('add-category-btn')?.addEventListener('click', () => openCategoryForm(null));
  document.getElementById('cancel-category-form')?.addEventListener('click', () => {
    document.getElementById('category-form-panel').style.display = 'none';
  });

  document.getElementById('category-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'SAVING…';
    const errEl = document.getElementById('category-form-error');
    errEl.textContent = '';

    const name      = document.getElementById('cat-name').value.trim();
    const slugInput = document.getElementById('cat-slug').value.trim();
    const sortOrder = document.getElementById('cat-sort').value;

    if (!name) { errEl.textContent = 'Category name is required.'; btn.disabled = false; btn.textContent = 'SAVE CATEGORY'; return; }

    try {
      const payload = { name, slug: slugInput, sort_order: sortOrder };
      if (editingCategoryId) {
        await adminUpdateCategory(editingCategoryId, payload);
      } else {
        await adminCreateCategory(payload);
      }
      document.getElementById('category-form-panel').style.display = 'none';
      e.target.reset();
      editingCategoryId = null;
      toast('Category saved.');
      loadCategoriesManager();
    } catch (err) {
      errEl.textContent = err.message || 'Could not save category. Slug may already be in use.';
    } finally {
      btn.disabled = false; btn.textContent = 'SAVE CATEGORY';
    }
  });

  function openCategoryForm(cat) {
    editingCategoryId = cat?.id || null;
    document.getElementById('category-form-title').textContent = cat ? 'EDIT CATEGORY' : 'ADD CATEGORY';
    document.getElementById('cat-name').value = cat?.name || '';
    document.getElementById('cat-slug').value = cat?.slug || '';
    document.getElementById('cat-sort').value = cat?.sort_order ?? 0;
    document.getElementById('category-form-error').textContent = '';
    document.getElementById('category-form-panel').style.display = 'block';
    document.getElementById('cat-name').focus();
    document.getElementById('category-form-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadCategoriesManager() {
    const wrap = document.getElementById('category-table-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading categories…</p>';
    try {
      const [cats, items] = await Promise.all([
        adminFetchCategories(),
        adminFetchMenuItems().catch(() => []),
      ]);
      cachedCategories = cats || [];

      if (!cachedCategories.length) {
        wrap.innerHTML = '<p class="empty">No categories yet. Add your first category above — it will appear instantly as a filter on the storefront.</p>';
        return;
      }

      const countByCategory = {};
      (items || []).forEach(i => {
        const key = i.category_id || i.category;
        countByCategory[key] = (countByCategory[key] || 0) + 1;
      });

      wrap.innerHTML = `
        <div class="tbl-wrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Slug</th><th>Sort Order</th><th>Items</th><th>Actions</th></tr>
            </thead>
            <tbody>
              ${cachedCategories.map(c => `
                <tr data-id="${c.id}">
                  <td class="td-name">${esc(c.name)}</td>
                  <td style="font-family:'Oswald',sans-serif;font-size:0.78rem;color:var(--text-muted)">${esc(c.slug)}</td>
                  <td>${c.sort_order}</td>
                  <td>${countByCategory[c.id] || 0}</td>
                  <td style="white-space:nowrap">
                    <button class="tb edit"   data-action="edit"   data-id="${c.id}">Edit</button>
                    <button class="tb danger" data-action="delete" data-id="${c.id}">Delete</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>`;

      wrap.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
          const row = cachedCategories.find(c => String(c.id) === String(btn.dataset.id));
          if (row) openCategoryForm(row);
        });
      });
      wrap.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const count = countByCategory[btn.dataset.id] || 0;
          const msg = count > 0
            ? `This category has ${count} item(s) assigned. Deleting it will unassign them (they won't be removed). Continue?`
            : 'Delete this category?';
          if (!confirm(msg)) return;
          btn.disabled = true;
          try {
            await adminDeleteCategory(btn.dataset.id);
            toast('Category deleted.');
            loadCategoriesManager();
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
  // MENU MANAGER  (categories, up to 4 images, variants, stock)
  // ──────────────────────────────────────
  let cachedMenuItems  = [];
  let currentImages    = [];   // array of uploaded URLs for the open form
  let currentVariants   = [];   // array of { name, price_mod, available }

  document.getElementById('add-item-btn')?.addEventListener('click', async () => { await openMenuForm(null); });
  document.getElementById('cancel-menu-form')?.addEventListener('click', () => {
    document.getElementById('menu-form-panel').style.display = 'none';
  });

  // ── Image dropzone wiring ──
  const dropzone   = document.getElementById('mi-dropzone');
  const fileInput  = document.getElementById('mi-images-file');

  dropzone?.addEventListener('click', () => { if (currentImages.length < 4) fileInput.click(); });
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleIncomingFiles(e.dataTransfer.files);
  });
  fileInput?.addEventListener('change', () => {
    handleIncomingFiles(fileInput.files);
    fileInput.value = '';
  });

  async function handleIncomingFiles(fileList) {
    const files = [...(fileList || [])].filter(f => f.type.startsWith('image/'));
    const room  = 4 - currentImages.length;
    if (room <= 0) { toast('Maximum of 4 images reached.', 'error'); return; }

    for (const file of files.slice(0, room)) {
      const placeholderIdx = currentImages.length;
      currentImages.push({ url: null, uploading: true });
      renderImagePreviews();
      try {
        const url = await uploadImageToCloudinary(file);
        currentImages[placeholderIdx] = { url, uploading: false };
      } catch (err) {
        currentImages.splice(placeholderIdx, 1);
        toast(err.message || 'Image upload failed.', 'error');
      }
      renderImagePreviews();
    }
  }

  function renderImagePreviews() {
    const grid = document.getElementById('mi-images-preview');
    if (!grid) return;
    const slots = [];
    for (let i = 0; i < 4; i++) {
      const img = currentImages[i];
      if (!img) { slots.push('<div class="image-slot empty">+</div>'); continue; }
      if (img.uploading) {
        slots.push('<div class="image-slot"><span class="img-uploading">Uploading…</span></div>');
      } else {
        slots.push(`
          <div class="image-slot">
            <img src="${esc(img.url)}" alt="">
            <button type="button" class="img-remove" data-idx="${i}">✕</button>
          </div>`);
      }
    }
    grid.innerHTML = slots.join('');
    grid.querySelectorAll('.img-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        currentImages.splice(parseInt(btn.dataset.idx), 1);
        renderImagePreviews();
      });
    });
    dropzone?.classList.toggle('disabled', currentImages.length >= 4);
  }

  // ── Variant editor wiring ──
  document.getElementById('mi-add-variant-btn')?.addEventListener('click', () => {
    currentVariants.push({ name: '', price_mod: 0, available: true });
    renderVariantRows();
  });

  function renderVariantRows() {
    const list = document.getElementById('mi-variants-list');
    if (!list) return;
    if (!currentVariants.length) {
      list.innerHTML = '<p style="font-size:0.72rem;color:var(--text-muted)">No flavors/options yet. Add one if this item has variants (e.g. flavors, sizes).</p>';
      return;
    }
    list.innerHTML = currentVariants.map((v, i) => `
      <div class="variant-row" data-idx="${i}">
        <input type="text" class="s-input variant-name" placeholder="e.g. Dark Chocolate" maxlength="100" value="${esc(v.name)}">
        <input type="number" class="s-input variant-pricemod" placeholder="+/- $" step="0.01" value="${v.price_mod}">
        <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.7rem;color:var(--text-muted)">
          <input type="checkbox" class="variant-available" ${v.available !== false ? 'checked' : ''}> Avail.
        </label>
        <button type="button" class="variant-remove-btn" data-idx="${i}" title="Remove">✕</button>
      </div>`).join('');

    list.querySelectorAll('.variant-name').forEach((inp, i) => inp.addEventListener('input', () => { currentVariants[i].name = inp.value; }));
    list.querySelectorAll('.variant-pricemod').forEach((inp, i) => inp.addEventListener('input', () => { currentVariants[i].price_mod = inp.value; }));
    list.querySelectorAll('.variant-available').forEach((inp, i) => inp.addEventListener('change', () => { currentVariants[i].available = inp.checked; }));
    list.querySelectorAll('.variant-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentVariants.splice(parseInt(btn.dataset.idx), 1);
        renderVariantRows();
      });
    });
  }

  document.getElementById('menu-item-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    btn.disabled = true; btn.textContent = 'SAVING…';

    if (currentImages.some(i => i.uploading)) {
      toast('Please wait for image uploads to finish.', 'error');
      btn.disabled = false; btn.textContent = 'SAVE ITEM';
      return;
    }

    try {
      const catSelect  = document.getElementById('mi-category');
      const selectedOpt = catSelect.selectedOptions[0];
      const stockVal = document.getElementById('mi-stock').value;

      const savedItem = await adminUpdateMenu({
        id:          document.getElementById('mi-id').value || null,
        name:        document.getElementById('mi-name').value,
        category_id: catSelect.value || null,
        category:    selectedOpt?.dataset.slug || 'desserts',
        subcategory: document.getElementById('mi-subcategory').value,
        price:       document.getElementById('mi-price').value,
        description: document.getElementById('mi-description').value,
        available:   document.getElementById('mi-available').value === 'true',
        images:      currentImages.filter(i => i.url).map(i => i.url),
        image_url:   currentImages.find(i => i.url)?.url || null,
        variants:    currentVariants.filter(v => v.name.trim()),
      });

      // Stock is set via the dedicated daily_stock endpoint (null = unlimited).
      await adminSetDailyStock(savedItem.id, stockVal === '' ? null : stockVal);

      document.getElementById('menu-form-panel').style.display = 'none';
      e.target.reset();
      currentImages = [];
      currentVariants = [];
      toast('Menu item saved — now live on the storefront.');
      loadMenuItems();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'SAVE ITEM';
    }
  });

  async function populateCategorySelect(selectedId, fallbackSlug) {
    if (!cachedCategories.length) {
      try { cachedCategories = await adminFetchCategories() || []; } catch { cachedCategories = []; }
    }
    const select = document.getElementById('mi-category');
    if (!select) return;
    select.innerHTML = cachedCategories.map(c =>
      `<option value="${c.id}" data-slug="${esc(c.slug)}">${esc(c.name)}</option>`
    ).join('') || '<option value="">No categories — create one first</option>';

    if (selectedId && cachedCategories.some(c => c.id === selectedId)) {
      select.value = selectedId;
    } else if (fallbackSlug) {
      const match = cachedCategories.find(c => c.slug === fallbackSlug);
      if (match) select.value = match.id;
    }
  }

  async function openMenuForm(item) {
    document.getElementById('menu-form-title').textContent = item ? 'EDIT MENU ITEM' : 'ADD MENU ITEM';
    document.getElementById('mi-id').value          = item?.id          || '';
    document.getElementById('mi-name').value        = item?.name        || '';
    document.getElementById('mi-subcategory').value = item?.subcategory || '';
    document.getElementById('mi-price').value       = item?.price       || '';
    document.getElementById('mi-description').value = item?.description || '';
    document.getElementById('mi-available').value   = String(item?.available ?? true);
    document.getElementById('mi-stock').value       = (item?.daily_stock === null || item?.daily_stock === undefined) ? '' : item.daily_stock;

    await populateCategorySelect(item?.category_id || null, item?.category || null);

    currentImages = (item?.images || [])
      .slice().sort((a,b) => (a.sort_order||0) - (b.sort_order||0))
      .slice(0, 4).map(img => ({ url: img.url, uploading: false }));
    if (!currentImages.length && item?.image_url) currentImages = [{ url: item.image_url, uploading: false }];
    renderImagePreviews();

    currentVariants = (item?.variants || []).map(v => ({ name: v.name, price_mod: v.price_mod, available: v.available !== false }));
    renderVariantRows();

    document.getElementById('menu-form-panel').style.display = 'block';
    document.getElementById('mi-name').focus();
    document.getElementById('menu-form-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadMenuItems() {
    const wrap = document.getElementById('menu-table-wrap');
    wrap.innerHTML = '<p class="loading-msg">Loading…</p>';
    try {
      const [items, cats] = await Promise.all([
        adminFetchMenuItems(),
        adminFetchCategories().catch(() => []),
      ]);
      cachedMenuItems  = items || [];
      cachedCategories = cats  || cachedCategories;

      if (!cachedMenuItems.length) {
        wrap.innerHTML = '<p class="empty">No menu items yet. Add your first item above.</p>';
        return;
      }

      // Group by category (real categories first, then any legacy/unassigned items).
      const catMap = {};
      cachedCategories.forEach(c => { catMap[c.id] = c; });
      const grouped = {};
      cachedMenuItems.forEach(i => {
        const cat = i.category_id && catMap[i.category_id] ? catMap[i.category_id] : null;
        const key = cat ? cat.id : (i.category || 'uncategorized');
        (grouped[key] ||= { label: cat ? cat.name : (i.category || 'Uncategorized'), items: [] }).items.push(i);
      });

      let html = '';
      Object.values(grouped).forEach(({ label, items: catItems }) => {
        if (!catItems.length) return;
        html += `
          <div style="margin-bottom:2rem">
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.8rem">
              <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;letter-spacing:0.25em;color:var(--text-muted);text-transform:uppercase">${esc(label)}</span>
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
                    <th>Images</th>
                    <th>Variants</th>
                    <th>Available</th>
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
                      <td style="color:${item.daily_stock === 0 ? '#ef9a9a' : (item.daily_stock > 0 && item.daily_stock <= 5) ? '#ffcc80' : '#a5d6a7'};font-size:0.8rem;font-weight:500">
                        ${item.daily_stock === null || item.daily_stock === undefined ? '∞' : item.daily_stock}
                      </td>
                      <td style="font-size:0.78rem;color:var(--text-muted)">${(item.images||[]).length}/4</td>
                      <td style="font-size:0.78rem;color:var(--text-muted)">${(item.variants||[]).length}</td>
                      <td>${item.available
                        ? '<span style="color:#a5d6a7;font-size:0.8rem;font-weight:600">✓ YES</span>'
                        : '<span style="color:var(--text-muted);font-size:0.8rem">— NO</span>'}</td>
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
      const [items, cats] = await Promise.all([
        adminFetchMenuItems(),
        adminFetchCategories().catch(() => []),
      ]);
      if (!items?.length) {
        wrap.innerHTML = '<p class="empty">No menu items found. Add items in Menu Manager first.</p>';
        return;
      }

      const catMap = {};
      (cats || []).forEach(c => { catMap[c.id] = c; });
      const grouped = {};
      items.forEach(i => {
        const cat = i.category_id && catMap[i.category_id] ? catMap[i.category_id] : null;
        const key = cat ? cat.id : (i.category || 'uncategorized');
        (grouped[key] ||= { label: cat ? cat.name : (i.category || 'Uncategorized'), items: [] }).items.push(i);
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

      Object.values(grouped).forEach(({ label, items: catItems }) => {
        if (!catItems.length) return;
        let html = `
          <div style="margin-bottom:2rem">
            <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.8rem">
              <span style="font-family:'Oswald',sans-serif;font-size:0.8rem;letter-spacing:0.25em;color:var(--text-muted);text-transform:uppercase">${esc(label)}</span>
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
