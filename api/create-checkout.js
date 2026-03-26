// api/create-checkout.js
// Creates a Stripe Checkout session and returns the URL
// Called from bebz.tv when user clicks Annual or Lifetime

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICE_IDS = {
  annual:   'price_1TFMJSDygJnG7IrzoolT97kl',
  lifetime: 'price_1TFMLQDygJnG7IrzkoYXGR9v',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const { device_id, plan } = body;

  if (!device_id || !plan) {
    return res.status(400).json({ error: 'device_id and plan are required' });
  }

  if (!PRICE_IDS[plan]) {
    return res.status(400).json({ error: 'Invalid plan. Use "annual" or "lifetime"' });
  }

  try {
    const sessionConfig = {
      payment_method_types: ['card'],
      line_items: [{
        price: PRICE_IDS[plan],
        quantity: 1,
      }],
      metadata: {
        device_id: device_id,
        plan: plan,
      },
      success_url: `https://bebz.tv/?payment=success&device=${encodeURIComponent(device_id)}&plan=${plan}`,
      cancel_url:  `https://bebz.tv/?payment=cancelled&device=${encodeURIComponent(device_id)}`,
    };

    // Annual = subscription mode, Lifetime = payment mode
    if (plan === 'annual') {
      sessionConfig.mode = 'subscription';
    } else {
      sessionConfig.mode = 'payment';
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    res.status(200).json({ url: session.url });

  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
