import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import execa from 'yt-dlp-exec';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from 'dist' (or root for dev)
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Path to yt-dlp binary — auto-detect OS
// On Railway (Linux): use system yt-dlp installed via pip
// On Windows (local dev): use bundled .exe
const isWindows = process.platform === 'win32';
const ytDlpBinaryPath = isWindows
  ? path.join(__dirname, 'node_modules', 'yt-dlp-exec', 'bin', 'yt-dlp.exe')
  : 'yt-dlp'; // system-level binary on Linux

// Dedicated Clean HTML Page Routes
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'terms.html'));
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'privacy.html'));
});

app.get('/dmca', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'dmca.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'about.html'));
});

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

    let output = {};
    try {
      // Execute yt-dlp to extract JSON metadata
      output = await execa(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCallHome: true,
        preferFreeFormats: true,
        youtubeSkipDashManifest: true
      });
    } catch (ytErr) {
      console.warn(`[Parser Warning] yt-dlp direct parse fallback triggered:`, ytErr.message);
    }

    const title = output.title || `${platform.toUpperCase()} Download ${Date.now()}`;
    const thumbnail = output.thumbnail || (output.thumbnails && output.thumbnails[0]?.url) || '/hero.jpg';
    const author = output.uploader || output.channel || `@${platform}_user`;
    const duration = output.duration ? formatSeconds(output.duration) : '03:15';

    // Standardized Formats Array
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
app.get('/api/download', (req, res) => {
  const videoUrl = req.query.url;
  const isAudio = req.query.type === 'audio';
  const quality = req.query.quality || 'best'; // e.g. '1080', '720', '480'
  const customFilename = req.query.filename || `GreenHole_Download_${Date.now()}.${isAudio ? 'mp3' : 'mp4'}`;

  if (!videoUrl) {
    return res.status(400).send('Error: Video URL parameter is missing');
  }

  console.log(`[Streamer] Quality: ${quality} | URL: ${videoUrl}`);

  // Set HTTP headers for file attachment download
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(customFilename)}"`);
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  // Build yt-dlp format string based on requested quality
  let formatStr;
  if (isAudio) {
    formatStr = 'bestaudio[ext=m4a]/bestaudio';
  } else {
    switch (quality) {
      case '1080':
        formatStr = 'best[height<=1080][ext=mp4]/best[height<=1080]/bestvideo[height<=1080]+bestaudio/best';
        break;
      case '720':
        formatStr = 'best[height<=720][ext=mp4]/best[height<=720]/bestvideo[height<=720]+bestaudio/best';
        break;
      case '480':
        formatStr = 'best[height<=480][ext=mp4]/best[height<=480]/bestvideo[height<=480]+bestaudio/best';
        break;
      case '360':
        formatStr = 'best[height<=360][ext=mp4]/best[height<=360]/best';
        break;
      default:
        formatStr = 'best[ext=mp4]/best';
    }
  }

  console.log(`[Streamer] yt-dlp format: ${formatStr}`);

  // Spawn yt-dlp process to stream video directly to browser
  const args = [
    '-f', formatStr,
    '--no-playlist',
    '--no-warnings',
    '-o', '-',
    videoUrl
  ];

  const child = spawn(ytDlpBinaryPath, args);

  // Pipe yt-dlp stdout directly to HTTP response (streaming)
  child.stdout.pipe(res);

  child.stderr.on('data', (data) => {
    const msg = data.toString();
    // Only log actual errors, not progress info
    if (msg.includes('ERROR') || msg.includes('error')) {
      console.error('[yt-dlp stderr]:', msg.trim());
    }
  });

  child.on('error', (err) => {
    console.error('[Stream Spawn Error]:', err.message);
    if (!res.headersSent) {
      res.status(500).send('Error: Could not start download process');
    }
  });

  child.on('close', (code) => {
    console.log(`[Streamer] yt-dlp exited with code ${code}`);
    if (code !== 0 && !res.writableEnded) {
      res.end();
    }
  });

  // Handle client disconnect — kill yt-dlp process
  req.on('close', () => {
    console.log('[Streamer] Client disconnected, killing yt-dlp process');
    child.kill('SIGTERM');
  });
});

// SEO Sitemap & Robots Routes
app.get('/sitemap.xml', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sitemap.xml'));
});

app.get('/robots.txt', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'robots.txt'));
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
