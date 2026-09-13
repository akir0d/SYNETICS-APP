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
    return normalize({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    // Stockage inaccessible (mode prive, quota) : on repart des valeurs par defaut.
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Rattrape un reglage enregistre par une version anterieure.
 *
 * L'application entiere refuse de s'afficher si un champ attendu manque ou
 * n'a pas le bon type — une bibliotheque existante suffirait a la rendre
 * inutilisable apres mise a jour. On repare donc a la lecture.
 */
function normalize(settings: AppSettings): AppSettings {
  const teams = Array.isArray(settings.teams)
    ? settings.teams.filter((t) => t && typeof t.id === 'string').map((t) => ({
        id: t.id,
        tag: typeof t.tag === 'string' ? t.tag : '',
        name: typeof t.name === 'string' ? t.name : '',
        players: Array.isArray(t.players) ? t.players.filter((p) => typeof p === 'string') : [],
      }))
    : [];
  return {
    ...settings,
    teams,
    // Une equipe supprimee ne doit pas rester designee comme la votre.
    myTeamId: teams.some((t) => t.id === settings.myTeamId) ? settings.myTeamId : '',
  };
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Sans persistance, l'application reste utilisable le temps de la session.
  }
}
