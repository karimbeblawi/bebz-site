const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

var PRICE_IDS = {
  annual:   'price_1TFPRDRY7XEptPcwOWo3bFVD',
  lifetime: 'price_1TFPRDRY7XEptPcwET2G0VBA',
};

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  var body = req.body || {};
  var device_id = body.device_id;
  var plan = body.plan;

  if (!device_id || !plan) return res.status(400).json({ error: 'device_id and plan required' });
  if (!PRICE_IDS[plan]) return res.status(400).json({ error: 'Invalid plan' });

  try {
    var session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_IDS[plan], quantity: 1 }],
      mode: plan === 'annual' ? 'subscription' : 'payment',
      metadata: { device_id: device_id, plan: plan },
      success_url: 'https://bebz.tv/?payment=success&device=' + encodeURIComponent(device_id) + '&plan=' + plan,
      cancel_url:  'https://bebz.tv/?payment=cancelled&device=' + encodeURIComponent(device_id),
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
