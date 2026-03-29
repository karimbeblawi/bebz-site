const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Disable body parsing so Stripe can verify the raw body signature
module.exports.config = {
  api: { bodyParser: false },
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

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var rawBody = await getRawBody(req);
  var sig = req.headers['stripe-signature'];
  var event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Signature error:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('Event:', event.type);

  try {

    // ── New checkout completed (first payment for any plan) ──────────────
    if (event.type === 'checkout.session.completed') {
      var session = event.data.object;
      var deviceId = session.metadata && session.metadata.device_id;
      var plan = session.metadata && session.metadata.plan;
      if (!deviceId) { console.error('No device_id in metadata'); return res.status(200).json({ received: true }); }

      var expiryDate = null;
      if (plan === 'annual') {
        expiryDate = addOneYear(null);
      }
      // lifetime: expiryDate stays null (no expiry)

      var r = await sb.from('devices').update({
        status: 'active',
        expiry_date: expiryDate,
        stripe_customer_id: session.customer || null,
        stripe_subscription_id: session.subscription || null,
      }).eq('device_id', deviceId);

      if (r.error) console.error('Supabase error:', r.error.message);
      else console.log('Activated device:', deviceId, 'plan:', plan, 'expiry:', expiryDate);

    // ── Annual subscription renewed ──────────────────────────────────────
    } else if (event.type === 'invoice.payment_succeeded') {
      var invoice = event.data.object;

      // Only handle subscription renewals, not the first invoice
      // (first invoice is covered by checkout.session.completed)
      if (invoice.billing_reason !== 'subscription_cycle') {
        return res.status(200).json({ received: true });
      }

      var customerId = invoice.customer;
      if (!customerId) { return res.status(200).json({ received: true }); }

      // Look up the device by stripe_customer_id
      var lookup = await sb
        .from('devices')
        .select('device_id, expiry_date')
        .eq('stripe_customer_id', customerId)
        .limit(1);

      if (lookup.error || !lookup.data || lookup.data.length === 0) {
        console.error('No device found for customer:', customerId);
        return res.status(200).json({ received: true });
      }

      var device = lookup.data[0];
      // Extend from current expiry if it's in the future, otherwise from today
      var newExpiry = addOneYear(device.expiry_date);

      var r2 = await sb.from('devices').update({
        status: 'active',
        expiry_date: newExpiry,
      }).eq('stripe_customer_id', customerId);

      if (r2.error) console.error('Supabase error:', r2.error.message);
      else console.log('Renewed device:', device.device_id, 'new expiry:', newExpiry);

    // ── Subscription cancelled or payment failed ─────────────────────────
    } else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      var customerId = event.data.object.customer;
      var r3 = await sb.from('devices').update({ status: 'expired' }).eq('stripe_customer_id', customerId);
      if (r3.error) console.error('Supabase error:', r3.error.message);
      else console.log('Expired device for customer:', customerId);
    }

  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  return res.status(200).json({ received: true });
};
