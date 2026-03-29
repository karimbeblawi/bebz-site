const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TRIAL_DAYS = 30;

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { device_id } = req.body || {};
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

  // Fetch current device row
  const { data, error } = await sb
    .from('devices')
    .select('status, expiry_date, trial_start_at')
    .eq('device_id', device_id)
    .limit(1);

  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: 'Device not found' });

  const device = data[0];
  const status = device.status;

  // Never downgrade an active/paid device
  if (status === 'active' || status === 'free_trial') {
    return res.status(400).json({ error: 'Device is already active' });
  }

  // Block re-activation if device has already had a trial
  // trial_start_at is set when the first trial was granted
  if (device.trial_start_at !== null) {
    return res.status(400).json({ error: 'This device has already used its free trial' });
  }

  const now = new Date();
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + TRIAL_DAYS);
  const expiryIso = expiry.toISOString().split('T')[0];

  const { error: updateError } = await sb
    .from('devices')
    .update({
      status: 'free_trial',
      expiry_date: expiryIso,
      trial_start_at: now.toISOString(),
    })
    .eq('device_id', device_id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  return res.status(200).json({ status: 'free_trial', expiry_date: expiryIso });
};
