var fetch = require('node-fetch');

// =============================================================
// api/paypal-capture.js
// Captures PayPal payment after customer approves and
// activates the device in Supabase.
// =============================================================

const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

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

function addOneYear(fromDate) {
  var d = fromDate ? new Date(fromDate) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

module.exports = async function(req, res) {
  var token     = req.query.token;
  var device_id = req.query.device_id;
  var plan      = req.query.plan;
  var app_id    = req.query.app_id || 'bebztv';
  var siteBase  = app_id === 'arabic_iptv' ? process.env.SITE_URL + '/arabic' : process.env.SITE_URL;

  if (!token || !device_id || !plan) {
    return res.redirect(siteBase + '/?payment=cancelled');
  }

  try {
    var auth = await getPayPalAccessToken();

    var captureResp = await fetch(auth.baseUrl + '/v2/checkout/orders/' + token + '/capture', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + auth.token,
        'Content-Type': 'application/json'
      }
    });

    var capture = await captureResp.json();

    if (capture.status !== 'COMPLETED') {
      console.error('PayPal capture failed:', JSON.stringify(capture));
      return res.redirect(siteBase + '/?payment=cancelled');
    }

    // Extract custom_id for device_id and plan
    var finalDeviceId = device_id;
    var finalPlan     = plan;
    var purchaseUnit  = capture.purchase_units && capture.purchase_units[0];

    if (purchaseUnit && purchaseUnit.custom_id) {
      try {
        var custom = JSON.parse(purchaseUnit.custom_id);
        if (custom.device_id) finalDeviceId = custom.device_id;
        if (custom.plan)      finalPlan      = custom.plan;
      } catch(e) {}
    }

    var paypalOrderId = capture.id;
    var payerId       = req.query.PayerID || null;
    var expiryDate    = finalPlan === 'annual' ? addOneYear(null) : null;
    var finalAppId    = req.query.app_id || (purchaseUnit && purchaseUnit.custom_id ? (() => { try { return JSON.parse(purchaseUnit.custom_id).app_id || 'bebztv'; } catch(e) { return 'bebztv'; } })() : 'bebztv');
    var devicesTable  = finalAppId === 'arabic_iptv' ? 'devices_arabic' : 'devices';
    var redirectBase  = finalAppId === 'arabic_iptv'
      ? process.env.SITE_URL + '/arabic'
      : process.env.SITE_URL;

    var result = await sb.from(devicesTable).update({
      status:          'active',
      expiry_date:     expiryDate,
      paypal_order_id: paypalOrderId,
      paypal_payer_id: payerId
    }).eq('device_id', finalDeviceId);

    if (result.error) {
      console.error('Supabase error:', result.error.message);
    } else {
      console.log('Activated device:', finalDeviceId, 'plan:', finalPlan, 'expiry:', expiryDate, 'app:', finalAppId);
    }

    return res.redirect(
      redirectBase + '/?payment=success&plan=' + finalPlan + '&device_id=' + encodeURIComponent(finalDeviceId)
    );

  } catch(err) {
    console.error('Capture error:', err);
    return res.redirect(siteBase + '/?payment=cancelled');
  }
};
