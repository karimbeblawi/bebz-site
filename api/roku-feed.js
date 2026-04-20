// api/roku-feed.js
// Roku Search Feed 2.0 - minimal test with single item

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const feed = {
    providerName: 'Bebz Arabic IPTV Player',
    lastUpdated: '2026-04-20T00:00:00+00:00',
    language: 'en-US',
    shortFormVideos: [
      {
        id: 'bebz-arabic-aljazeera-1',
        title: 'Al Jazeera Arabic',
        content: {
          dateAdded: '2026-04-20T00:00:00+00:00',
          videos: [
            {
              url: 'https://live-hls-web-aje.getaj.net/AJE/index.m3u8',
              quality: 'FHD',
              videoType: 'HLS',
              duration: 86400
            }
          ],
          duration: 86400,
          language: 'en-US'
        },
        thumbnail: 'https://bebz.tv/arabic/logo.png',
        shortDescription: 'Watch Al Jazeera Arabic live on Bebz Arabic IPTV Player for Roku',
        longDescription: 'Al Jazeera Arabic is a free live channel available on Bebz Arabic IPTV Player for Roku. No subscription required.',
        tags: ['arabic', 'live', 'news'],
        rating: { rating: 'UNRATED', ratingSource: 'USA_PR' },
        genres: ['news']
      }
    ]
  };

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(feed);
};
