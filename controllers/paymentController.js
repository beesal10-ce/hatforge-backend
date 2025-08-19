// controllers/paymentController.js
const Stripe = require('stripe');

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is missing. Add it to your backend .env and restart.');
}

// (Optional) Pin to a recent API version you have enabled on your account
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY /*, { apiVersion: '2024-06-20' }*/);

// Shipping prices in cents (override in .env if you like)
const SHIPPING_STANDARD_CENTS  = Number(process.env.SHIPPING_STANDARD_CENTS  || 699);   // $6.99
const SHIPPING_EXPEDITED_CENTS = Number(process.env.SHIPPING_EXPEDITED_CENTS || 1599);  // $15.99

// Optional: force specific payment method types via env
// Example in .env: PAYMENT_METHOD_TYPES=card,link,cashapp
const PMT_ENV = (process.env.PAYMENT_METHOD_TYPES || '').trim();
const EXPLICIT_PAYMENT_METHOD_TYPES = PMT_ENV
  ? PMT_ENV.split(',').map(s => s.trim()).filter(Boolean)
  : null;

const toUsd = cents => (Number(cents || 0) / 100).toFixed(2);

function normalizeCountry(input) {
  if (!input) return 'US';
  const v = String(input).trim();
  if (v.length === 2) return v.toUpperCase();
  if (/united states/i.test(v)) return 'US';
  return v;
}

exports.createIntent = async (req, res) => {
  try {
    const { orderSummary, shipping } = req.body || {};
    if (!orderSummary?.items?.length) {
      return res.status(400).json({ error: { message: 'No items in order.' } });
    }
    if (!shipping?.address1 || !shipping?.city || !shipping?.state || !shipping?.postalCode) {
      return res.status(400).json({ error: { message: 'Shipping address incomplete for tax.' } });
    }

    // ---- Build a lean items array (NO base64 images here!) ----
    const items = orderSummary.items.map((it) => {
      const qty = Number(it.quantity) || 1;
      const unitCents = Math.round(Number(it.unitPrice) * 100); // 24.99 -> 2499
      return {
        id: String(it.id || ''),
        hatType: String(it.hatType || 'Hat'),
        color: String(it.hatColor || ''),
        qty,
        unitCents,
        lineCents: unitCents * qty,
      };
    });

    // ✅ Subtotal from our own items (robust across API versions)
    const subtotalCents = items.reduce((a, it) => a + it.lineCents, 0);

    const shippingCents =
      (shipping?.deliveryMethod === 'expedited') ? SHIPPING_EXPEDITED_CENTS : SHIPPING_STANDARD_CENTS;

    // ---- Stripe Tax CALCULATION (figures out tax incl. shipping taxability) ----
    const calculation = await stripe.tax.calculations.create({
      currency: 'usd',
      customer_details: {
        address: {
          line1: shipping.address1,
          line2: shipping.address2 || undefined,
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.postalCode,
          country: normalizeCountry(shipping.country),
        },
        address_source: 'shipping',
      },
      line_items: items.map((i) => ({
        amount: i.unitCents,   // per-unit cents
        quantity: i.qty,
        reference: i.id,
        // Optionally set a tax_code here if you sell a special category
        // tax_code: 'txcd_99999999',
      })),
      shipping_cost: { amount: shippingCents },
    });

  // Shipping returned by Stripe calculation (or fallback to what we sent)
const calcShippingCents =
calculation?.shipping_cost?.amount != null
  ? Number(calculation.shipping_cost.amount)
  : shippingCents;

// Total from Stripe (includes tax)
const totalCents =
calculation?.amount_total != null
  ? Number(calculation.amount_total)
  : (subtotalCents + calcShippingCents);

// Robust tax extraction (covers older API versions)
let taxCents;
if (typeof calculation?.amount_tax === 'number') {
taxCents = Number(calculation.amount_tax);
} else if (Array.isArray(calculation?.tax_breakdown) && calculation.tax_breakdown.length) {
taxCents = calculation.tax_breakdown.reduce((sum, row) => sum + Number(row.amount || 0), 0);
} else {
// Fallback: compute as total - subtotal - shipping
taxCents = Math.max(0, totalCents - subtotalCents - calcShippingCents);
}

// Debug so you can see the resolved numbers
console.log('=== Stripe Tax Calc (fixed read) ===', {
subtotalCents,
calcShippingCents,
taxCents,
totalCents,
destination: {
  country: calculation?.customer_details?.address?.country,
  state: calculation?.customer_details?.address?.state,
  postal: calculation?.customer_details?.address?.postal_code,
},
});

    // ---- Create the PaymentIntent for the calculation total ----
    const piParams = {
      amount: totalCents,
      currency: 'usd',
      description: `Hat order (${items.length} item${items.length > 1 ? 's' : ''})`,
      // DO NOT send automatic_tax when using Calculations
      metadata: {
        tax_calculation_id: calculation.id,
        order_items: JSON.stringify(items.map(i => ({ id: i.id, qty: i.qty }))).slice(0, 4500),
      },
      shipping: shipping?.fullName ? {
        name: shipping.fullName,
        phone: shipping.phone || undefined,
        address: {
          line1: shipping.address1,
          line2: shipping.address2 || undefined,
          city: shipping.city,
          state: shipping.state,
          postal_code: shipping.postalCode,
          country: normalizeCountry(shipping.country),
        },
      } : undefined,
    };

    if (EXPLICIT_PAYMENT_METHOD_TYPES?.length) {
      piParams.payment_method_types = EXPLICIT_PAYMENT_METHOD_TYPES;
    }

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.create(piParams);
    } catch (e) {
      // If a forced PM type isn’t activated, retry without forcing them.
      const msg = String(e?.message || '');
      const isPMTissue =
        msg.includes('payment method type') ||
        msg.includes('is not activated for your account') ||
        msg.includes('Invalid payment_method_types');
      if (isPMTissue && piParams.payment_method_types) {
        const fallback = { ...piParams };
        delete fallback.payment_method_types;
        paymentIntent = await stripe.paymentIntents.create(fallback);
      } else {
        throw e;
      }
    }

    // Send a clean breakdown back to the client
    return res.json({
      clientSecret: paymentIntent.client_secret,
      breakdown: {
        items: items.map((it) => ({
          id: it.id,
          title: `${it.hatType} Hat`,
          color: it.color,
          qty: it.qty,
          unit: toUsd(it.unitCents),
          lineTotal: toUsd(it.lineCents),
        })),
        subtotal: toUsd(subtotalCents),
        shipping: toUsd(calcShippingCents),
        tax: toUsd(taxCents),
        total: toUsd(totalCents),
      },
    });
  } catch (err) {
    console.error('createIntent error:', err);
    return res.status(400).json({
      error: { message: err?.message || 'Failed to create payment intent.' },
    });
  }
};
