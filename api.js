/**
 * SAMY CLOUD BAKERY — api.js
 * ─────────────────────────────────────────────────────────────
 * Central API module. Supabase + Cloudinary + order system.
 * Config fetched from /api/config (Vercel serverless).
 *
 * Supabase tables needed:
 *   menu_items   — id, name, category, subcategory, description, price, available, image_url, daily_stock
 *   orders       — id, name, email, phone, delivery_type, address, notes, total, status, created_at
 *   order_items  — id, order_id, item_id, item_name, price, qty
 *   reviews      — id, rating, message, created_at
 * ─────────────────────────────────────────────────────────────
 */

// ─── CONFIG LOADER ───────────────────────────────────────────
let _config = null;

export async function getConfig() {
  if (_config) return _config;
  try {
    const res = await fetch('/api/config');
    _config   = await res.json();
    return _config;
  } catch (err) {
    console.error('[api] Could not load config:', err);
    _config = window.__ENV || {};
    return _config;
  }
}

// ─── SUPABASE CLIENT ─────────────────────────────────────────
const sb = {
  async _req(path, options = {}) {
    const cfg    = await getConfig();
    const token  = this._getToken();
    const authKey = token || cfg.supabaseAnonKey;

    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
      headers: {
        'apikey':        cfg.supabaseAnonKey,
        'Authorization': `Bearer ${authKey}`,
        'Content-Type':  'application/json',
        'Prefer':        options.prefer || 'return=representation',
        ...options.headers,
      },
      method: options.method || 'GET',
      body:   options.body   ? JSON.stringify(options.body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Supabase error ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  },

  _getToken() {
    try {
      const keys = Object.keys(localStorage).filter(k => k.endsWith('-auth-token'));
      if (!keys.length) return null;
      return JSON.parse(localStorage.getItem(keys[0]))?.access_token || null;
    } catch { return null; }
  },

  query(path, options = {})     { return this._req(path, options); },
  authQuery(path, options = {}) {
    if (!this._getToken()) throw new Error('Not authenticated');
    return this._req(path, options);
  },
};

// ─── RATE LIMITER ────────────────────────────────────────────
const RateLimit = {
  _store: {},
  check(key, max = 3, windowMs = 60_000) {
    const now = Date.now();
    if (!this._store[key]) this._store[key] = [];
    this._store[key] = this._store[key].filter(t => now - t < windowMs);
    if (this._store[key].length >= max) return false;
    this._store[key].push(now);
    return true;
  },
};

// ─── INPUT SANITIZER ─────────────────────────────────────────
function sanitize(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[<>"'`]/g, c =>
    ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#x27;', '`':'&#x60;' }[c]));
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function detectHoneypot(formEl) {
  const trap = formEl?.querySelector('[name="website"], [name="url"], [name="_gotcha"]');
  return !!(trap && trap.value.trim());
}

// ─────────────────────────────────────────────────────────────
// PUBLIC — MENU
// ─────────────────────────────────────────────────────────────

/**
 * loadMenu()
 * Returns items grouped by category, only where available=true.
 */
export async function loadMenu() {
  try {
    const items = await sb.query('menu_items?available=eq.true&order=category,name');
    const grouped = { starters: [], mains: [], desserts: [], drinks: [] };
    (items || []).forEach(item => {
      const cat = item.category?.toLowerCase();
      if (grouped[cat]) grouped[cat].push(item);
      else grouped[cat] = [item];
    });
    return grouped;
  } catch (err) {
    console.error('[loadMenu]', err);
    return { starters: [], mains: [], desserts: [], drinks: [] };
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC — ORDERS
// ─────────────────────────────────────────────────────────────

/**
 * submitOrder()
 * Places an order. Decrements daily_stock for each item.
 * Returns { ok, order, ticketId }
 */
export async function submitOrder(formEl, data) {
  if (detectHoneypot(formEl)) return { ok: false, message: 'Blocked.' };
  if (!RateLimit.check('order', 3, 120_000))
    return { ok: false, message: 'Too many requests. Please wait a moment.' };

  const { name, email, phone, delivery_type, address, notes, items, total } = data;

  if (!name || !email || !phone)
    return { ok: false, message: 'Please fill in all required fields.' };
  if (!validateEmail(email))
    return { ok: false, message: 'Please enter a valid email address.' };
  if (!items || !items.length)
    return { ok: false, message: 'Your order is empty.' };
  if (delivery_type === 'delivery' && !address)
    return { ok: false, message: 'Please enter your delivery address.' };

  // Try serverless first
  try {
    const apiRes = await fetch('/api/order', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name: sanitize(name, 100),
        email: sanitize(email, 100),
        phone: sanitize(phone, 30),
        delivery_type: sanitize(delivery_type, 20),
        address: sanitize(address || '', 300),
        notes: sanitize(notes || '', 500),
        items,
        total,
        status: 'confirmed',
      }),
    });
    if (apiRes.ok) {
      const result = await apiRes.json();
      return result;
    }
    throw new Error('Serverless unavailable');
  } catch {
    // Fallback: direct Supabase insert
    try {
      const orderPayload = {
        name:          sanitize(name, 100),
        email:         sanitize(email, 100),
        phone:         sanitize(phone, 30),
        delivery_type: sanitize(delivery_type || 'pickup', 20),
        address:       sanitize(address || '', 300),
        notes:         sanitize(notes || '', 500),
        total:         parseFloat(total) || 0,
        status:        'confirmed',
      };

      const rows = await sb.query('orders', {
        method: 'POST',
        body:   orderPayload,
        prefer: 'return=representation',
      });
      const order = Array.isArray(rows) ? rows[0] : rows;

      // Insert order_items
      if (order?.id && items?.length) {
        const orderItems = items.map(i => ({
          order_id:  order.id,
          item_id:   i.id,
          item_name: sanitize(i.name, 100),
          price:     parseFloat(i.price) || 0,
          qty:       parseInt(i.qty) || 1,
        }));
        await sb.query('order_items', {
          method: 'POST',
          body:   orderItems,
          prefer: 'return=minimal',
        }).catch(err => console.warn('[order_items insert]', err));

        // Decrement stock for each item
        for (const item of items) {
          if (item.id) {
            await decrementStock(item.id, parseInt(item.qty) || 1).catch(() => {});
          }
        }
      }

      const ticketId = String(order?.id || '').slice(-8).toUpperCase()
        || Math.random().toString(36).slice(2, 10).toUpperCase();

      return {
        ok: true,
        order: { ...order, ...orderPayload, items },
        ticketId,
        message: 'Order confirmed!',
      };
    } catch (err) {
      console.error('[submitOrder]', err);
      return { ok: false, message: 'Something went wrong. Please try again.' };
    }
  }
}

/**
 * decrementStock()
 * Reduces daily_stock by qty for a menu item. Clamps at 0.
 */
async function decrementStock(itemId, qty = 1) {
  try {
    // Fetch current stock
    const rows = await sb.query(`menu_items?id=eq.${itemId}&select=daily_stock`);
    const item = Array.isArray(rows) ? rows[0] : rows;
    if (!item || item.daily_stock === null || item.daily_stock === undefined) return;
    const newStock = Math.max(0, (item.daily_stock || 0) - qty);
    await sb.query(`menu_items?id=eq.${itemId}`, {
      method: 'PATCH',
      body:   { daily_stock: newStock },
      prefer: 'return=minimal',
    });
  } catch (err) {
    console.warn('[decrementStock]', err);
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC — NEWSLETTER (kept for compatibility)
// ─────────────────────────────────────────────────────────────

export async function submitNewsletter(formEl, email) {
  if (detectHoneypot(formEl)) return { ok: false, message: 'Blocked.' };
  if (!RateLimit.check('newsletter', 1, 120_000))
    return { ok: false, message: 'Please wait before trying again.' };
  if (!validateEmail(email))
    return { ok: false, message: 'Please enter a valid email address.' };

  try {
    await sb.query('newsletter_subscribers', {
      method: 'POST',
      body:   { email: sanitize(email, 100) },
      prefer: 'return=minimal',
    });
    return { ok: true, message: "You're on the list." };
  } catch (err) {
    if (err.message?.includes('duplicate') || err.message?.includes('unique'))
      return { ok: true, message: "You're already subscribed." };
    console.error('[submitNewsletter]', err);
    return { ok: false, message: 'Could not subscribe. Please try again.' };
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC — REVIEWS
// ─────────────────────────────────────────────────────────────

export async function submitReview(data) {
  if (!RateLimit.check('review', 2, 300_000))
    return { ok: false, message: 'Feedback already received. Thank you.' };

  const { rating, message = '' } = data;
  if (!rating || rating < 1 || rating > 5)
    return { ok: false, message: 'Invalid rating.' };

  try {
    await sb.query('reviews', {
      method: 'POST',
      body:   { rating: parseInt(rating), message: sanitize(message, 1000) },
      prefer: 'return=minimal',
    });
    return { ok: true, message: 'Feedback received.' };
  } catch (err) {
    console.error('[submitReview]', err);
    return { ok: false, message: 'Could not submit. Please try again.' };
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN — AUTH
// ─────────────────────────────────────────────────────────────

export async function adminLogin(email, password) {
  if (!validateEmail(email)) return { ok: false, message: 'Invalid email.' };
  try {
    const cfg = await getConfig();
    const res = await fetch(`${cfg.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method:  'POST',
      headers: { 'apikey': cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || 'Login failed');
    const host = new URL(cfg.supabaseUrl).hostname.split('.')[0];
    localStorage.setItem(`sb-${host}-auth-token`, JSON.stringify(data));
    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, message: err.message || 'Login failed.' };
  }
}

export function adminLogout() {
  Object.keys(localStorage)
    .filter(k => k.endsWith('-auth-token'))
    .forEach(k => localStorage.removeItem(k));
}

// ─────────────────────────────────────────────────────────────
// ADMIN — ORDERS
// ─────────────────────────────────────────────────────────────

export async function adminFetchOrders(status) {
  let filter = '?order=created_at.desc';
  if (status && status !== 'all') filter = `?status=eq.${status}&order=created_at.desc`;
  return sb.authQuery(`orders${filter}`);
}

export async function adminFetchOrderItems(orderId) {
  return sb.authQuery(`order_items?order_id=eq.${orderId}&order=id.asc`);
}

export async function adminUpdateOrderStatus(id, status, reason = '') {
  const body = { status };
  if (reason) body.cancel_reason = sanitize(reason, 400);
  return sb.authQuery(`orders?id=eq.${id}`, {
    method: 'PATCH', body, prefer: 'return=minimal',
  });
}

/**
 * adminFetchAnalytics()
 * Fetches all orders for analytics computation.
 */
export async function adminFetchAnalytics() {
  try {
    return await sb.authQuery('orders?order=created_at.desc') || [];
  } catch (err) {
    console.error('[adminFetchAnalytics]', err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN — MENU
// ─────────────────────────────────────────────────────────────

export async function adminFetchMenuItems() {
  return sb.authQuery('menu_items?order=category,name');
}

export async function adminUpdateMenu(item) {
  const payload = {
    name:        sanitize(item.name, 100),
    category:    sanitize(item.category, 50),
    subcategory: sanitize(item.subcategory || '', 60),
    description: sanitize(item.description || '', 500),
    price:       parseFloat(item.price),
    available:   Boolean(item.available),
  };
  if (item.image_url !== undefined) payload.image_url = sanitize(item.image_url || '', 500);

  if (item.id) {
    return sb.authQuery(`menu_items?id=eq.${item.id}`, {
      method: 'PATCH', body: payload, prefer: 'return=representation',
    });
  }
  return sb.authQuery('menu_items', { method: 'POST', body: payload, prefer: 'return=representation' });
}

export async function adminDeleteMenuItem(id) {
  return sb.authQuery(`menu_items?id=eq.${id}`, {
    method: 'DELETE', prefer: 'return=minimal',
  });
}

/**
 * adminSetDailyStock()
 * Sets daily_stock for a menu item. Pass null for unlimited.
 */
export async function adminSetDailyStock(itemId, stock) {
  const val = stock === '' || stock === null || stock === undefined ? null : Math.max(0, parseInt(stock));
  return sb.authQuery(`menu_items?id=eq.${itemId}`, {
    method: 'PATCH',
    body:   { daily_stock: val },
    prefer: 'return=minimal',
  });
}

/**
 * adminResetAllStock()
 * Resets all menu items' daily_stock to a given value.
 */
export async function adminResetAllStock(defaultStock) {
  return sb.authQuery('menu_items', {
    method: 'PATCH',
    body:   { daily_stock: defaultStock },
    prefer: 'return=minimal',
  });
}

// ─────────────────────────────────────────────────────────────
// ADMIN — REVIEWS
// ─────────────────────────────────────────────────────────────

export async function adminFetchReviews() {
  return sb.authQuery('reviews?order=created_at.desc');
}

// ─────────────────────────────────────────────────────────────
// NOTIFY (best-effort email)
// ─────────────────────────────────────────────────────────────

export async function sendCustomerEmail(order, updateType, reason = '') {
  try {
    const res = await fetch('/api/notify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ order, updateType, reason }),
    });
    if (!res.ok) throw new Error('Notify endpoint error');
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
