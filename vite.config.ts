import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

const visitorApiPath = decodeURIComponent(new URL('./src/visitor/visitorApi.ts', import.meta.url).pathname);

export default defineConfig(({ mode }) => {
  const visitorBuild = mode === 'visitor';
  return {
    base: visitorBuild ? '/visitor/' : '/',
    resolve: visitorBuild
      ? { alias: { '../api': visitorApiPath } }
      : undefined,
    plugins: [
      react(),
      legacy({
        targets: ['Android >= 6', 'Chrome >= 61', 'Safari >= 12', 'iOS >= 12'],
        modernPolyfills: true,
        renderLegacyChunks: true,
      }),
    ],
    build: {
      outDir: visitorBuild ? 'dist/visitor' : 'dist',
      emptyOutDir: true,
      cssTarget: 'chrome61',
      rollupOptions: {
        input: visitorBuild ? 'visitor.html' : 'index.html',
      },
    },
    server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  };
});
