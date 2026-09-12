import { Capacitor } from '@capacitor/core';

/**
 * Couche d'adaptation entre les trois cibles : navigateur, application PC
 * (Electron) et application Android (Capacitor). Le reste du code ignore
 * completement sur quoi il tourne.
 */

export type PlatformKind = 'electron' | 'android' | 'web';

interface SyneticsBridge {
  saveTextFile: (
    filename: string,
    content: string,
  ) => Promise<{ ok: boolean; path?: string; reason?: string }>;
  platform: string;
  version: string;
}

declare global {
  interface Window {
    synetics?: SyneticsBridge;
  }
}

export function detectPlatform(): PlatformKind {
  if (typeof window !== 'undefined' && window.synetics) return 'electron';
  if (Capacitor.isNativePlatform()) return 'android';
  return 'web';
}

export interface SaveResult {
  ok: boolean;
  /** Emplacement du fichier quand la plateforme sait le dire. */
  path?: string;
  message: string;
}

/** Ecrit un fichier texte la ou la plateforme sait le faire. */
export async function saveTextFile(
  filename: string,
  content: string,
  mimeType = 'text/plain',
): Promise<SaveResult> {
  const platform = detectPlatform();

  if (platform === 'electron' && window.synetics) {
    const result = await window.synetics.saveTextFile(filename, content);
    if (!result.ok) {
      return { ok: false, message: result.reason ?? 'Enregistrement annule.' };
    }
    return { ok: true, path: result.path, message: `Fichier enregistre : ${result.path}` };
  }

  if (platform === 'android') {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
    const written = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });
    return { ok: true, path: written.uri, message: `Enregistre dans Documents : ${filename}` };
  }

  // Navigateur : telechargement classique via un lien temporaire.
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Laisse au navigateur le temps de demarrer le telechargement.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { ok: true, message: `Telechargement lance : ${filename}` };
}

/**
 * Empeche la mise en veille de l'ecran pendant une analyse.
 *
 * Sur Android, laisser l'ecran s'eteindre fait passer la WebView en
 * arriere-plan : le decodage video y est fortement ralenti et une analyse de
 * dix minutes peut s'eterniser. Le verrou est relache des la fin.
 *
 * Renvoie toujours une fonction de liberation, meme quand la plateforme ne
 * propose pas l'API : l'appelant n'a jamais a s'en soucier.
 */
export async function keepScreenAwake(): Promise<() => void> {
  const wakeLock = (navigator as Navigator & {
    wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> };
  }).wakeLock;

  if (!wakeLock) return () => {};

  try {
    const sentinel = await wakeLock.request('screen');
    return () => {
      void sentinel.release().catch(() => {});
    };
  } catch {
    // Verrou refuse (onglet en arriere-plan, batterie faible) : sans gravite,
    // l'analyse se poursuit, simplement plus lentement si l'ecran s'eteint.
    return () => {};
  }
}
