// =============================================================
// api/create-checkout.js
//
// Creates a PayPal order for a given plan and returns the
// approval URL to redirect the customer to PayPal checkout.
// Plan pricing is stored server-side — never exposed to client.
// =============================================================

const PLAN_CONFIG = {
  annual: {
    name: 'BebzTV Annual Subscription',
    description: 'Full access to BebzTV media player for 1 year',
    amount: '8.99',
    currency: 'USD',
    type: 'subscription'
  },
  lifetime: {
    name: 'BebzTV Lifetime Access',
    description: 'Permanent access to BebzTV media player — one-time payment',
    amount: '19.99',
    currency: 'USD',
    type: 'one_time'
  }
};

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret   = process.env.PAYPAL_SECRET_KEY;
  const mode     = process.env.PAYPAL_MODE || 'live';
  const baseUrl  = mode === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  const resp = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await resp.json();
  if (!data.access_token) throw new Error('Failed to get PayPal access token');
  return { token: data.access_token, baseUrl };
}

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
    const { token, baseUrl } = await getPayPalAccessToken();

    const orderResp = await fetch(`${baseUrl}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: `${device_id}_${plan}`,
            description: planConfig.description,
            custom_id: JSON.stringify({ device_id, plan }),
            amount: {
              currency_code: planConfig.currency,
              value: planConfig.amount
            },
            items: [
              {
                name: planConfig.name,
                description: planConfig.description,
                quantity: '1',
                unit_amount: {
                  currency_code: planConfig.currency,
                  value: planConfig.amount
                },
                category: 'DIGITAL_GOODS'
              }
            ]
          }
        ],
        application_context: {
          brand_name: 'BebzTV',
          landing_page: 'NO_PREFERENCE',
          user_action: 'PAY_NOW',
          return_url: `${process.env.SITE_URL}/api/paypal-capture?device_id=${encodeURIComponent(device_id)}&plan=${plan}`,
          cancel_url: `${process.env.SITE_URL}/?payment=cancelled`
        }
      })
    });

    const order = await orderResp.json();

    if (!order.id) {
      console.error('PayPal order error:', order);
      return res.status(500).json({ error: 'Failed to create PayPal order' });
    }

    // Find the approval URL
    const approvalLink = order.links.find(l => l.rel === 'approve');
    if (!approvalLink) {
      return res.status(500).json({ error: 'No approval URL from PayPal' });
    }

    return res.status(200).json({ url: approvalLink.href });

  } catch (err) {
    console.error('PayPal error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
