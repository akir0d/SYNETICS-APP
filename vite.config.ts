import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Chemins relatifs : indispensable pour Electron (file://) et Capacitor (WebView).
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  server: { port: 5173, host: true },
});
