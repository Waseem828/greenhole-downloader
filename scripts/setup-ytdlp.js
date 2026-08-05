// Auto-download yt-dlp + ffmpeg binaries for Linux (Hostinger/Railway)
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const binDir = path.join(rootDir, 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp');

// Windows par skip (Windows local dev yt-dlp.exe + ffmpeg.exe already hai)
if (process.platform === 'win32') {
  console.log('[Setup] Windows detected - skipping Linux binary download');
  process.exit(0);
}

// bin folder banao
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

// 1. Download yt-dlp for Linux
try {
  if (!existsSync(ytdlpPath)) {
    console.log('[Setup] Downloading yt-dlp Linux binary...');
    execSync(
      `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "${ytdlpPath}"`,
      { stdio: 'inherit', timeout: 120000 }
    );
    execSync(`chmod +x "${ytdlpPath}"`, { stdio: 'inherit' });
    console.log('[Setup] yt-dlp ready!');
  } else {
    console.log('[Setup] yt-dlp already exists, skipping download.');
  }
} catch (err) {
  console.error('[Setup] Failed to download yt-dlp:', err.message);
}

// 2. Install ffmpeg via system package manager (for 1080p merging)
try {
  // Check if ffmpeg already installed
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    console.log('[Setup] ffmpeg already installed on system.');
  } catch {
    console.log('[Setup] Installing ffmpeg via apt...');
    execSync('apt-get update -qq && apt-get install -y -qq ffmpeg', {
      stdio: 'inherit',
      timeout: 120000
    });
    console.log('[Setup] ffmpeg installed successfully!');
  }
} catch (err) {
  console.warn('[Setup] Could not install ffmpeg (may need sudo or not apt-based):', err.message);
  // Try yum as fallback
  try {
    execSync('yum install -y ffmpeg', { stdio: 'inherit', timeout: 60000 });
  } catch {
    console.warn('[Setup] ffmpeg not installed. 1080p downloads may fallback to 360p.');
  }
}
