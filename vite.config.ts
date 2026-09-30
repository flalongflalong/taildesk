import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { novncOrientation } from './scripts/novnc-orientation.mjs';
export default defineConfig({
  plugins: [novncOrientation(), react()],
  optimizeDeps: { exclude: ['@novnc/novnc'] },
  build: {
    target: ['es2022', 'safari15.4'],
    rollupOptions: { output: { manualChunks: { novnc: ['@novnc/novnc'] } } },
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:8787', '/ws': { target: 'ws://127.0.0.1:8787', ws: true } },
  },
});
