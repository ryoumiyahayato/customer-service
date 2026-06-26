import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['Android >= 6', 'Chrome >= 61', 'Safari >= 12', 'iOS >= 12'],
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2017', cssTarget: 'chrome61' },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});