// api/webhook.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

module.exports.default = async function(req, res) {
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
    if (event.type === 'checkout.session.completed') {
      var session = event.data.object;
      var deviceId = session.metadata && session.metadata.device_id;
      var plan = session.metadata && session.metadata.plan;
      if (!deviceId) { console.error('No device_id'); return res.status(200).json({ received: true }); }

      var expiryDate = null;
      if (plan === 'annual') {
        var exp = new Date();
        exp.setFullYear(exp.getFullYear() + 1);
        expiryDate = exp.toISOString().split('T')[0];
      }

      var r = await sb.from('devices').update({
        status: 'active',
        expiry_date: expiryDate,
        stripe_customer_id: session.customer || null,
        stripe_subscription_id: session.subscription || null,
      }).eq('device_id', deviceId);

      if (r.error) console.error('Supabase error:', r.error.message);
      else console.log('Activated device:', deviceId, 'plan:', plan);

    } else if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
      var customerId = event.data.object.customer;
      var r2 = await sb.from('devices').update({ status: 'expired' }).eq('stripe_customer_id', customerId);
      if (r2.error) console.error('Supabase error:', r2.error.message);
      else console.log('Expired device for customer:', customerId);
    }
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  return res.status(200).json({ received: true });
};
