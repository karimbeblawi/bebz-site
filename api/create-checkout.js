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

module.exports = async function(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var device_id = req.body.device_id;
  var plan      = req.body.plan;

  console.log('create-checkout called: device_id=' + device_id + ' plan=' + plan);
  console.log('ENV CHECK: PAYPAL_CLIENT_ID=' + (process.env.PAYPAL_CLIENT_ID ? 'SET' : 'MISSING'));
  console.log('ENV CHECK: PAYPAL_SECRET_KEY=' + (process.env.PAYPAL_SECRET_KEY ? 'SET' : 'MISSING'));
  console.log('ENV CHECK: PAYPAL_MODE=' + process.env.PAYPAL_MODE);
  console.log('ENV CHECK: SITE_URL=' + process.env.SITE_URL);

  if (!device_id || !plan) {
    return res.status(400).json({ error: 'Missing device_id or plan' });
  }

  var planConfig = PLAN_CONFIG[plan];
  if (!planConfig) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  var clientId = process.env.PAYPAL_CLIENT_ID;
  var secret   = process.env.PAYPAL_SECRET_KEY;
  var mode     = process.env.PAYPAL_MODE || 'live';
  var baseUrl  = mode === 'sandbox'
    ? 'https://api-m.sandbox.paypal.com'
    : 'https://api-m.paypal.com';

  try {
    // Step 1: Get access token
    console.log('Getting PayPal access token from ' + baseUrl);
    var tokenResp = await fetch(baseUrl + '/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(clientId + ':' + secret).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });

    var tokenData = await tokenResp.json();
    console.log('Token response status: ' + tokenResp.status);

    if (!tokenData.access_token) {
      console.error('Token error:', JSON.stringify(tokenData));
      return res.status(500).json({ error: 'PayPal auth failed', detail: JSON.stringify(tokenData) });
    }

    console.log('Got access token OK');

    // Step 2: Create order
    var orderResp = await fetch(baseUrl + '/v2/checkout/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + tokenData.access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: device_id + '_' + plan,
          description: planConfig.description,
          custom_id: JSON.stringify({ device_id: device_id, plan: plan }),
          amount: {
            currency_code: planConfig.currency,
            value: planConfig.amount
          },
          items: [{
            name: planConfig.name,
            description: planConfig.description,
            quantity: '1',
            unit_amount: {
              currency_code: planConfig.currency,
              value: planConfig.amount
            },
            category: 'DIGITAL_GOODS'
          }]
        }],
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
    console.log('Order response status: ' + orderResp.status);
    console.log('Order response: ' + JSON.stringify(order).substring(0, 200));

    if (!order.id) {
      return res.status(500).json({ error: 'Failed to create PayPal order', detail: JSON.stringify(order) });
    }

    var approvalLink = order.links.find(function(l) { return l.rel === 'approve'; });
    if (!approvalLink) {
      return res.status(500).json({ error: 'No approval URL from PayPal' });
    }

    return res.status(200).json({ url: approvalLink.href });

  } catch(err) {
    console.error('Exception:', err.message);
    return res.status(500).json({ error: 'Failed to create checkout session', detail: err.message });
  }
};
