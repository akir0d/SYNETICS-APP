'use strict';

/**
 * Lance le controle bout en bout : ouvre la page de test dans Electron,
 * attend le verdict pose par `smoke.ts`, puis termine avec un code de sortie
 * exploitable par une integration continue.
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', '..', 'dist-e2e', 'index.html');
const TIMEOUT_MS = 180_000;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 600,
    webPreferences: { offscreen: false },
  });

  window.webContents.on('console-message', (_event, _level, message) => {
    if (message.startsWith('Erreur') || message.includes('Error')) console.log('[page]', message);
  });

  await window.loadFile(PAGE);

  const startedAt = Date.now();
  let lastProgress = '';
  const poll = setInterval(async () => {
    // Journal de progression : sans lui, un blocage ne dit pas a quelle etape.
    const progress = await window.webContents.executeJavaScript(
      "document.getElementById('out')?.textContent ?? ''",
    );
    if (progress && progress !== lastProgress) {
      lastProgress = progress;
      console.log(`[${Math.round((Date.now() - startedAt) / 1000)}s] ${progress.slice(0, 120)}`);
    }

    const verdict = await window.webContents.executeJavaScript('window.__SMOKE__ ?? null');
    if (verdict) {
      clearInterval(poll);
      console.log(JSON.stringify(verdict, null, 2));
      console.log(verdict.ok ? '\nCONTROLE BOUT EN BOUT : REUSSI' : '\nCONTROLE BOUT EN BOUT : ECHEC');
      app.exit(verdict.ok ? 0 : 1);
      return;
    }
    if (Date.now() - startedAt > TIMEOUT_MS) {
      clearInterval(poll);
      console.error('CONTROLE BOUT EN BOUT : DELAI DEPASSE');
      app.exit(2);
    }
  }, 500);
});
