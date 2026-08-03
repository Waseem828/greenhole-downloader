// Auto-download yt-dlp binary for Linux (Hostinger/Railway)
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');
const binDir = path.join(rootDir, 'bin');
const ytdlpPath = path.join(binDir, 'yt-dlp');

// Windows par kuch nahi karna - .exe already hai node_modules mein
if (process.platform === 'win32') {
  console.log('[Setup] Windows detected - skipping yt-dlp download');
  process.exit(0);
}

// Agar already downloaded hai
if (existsSync(ytdlpPath)) {
  console.log('[Setup] yt-dlp already exists, skipping download');
  process.exit(0);
}

// bin folder banao
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

try {
  console.log('[Setup] Downloading yt-dlp Linux binary from GitHub...');
  execSync(
    `curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "${ytdlpPath}"`,
    { stdio: 'inherit', timeout: 120000 }
  );
  execSync(`chmod +x "${ytdlpPath}"`, { stdio: 'inherit' });
  console.log('[Setup] yt-dlp binary ready!');
} catch (err) {
  console.error('[Setup] Failed to download yt-dlp:', err.message);
  // App phir bhi start hogi, download endpoint fail hoga
}
