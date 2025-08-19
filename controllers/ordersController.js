const db = require('../db');
const { sendOrderConfirmation } = require('../services/emailService');

// ===== parse & store design features (no frontend changes needed) =====
const VIEWS = ['front', 'back', 'left', 'right'];

const stripTags = (s) => (typeof s === 'string' ? s.replace(/<[^>]*>/g, '').trim() : null);
const extractAttr = (html, attr) => {
  if (typeof html !== 'string') return null;
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]+)"`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
};
const asInt = (v) => (Number.isFinite(+v) ? Math.round(+v) : null);
const asDec = (v) => (Number.isFinite(+v) ? +(+v).toFixed(6) : null);

/**
 * Insert one row per (order_item, view, element) into `order_item_design_features`.
 * Safe to re-run: clears existing rows for that order_item_id first.
 */
// add this helper near your other helpers
const norm = (s) => {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'undefined') return null;
    return t;
  };
  
  async function upsertDesignFeaturesFromJson(conn, orderItemId, designsJson) {
    if (!orderItemId || !designsJson) return;
  
    await conn.query(`DELETE FROM order_item_design_features WHERE order_item_id = ?`, [orderItemId]);
  
    let designs;
    try {
      designs = typeof designsJson === 'string' ? JSON.parse(designsJson) : designsJson;
    } catch {
      return;
    }
  
    for (const view of VIEWS) {
      const dv = designs?.[view];
      if (!dv || typeof dv !== 'object') continue;
  
      // ===== TEXT — insert only if actual text exists =====
      const td = dv.textData;
      if (td) {
        const contentHtml  = norm(td.text);                 // trim + nullify empties / 'null'
        const contentPlain = stripTags(contentHtml) || null; // strip tags; empty -> null
        if (contentPlain) {
          await conn.query(
            `INSERT INTO order_item_design_features
               (order_item_id, view_name, kind, position,
                content_html, content_plain, font_family, color, font_size,
                x, y, w, h, aspect_ratio)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              orderItemId, view, 'text', 1,
              contentHtml,
              contentPlain,
              extractAttr(contentHtml, 'face') || null,
              extractAttr(contentHtml, 'color') || (td.color || null),
              asInt(td.fontSize),
              asInt(td.x), asInt(td.y), asInt(td.width), asInt(td.height),
              null
            ]
          );
        }
      }
  
      // ===== LOGO — insert only if a real URL is present =====
      const ld = dv.logoData;
      const logoUrl = norm(dv.logoUrl);                      // ignore blanks / 'null'
      if (logoUrl) {
        await conn.query(
          `INSERT INTO order_item_design_features
             (order_item_id, view_name, kind, position,
              url,
              x, y, w, h, aspect_ratio)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            orderItemId, view, 'logo', 1,
            logoUrl,
            asInt(ld?.x), asInt(ld?.y), asInt(ld?.width), asInt(ld?.height),
            asDec(ld?.aspectRatio ?? (ld?.width && ld?.height ? ld.width / ld.height : null))
          ]
        );
      }
  
      // ===== SHAPE — already correct (only if sd.type) =====
      const sd = dv.shapeData;
      if (sd && sd.type) {
        await conn.query(
          `INSERT INTO order_item_design_features
             (order_item_id, view_name, kind, position,
              shape_type, is_filled, color,
              x, y, w, h, aspect_ratio)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            orderItemId, view, 'shape', 1,
            sd.type || null,
            sd.isFilled ? 1 : 0,
            sd.color || null,
            asInt(sd.x), asInt(sd.y), asInt(sd.width), asInt(sd.height),
            asDec(sd?.aspectRatio ?? (sd?.width && sd?.height ? sd.width / sd.height : null))
          ]
        );
      }
    }
  }
  


// Helper: insert or fetch id quickly
async function insertOrder(conn, { userId, piId, piStatus, email, fullName, phone, deliveryMethod,
  ship, quoteId }) {
  const [r] = await conn.query(
    `INSERT INTO orders
     (user_id, payment_intent_id, payment_status, stripe_customer_id,
      email, full_name, phone, delivery_method,
      ship_line1, ship_line2, ship_city, ship_state, ship_postal, ship_country,
      amount_subtotal_cents, amount_shipping_cents, amount_tax_cents, amount_total_cents, quote_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?)`,
    [
      userId || null,
      piId || null,
      piStatus || null,
      null,
      email || null,
      fullName || null,
      phone || null,
      deliveryMethod || 'standard',
      ship?.line1 || ship?.address1 || null,
      ship?.line2 || ship?.address2 || null,
      ship?.city || null,
      ship?.state || null,
      ship?.postal_code || ship?.postalCode || null,
      ship?.country || 'United States',
      0, 0, 0, 0, // will be updated right after
      quoteId || null
    ]
  );
  return r.insertId;
}

exports.createOrder = async (req, res) => {
  const {
    paymentIntentId,
    paymentStatus,
    orderSummary,
    shipping,
    breakdown,
    quoteId,
    // IMPORTANT: cartRawMeta only (no screenshots/attachments here)
    cartRaw = []
  } = req.body || {};

  if (!orderSummary?.items?.length) {
    return res.status(400).json({ error: { message: 'No items in order.' } });
  }

  const userId = req.user?.id || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const orderId = await insertOrder(conn, {
      userId,
      piId: paymentIntentId,
      piStatus: paymentStatus,
      email: shipping?.email,
      fullName: shipping?.fullName,
      phone: shipping?.phone,
      deliveryMethod: shipping?.deliveryMethod || 'standard',
      ship: shipping,
      quoteId: quoteId,
    });

    // insert items
    for (const it of orderSummary.items) {
      const qty = Number(it.quantity ?? it.qty ?? 1);
      const unit = Number(it.unitPrice ?? it.unit ?? 0); // in USD
      const line = Number(it.subtotal ?? it.lineTotal ?? unit * qty);

      const [ri] = await conn.query(
        `INSERT INTO order_items
         (order_id, original_item_id, hat_type, hat_color, is_clip_visible, clip_color, quantity, unit_price_cents, line_total_cents, notes)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          orderId,
          String(it.id || ''),
          String(it.hatType || 'Hat'),
          String(it.hatColor || ''),
          it.isClipVisible ? 1 : 0,
          it.clipColor || null,
          qty,
          Math.round((Number(it.unitPrice ?? it.unit ?? 0)) * 100),
          Math.round((Number(it.subtotal ?? it.lineTotal ?? 0)) * 100),
          it.notes || null
        ]
      );
      const orderItemId = ri.insertId;

      // design JSON (lightweight metadata only)
      const designs = it.designs ? JSON.stringify(it.designs) : (cartRaw.find(c => c.id === it.id)?.designs ? JSON.stringify(cartRaw.find(c => c.id === it.id).designs) : null);

      await conn.query(
        `INSERT INTO order_item_designs (order_item_id, designs_json) VALUES (?, ?)`,
        [orderItemId, designs]
      );

      await upsertDesignFeaturesFromJson(conn, orderItemId, designs);

    }

    // update money totals from breakdown
    const subtotalC = Math.round(Number(breakdown?.subtotal || 0) * 100);
    const shipC     = Math.round(Number(breakdown?.shipping || 0) * 100);
    const taxC      = Math.round(Number(breakdown?.tax || 0) * 100);
    const totalC    = Math.round(Number(breakdown?.total || 0) * 100);

    await conn.query(
      `UPDATE orders
       SET amount_subtotal_cents=?, amount_shipping_cents=?, amount_tax_cents=?, amount_total_cents=?
       WHERE id=?`,
      [subtotalC, shipC, taxC, totalC, orderId]
    );

    await conn.commit();
    return res.json({ orderId });
  } catch (e) {
    await conn.rollback();
    console.error('createOrder error:', e);
    return res.status(500).json({ error: { message: 'Failed to create order.' } });
  } finally {
    conn.release();
  }
};



