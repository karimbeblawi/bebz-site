module.exports = async function(req, res) {
  // Allow GET for health check
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  var body = req.body || {};
  var device_id = body.device_id  || 'unknown';
  var app_id    = body.app_id     || 'unknown';
  var event     = body.event      || 'unknown';
  var detail    = body.detail     || '';
  var timestamp = body.timestamp  || new Date().toISOString();

  console.log('=== REMOTE DEBUG LOG ===');
  console.log('time:      ' + timestamp);
  console.log('app_id:    ' + app_id);
  console.log('device_id: ' + device_id);
  console.log('event:     ' + event);
  console.log('detail:    ' + detail);
  console.log('========================');

  return res.status(200).json({ ok: true });
};
