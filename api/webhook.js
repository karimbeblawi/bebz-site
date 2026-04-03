var fetch = require('node-fetch');

// =============================================================
// api/webhook.js
// Handles PayPal webhook events for subscription management.
// =============================================================

const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports.config = {
  api: { bodyParser: false }
};

function getRawBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() { resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

function addOneYear(fromDate) {
  var d = fromDate ? new Date(fromDate) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

async function getPayPalAccessToken() {
  var mode    = process.env.PAYPAL_MODE || 'live';
  var baseUrl = mode === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  var resp = await fetch(baseUrl + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(process.env.PAYPAL_CLIENT_ID + ':' + process.env.PAYPAL_SECRET_KEY).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  var data = await resp.json();
  return { token: data.access_token, baseUrl };
}

module.exports = async function(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var rawBody = await getRawBody(req);
  var event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch(err) {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  console.log('PayPal webhook:', event.event_type);

  try {
    var resource = event.resource || {};

    // Payment captured (one-time or subscription)
    if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
      var customId  = resource.custom_id || '';
      var deviceId  = '';
      var plan      = '';

      try {
        var custom = JSON.parse(customId);
        deviceId = custom.device_id || '';
        plan     = custom.plan      || '';
      } catch(e) {
        var parts = customId.split('_');
        deviceId = parts[0] || '';
        plan     = parts[1] || '';
      }

      if (!deviceId) {
        console.error('No device_id in custom_id');
        return res.status(200).json({ received: true });
      }

      var expiryDate  = plan === 'annual' ? addOneYear(null) : null;
      var paypalPayerId = (resource.payer && resource.payer.payer_id) || null;

      var r = await sb.from('devices').update({
        status:          'active',
        expiry_date:     expiryDate,
        paypal_order_id: resource.id || null,
        paypal_payer_id: paypalPayerId
      }).eq('device_id', deviceId);

      if (r.error) console.error('Supabase error:', r.error.message);
      else console.log('Activated device:', deviceId);

    // Subscription renewed
    } else if (event.event_type === 'BILLING.SUBSCRIPTION.ACTIVATED' ||
               event.event_type === 'PAYMENT.SALE.COMPLETED') {

      var payerId = resource.payer_id || (resource.payer && resource.payer.payer_id) || null;
      if (!payerId) return res.status(200).json({ received: true });

      var lookup = await sb.from('devices').select('device_id, expiry_date').eq('paypal_payer_id', payerId).limit(1);
      if (lookup.error || !lookup.data || lookup.data.length === 0) {
        return res.status(200).json({ received: true });
      }

      var newExpiry = addOneYear(lookup.data[0].expiry_date);
      var r2 = await sb.from('devices').update({ status: 'active', expiry_date: newExpiry }).eq('paypal_payer_id', payerId);
      if (r2.error) console.error('Supabase error:', r2.error.message);
      else console.log('Renewed device for payer:', payerId);

    // Subscription cancelled/suspended/expired
    } else if (event.event_type === 'BILLING.SUBSCRIPTION.CANCELLED' ||
               event.event_type === 'BILLING.SUBSCRIPTION.SUSPENDED' ||
               event.event_type === 'BILLING.SUBSCRIPTION.EXPIRED') {

      var payerId2 = resource.payer_id || (resource.payer && resource.payer.payer_id) || null;
      if (!payerId2) return res.status(200).json({ received: true });

      var r3 = await sb.from('devices').update({ status: 'expired' }).eq('paypal_payer_id', payerId2);
      if (r3.error) console.error('Supabase error:', r3.error.message);
      else console.log('Expired device for payer:', payerId2);
    }

  } catch(err) {
    console.error('Webhook error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  return res.status(200).json({ received: true });
};
