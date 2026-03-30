// =============================================================
// api/config.js
//
// Central subscription configuration endpoint.
// Change pricing, trial settings, and Stripe IDs here —
// no app code changes needed.
//
// GET /api/config  →  returns public config (no secrets)
// =============================================================

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  const config = {
    free_trial_enabled: true,
    free_trial_days: 30,
    plans: [
      {
        id: 'annual',
        label: 'Annual',
        description: '1 year of full access',
        price: 8.99,
        currency: 'CAD',
        period: 'year',
        badge: null
      },
      {
        id: 'lifetime',
        label: 'Lifetime',
        description: 'One-time payment, forever',
        price: 19.99,
        currency: 'CAD',
        period: 'lifetime',
        badge: 'Best Value'
      }
    ]
  };

  return res.status(200).json(config);
}
