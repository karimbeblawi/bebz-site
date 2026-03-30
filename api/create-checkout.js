// =============================================================
// api/create-checkout.js
//
// Creates a Stripe Checkout session for a given plan.
// Stripe price IDs are stored server-side in PLAN_CONFIG —
// never exposed to the client.
// =============================================================

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── Stripe price IDs live here — change without touching app ──
const PLAN_CONFIG = {
  annual: {
    stripe_price_id: 'price_1TFPRDRY7XEptPcwOWo3bFVD',
    mode: 'subscription'
  },
  lifetime: {
    stripe_price_id: 'price_1TFPRDRY7XEptPcwET2G0VBA',
    mode: 'payment'
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { device_id, plan } = req.body;

  if (!device_id || !plan) {
    return res.status(400).json({ error: 'Missing device_id or plan' });
  }

  const planConfig = PLAN_CONFIG[plan];
  if (!planConfig) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: planConfig.mode,
      line_items: [
        {
          price: planConfig.stripe_price_id,
          quantity: 1
        }
      ],
      metadata: {
        device_id,
        plan
      },
      success_url: `${process.env.SITE_URL}/?payment=success&plan=${plan}`,
      cancel_url: `${process.env.SITE_URL}/?payment=cancelled`
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
