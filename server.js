import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import ytdl from '@distube/ytdl-core';
import axios from 'axios';
import { spawn } from 'child_process';

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

// Path to optional yt-dlp binary if available
const isWindows = process.platform === 'win32';
const ytDlpBinaryPath = isWindows
  ? path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe')
  : path.join(__dirname, 'bin', 'yt-dlp');

// Dedicated Clean HTML Page Routes
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'privacy.html')));
app.get('/dmca', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'dmca.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'about.html')));

// API Endpoint 1: Parse Video URL Details
app.post('/api/parse', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL parameter is required' });
    }

    console.log(`[Parser] Analyzing URL: ${url}`);

    // Detect Platform
    let platform = 'video';
    if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'youtube';
    else if (url.includes('tiktok.com')) platform = 'tiktok';
    else if (url.includes('instagram.com')) platform = 'instagram';
    else if (url.includes('facebook.com') || url.includes('fb.watch')) platform = 'facebook';

    let title = `${platform.toUpperCase()} Download`;
    let thumbnail = '/hero.jpg';
    let author = `@${platform}_user`;
    let duration = '03:15';

    // A. YOUTUBE PARSING via Pure JS ytdl-core & oEmbed
    if (platform === 'youtube') {
      try {
        if (ytdl.validateURL(url)) {
          const info = await ytdl.getInfo(url);
          title = info.videoDetails.title || title;
          thumbnail = info.videoDetails.thumbnails.pop()?.url || thumbnail;
          author = info.videoDetails.author?.name ? `@${info.videoDetails.author.name}` : author;
          if (info.videoDetails.lengthSeconds) {
            duration = formatSeconds(parseInt(info.videoDetails.lengthSeconds));
          }
        } else {
          throw new Error('Invalid YouTube URL');
        }
      } catch (ytErr) {
        console.warn('[ytdl-core parse warning]:', ytErr.message);
        // Fallback to YouTube oEmbed API
        try {
          const embedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
          const response = await axios.get(embedUrl, { timeout: 5000 });
          if (response.data) {
            title = response.data.title || title;
            author = response.data.author_name ? `@${response.data.author_name}` : author;
            thumbnail = response.data.thumbnail_url || thumbnail;
          }
        } catch (oembedErr) {
          console.warn('[YouTube oEmbed warning]:', oembedErr.message);
        }
      }
    } 
    // B. TIKTOK PARSING via TikWM API
    else if (platform === 'tiktok') {
      try {
        const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { timeout: 8000 });
        if (response.data && response.data.data) {
          const d = response.data.data;
          title = d.title || title;
          thumbnail = d.cover || d.origin_cover || thumbnail;
          author = d.author ? `@${d.author.unique_id || d.author.nickname}` : author;
          duration = formatSeconds(d.duration || 30);
        }
      } catch (ttErr) {
        console.warn('[TikTok TikWM warning]:', ttErr.message);
      }
    }

    const formats = [
      {
        quality: '1080p Full HD',
        format: 'MP4',
        size: 'High Quality',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&quality=1080&filename=${encodeURIComponent(title)}.mp4`,
        type: 'video'
      },
      {
        quality: '720p HD',
        format: 'MP4',
        size: 'Standard Quality',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&quality=720&filename=${encodeURIComponent(title)}.mp4`,
        type: 'video'
      },
      {
        quality: '480p SD',
        format: 'MP4',
        size: 'Mobile Friendly',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&quality=480&filename=${encodeURIComponent(title)}.mp4`,
        type: 'video'
      },
      {
        quality: '320kbps MP3',
        format: 'MP3',
        size: 'Audio Only',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&type=audio&filename=${encodeURIComponent(title)}.mp3`,
        type: 'audio'
      }
    ];

    return res.json({
      success: true,
      title,
      thumbnail,
      author,
      duration,
      platform,
      formats
    });

  } catch (error) {
    console.error('[API Error /api/parse]:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to process video link. Please verify the URL and try again.'
    });
  }
});

// API Endpoint 2: Real-time Video Stream Download
app.get('/api/download', async (req, res) => {
  const videoUrl = req.query.url;
  const isAudio = req.query.type === 'audio';
  const quality = req.query.quality || '720';
  const customFilename = req.query.filename || `GreenHole_Download_${Date.now()}.${isAudio ? 'mp3' : 'mp4'}`;

  if (!videoUrl) {
    return res.status(400).send('Error: Video URL parameter is missing');
  }

  console.log(`[Streamer] Downloading: ${videoUrl} | Type: ${isAudio ? 'audio' : 'video'} | Quality: ${quality}`);

  // Set HTTP headers for direct file download
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(customFilename)}"`);
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');

  // METHOD 1: YouTube Pure JavaScript ytdl-core (No Python required!)
  if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be')) {
    try {
      if (ytdl.validateURL(videoUrl)) {
        let filterSetting = isAudio ? 'audioonly' : 'videoandaudio';
        let qualitySetting = 'highestvideo';

        if (isAudio) {
          qualitySetting = 'highestaudio';
        } else {
          if (quality === '1080') qualitySetting = 'highestvideo';
          else if (quality === '720') qualitySetting = 'highestvideo';
          else if (quality === '480') qualitySetting = 'lowestvideo';
        }

        const stream = ytdl(videoUrl, {
          filter: filterSetting,
          quality: qualitySetting,
          highWaterMark: 1 << 25
        });

        stream.on('error', (err) => {
          console.error('[ytdl-core Stream Error]:', err.message);
          if (!res.headersSent) {
            res.status(500).send('Error streaming YouTube video');
          }
        });

        return stream.pipe(res);
      }
    } catch (ytdlErr) {
      console.warn('[ytdl-core Engine Warning]:', ytdlErr.message);
    }
  }

  // METHOD 2: TikTok CDN Direct Stream via TikWM
  if (videoUrl.includes('tiktok.com')) {
    try {
      const tikRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, { timeout: 8000 });
      if (tikRes.data && tikRes.data.data) {
        const directMediaUrl = isAudio ? tikRes.data.data.music : (tikRes.data.data.hdplay ? `https://www.tikwm.com${tikRes.data.data.hdplay}` : `https://www.tikwm.com${tikRes.data.data.play}`);
        if (directMediaUrl) {
          const mediaStream = await axios({
            method: 'get',
            url: directMediaUrl,
            responseType: 'stream',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          return mediaStream.data.pipe(res);
        }
      }
    } catch (tikErr) {
      console.warn('[TikTok Stream Proxy Error]:', tikErr.message);
    }
  }

  // METHOD 3: Fallback yt-dlp spawn (if yt-dlp binary exists on machine)
  try {
    let formatStr = isAudio ? 'bestaudio[ext=m4a]/bestaudio' : 'best[ext=mp4]/best';
    const child = spawn(ytDlpBinaryPath, ['-f', formatStr, '--no-playlist', '-o', '-', videoUrl]);
    
    child.stdout.pipe(res);

    child.on('error', (err) => {
      console.error('[yt-dlp spawn error]:', err.message);
      if (!res.headersSent) res.status(500).send('Download engine unavailable');
    });

    req.on('close', () => child.kill());
    return;
  } catch (spawnErr) {
    console.error('[Fallback spawn failed]:', spawnErr.message);
  }

  if (!res.headersSent) {
    res.status(500).send('Unable to stream media at this moment.');
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
