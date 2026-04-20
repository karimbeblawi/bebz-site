// api/roku-feed.js
// Generates a Roku Search Feed 2.0 JSON from the Arabic IPTV M3U
// The feed includes channel metadata for Roku Search indexing
// Deep links back to the app - no static stream URLs needed

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
      // Extract tvg-name
      const nameMatch = line.match(/tvg-name="([^"]*)"/);
      if (nameMatch) current.name = nameMatch[1];
      // Extract tvg-logo
      const logoMatch = line.match(/tvg-logo="([^"]*)"/);
      if (logoMatch) current.logo = logoMatch[1];
      // Extract group-title
      const groupMatch = line.match(/group-title="([^"]*)"/);
      if (groupMatch) current.group = groupMatch[1];
      // Extract display name (after last comma)
      const commaIdx = line.lastIndexOf(',');
      if (commaIdx !== -1) {
        current.displayName = line.substring(commaIdx + 1).trim();
      }
      if (!current.name) current.name = current.displayName || 'Unknown';
    } else if (current && line.startsWith('http')) {
      current.url = line;
      if (current.name && current.name !== 'Unknown') {
        channels.push(current);
      }
      current = null;
    }
  }
  return channels;
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

function buildFeed(channels) {
  const now = new Date().toISOString();
  const appId = '861609'; // Arabic IPTV Bebz Player channel ID

  const liveFeeds = channels.map((ch, idx) => {
    const id = `arabic-iptv-bebz-${slugify(ch.name)}-${idx}`;
    const title = ch.displayName || ch.name;
    const thumbnail = ch.logo && ch.logo.startsWith('http')
      ? ch.logo
      : 'https://bebz.tv/arabic/logo.png';

    return {
      id,
      title,
      content: {
        dateAdded: now,
        videos: [
          {
            url: `https://bebz.tv/arabic/?channel=${encodeURIComponent(ch.name)}`,
            quality: 'HD',
            videoType: 'HLS'
          }
        ],
        language: 'ar',
        validityPeriodStart: now,
        validityPeriodEnd: '2099-12-31T00:00:00Z'
      },
      thumbnail,
      shortDescription: `Watch ${title} live — free Arabic channel on Bebz Arabic IPTV Player`,
      longDescription: `${title} is a free Arabic live channel available on Bebz Arabic IPTV Player for Roku. No subscription required. Install Bebz Arabic IPTV Player from the Roku Channel Store and enjoy 200+ free Arabic channels including ${title}.`,
      tags: ['arabic', 'live', 'free', ch.group || 'general'].filter(Boolean),
      rating: { rating: 'UNRATED', ratingSource: 'USA_PR' },
      genres: ['faith-and-spirituality'],
      externalIds: [{ id: `bebz-arabic-${idx}`, idType: 'CHANNEL_ID' }]
    };
  });

  return {
    providerName: 'Bebz Arabic IPTV Player',
    lastUpdated: now,
    language: 'ar',
    liveFeeds,
    categories: [
      {
        name: 'Free Arabic Live Channels',
        order: 'most_recent',
        items: liveFeeds.slice(0, 20).map(f => ({ id: f.id, type: 'liveFeed' }))
      }
    ]
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
    res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache 1 hour
    return res.status(200).json(feed);

  } catch (err) {
    console.error('Feed error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
