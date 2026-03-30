// =============================================================
// api/add-playlist.js
//
// Receives playlist credentials from the website, encrypts
// username and password using AES-256-GCM with a server-side
// key, then stores in Supabase device_links.
//
// Environment variables required:
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY
//   PLAYLIST_ENCRYPTION_KEY  (32-byte hex string, 64 chars)
//
// Generate key: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
// =============================================================

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  if (!text) return '';
  const key = Buffer.from(process.env.PLAYLIST_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext (all hex)
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { device_id, playlist_name, playlist_url, username, password } = req.body;

  if (!device_id || !playlist_url) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!process.env.PLAYLIST_ENCRYPTION_KEY) {
    return res.status(500).json({ error: 'Encryption key not configured' });
  }

  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + 10);

  const isM3u = playlist_url.toLowerCase().endsWith('.m3u') || playlist_url.toLowerCase().endsWith('.m3u8');
  const resolvedName = playlist_name || (isM3u ? 'M3U Playlist' : 'My Playlist');

  const payload = {
    device_id,
    playlist_name: encrypt(resolvedName),
    playlist_url:  encrypt(playlist_url),
    username:      encrypt(username),
    password:      encrypt(password),
    consumed: false,
    expires_at: expires.toISOString()
  };

  const { data, error } = await supabase
    .from('device_links')
    .insert([payload])
    .select('id');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ id: data[0].id });
}
