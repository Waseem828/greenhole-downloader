import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { spawn, execFile, execSync } from 'child_process';
import { promisify } from 'util';
import ffmpegStatic from 'ffmpeg-static';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Path to yt-dlp binary — auto detect Windows vs Linux
const YTDLP_PATH = process.platform === 'win32'
  ? path.join(__dirname, 'bin', 'yt-dlp.exe')
  : path.join(__dirname, 'bin', 'yt-dlp');

// Path to ffmpeg binary — from ffmpeg-static npm package (works on Windows + Linux)
const FFMPEG_PATH = ffmpegStatic;

// Ensure yt-dlp AND ffmpeg binaries exist & have executable (chmod +x) permissions on Linux (Hostinger)
function ensureBinariesPermissions() {
  if (process.platform === 'win32') return;

  // 1. Fix yt-dlp binary
  const binDir = path.join(__dirname, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const ytdlpLinuxPath = path.join(binDir, 'yt-dlp');
  if (!fs.existsSync(ytdlpLinuxPath)) {
    console.log('[Server Startup] yt-dlp binary missing! Downloading for Linux...');
    try {
      execSync(
        `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "${ytdlpLinuxPath}"`,
        { stdio: 'inherit', timeout: 120000 }
      );
      console.log('[Server Startup] ✅ yt-dlp binary downloaded!');
    } catch (e) {
      console.error('[Server Startup] Failed to download yt-dlp binary:', e.message);
    }
  }

  try {
    execSync(`chmod +x "${ytdlpLinuxPath}"`, { stdio: 'ignore' });
    console.log('[Server Startup] ✅ yt-dlp permission set (chmod +x)!');
  } catch (e) {}

  // 2. Fix ffmpeg binary permissions (CRITICAL for Hostinger Linux!)
  if (FFMPEG_PATH && fs.existsSync(FFMPEG_PATH)) {
    try {
      execSync(`chmod +x "${FFMPEG_PATH}"`, { stdio: 'ignore' });
      console.log('[Server Startup] ✅ ffmpeg permission set (chmod +x)!');
    } catch (e) {}
  }
}
ensureBinariesPermissions();

// Base args with no-check-certificates & robust player clients (android,ios,mweb)
const YTDLP_BASE_ARGS = [
  '--no-playlist',
  '--no-warnings',
  '--no-check-certificates',
  '--extractor-args', 'youtube:player_client=android,ios,mweb',
];

// Add ffmpeg location if present
if (FFMPEG_PATH && fs.existsSync(FFMPEG_PATH)) {
  YTDLP_BASE_ARGS.push('--ffmpeg-location', FFMPEG_PATH);
}

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

// Helper: Format seconds to MM:SS
function formatSeconds(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

// Helper: Get video info using yt-dlp --dump-json
async function getYtDlpInfo(url) {
  try {
    const args = [
      ...YTDLP_BASE_ARGS,
      '--dump-json',
      '--skip-download',
      url
    ];
    const { stdout } = await execFileAsync(YTDLP_PATH, args, {
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(stdout.trim());
  } catch (err) {
    console.error('[yt-dlp info error]:', err.message?.substring(0, 300));
    return null;
  }
}

// API Endpoint 1: Parse Video URL Details
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

    // TikTok: Use TikWM API
    if (platform === 'tiktok') {
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
    } else {
      // YouTube/Instagram/Facebook: use yt-dlp
      const info = await getYtDlpInfo(cleanUrl);
      if (info) {
        title = info.title || title;
        thumbnail = info.thumbnail || thumbnail;
        author = info.uploader ? `@${info.uploader}` : (info.channel ? `@${info.channel}` : author);
        duration = info.duration ? formatSeconds(info.duration) : duration;
        console.log(`[Parser] yt-dlp success: ${title}`);
      } else if (platform === 'youtube') {
        // Fallback to YouTube oEmbed
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

// Helper function to stream yt-dlp output with automatic failover
function streamYtDlpProcess(res, videoUrl, formatArg, safeFilename, isAudio, onFail) {
  const ytdlpArgs = [
    ...YTDLP_BASE_ARGS,
    '-f', formatArg,
    '-o', '-',
    videoUrl
  ];

  console.log(`[yt-dlp stream] Trying format "${formatArg}" for: ${videoUrl}`);

  const ytdlpProcess = spawn(YTDLP_PATH, ytdlpArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let headersSent = false;
  let stderrData = '';

  ytdlpProcess.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  ytdlpProcess.stdout.once('data', (chunk) => {
    headersSent = true;
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
    res.write(chunk);
    ytdlpProcess.stdout.pipe(res);
  });

  ytdlpProcess.on('error', (err) => {
    console.error('[yt-dlp spawn error]:', err.message);
    if (!headersSent && onFail) onFail(err);
  });

  ytdlpProcess.on('close', (code) => {
    if (code !== 0 && !headersSent) {
      console.warn(`[yt-dlp format "${formatArg}" failed code ${code}] Stderr: ${stderrData.substring(0, 200)}`);
      if (onFail) onFail(new Error(stderrData || `Code ${code}`));
    } else if (headersSent) {
      console.log(`[yt-dlp] ✅ Stream finished successfully!`);
    }
  });
}

// API Endpoint 2: Robust multi-stage download endpoint for ALL platforms
app.get('/api/download', async (req, res) => {
  const videoUrl = req.query.url;
  const isAudio = req.query.type === 'audio';
  const quality = req.query.quality || '720';
  const rawFilename = req.query.filename || `GreenHole_Download_${Date.now()}.${isAudio ? 'mp3' : 'mp4'}`;

  if (!videoUrl) {
    return res.status(400).send('Error: Video URL parameter is missing');
  }

  const safeFilename = rawFilename.replace(/[^\w\s.-]/g, '_').substring(0, 100);
  console.log(`[Streamer Request] URL: ${videoUrl} | Quality: ${quality} | Audio: ${isAudio}`);

  // TIKTOK: Use TikWM CDN with fixed URL prefix handling
  if (videoUrl.includes('tiktok.com')) {
    try {
      const tikRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, { timeout: 10000 });
      if (tikRes.data && tikRes.data.data) {
        const d = tikRes.data.data;
        let mediaUrl = isAudio ? d.music : (d.hdplay || d.play);

        if (mediaUrl) {
          if (!mediaUrl.startsWith('http')) {
            mediaUrl = 'https://www.tikwm.com' + mediaUrl;
          }
          console.log(`[TikTok CDN] Streaming directly: ${mediaUrl}`);
          const streamRes = await axios({
            method: 'get',
            url: mediaUrl,
            responseType: 'stream',
            timeout: 60000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
          res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
          if (streamRes.headers['content-length']) {
            res.setHeader('Content-Length', streamRes.headers['content-length']);
          }
          return streamRes.data.pipe(res);
        }
      }
    } catch (tikErr) {
      console.warn('[TikTok stream warning]:', tikErr.message);
    }
  }

  // Ensure binaries exist & permissions set on Linux
  if (!fs.existsSync(YTDLP_PATH) && process.platform !== 'win32') {
    ensureBinariesPermissions();
  }

  if (!fs.existsSync(YTDLP_PATH)) {
    return res.status(500).send('Server Error: Downloader engine initializing. Please refresh and try again.');
  }

  const h = parseInt(quality) || 720;

  // Stage 1: Single combined MP4 file (Instant stream, no ffmpeg required, 100% reliable)
  const primaryFormat = isAudio
    ? 'bestaudio/best'
    : `best[height<=${h}][ext=mp4]/best[height<=${h}]/best[ext=mp4]/best`;

  // Stage 2: Merged video+audio (HD)
  const secondaryFormat = isAudio
    ? 'best'
    : `bestvideo[height<=${h}]+bestaudio/bestvideo+bestaudio/best`;

  // Stage 3: Ultimate simple format
  const ultimateFormat = 'b/best';

  // Execute Stage 1
  streamYtDlpProcess(res, videoUrl, primaryFormat, safeFilename, isAudio, (stage1Err) => {
    console.log('[Download Failover] Stage 1 failed. Triggering Stage 2...');

    // Execute Stage 2
    streamYtDlpProcess(res, videoUrl, secondaryFormat, safeFilename, isAudio, (stage2Err) => {
      console.log('[Download Failover] Stage 2 failed. Triggering Stage 3...');

      // Execute Stage 3
      streamYtDlpProcess(res, videoUrl, ultimateFormat, safeFilename, isAudio, (stage3Err) => {
        if (!res.headersSent) {
          res.status(500).send('Download failed. Please check the URL and try again.');
        }
      });
    });
  });
});

// SEO Routes
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sitemap.xml')));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'robots.txt')));

// SPA Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'), (err) => {
    if (err) res.status(404).send('Page not found');
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`✅ Green Hole Downloader Backend running on port ${PORT}`);
  console.log(`🔧 yt-dlp path: ${YTDLP_PATH}`);
  console.log(`🎬 ffmpeg path: ${FFMPEG_PATH}`);
});