exports.uploadAssets = async (req, res) => {
  const orderId = Number(req.params.orderId);
  const { assets = [] } = req.body || {};
  if (!orderId || !Array.isArray(assets)) {
    return res.status(400).json({ error: { message: 'Bad payload.' } });
  }

  // Allow larger payload JUST for this route if you want (you already raised app limit).
  // For production consider storing images to S3/GCS & save URLs instead.

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Fetch order_items to build a map original_item_id -> order_item_id
    const [rows] = await conn.query(`SELECT id, original_item_id FROM order_items WHERE order_id=?`, [orderId]);
    const idMap = new Map(rows.map(r => [String(r.original_item_id), r.id]));

    for (const a of assets) {
      const orderItemId = idMap.get(String(a.originalItemId));
      if (!orderItemId) continue;

      // screenshots: {front?, back?, left?, right?} as data URLs
      const sc = a.screenshots || {};
      for (const view of ['front', 'back', 'left', 'right']) {
        const dataUrl = sc[view];
        if (!dataUrl) continue;
        await conn.query(
          `INSERT INTO order_item_screens (order_item_id, view_name, screenshot_base64)
           VALUES (?,?,?)`,
          [orderItemId, view, dataUrl] // MEDIUMBLOB/LONGTEXT column recommended
        );
      }

      // attachedFiles: array of data URLs (pdf/png/jpg)
      const files = Array.isArray(a.attachedFiles) ? a.attachedFiles : [];
      for (const dataUrl of files) {
        await conn.query(
          `INSERT INTO order_files (order_id, file_mime, file_name, file_blob)
           VALUES (?, ?, ?, ?)`,
          [orderId, null, null, dataUrl]
        );
      }
    }

    await conn.commit();
    return res.json({ ok: true });
  } catch (e) {
    await conn.rollback();
    console.error('uploadAssets error:', e);
    return res.status(500).json({ error: { message: 'Failed to upload assets.' } });
  } finally {
    conn.release();
  }
};



