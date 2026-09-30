const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const TRIAL_DAYS = 30;

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { device_id, app_id } = req.body || {};
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

  const devicesTable = (app_id === 'arabic_iptv') ? 'devices_arabic' : 'devices';

  // Fetch current device row
  let query = sb.from(devicesTable).select('status, expiry_date, trial_start_at').eq('device_id', device_id).limit(1);
  const { data, error } = await query;

  if (error) return res.status(500).json({ error: error.message });

  if (!data || data.length === 0) {
    return res.status(404).json({
      error: 'This Device ID was not found. Open the app on your Roku first, then enter the Device ID shown on the TV.'
    });
  }

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

  const updatePayload = {
    status: 'free_trial',
    expiry_date: expiryIso,
    trial_start_at: now.toISOString(),
  };
  if (app_id) updatePayload.app_id = app_id;

  let updateQuery = sb.from(devicesTable).update(updatePayload).eq('device_id', device_id);
  const { error: updateError } = await updateQuery;

  if (updateError) return res.status(500).json({ error: updateError.message });

  return res.status(200).json({ status: 'free_trial', expiry_date: expiryIso });
};
