import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Build isole du controle bout en bout : il ne part jamais avec l'application. */
export default defineConfig({
  root: here,
  base: './',
  build: {
    outDir: path.join(here, '..', '..', 'dist-e2e'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
