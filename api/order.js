/**
 * /api/order.js — Vercel Serverless Function
 * ─────────────────────────────────────────────────────────────
 * Handles order creation server-side using service_role key.
 * - Inserts into `orders` table
 * - Inserts into `order_items` table
 * - Decrements daily_stock for each ordered item
 * - Optional: sends confirmation email via Resend
 * ─────────────────────────────────────────────────────────────
 */

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function sanitize(str, maxLen = 255) {
  if (typeof str !== 'string') return '';
  return str.slice(0, maxLen).replace(/[<>"'`]/g, c =>
    ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#x27;', '`':'&#x60;' }[c]));
}

async function supabasePatch(supabaseUrl, key, table, filter, body) {
  return fetch(`${supabaseUrl}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

async function supabaseGet(supabaseUrl, key, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) return null;
  return res.json();
}

function buildConfirmationEmail(order, items, shortId) {
  const rows = (items || []).map(i =>
    `<tr>
      <td style="padding:0.4rem 0.8rem;color:#a0a0a0">${sanitize(i.item_name, 80)}</td>
      <td style="padding:0.4rem 0.8rem;text-align:center">${i.qty}</td>
      <td style="padding:0.4rem 0.8rem;text-align:right">$${(parseFloat(i.price||0)*i.qty).toFixed(2)}</td>
    </tr>`
  ).join('');

  return `
    <div style="font-family:'Inter',sans-serif;max-width:560px;margin:0 auto;color:#f5f5f5;background:#080808;padding:3rem 2rem;border-radius:16px;border:1px solid rgba(229,37,37,0.2)">
      <p style="font-family:'Georgia',serif;font-size:1.8rem;letter-spacing:0.35em;text-align:center;color:#e52525;margin-bottom:0.3rem">SAMY</p>
      <p style="text-align:center;font-size:0.65rem;letter-spacing:0.3em;color:#555;text-transform:uppercase;margin-bottom:2.5rem">CLOUD BAKERY — ORDER CONFIRMED</p>

      <h2 style="font-size:1.1rem;font-weight:400;margin-bottom:1rem">Your allocation is secured, ${sanitize(order.name, 60)}.</h2>

      <table style="width:100%;border-collapse:collapse;margin-bottom:1.5rem;font-size:0.85rem">
        <thead>
          <tr style="border-bottom:1px solid rgba(255,255,255,0.06)">
            <th style="padding:0.5rem 0.8rem;text-align:left;color:#555;font-weight:400;font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase">Item</th>
            <th style="padding:0.5rem 0.8rem;text-align:center;color:#555;font-weight:400;font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase">Qty</th>
            <th style="padding:0.5rem 0.8rem;text-align:right;color:#555;font-weight:400;font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase">Amount</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="border-top:1px solid rgba(255,255,255,0.06)">
            <td colspan="2" style="padding:0.8rem;color:#888;font-size:0.8rem;letter-spacing:0.1em">TOTAL</td>
            <td style="padding:0.8rem;text-align:right;color:white;font-weight:700;font-size:1rem">$${parseFloat(order.total||0).toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:1.2rem;margin-bottom:1.5rem;font-size:0.82rem">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem">
          <span style="color:#555">Order ID</span>
          <span style="color:#e52525;font-weight:700;letter-spacing:0.12em">${shortId}</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem">
          <span style="color:#555">Type</span>
          <span style="text-transform:capitalize">${sanitize(order.delivery_type||'pickup',20)}</span>
        </div>
        ${order.address ? `<div style="display:flex;justify-content:space-between">
          <span style="color:#555">Delivery Address</span>
          <span style="text-align:right;max-width:55%">${sanitize(order.address,200)}</span>
        </div>` : ''}
      </div>

      <p style="color:#555;font-size:0.78rem;line-height:1.6;margin-bottom:1.5rem">
        Present your Order ID upon pickup or mention it to your delivery driver. Our team will begin preparing your batch shortly.
      </p>

      <p style="color:#e52525;font-size:0.75rem;letter-spacing:0.2em;text-align:center">— THE CLOUD LABORATORY</p>
    </div>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone, delivery_type, address, notes, items, total, _gotcha } = req.body || {};

  // Honeypot
  if (_gotcha) return res.status(200).json({ ok: true });

  // Validation
  if (!name || !email || !phone)
    return res.status(400).json({ ok: false, message: 'Missing required fields.' });
  if (!validateEmail(email))
    return res.status(400).json({ ok: false, message: 'Invalid email address.' });
  if (!items || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ ok: false, message: 'Order has no items.' });
  if (delivery_type === 'delivery' && !address)
    return res.status(400).json({ ok: false, message: 'Delivery address required.' });

  const supabaseUrl    = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({ ok: false, message: 'Server configuration error.' });
  }

  try {
    // ── 1. Insert order ──
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

    const dbRes = await fetch(`${supabaseUrl}/rest/v1/orders`, {
      method: 'POST',
      headers: {
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
      body: JSON.stringify(orderPayload),
    });

    if (!dbRes.ok) {
      const err = await dbRes.json().catch(() => ({}));
      throw new Error(err.message || 'Database error creating order');
    }

    const rows  = await dbRes.json();
    const order = Array.isArray(rows) ? rows[0] : rows;

    if (!order?.id) throw new Error('Order created but no ID returned.');

    const shortId = String(order.id).slice(-8).toUpperCase();

    // ── 2. Insert order_items ──
    const orderItems = items.map(i => ({
      order_id:  order.id,
      item_id:   i.id || null,
      item_name: sanitize(i.name || '', 100),
      price:     parseFloat(i.price) || 0,
      qty:       Math.max(1, parseInt(i.qty) || 1),
    }));

    const itemsRes = await fetch(`${supabaseUrl}/rest/v1/order_items`, {
      method: 'POST',
      headers: {
        'apikey':        serviceRoleKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(orderItems),
    });

    if (!itemsRes.ok) {
      console.error('[order_items] Insert failed:', await itemsRes.text());
      // Don't block — order was created
    }

    // ── 3. Decrement daily_stock for each item ──
    for (const item of items) {
      if (!item.id) continue;
      try {
        const current = await supabaseGet(supabaseUrl, serviceRoleKey, `menu_items?id=eq.${item.id}&select=daily_stock`);
        const row = Array.isArray(current) ? current[0] : current;
        if (!row || row.daily_stock === null || row.daily_stock === undefined) continue;
        const newStock = Math.max(0, (row.daily_stock || 0) - (parseInt(item.qty) || 1));
        await supabasePatch(supabaseUrl, serviceRoleKey, 'menu_items', `id=eq.${item.id}`, { daily_stock: newStock });
      } catch (stockErr) {
        console.warn('[stock decrement]', item.id, stockErr.message);
      }
    }

    // ── 4. Optional confirmation email ──
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && order.email) {
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({
          from:    process.env.FROM_EMAIL || 'orders@samycloudbakery.com',
          to:      [order.email],
          subject: `Order Confirmed — SAMY #${shortId}`,
          html:    buildConfirmationEmail(order, orderItems, shortId),
        }),
      }).catch(err => console.error('[email]', err));
    }

    return res.status(200).json({
      ok:       true,
      order:    { ...order, items: orderItems },
      ticketId: shortId,
      message:  'Order confirmed!',
    });

  } catch (err) {
    console.error('[/api/order]', err);
    return res.status(500).json({ ok: false, message: 'Could not save order. Please try again.' });
  }
}