exports.attachQuotePdf = async (req, res) => {
  const orderId = Number(req.params.orderId);
  let { quotePdfBase64 } = req.body || {};

  console.log('[attachQuotePdf] orderId=', orderId);
  console.log('[attachQuotePdf] body keys=', Object.keys(req.body || {}));
  if (!orderId || !quotePdfBase64) {
    return res.status(400).json({ error: { message: 'orderId and quotePdfBase64 are required.' } });
  }

  try {
    // Accept both raw base64 and data URLs
    if (typeof quotePdfBase64 === 'string' && quotePdfBase64.startsWith('data:')) {
      const idx = quotePdfBase64.indexOf('base64,');
      if (idx !== -1) quotePdfBase64 = quotePdfBase64.slice(idx + 'base64,'.length);
    }

    // quick sanity (avoid logging the actual base64)
    console.log('[attachQuotePdf] base64 length=', quotePdfBase64?.length || 0);

    if (!/^[A-Za-z0-9+/=\s]+$/.test(quotePdfBase64)) {
      return res.status(400).json({ error: { message: 'Invalid base64 payload.' } });
    }

    const pdfBuf = Buffer.from(quotePdfBase64, 'base64');
    console.log('[attachQuotePdf] decoded bytes=', pdfBuf.length);
    if (!pdfBuf.length) {
      return res.status(400).json({ error: { message: 'Empty PDF payload.' } });
    }

    const conn = await db.getConnection();
    try {
      const [r] = await conn.query(
        `UPDATE orders
           SET quote_pdf = ?, quote_pdf_uploaded_at = NOW()
         WHERE id = ?`,
        [pdfBuf, orderId]
      );
      console.log('[attachQuotePdf] affectedRows=', r.affectedRows);
      if (!r.affectedRows) {
        return res.status(404).json({ error: { message: 'Order not found.' } });
      }
      return res.json({ ok: true, size: pdfBuf.length });
    } catch (e) {
      console.error('attachQuotePdf SQL error:', e);
      return res.status(500).json({ error: { message: 'Failed to attach quote PDF.' } });
    } finally {
      try { conn.release(); } catch {}
    }
  } catch (e) {
    console.error('attachQuotePdf parse error:', e);
    return res.status(500).json({ error: { message: 'Failed to attach quote PDF.' } });
  }
};


// controllers/ordersController.js

exports.downloadQuotePdf = async (req, res) => {
    const orderId = Number(req.params.orderId);
    if (!orderId) return res.status(400).json({ error: { message: 'Bad orderId.' } });
  
    try {
      const [rows] = await db.query(
        `SELECT id, quote_pdf
         FROM orders
         WHERE id = ?`,
        [orderId]
      );
  
      const row = rows?.[0];
      if (!row || !row.quote_pdf) {
        return res.status(404).json({ error: { message: 'No quote PDF attached.' } });
      }
  
      // Serve as a proper PDF with a nice filename
      const filename = `HatForge-Order-${orderId}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      return res.send(row.quote_pdf); // Buffer
    } catch (e) {
      console.error('downloadQuotePdf error:', e);
      return res.status(500).json({ error: { message: 'Failed to stream quote PDF.' } });
    }
  };
  
  exports.sendConfirmationEmail = async (req, res) => {
    const { orderId } = req.body;
  
    if (!orderId) {
      return res.status(400).json({ message: 'Order ID is required.' });
    }
  
    try {
      // ✅ REVISED QUERY: Selects directly from the 'orders' table.
      const query = `
        SELECT 
          id,
          full_name, 
          email, 
          ship_line1, 
          ship_line2, 
          ship_city, 
          ship_state, 
          ship_postal, 
          ship_country,
          quote_id 
        FROM orders
        WHERE id = ?;
      `;
      const [rows] = await db.query(query, [orderId]);
  
      if (rows.length === 0) {
        return res.status(404).json({ message: 'Order not found.' });
      }
      const orderData = rows[0];
  
      // ✅ REVISED TEMPLATE DATA: Uses the correct column names from the 'orders' table.
      const templateData = {
        customer_name: orderData.full_name,
        order_id: orderData.id,
        quote_id: orderData.quote_id,
        shipping_name: orderData.full_name,
        shipping_address_line1: orderData.ship_line1,
        shipping_address_line2: orderData.ship_line2 || '',
        shipping_city_state_zip: `${orderData.ship_city}, ${orderData.ship_state} ${orderData.ship_postal}`,
        shipping_country: orderData.ship_country,
      };
  
      // Call the email service
      await sendOrderConfirmation(orderData.email, templateData);
  
      res.status(200).json({ message: 'Confirmation email sent successfully.' });
    } catch (error) {
      console.error('API Error sending confirmation email:', error);
      res.status(500).json({ message: 'Failed to send confirmation email.' });
    }
  };