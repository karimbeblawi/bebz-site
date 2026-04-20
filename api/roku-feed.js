// api/roku-feed.js
// Generates a Roku Search Feed 2.0 JSON from the Arabic IPTV M3U

const https = require('https');

const M3U_URL = 'https://iptv-org.github.io/iptv/languages/ara.m3u';

function fetchM3U(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function parseM3U(content) {
  const lines = content.split('\n');
  const channels = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      current = {};
      const nameMatch = line.match(/tvg-name="([^"]*)"/);
      if (nameMatch) current.name = nameMatch[1];
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      if (logoMatch) current.logo = logoMatch[1];
      const commaIdx = line.lastIndexOf(',');
      if (commaIdx !== -1) {
        current.displayName = line.substring(commaIdx + 1).trim();
      }
      if (!current.name) current.name = current.displayName || '';
    } else if (current && line.startsWith('http')) {
      current.url = line;
      if (current.name) channels.push(current);
      current = null;
    }
  }
  return channels;
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 40);
}

function buildFeed(channels) {
  const now = new Date().toISOString();

  const liveFeeds = channels.map((ch, idx) => {
    const title = ch.displayName || ch.name;
    const id = `bebz-arabic-${idx}-${slugify(ch.name)}`;
    const thumbnail = ch.logo && ch.logo.startsWith('https')
      ? ch.logo
      : 'https://bebz.tv/arabic/logo.png';

    return {
      id,
      title,
      content: {
        dateAdded: now,
        videos: [
          {
            url: ch.url,
            quality: 'FHD',
            videoType: 'HLS'
          }
        ],
        language: 'en-US'
      },
      thumbnail,
      shortDescription: `Watch ${title} live on Bebz Arabic IPTV Player for Roku`,
      longDescription: `${title} is a free Arabic live channel available on Bebz Arabic IPTV Player for Roku. No subscription required. Install Bebz Arabic IPTV Player from the Roku Channel Store and enjoy 200+ free Arabic channels.`,
      tags: ['arabic', 'live', 'free'],
      rating: { rating: 'UNRATED', ratingSource: 'USA_PR' },
      genres: ['news']
    };
  });

  return {
    providerName: 'Bebz Arabic IPTV Player',
    lastUpdated: now,
    language: 'en-US',
    liveFeeds
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const m3uContent = await fetchM3U(M3U_URL);
    const channels = parseM3U(m3uContent);

    if (!channels || channels.length === 0) {
      return res.status(500).json({ error: 'Failed to parse channels' });
    }

    const feed = buildFeed(channels);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.status(200).json(feed);

  } catch (err) {
    console.error('Feed error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
