// Auto-download standalone yt-dlp binary for Linux (Hostinger/Railway)
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const binDir = path.join(rootDir, 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp');

// Windows par skip (Windows local dev yt-dlp.exe use karta hai)
if (process.platform === 'win32') {
  console.log('[Setup] Windows detected - skipping Linux yt-dlp download');
  process.exit(0);
}

// bin folder banao
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

try {
  console.log('[Setup] Downloading standalone Linux yt-dlp_linux binary (with embedded Python)...');
  // Download standalone compiled x86_64 binary with embedded Python environment
  execSync(
    `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o "${ytdlpPath}"`,
    { stdio: 'inherit', timeout: 120000 }
  );
  execSync(`chmod +x "${ytdlpPath}"`, { stdio: 'inherit' });
  console.log('[Setup] Standalone yt-dlp binary ready at bin/yt-dlp!');
} catch (err) {
  console.error('[Setup] Failed to download standalone yt-dlp:', err.message);
}
