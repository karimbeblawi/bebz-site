// =============================================================
// api/webhook.js
//
// Handles PayPal webhook events for subscription management.
// PayPal IPN/webhook for: payment completed, subscription
// renewed, subscription cancelled.
// =============================================================

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports.config = {
  api: { bodyParser: false },
};

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function addOneYear(fromDate) {
  const d = fromDate ? new Date(fromDate) : new Date();
  if (isNaN(d.getTime())) return addOneYear(null);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

async function verifyPayPalWebhook(headers, rawBody) {
  // Verify with PayPal's verification API
  const mode    = process.env.PAYPAL_MODE || 'live';
  const baseUrl = mode === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  // Get access token
  const tokenResp = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(
        process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_SECRET_KEY
      ).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const tokenData = await tokenResp.json();

  const verifyResp = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      auth_algo:         headers['paypal-auth-algo'],
      cert_url:          headers['paypal-cert-url'],
      transmission_id:   headers['paypal-transmission-id'],
      transmission_sig:  headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id:        process.env.PAYPAL_WEBHOOK_ID,
      webhook_event:     JSON.parse(rawBody.toString('utf8'))
    })
  });

  const verifyData = await verifyResp.json();
  return verifyData.verification_status === 'SUCCESS';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);

  // Verify webhook signature
  try {
    const valid = await verifyPayPalWebhook(req.headers, rawBody);
    if (!valid) {
      console.error('Invalid PayPal webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Webhook verification error:', err);
    return res.status(400).json({ error: 'Verification failed' });
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('PayPal webhook event:', event.event_type);

  try {
    const resource = event.resource || {};

    // ── Payment captured (one-time or first subscription payment) ──
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      const customId = resource.custom_id || resource.custom || '';
      let deviceId   = '';
      let plan       = '';

      try {
        const custom = JSON.parse(customId);
        deviceId = custom.device_id || '';
        plan     = custom.plan      || '';
      } catch (e) {
        // fallback: custom_id might be "deviceId_plan"
        const parts = customId.split('_');
        deviceId = parts[0] || '';
        plan     = parts[1] || '';
      }

      if (!deviceId) {
        console.error('No device_id in custom_id:', customId);
        return res.status(200).json({ received: true });
      }

      const expiryDate  = plan === 'annual' ? addOneYear(null) : null;
      const paypalPayerId = resource.payer && resource.payer.payer_id || null;

      const { error } = await sb.from('devices').update({
        status:          'active',
        expiry_date:     expiryDate,
        paypal_order_id: resource.id || null,
        paypal_payer_id: paypalPayerId,
      }).eq('device_id', deviceId);

      if (error) console.error('Supabase error:', error.message);
      else console.log('Activated device:', deviceId, 'plan:', plan);

    // ── Subscription renewed ──────────────────────────────────────
    } else if (event.event_type === 'BILLING.SUBSCRIPTION.RENEWED' ||
               event.event_type === 'PAYMENT.SALE.COMPLETED') {

      const payerId = resource.payer_id ||
                      (resource.payer && resource.payer.payer_id) || null;

      if (!payerId) {
        console.error('No payer_id for renewal');
        return res.status(200).json({ received: true });
      }

      const lookup = await sb
        .from('devices')
        .select('device_id, expiry_date')
        .eq('paypal_payer_id', payerId)
        .limit(1);

      if (lookup.error || !lookup.data || lookup.data.length === 0) {
        console.error('No device found for payer:', payerId);
        return res.status(200).json({ received: true });
      }

      const device   = lookup.data[0];
      const newExpiry = addOneYear(device.expiry_date);

      const { error } = await sb.from('devices').update({
        status:      'active',
        expiry_date: newExpiry,
      }).eq('paypal_payer_id', payerId);

      if (error) console.error('Supabase error:', error.message);
      else console.log('Renewed device:', device.device_id, 'new expiry:', newExpiry);

    // ── Subscription cancelled ────────────────────────────────────
    } else if (event.event_type === 'BILLING.SUBSCRIPTION.CANCELLED' ||
               event.event_type === 'BILLING.SUBSCRIPTION.SUSPENDED') {

      const payerId = resource.payer_id ||
                      (resource.payer && resource.payer.payer_id) || null;

      if (!payerId) return res.status(200).json({ received: true });

      const { error } = await sb.from('devices')
        .update({ status: 'expired' })
        .eq('paypal_payer_id', payerId);

      if (error) console.error('Supabase error:', error.message);
      else console.log('Expired device for payer:', payerId);
    }

  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  return res.status(200).json({ received: true });
};
