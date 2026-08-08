import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

function visitorSurfaceImports(enabled: boolean) {
  return {
    name: 'visitor-surface-imports',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!enabled || !id.replaceAll('\\', '/').endsWith('/src/visitor/GuestChat.tsx')) return null;
      const next = code
        .replace("from '../api'", "from './visitorApi'")
        .replace("import '../styles.css';", "import './visitorChat.css';");
      if (next === code || next.includes("from '../api'") || next.includes("import '../styles.css'")) {
        throw new Error('visitor GuestChat imports were not isolated');
      }
      return { code: next, map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const visitorBuild = mode === 'visitor';
  return {
    base: visitorBuild ? '/visitor/' : '/',
    plugins: [
      visitorSurfaceImports(visitorBuild),
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
