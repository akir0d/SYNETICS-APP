'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Surface exposee au rendu : volontairement minuscule. L'application web ne
 * peut demander qu'une seule chose au systeme, ecrire un fichier texte que
 * l'utilisateur a choisi lui-meme dans une boite de dialogue.
 */
contextBridge.exposeInMainWorld('synetics', {
  saveTextFile: (filename, content) =>
    ipcRenderer.invoke('synetics:saveTextFile', filename, content),
  platform: process.platform,
  version: process.versions.electron,
});
