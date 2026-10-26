import type { Callout, CalloutMap } from './quiz';
import { priority } from './quiz';

/**
 * Le trainer : une partie a points et a vies, sur une carte ou sur toutes.
 *
 * Deux formats : une serie de 20 questions, ou un mode infini qui ne
 * s'arrete qu'a la derniere vie perdue. Module pur, il porte les tests.
 */

/** Nombre de questions d'une serie ; null pour le mode infini. */
export type GameLength = number | null;

export const SERIES_LENGTH = 20;
export const START_LIVES = 3;

/** Points d'une bonne reponse, avant le bonus de serie. */
export const BASE_POINTS = 100;
/** Bonus par bonne reponse consecutive deja enchainee. */
export const STREAK_BONUS = 20;
/** Plafond du bonus : au-dela de 10 d'affilee, il n'augmente plus. */
export const STREAK_CAP = 10;

/** Un endroit a demander, avec la carte a laquelle il appartient. */
export interface GameItem {
  mapId: string;
  callout: Callout;
}

export interface GameState {
  score: number;
  lives: number;
  /** Bonnes reponses consecutives en cours. */
  streak: number;
  bestStreak: number;
  answered: number;
  correct: number;
  /** Cles des endroits deja demandes, du plus ancien au plus recent. */
  asked: string[];
  over: boolean;
}

export function itemKey(item: GameItem): string {
  return `${item.mapId}/${item.callout.id}`;
}

/** Tous les endroits jouables des cartes choisies. */
export function buildPool(maps: readonly CalloutMap[]): GameItem[] {
  return maps.flatMap((m) =>
    m.callouts.filter((c) => c.name.trim()).map((callout) => ({ mapId: m.id, callout })),
  );
}

export function newGame(lives = START_LIVES): GameState {
  return { score: 0, lives, streak: 0, bestStreak: 0, answered: 0, correct: 0, asked: [], over: false };
}

/** Points rapportes par une bonne reponse, selon la serie en cours. */
export function pointsFor(streak: number): number {
  return BASE_POINTS + Math.min(streak, STREAK_CAP) * STREAK_BONUS;
}

/**
 * Applique une reponse. Une erreur coute une vie et casse la serie ; la
 * partie s'arrete a zero vie, ou a la derniere question d'une serie.
 */
export function applyAnswer(
  state: GameState,
  item: GameItem,
  correct: boolean,
  length: GameLength,
): GameState {
  const streak = correct ? state.streak + 1 : 0;
  const lives = correct ? state.lives : state.lives - 1;
  const answered = state.answered + 1;
  return {
    score: state.score + (correct ? pointsFor(state.streak) : 0),
    lives,
    streak,
    bestStreak: Math.max(state.bestStreak, streak),
    answered,
    correct: state.correct + (correct ? 1 : 0),
    asked: [...state.asked, itemKey(item)],
    over: lives <= 0 || (length !== null && answered >= length),
  };
}

/**
 * Choisit la prochaine question.
 *
 * Les endroits fragiles (jamais vus, souvent rates) tombent plus souvent.
 * Les derniers demandes sont ecartes pour ne pas reposer la meme question
 * coup sur coup : toute la serie quand le nombre d'endroits le permet, sinon
 * la moitie la plus recente, ce qui garde un vrai brassage en mode infini.
 */
export function pickNext(
  pool: readonly GameItem[],
  asked: readonly string[],
  length: GameLength,
  random: () => number = Math.random,
): GameItem | null {
  if (pool.length === 0) return null;
  const fenetre =
    length !== null && pool.length >= length
      ? asked.length
      : Math.min(asked.length, Math.max(1, Math.floor(pool.length / 2)), pool.length - 1);
  const recents = new Set(asked.slice(asked.length - fenetre));
  const candidats = pool.filter((item) => !recents.has(itemKey(item)));
  const choix = candidats.length > 0 ? candidats : [...pool];

  const poids = choix.map((item) => priority(item.callout.stats));
  const total = poids.reduce((a, b) => a + b, 0);
  let tirage = random() * total;
  for (let i = 0; i < choix.length; i++) {
    tirage -= poids[i] ?? 0;
    if (tirage <= 0) return choix[i] ?? null;
  }
  return choix[choix.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Records, par perimetre et par format.

const RECORDS_KEY = 'synetics.callouts.records.v1';

export function recordKey(scope: string, mode: string, length: GameLength): string {
  return `${scope}|${mode}|${length ?? 'infini'}`;
}

export function loadRecords(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** Enregistre un score s'il bat le record ; renvoie l'ancien record. */
export function submitRecord(key: string, score: number): number {
  const records = loadRecords();
  const previous = records[key] ?? 0;
  if (score > previous) {
    try {
      localStorage.setItem(RECORDS_KEY, JSON.stringify({ ...records, [key]: score }));
    } catch {
      // Stockage inaccessible : le record n'est simplement pas garde.
    }
  }
  return previous;
}
