import type { AppSettings } from '../types';
import { DEFAULT_SETTINGS } from '../types';

const KEY = 'synetics.settings.v1';

/**
 * Les reglages (dont la cle API) restent sur l'appareil. Aucune synchronisation,
 * aucun envoi vers un serveur tiers.
 */
export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    // Stockage inaccessible (mode prive, quota) : on repart des valeurs par defaut.
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Sans persistance, l'application reste utilisable le temps de la session.
  }
}
