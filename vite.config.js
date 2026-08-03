import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        terms: resolve(__dirname, 'terms.html'),
        privacy: resolve(__dirname, 'privacy.html'),
        dmca: resolve(__dirname, 'dmca.html'),
        about: resolve(__dirname, 'about.html')
      }
    }
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false
      },
      '/sitemap.xml': {
        target: 'http://localhost:3001',
        changeOrigin: true
      },
      '/robots.txt': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  }
});

