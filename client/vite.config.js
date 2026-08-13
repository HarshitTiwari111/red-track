import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies every tracker path to Express on 3010 so httpOnly cookie
// auth, /c redirects and postbacks all behave exactly like production.
const target = 'http://localhost:3010';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target, changeOrigin: false },
      '/c': { target, changeOrigin: false },
      '/go': { target, changeOrigin: false },
      '/postback': { target, changeOrigin: false },
      '/pixel.gif': { target, changeOrigin: false },
      '/track.js': { target, changeOrigin: false },
      '/health': { target, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
});
