const { createClient } = require('@supabase/supabase-js');
const presence = require('./_lib/devicePresence');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const device_id = presence.normalizeDeviceId((req.body || {}).device_id);
  const app_id = (req.body || {}).app_id;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

  const existing = await presence.getDeviceRow(sb, device_id, app_id);
  if (existing.error) return res.status(500).json({ error: existing.error.message });

  if (existing.row) {
    await presence.markLinked(sb, device_id, app_id);
    return res.status(200).json({ found: true, tv_online: true, device: existing.row });
  }

  const live = await presence.getFreshPresence(sb, device_id, app_id);
  if (!live) {
    return res.status(200).json({
      found: false,
      tv_online: false,
      error: presence.waitingForTvMessage()
    });
  }

  if (live.roku_client_id) {
    const other = await presence.getDeviceByRokuClientId(sb, live.roku_client_id, app_id);
    if (other.error) return res.status(500).json({ error: other.error.message });
    if (other.row && presence.normalizeDeviceId(other.row.device_id) !== device_id) {
      return res.status(200).json({
        found: false,
        tv_online: false,
        code: 'ROKU_CLIENT_MISMATCH',
        existing_device_id: other.row.device_id,
        error: presence.rokuMismatchMessage(other.row.device_id)
      });
    }
  }

  await presence.markLinked(sb, device_id, app_id);
  return res.status(200).json({
    found: false,
    tv_online: true,
    device: { device_id: device_id, status: '', expiry_date: null }
  });
};
