'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

/**
 * Processus principal de l'application PC.
 *
 * Le rendu est la meme application web que sur Android : Electron ne fournit
 * ici que la fenetre, l'enregistrement de fichiers et les garde-fous de
 * securite. Aucune logique d'analyse ne vit dans ce fichier.
 */

const DEV_SERVER = process.env.SYNETICS_DEV_SERVER;

function createWindow() {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0a0e17',
    title: 'SYNETICS — Analyse IA de matchs EVA',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      // Le rendu n'a aucun acces direct a Node : tout passe par le pont IPC.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (DEV_SERVER) {
    void window.loadURL(DEV_SERVER);
    window.webContents.openDevTools({ mode: 'detach' });
  } else {
    void window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  // Un lien externe s'ouvre dans le navigateur du systeme, jamais dans l'app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}

ipcMain.handle('synetics:saveTextFile', async (event, filename, content) => {
  if (typeof filename !== 'string' || typeof content !== 'string') {
    return { ok: false, reason: 'Requete d enregistrement invalide.' };
  }

  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    defaultPath: path.join(app.getPath('documents'), path.basename(filename)),
    filters: [{ name: 'Fichiers exportes', extensions: [path.extname(filename).slice(1) || 'txt'] }],
  };

  const result = window
    ? await dialog.showSaveDialog(window, options)
    : await dialog.showSaveDialog(options);

  if (result.canceled || !result.filePath) {
    return { ok: false, reason: 'Enregistrement annule.' };
  }

  try {
    await fs.writeFile(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, reason: `Ecriture impossible : ${String(error)}` };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
