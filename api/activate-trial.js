const { createClient } = require('@supabase/supabase-js');
const presence = require('./_lib/devicePresence');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TRIAL_DAYS = 30;

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const app_id = (req.body || {}).app_id;
  const device_id = presence.normalizeDeviceId((req.body || {}).device_id);
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

  const devicesTable = presence.devicesTable(app_id);
  const gate = await presence.requireExistingOrLinked(sb, device_id, app_id);
  if (!gate.ok) return res.status(gate.status).json({ error: gate.error, code: gate.code });

  const device = gate.device;
  const status = device ? device.status : '';

  if (status === 'active' || status === 'free_trial') {
    return res.status(400).json({ error: 'Device is already active' });
  }

  if (device && device.trial_start_at !== null) {
    return res.status(400).json({ error: 'This device has already used its free trial' });
  }

  const now = new Date();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + TRIAL_DAYS);
  const expiryIso = expiry.toISOString().split('T')[0];

  const payload = Object.assign({
    status: 'free_trial',
    expiry_date: expiryIso,
    trial_start_at: now.toISOString()
  }, presence.presenceExtras(gate.presence));
  if (app_id) payload.app_id = presence.normalizeAppId(app_id);

  if (device) {
    const { error: updateError } = await sb.from(devicesTable).update(payload).eq('device_id', device_id);
    if (updateError) return res.status(500).json({ error: updateError.message });
  } else {
    payload.device_id = device_id;
    const { error: insertError } = await sb.from(devicesTable).insert(payload);
    if (insertError) return res.status(500).json({ error: insertError.message });
  }

  return res.status(200).json({ status: 'free_trial', expiry_date: expiryIso });
};
