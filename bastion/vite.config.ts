import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Cible large : certaines WebView Android ne sont pas a jour (Array.at manquait, ecran vide).
  build: { outDir: 'dist', target: ['es2019', 'chrome80'], chunkSizeWarningLimit: 1200 },
  server: { port: 5175, host: true },
});
