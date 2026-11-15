import { defineConfig } from 'vite';

export default defineConfig({
  // Chemins relatifs : indispensable pour la WebView de Capacitor.
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
  server: { port: 5174, host: true },
});
