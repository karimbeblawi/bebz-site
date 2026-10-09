const PRESENCE_TTL_MS = 120000;
const LINK_TTL_MS = 60 * 60 * 1000;

function normalizeAppId(appId) {
  return appId === 'arabic_iptv' ? 'arabic_iptv' : 'bebztv';
}

function normalizeDeviceId(deviceId) {
  return String(deviceId || '').trim().toUpperCase();
}

function devicesTable(appId) {
  return normalizeAppId(appId) === 'arabic_iptv' ? 'devices_arabic' : 'devices';
}

function waitingForTvMessage() {
  return 'Open the app on your Roku, leave the Device ID / QR screen on, then try again.';
}

function linkFirstMessage() {
  return 'Link this Device ID first, then start a free trial or subscribe.';
}

function rokuMismatchMessage(existingId) {
  return 'This TV is already registered as ' + existingId +
    '. Use that Device ID (it should appear on the TV). Reopen the app if the code on screen is different.';
}

async function recordPresence(sb, fields) {
  const device_id = normalizeDeviceId(fields.device_id);
  if (!device_id) return;
  const payload = {
    device_id: device_id,
    app_id: normalizeAppId(fields.app_id),
    seen_at: new Date().toISOString()
  };
  if (fields.roku_client_id) payload.roku_client_id = String(fields.roku_client_id);
  if (fields.build) payload.build = String(fields.build);
  if (fields.app_language) payload.app_language = String(fields.app_language);
  const result = await sb.from('device_presence').upsert(payload, { onConflict: 'device_id,app_id' });
  if (result.error) {
    console.error('device_presence upsert:', result.error.message);
  }
}

function isFresh(iso, ttlMs) {
  const t = new Date(iso).getTime();
  return !!(t && Date.now() - t <= ttlMs);
}

async function getPresenceRow(sb, deviceId, appId) {
  const result = await sb
    .from('device_presence')
    .select('device_id, app_id, seen_at, linked_at, roku_client_id, build, app_language')
    .eq('device_id', normalizeDeviceId(deviceId))
    .eq('app_id', normalizeAppId(appId))
    .limit(1);
  if (result.error) {
    console.error('device_presence select:', result.error.message);
    return null;
  }
  if (!result.data || result.data.length === 0) return null;
  return result.data[0];
}

async function getFreshPresence(sb, deviceId, appId) {
  const row = await getPresenceRow(sb, deviceId, appId);
  if (!row || !isFresh(row.seen_at, PRESENCE_TTL_MS)) return null;
  return row;
}

async function getLinkedPresence(sb, deviceId, appId) {
  const row = await getPresenceRow(sb, deviceId, appId);
  if (!row || !isFresh(row.linked_at, LINK_TTL_MS)) return null;
  return row;
}

async function markLinked(sb, deviceId, appId) {
  const result = await sb
    .from('device_presence')
    .update({ linked_at: new Date().toISOString() })
    .eq('device_id', normalizeDeviceId(deviceId))
    .eq('app_id', normalizeAppId(appId));
  if (result.error) {
    console.error('device_presence linked_at:', result.error.message);
  }
}

function presenceExtras(row) {
  const extra = {};
  if (!row) return extra;
  if (row.roku_client_id) extra.roku_client_id = row.roku_client_id;
  if (row.build) extra.build = row.build;
  if (row.app_language) extra.app_language = row.app_language;
  return extra;
}

async function getDeviceRow(sb, deviceId, appId) {
  const table = devicesTable(appId);
  const result = await sb
    .from(table)
    .select('*')
    .eq('device_id', normalizeDeviceId(deviceId))
    .limit(1);
  if (result.error) return { error: result.error, row: null };
  if (!result.data || result.data.length === 0) return { error: null, row: null };
  return { error: null, row: result.data[0] };
}

async function getDeviceByRokuClientId(sb, rokuClientId, appId) {
  if (!rokuClientId) return { error: null, row: null };
  const result = await sb
    .from(devicesTable(appId))
    .select('*')
    .eq('roku_client_id', String(rokuClientId))
    .limit(1);
  if (result.error) return { error: result.error, row: null };
  if (!result.data || result.data.length === 0) return { error: null, row: null };
  return { error: null, row: result.data[0] };
}

async function requireExistingOrLinked(sb, deviceId, appId) {
  const existing = await getDeviceRow(sb, deviceId, appId);
  if (existing.error) {
    return { ok: false, status: 500, error: existing.error.message };
  }
  if (existing.row) {
    return { ok: true, device: existing.row, presence: null };
  }
  const linked = await getLinkedPresence(sb, deviceId, appId);
  if (!linked) {
    return { ok: false, status: 403, error: linkFirstMessage(), code: 'NOT_LINKED' };
  }
  return { ok: true, device: null, presence: linked };
}

module.exports = {
  PRESENCE_TTL_MS,
  LINK_TTL_MS,
  normalizeAppId,
  normalizeDeviceId,
  devicesTable,
  waitingForTvMessage,
  linkFirstMessage,
  rokuMismatchMessage,
  recordPresence,
  getFreshPresence,
  getLinkedPresence,
  markLinked,
  presenceExtras,
  getDeviceRow,
  getDeviceByRokuClientId,
  requireExistingOrLinked
};
