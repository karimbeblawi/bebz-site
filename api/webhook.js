// api/webhook.js
// Stripe webhook handler -- runs as a Vercel serverless function
// Listens for payment events and updates Supabase accordingly

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // service key for server-side writes
);

export const config = {
  api: {
    bodyParser: false,  // Required -- Stripe needs the raw body to verify signature
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  console.log('Stripe event received:', event.type);

  try {
    switch (event.type) {

      case 'checkout.session.completed': {
        const session = event.data.object;
        const deviceId = session.metadata?.device_id;
        const plan = session.metadata?.plan; // 'annual' or 'lifetime'

        if (!deviceId) {
          console.error('No device_id in session metadata');
          break;
        }

        let status = 'active';
        let expiryDate = null;

        if (plan === 'annual') {
          // Set expiry 1 year from today
          const expiry = new Date();
          expiry.setFullYear(expiry.getFullYear() + 1);
          expiryDate = expiry.toISOString().split('T')[0];
        } else if (plan === 'lifetime') {
          // Lifetime -- no expiry
          expiryDate = null;
          status = 'active';
        }

        const { error } = await sb
          .from('devices')
          .update({
            status: status,
            expiry_date: expiryDate,
            stripe_customer_id: session.customer || null,
            stripe_subscription_id: session.subscription || null,
          })
          .eq('device_id', deviceId);

        if (error) {
          console.error('Supabase update failed:', error.message);
        } else {
          console.log(`Device ${deviceId} activated (${plan}), expiry: ${expiryDate}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        // Annual subscription cancelled or expired
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Find device by stripe_customer_id
        const { data, error: fetchErr } = await sb
          .from('devices')
          .select('device_id')
          .eq('stripe_customer_id', customerId)
          .limit(1);

        if (fetchErr || !data || data.length === 0) {
          console.error('Could not find device for customer:', customerId);
          break;
        }

        const { error: updateErr } = await sb
          .from('devices')
          .update({ status: 'expired' })
          .eq('stripe_customer_id', customerId);

        if (updateErr) {
          console.error('Supabase update failed:', updateErr.message);
        } else {
          console.log(`Device for customer ${customerId} marked expired`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        // Annual renewal payment failed
        const invoice = event.data.object;
        const customerId = invoice.customer;

        const { error } = await sb
          .from('devices')
          .update({ status: 'expired' })
          .eq('stripe_customer_id', customerId);

        if (error) {
          console.error('Supabase update failed:', error.message);
        } else {
          console.log(`Device for customer ${customerId} marked expired (payment failed)`);
        }
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }
  } catch (err) {
    console.error('Error processing webhook:', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  res.status(200).json({ received: true });
}
