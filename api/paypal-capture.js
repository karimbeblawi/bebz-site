// =============================================================
// api/paypal-capture.js
//
// Captures a PayPal order after customer approves it.
// Called automatically when PayPal redirects back to our site.
// Activates the device in Supabase on successful capture.
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
  const d = fromDate ? new Date(fromDate) : new Date();
  if (isNaN(d.getTime())) return addOneYear(null);
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

export default async function handler(req, res) {
  const { token, PayerID, device_id, plan } = req.query;

  if (!token || !device_id || !plan) {
    return res.redirect(`${process.env.SITE_URL}/?payment=cancelled`);
  }

  try {
    const { token: accessToken, baseUrl } = await getPayPalAccessToken();

    // Capture the order
    const captureResp = await fetch(`${baseUrl}/v2/checkout/orders/${token}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    const capture = await captureResp.json();

    if (capture.status !== 'COMPLETED') {
      console.error('PayPal capture failed:', capture);
      return res.redirect(`${process.env.SITE_URL}/?payment=cancelled`);
    }

    // Extract custom_id to get device_id and plan
    const purchaseUnit = capture.purchase_units && capture.purchase_units[0];
    let finalDeviceId  = device_id;
    let finalPlan      = plan;

    if (purchaseUnit && purchaseUnit.custom_id) {
      try {
        const custom = JSON.parse(purchaseUnit.custom_id);
        if (custom.device_id) finalDeviceId = custom.device_id;
        if (custom.plan)      finalPlan      = custom.plan;
      } catch (e) {}
    }

    const paypalOrderId   = capture.id;
    const paypalPayerId   = PayerID || null;
    const expiryDate      = finalPlan === 'annual' ? addOneYear(null) : null;

    // Activate device in Supabase
    const { error } = await sb.from('devices').update({
      status:                 'active',
      expiry_date:            expiryDate,
      paypal_order_id:        paypalOrderId,
      paypal_payer_id:        paypalPayerId,
    }).eq('device_id', finalDeviceId);

    if (error) {
      console.error('Supabase error:', error.message);
    } else {
      console.log('Activated device:', finalDeviceId, 'plan:', finalPlan, 'expiry:', expiryDate);
    }

    return res.redirect(
      `${process.env.SITE_URL}/?payment=success&plan=${finalPlan}&device_id=${encodeURIComponent(finalDeviceId)}`
    );

  } catch (err) {
    console.error('Capture error:', err);
    return res.redirect(`${process.env.SITE_URL}/?payment=cancelled`);
  }
}
