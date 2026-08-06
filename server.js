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

// FIX HOSTINGER /tmp NOEXEC BLOCK
const localTempDir = path.join(__dirname, 'temp_downloads');
if (!fs.existsSync(localTempDir)) {
  fs.mkdirSync(localTempDir, { recursive: true });
}
process.env.TMPDIR = localTempDir;
process.env.TEMP = localTempDir;
process.env.TMP = localTempDir;

// Path to yt-dlp binary — auto detect Windows vs Linux
const YTDLP_PATH = process.platform === 'win32'
  ? path.join(__dirname, 'bin', 'yt-dlp.exe')
  : path.join(__dirname, 'bin', 'yt-dlp');

// Path to ffmpeg binary
const FFMPEG_PATH = ffmpegStatic;

// Path to optional Netscape cookies.txt file
const COOKIES_PATH = path.join(__dirname, 'cookies.txt');

// Ensure yt-dlp AND ffmpeg binaries exist & have executable permissions on Linux (Hostinger)
function ensureBinariesPermissions() {
  if (process.platform === 'win32') return;

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
      console.error('[Server Startup] Failed to download yt-dlp binary via curl:', e.message);
    }
  }

  try {
    execSync(`chmod +x "${ytdlpLinuxPath}"`, { stdio: 'ignore' });
    console.log('[Server Startup] ✅ yt-dlp permission set (chmod +x)!');
  } catch (e) {}

  if (FFMPEG_PATH && fs.existsSync(FFMPEG_PATH)) {
    try {
      execSync(`chmod +x "${FFMPEG_PATH}"`, { stdio: 'ignore' });
      console.log('[Server Startup] ✅ ffmpeg permission set (chmod +x)!');
    } catch (e) {}
  }
}
ensureBinariesPermissions();

// Base args — --js-runtimes node enables Node.js challenge solver for YouTube JS anti-bot!
const YTDLP_BASE_ARGS = [
  '--no-playlist',
  '--no-warnings',
  '--no-check-certificates',
  '--js-runtimes', 'node',
  '--extractor-args', 'youtube:player_client=android_creator,android,web',
];

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
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        TMPDIR: localTempDir,
        TEMP: localTempDir,
        TMP: localTempDir
      }
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

    let platform = 'video';
    if (cleanUrl.includes('youtube.com') || cleanUrl.includes('youtu.be')) platform = 'youtube';
    else if (cleanUrl.includes('instagram.com')) platform = 'instagram';
    else if (cleanUrl.includes('facebook.com') || cleanUrl.includes('fb.watch')) platform = 'facebook';

    let title = `${platform.toUpperCase()} Video`;
    let thumbnail = '/hero.jpg';
    let author = `@${platform}_creator`;
    let duration = '03:15';

    // YouTube/Instagram/Facebook: use yt-dlp
    const info = await getYtDlpInfo(cleanUrl);
    if (info) {
        title = info.title || title;
        thumbnail = info.thumbnail || thumbnail;
        author = info.uploader ? `@${info.uploader}` : (info.channel ? `@${info.channel}` : author);
        duration = info.duration ? formatSeconds(info.duration) : duration;
        console.log(`[Parser] yt-dlp success: ${title}`);
      } else if (platform === 'youtube') {
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

// Helper function to stream yt-dlp output
function streamYtDlpProcess(res, videoUrl, formatArg, safeFilename, isAudio, onFail) {
  const ytdlpArgs = [
    ...YTDLP_BASE_ARGS,
    '-f', formatArg,
    '-o', '-',
    videoUrl
  ];

  console.log(`[yt-dlp stream] Format: "${formatArg}" | Cookies Active: ${fs.existsSync(COOKIES_PATH)} | URL: ${videoUrl}`);

  const ytdlpProcess = spawn(YTDLP_PATH, ytdlpArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      TMPDIR: localTempDir,
      TEMP: localTempDir,
      TMP: localTempDir
    }
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
      const errDetail = stderrData.trim() || `Exit code ${code}`;
      console.warn(`[yt-dlp failed] ${errDetail}`);
      if (onFail) onFail(new Error(errDetail));
    } else if (headersSent) {
      console.log(`[yt-dlp] ✅ Stream finished successfully!`);
    }
  });
}

// API Endpoint 2: Robust download endpoint for ALL platforms
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


  // Ensure binaries exist & permissions set on Linux
  if (!fs.existsSync(YTDLP_PATH) && process.platform !== 'win32') {
    ensureBinariesPermissions();
  }

  if (!fs.existsSync(YTDLP_PATH)) {
    return res.status(500).send('Server Error: Downloader binary not found on server. Please check bin/yt-dlp.');
  }

  const formatArg = isAudio ? 'bestaudio/best' : 'best/b';

  streamYtDlpProcess(res, videoUrl, formatArg, safeFilename, isAudio, (err) => {
    if (!res.headersSent) {
      res.status(500).send(`Server Download Error: ${err?.message || 'Process error'}`);
    }
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
  console.log(`🍪 Cookies file active: ${fs.existsSync(COOKIES_PATH)}`);
});
