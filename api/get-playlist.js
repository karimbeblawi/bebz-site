// =============================================================
// api/get-playlist.js
//
// Called by the Roku app to fetch and decrypt playlist
// credentials for a device. Decrypts username/password
// server-side so the encryption key never leaves the server.
//
// GET /api/get-playlist?device_id=XXXX
//
// Returns: { found: false } or { found: true, link: {...} }
// with decrypted username and password.
// =============================================================

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ALGORITHM = 'aes-256-gcm';

function decrypt(encrypted) {
  if (!encrypted) return '';
  // Support legacy plain-text values (before encryption was added)
  if (!encrypted.includes(':')) return encrypted;
  try {
    const key = Buffer.from(process.env.PLAYLIST_ENCRYPTION_KEY, 'hex');
    const [ivHex, tagHex, dataHex] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data, undefined, 'utf8') + decipher.final('utf8');
  } catch (e) {
    console.error('Decrypt error:', e.message);
    return '';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { device_id } = req.query;

  if (!device_id) {
    return res.status(400).json({ error: 'Missing device_id' });
  }

  // Fetch the most recent unconsumed link for this device
  const { data, error } = await supabase
    .from('device_links')
    .select('id, device_id, playlist_name, playlist_url, username, password')
    .eq('device_id', device_id)
    .eq('consumed', false)
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  if (!data || data.length === 0) {
    return res.status(200).json({ found: false });
  }

  const link = data[0];

  // Decrypt all fields server-side
  link.playlist_name = decrypt(link.playlist_name);
  link.playlist_url  = decrypt(link.playlist_url);
  link.username      = decrypt(link.username);
  link.password      = decrypt(link.password);

  return res.status(200).json({ found: true, link });
}
