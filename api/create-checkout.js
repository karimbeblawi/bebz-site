// =============================================================
// api/create-checkout.js
// Creates a PayPal order and returns the approval URL.
// =============================================================

var fetch = require('node-fetch');

var PLAN_CONFIG = {
  annual: {
    name: 'BebzTV Annual Subscription',
    description: 'Full access to BebzTV media player for 1 year',
    amount: '8.99',
    currency: 'USD'
  },
  lifetime: {
    name: 'BebzTV Lifetime Access',
    description: 'Permanent access to BebzTV media player — one-time payment',
    amount: '19.99',
    currency: 'USD'
  }
};

async function getPayPalAccessToken() {
  var clientId = process.env.PAYPAL_CLIENT_ID;
  var secret   = process.env.PAYPAL_SECRET_KEY;
  var mode     = process.env.PAYPAL_MODE || 'live';
  var baseUrl  = mode === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  var resp = await fetch(baseUrl + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  var data = await resp.json();
  if (!data.access_token) throw new Error('Failed to get PayPal access token: ' + JSON.stringify(data));
  return { token: data.access_token, baseUrl: baseUrl };
}

module.exports = async function(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var device_id = req.body.device_id;
  var plan      = req.body.plan;

  if (!device_id || !plan) {
    return res.status(400).json({ error: 'Missing device_id or plan' });
  }

  var planConfig = PLAN_CONFIG[plan];
  if (!planConfig) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  try {
    var auth = await getPayPalAccessToken();

    var orderResp = await fetch(auth.baseUrl + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + auth.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: device_id + '_' + plan,
            description: planConfig.description,
            custom_id: JSON.stringify({ device_id: device_id, plan: plan }),
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
          return_url: process.env.SITE_URL + '/api/paypal-capture?device_id=' + encodeURIComponent(device_id) + '&plan=' + plan,
          cancel_url: process.env.SITE_URL + '/?payment=cancelled'
        }
      })
    });

    var order = await orderResp.json();

    if (!order.id) {
      console.error('PayPal order error:', JSON.stringify(order));
      return res.status(500).json({ error: 'Failed to create PayPal order', detail: JSON.stringify(order) });
    }

    var approvalLink = order.links.find(function(l) { return l.rel === 'approve'; });
    if (!approvalLink) {
      return res.status(500).json({ error: 'No approval URL from PayPal' });
    }

    return res.status(200).json({ url: approvalLink.href });

  } catch(err) {
    console.error('PayPal error:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session', detail: err.message });
  }
};
