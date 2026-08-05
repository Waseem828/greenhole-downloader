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

// Common Base Args
const YTDLP_COMMON_ARGS = [
  '--no-playlist',
  '--no-warnings',
  '--no-check-certificates',
  '--geo-bypass',
];

if (FFMPEG_PATH && fs.existsSync(FFMPEG_PATH)) {
  YTDLP_COMMON_ARGS.push('--ffmpeg-location', FFMPEG_PATH);
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

// Helper: Get video info using yt-dlp --dump-json (Skips web player configs to bypass bot check)
async function getYtDlpInfo(url) {
  try {
    const args = [
      ...YTDLP_COMMON_ARGS,
      '--extractor-args', 'youtube:player_client=android;player_skip=web,configs',
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

// Helper function to stream yt-dlp with player_skip=web,configs (Bypasses web bot checks)
function streamYtDlpProcess(res, videoUrl, extractorArgs, formatArg, safeFilename, isAudio, onFail) {
  const ytdlpArgs = [
    ...YTDLP_COMMON_ARGS,
    '--extractor-args', extractorArgs,
    '-f', formatArg,
    '-o', '-',
    videoUrl
  ];

  console.log(`[yt-dlp stream] ExtractorArgs: ${extractorArgs} | Format: "${formatArg}" | URL: ${videoUrl}`);

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

  // TIKTOK: Direct TikWM CDN streaming
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
    return res.status(500).send('Server Error: Downloader binary not found on server. Please check bin/yt-dlp.');
  }

  const formatArg = isAudio ? 'bestaudio/best' : 'best/b';

  // STAGE 1: Pure Android API (Skips web player configs entirely — 100% bypasses bot checks)
  const stage1Args = 'youtube:player_client=android;player_skip=web,configs';

  // STAGE 2: Creator Android API Backup
  const stage2Args = 'youtube:player_client=android_creator,android;player_skip=web,configs';

  // STAGE 3: TV Embedded Client Backup
  const stage3Args = 'youtube:player_client=tv_embedded,android';

  // Execute Stage 1
  streamYtDlpProcess(res, videoUrl, stage1Args, formatArg, safeFilename, isAudio, (stage1Err) => {
    console.log('[Failover] Stage 1 failed. Triggering Stage 2...');

    // Execute Stage 2
    streamYtDlpProcess(res, videoUrl, stage2Args, formatArg, safeFilename, isAudio, (stage2Err) => {
      console.log('[Failover] Stage 2 failed. Triggering Stage 3...');

      // Execute Stage 3
      streamYtDlpProcess(res, videoUrl, stage3Args, formatArg, safeFilename, isAudio, (stage3Err) => {
        if (!res.headersSent) {
          const detail = stage3Err?.message || stage2Err?.message || stage1Err?.message || 'Download error';
          res.status(500).send(`Server Download Error: ${detail}`);
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
