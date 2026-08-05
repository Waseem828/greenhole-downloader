import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { spawn, execFile } from 'child_process';
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

// Common yt-dlp args — Node.js runtime enables po_token for 720p/1080p
const YTDLP_BASE_ARGS = [
  '--no-playlist',
  '--no-warnings',
  '--ffmpeg-location', FFMPEG_PATH,
  '--js-runtimes', 'node',
  '--extractor-args', 'youtube:player_client=mweb,android',
];

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

// Helper: Get video info using yt-dlp --dump-json (android client)
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

    // TikTok: Use TikWM API (fastest for TikTok)
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
      // YouTube/Instagram/Facebook: use yt-dlp android client
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

// API Endpoint 2: Download via yt-dlp (android client — no cookies needed)
app.get('/api/download', async (req, res) => {
  const videoUrl = req.query.url;
  const isAudio = req.query.type === 'audio';
  const quality = req.query.quality || '720';
  const rawFilename = req.query.filename || `GreenHole_Download_${Date.now()}.${isAudio ? 'mp3' : 'mp4'}`;

  if (!videoUrl) {
    return res.status(400).send('Error: Video URL parameter is missing');
  }

  const safeFilename = rawFilename.replace(/[^\w\s.-]/g, '_').substring(0, 100);
  console.log(`[Streamer] Downloading: ${videoUrl} | quality=${quality} | audio=${isAudio}`);

  // TIKTOK: Use TikWM CDN (fast, no watermark)
  if (videoUrl.includes('tiktok.com')) {
    try {
      const tikRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(videoUrl)}`, { timeout: 10000 });
      if (tikRes.data && tikRes.data.data) {
        const d = tikRes.data.data;
        let mediaUrl = isAudio ? d.music :
          (d.hdplay ? `https://www.tikwm.com${d.hdplay}` : `https://www.tikwm.com${d.play}`);

        if (mediaUrl) {
          const streamRes = await axios({
            method: 'get',
            url: mediaUrl,
            responseType: 'stream',
            timeout: 60000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
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

  // YOUTUBE / INSTAGRAM / FACEBOOK: yt-dlp android client streaming
  // With ffmpeg available, merge separate video+audio streams for true 1080p/720p
  let formatArg;
  if (isAudio) {
    formatArg = 'bestaudio[ext=m4a]/bestaudio/best';
  } else {
    const h = parseInt(quality);
    // Merged format: best video + best audio up to target height (requires ffmpeg)
    // Falls back to single combined file if merge not possible
    formatArg = `bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}][ext=mp4]/best[height<=${h}]/best`;
  }

  const ytdlpArgs = [
    ...YTDLP_BASE_ARGS,
    '-f', formatArg,
    '-o', '-',   // pipe to stdout
    videoUrl
  ];

  console.log(`[yt-dlp] Args: -f "${formatArg}" "${videoUrl}"`);

  res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
  res.setHeader('Transfer-Encoding', 'chunked');

  const ytdlpProcess = spawn(YTDLP_PATH, ytdlpArgs, {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderrData = '';
  let headersSentByPipe = false;

  ytdlpProcess.stderr.on('data', (data) => {
    stderrData += data.toString();
    process.stdout.write('[yt-dlp] ' + data.toString());
  });

  ytdlpProcess.stdout.on('data', (chunk) => {
    headersSentByPipe = true;
  });

  ytdlpProcess.on('error', (err) => {
    console.error('[yt-dlp spawn error]:', err.message);
    if (!res.headersSent) res.status(500).send('yt-dlp failed to start: ' + err.message);
  });

  ytdlpProcess.on('close', (code) => {
    if (code !== 0) {
      console.error(`[yt-dlp] exited code ${code}`);
      if (!headersSentByPipe && !res.headersSent) {
        res.status(500).send('Download failed. YouTube may be blocking this request. Please try again.');
      }
    } else {
      console.log(`[yt-dlp] ✅ Complete: ${videoUrl}`);
    }
  });

  req.on('close', () => {
    ytdlpProcess.kill('SIGTERM');
  });

  ytdlpProcess.stdout.pipe(res);
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
  console.log(`🔧 yt-dlp: ${YTDLP_PATH}`);
  console.log(`📱 Using Android client bypass (no cookies needed)`);
});
