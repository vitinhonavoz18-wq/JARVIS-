/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BUILD_ID = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

/** Versiona o cache do service worker a cada build. */
function swVersion() {
  return {
    name: 'jarvis-sw-version',
    closeBundle() {
      const f = 'dist/sw.js';
      if (existsSync(f)) writeFileSync(f, readFileSync(f, 'utf8').replaceAll('__BUILD_ID__', BUILD_ID));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), swVersion()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/@tiptap') || id.includes('prosemirror')) return 'editor';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (/node_modules\/(react|react-dom|react-router|scheduler)\//.test(id)) return 'react';
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: { VITE_SUPABASE_URL: '' },
  },
});
