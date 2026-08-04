import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import play from 'play-dl';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from 'dist'
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Dedicated Clean HTML Page Routes
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'privacy.html')));
app.get('/dmca', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'dmca.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'about.html')));

// API Endpoint 1: Parse Video URL Details (High-Speed Engine)
app.post('/api/parse', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL parameter is required' });
    }

    const cleanUrl = url.trim();
    console.log(`[Parser] Extracting metadata for: ${cleanUrl}`);

    // Detect Platform
    let platform = 'video';
    if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) platform = 'youtube';
    else if (cleanUrl.includes('tiktok.com')) platform = 'tiktok';
    else if (cleanUrl.includes('instagram.com')) platform = 'instagram';
    else if (cleanUrl.includes('facebook.com') || cleanUrl.includes('fb.watch')) platform = 'facebook';

    let title = `${platform.toUpperCase()} Video`;
    let thumbnail = '/hero.jpg';
    let author = `@${platform}_creator`;
    let duration = '03:15';

    // A. YOUTUBE METADATA
    if (platform === 'youtube') {
      try {
        const info = await play.video_basic_info(cleanUrl);
        if (info && info.video_details) {
          title = info.video_details.title || title;
          author = info.video_details.channel?.name ? `@${info.video_details.channel.name}` : author;
          thumbnail = info.video_details.thumbnails?.pop()?.url || thumbnail;
          if (info.video_details.durationInSec) {
            duration = formatSeconds(info.video_details.durationInSec);
          }
        }
      } catch (playErr) {
        console.warn('[YouTube play-dl parse warning]:', playErr.message);
        // Fallback to oEmbed
        try {
          const oembedRes = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`, { timeout: 5000 });
          if (oembedRes.data) {
            title = oembedRes.data.title || title;
            author = oembedRes.data.author_name ? `@${oembedRes.data.author_name}` : author;
            thumbnail = oembedRes.data.thumbnail_url || thumbnail;
          }
        } catch (e) {
          console.warn('[oEmbed fallback warning]:', e.message);
        }
      }
    }
    // B. TIKTOK METADATA
    else if (platform === 'tiktok') {
      try {
        const tikRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`, { timeout: 8000 });
        if (tikRes.data && tikRes.data.data) {
          const d = tikRes.data.data;
          title = d.title || title;
          thumbnail = d.cover || d.origin_cover || thumbnail;
          author = d.author ? `@${d.author.unique_id || d.author.nickname}` : author;
          duration = formatSeconds(d.duration || 30);
        }
      } catch (ttErr) {
        console.warn('[TikTok parse warning]:', ttErr.message);
      }
    }

    const cleanTitle = title.replace(/[^\w\s.-]/g, '_').substring(0, 80);

    const formats = [
      {
        quality: '1080p Full HD',
        format: 'MP4',
        size: 'High Quality',
        downloadUrl: `/api/download?url=${encodeURIComponent(cleanUrl)}&quality=1080&filename=${encodeURIComponent(cleanTitle)}.mp4`,
        type: 'video'
      },
      {
        quality: '720p HD',
        format: 'MP4',
        size: 'Standard Quality',
        downloadUrl: `/api/download?url=${encodeURIComponent(cleanUrl)}&quality=720&filename=${encodeURIComponent(cleanTitle)}.mp4`,
        type: 'video'
      },
      {
        quality: '480p SD',
        format: 'MP4',
        size: 'Mobile Friendly',
        downloadUrl: `/api/download?url=${encodeURIComponent(cleanUrl)}&quality=480&filename=${encodeURIComponent(cleanTitle)}.mp4`,
        type: 'video'
      },
      {
        quality: '320kbps MP3',
        format: 'MP3',
        size: 'Audio Only',
        downloadUrl: `/api/download?url=${encodeURIComponent(cleanUrl)}&type=audio&filename=${encodeURIComponent(cleanTitle)}.mp3`,
        type: 'audio'
      }
    ];

    return res.json({ success: true, title, thumbnail, author, duration, platform, formats });

  } catch (error) {
    console.error('[API Error /api/parse]:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to process video link. Please verify the URL and try again.'
    });
  }
});

// API Endpoint 2: Real-time High-Speed Stream / Direct Media Download
app.get('/api/download', async (req, res) => {
  const videoUrl = req.query.url;
  const isAudio = req.query.type === 'audio';
  const quality = req.query.quality || '720';
  const rawFilename = req.query.filename || `GreenHole_Download_${Date.now()}.${isAudio ? 'mp3' : 'mp4'}`;

  if (!videoUrl) {
    return res.status(400).send('Error: Video URL parameter is missing');
  }

  const safeFilename = rawFilename.replace(/[^\w\s.-]/g, '_').substring(0, 100);
  console.log(`[Streamer] Processing download request for: ${videoUrl}`);

  // A. YOUTUBE MEDIA STREAM / DIRECT LINK
  if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
    try {
      const info = await play.video_info(videoUrl);
      if (info && info.format && info.format.length > 0) {
        let selectedFormat;
        if (isAudio) {
          selectedFormat = info.format.find(f => f.mimeType && f.mimeType.includes('audio')) || info.format[0];
        } else {
          selectedFormat = info.format.find(f => f.url && f.mimeType && f.mimeType.includes('video/mp4')) || info.format[0];
        }

        if (selectedFormat && selectedFormat.url) {
          // Direct browser redirect to high-speed CDN stream
          return res.redirect(selectedFormat.url);
        }
      }
    } catch (ytErr) {
      console.warn('[YouTube download streamer warning]:', ytErr.message);
    }
  }

  // B. TIKTOK MEDIA STREAM / DIRECT LINK
  if (videoUrl.includes('tiktok.com')) {
    try {
      const tikRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, { timeout: 8000 });
      if (tikRes.data && tikRes.data.data) {
        const d = tikRes.data.data;
        const mediaUrl = isAudio ? d.music : (d.hdplay ? `https://www.tikwm.com${d.hdplay}` : `https://www.tikwm.com${d.play}`);
        if (mediaUrl) {
          return res.redirect(mediaUrl);
        }
      }
    } catch (tikErr) {
      console.warn('[TikTok download streamer warning]:', tikErr.message);
    }
  }

  // C. DEFAULT PROXY STREAM FOR OTHER URLS
  try {
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');

    const streamRes = await axios({
      method: 'get',
      url: videoUrl,
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    return streamRes.data.pipe(res);
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    if (!res.headersSent) res.status(500).send('Unable to stream media at this moment.');
  }
});

// SEO Sitemap & Robots Routes
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sitemap.xml')));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'robots.txt')));

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'), (err) => {
    if (err) res.status(404).send('Page not found');
  });
});

// Helper Function: Format seconds to MM:SS
function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Start Server
app.listen(PORT, () => {
  console.log(`Green Hole Downloader Backend API running on port ${PORT}`);
});
