import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import axios from 'axios';
import fs from 'fs';
import https from 'https';

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

// Path to yt-dlp binary
const isWindows = process.platform === 'win32';
let ytDlpBinaryPath = isWindows
  ? path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe')
  : path.join(__dirname, 'bin', 'yt-dlp');

if (isWindows && !fs.existsSync(ytDlpBinaryPath)) {
  ytDlpBinaryPath = path.join(__dirname, 'bin', 'yt-dlp.exe');
}

// Function to auto-download Linux yt-dlp binary on Hostinger server if missing
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Status ${res.statusCode}`));
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
      file.on('error', (err) => {
        fs.unlink(dest, () => reject(err));
      });
    }).on('error', reject);
  });
}

async function ensureYtDlpBinary() {
  if (isWindows) return;
  const binDir = path.join(__dirname, 'bin');
  const binPath = path.join(binDir, 'yt-dlp');

  if (fs.existsSync(binPath) && fs.statSync(binPath).size > 10000000) {
    console.log('[Server Engine] Linux yt-dlp binary is verified and ready.');
    return;
  }

  console.log('[Server Engine] Downloading standalone Linux yt-dlp binary on server startup...');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  try {
    await downloadFile('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', binPath);
    try { fs.chmodSync(binPath, '755'); } catch (e) {}
    console.log(`[Server Engine] Linux yt-dlp binary downloaded successfully (${fs.statSync(binPath).size} bytes)`);
  } catch (err) {
    console.error('[Server Engine Error] Failed to auto-download yt-dlp:', err.message);
  }
}

// Dedicated Clean HTML Page Routes
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'privacy.html')));
app.get('/dmca', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'dmca.html')));
app.get('/about', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'about.html')));

// Helper: Run yt-dlp dump JSON
async function extractMetadata(url) {
  await ensureYtDlpBinary();
  return new Promise((resolve, reject) => {
    const args = ['--dump-single-json', '--no-warnings', '--no-call-home', '--no-playlist', url];
    const child = spawn(ytDlpBinaryPath, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      if (code === 0 && stdout) {
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(new Error('JSON parse error')); }
      } else {
        reject(new Error(stderr || `yt-dlp exited code ${code}`));
      }
    });

    child.on('error', reject);
    setTimeout(() => { child.kill(); reject(new Error('Parser Timeout')); }, 25000);
  });
}

// API Endpoint 1: Parse Video URL Details
app.post('/api/parse', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ success: false, error: 'URL parameter is required' });
    }

    console.log(`[Parser] Processing URL: ${url}`);

    // Detect Platform
    let platform = 'video';
    if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'youtube';
    else if (url.includes('tiktok.com')) platform = 'tiktok';
    else if (url.includes('instagram.com')) platform = 'instagram';
    else if (url.includes('facebook.com') || url.includes('fb.watch')) platform = 'facebook';

    let output = {};
    
    try {
      output = await extractMetadata(url);
    } catch (ytErr) {
      console.warn(`[Parser Warning] yt-dlp parse warning:`, ytErr.message);

      if (platform === 'tiktok') {
        try {
          const tikRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, { timeout: 8000 });
          if (tikRes.data && tikRes.data.data) {
            const d = tikRes.data.data;
            output.title = d.title;
            output.thumbnail = d.cover || d.origin_cover;
            output.uploader = d.author ? `@${d.author.unique_id || d.author.nickname}` : null;
            output.duration = d.duration;
          }
        } catch (e) {
          console.warn('[TikTok TikWM parse fallback failed]:', e.message);
        }
      }
    }

    const title = output.title || `${platform.toUpperCase()} Download ${Date.now()}`;
    const thumbnail = output.thumbnail || (output.thumbnails && output.thumbnails[output.thumbnails.length - 1]?.url) || '/hero.jpg';
    const author = output.uploader || output.channel || `@${platform}_user`;
    const duration = output.duration ? formatSeconds(Math.round(output.duration)) : '03:15';

    const cleanTitle = title.replace(/[^\w\s.-]/g, '_').substring(0, 80);

    const formats = [
      {
        quality: '1080p Full HD',
        format: 'MP4',
        size: 'High Quality',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&quality=1080&filename=${encodeURIComponent(cleanTitle)}.mp4`,
        type: 'video'
      },
      {
        quality: '720p HD',
        format: 'MP4',
        size: 'Standard Quality',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&quality=720&filename=${encodeURIComponent(cleanTitle)}.mp4`,
        type: 'video'
      },
      {
        quality: '480p SD',
        format: 'MP4',
        size: 'Mobile Friendly',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&quality=480&filename=${encodeURIComponent(cleanTitle)}.mp4`,
        type: 'video'
      },
      {
        quality: '320kbps MP3',
        format: 'MP3',
        size: 'Audio Only',
        downloadUrl: `/api/download?url=${encodeURIComponent(url)}&type=audio&filename=${encodeURIComponent(cleanTitle)}.mp3`,
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

// API Endpoint 2: Real-time Video Stream Download
app.get('/api/download', async (req, res) => {
  const videoUrl = req.query.url;
  const isAudio = req.query.type === 'audio';
  const quality = req.query.quality || '720';
  const rawFilename = req.query.filename || `GreenHole_Download_${Date.now()}.${isAudio ? 'mp3' : 'mp4'}`;

  if (!videoUrl) {
    return res.status(400).send('Error: Video URL parameter is missing');
  }

  await ensureYtDlpBinary();

  const safeFilename = rawFilename.replace(/[^\w\s.-]/g, '_').substring(0, 100);

  console.log(`[Streamer] Streaming: ${videoUrl} | Type: ${isAudio ? 'audio' : 'video'} | Quality: ${quality}`);

  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');

  let formatStr;
  if (isAudio) {
    formatStr = 'bestaudio[ext=m4a]/bestaudio/best';
  } else {
    switch (quality) {
      case '1080':
        formatStr = 'best[height<=1080][ext=mp4]/best[height<=1080]/best[vcodec!=none][acodec!=none]/best';
        break;
      case '720':
        formatStr = 'best[height<=720][ext=mp4]/best[height<=720]/best[vcodec!=none][acodec!=none]/best';
        break;
      case '480':
        formatStr = 'best[height<=480][ext=mp4]/best[height<=480]/best[vcodec!=none][acodec!=none]/best';
        break;
      default:
        formatStr = 'best[ext=mp4]/best[vcodec!=none][acodec!=none]/best';
    }
  }

  try {
    const args = ['-f', formatStr, '--no-playlist', '--no-warnings', '-o', '-', videoUrl];
    const child = spawn(ytDlpBinaryPath, args);

    child.stdout.pipe(res);

    child.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('ERROR') || msg.includes('error')) {
        console.error('[yt-dlp stderr]:', msg.trim());
      }
    });

    child.on('error', async (err) => {
      console.error('[yt-dlp spawn error]:', err.message);
      if (videoUrl.includes('tiktok.com')) {
        return fallbackTikTokStream(videoUrl, isAudio, res);
      }
      if (!res.headersSent) res.status(500).send('Download stream failed');
    });

    req.on('close', () => {
      child.kill('SIGTERM');
    });

    return;

  } catch (spawnErr) {
    console.error('[Spawn Exception]:', spawnErr.message);
  }

  if (videoUrl.includes('tiktok.com')) {
    return fallbackTikTokStream(videoUrl, isAudio, res);
  }

  if (!res.headersSent) {
    res.status(500).send('Unable to start video download.');
  }
});

async function fallbackTikTokStream(videoUrl, isAudio, res) {
  try {
    const tikRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, { timeout: 8000 });
    if (tikRes.data && tikRes.data.data) {
      const d = tikRes.data.data;
      const mediaUrl = isAudio ? d.music : (d.hdplay ? `https://www.tikwm.com${d.hdplay}` : `https://www.tikwm.com${d.play}`);
      if (mediaUrl) {
        const streamRes = await axios({
          method: 'get',
          url: mediaUrl,
          responseType: 'stream',
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return streamRes.data.pipe(res);
      }
    }
  } catch (e) {
    console.error('[TikTok Stream Fallback Error]:', e.message);
  }
  if (!res.headersSent) res.status(500).send('Media stream unavailable');
}

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
app.listen(PORT, async () => {
  console.log(`Green Hole Downloader Backend API running on port ${PORT}`);
  await ensureYtDlpBinary();
});
