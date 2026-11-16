// Ce qui fait revenir le joueur : quetes du jour, coffre gratuit, niveaux des batiments,
// boosts temporaires. Les valeurs sont ici, la mecanique est branchee dans main.ts.

import type { Stats } from './progress';

// ---------------------------------------------------------------- quetes du jour

export interface QuestDef {
  id: string;
  icon: string;
  /** Texte, avec {n} pour l'objectif. */
  text: string;
  stat: keyof Stats;
  /** Objectif selon le jour de jeu atteint (les quetes grandissent avec le camp). */
  goal: (day: number) => number;
  gems: number;
  /** Debloquee a partir de cet objectif de progression. */
  from: number;
}

export const QUESTS: QuestDef[] = [
  { id: 'harvest', icon: '🥕', text: 'Récolte {n} légumes', stat: 'harvested', goal: (d) => 40 + 10 * d, gems: 5, from: 0 },
  { id: 'shelve', icon: '🧺', text: 'Pose {n} produits à l’étal', stat: 'shelved', goal: (d) => 50 + 12 * d, gems: 5, from: 1 },
  { id: 'earn', icon: '💰', text: 'Gagne {n} pièces', stat: 'earned', goal: (d) => 400 + 200 * d, gems: 8, from: 2 },
  { id: 'logs', icon: '🪓', text: 'Coupe {n} rondins', stat: 'logs', goal: (d) => 25 + 5 * d, gems: 5, from: 5 },
  { id: 'repair', icon: '🪵', text: 'Répare la palissade avec {n} rondins', stat: 'repairs', goal: () => 10, gems: 6, from: 6 },
  { id: 'kills', icon: '🧟', text: 'Abats {n} zombies', stat: 'kills', goal: (d) => 12 + 4 * d, gems: 8, from: 7 },
  { id: 'planks', icon: '🪚', text: 'Scie {n} planches', stat: 'planks', goal: (d) => 20 + 5 * d, gems: 6, from: 9 },
  { id: 'scrap', icon: '🔩', text: 'Récupère {n} ferrailles', stat: 'scrap', goal: (d) => 15 + 3 * d, gems: 6, from: 10 },
  { id: 'soup', icon: '🍲', text: 'Cuisine {n} soupes', stat: 'soup', goal: (d) => 8 + 2 * d, gems: 8, from: 14 },
  { id: 'chest', icon: '📦', text: 'Récupère {n} objets dans la réserve', stat: 'chest', goal: (d) => 30 + 8 * d, gems: 6, from: 17 },
  { id: 'bread', icon: '🍞', text: 'Cuis {n} pains', stat: 'bread', goal: (d) => 8 + 2 * d, gems: 10, from: 23 },
  { id: 'fish', icon: '🐟', text: 'Pêche {n} poissons', stat: 'fish', goal: (d) => 12 + 2 * d, gems: 8, from: 26 },
  { id: 'fuel', icon: '⛽', text: 'Siphonne {n} bidons', stat: 'fuel', goal: (d) => 8 + d, gems: 10, from: 29 },
];

export interface QuestState { id: string; base: number; goal: number; claimed: boolean }

/** Cle du jour local : les quetes se renouvellent a minuit. */
export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** Trois quetes tirees parmi celles deja accessibles, toujours les memes pour un jour donne. */
export function rollQuests(key: string, obj: number, day: number, stats: Stats): QuestState[] {
  // Chaque quete recoit une note tiree du jour et de son nom ; on garde les trois premieres.
  // Pas de boucle « jusqu'a trouver » : l'ancienne version (generateur dont la multiplication
  // depassait la precision des nombres JS) tournait a l'infini a certains objectifs et figeait
  // le jeu des la premiere image.
  const pool = QUESTS.filter((q) => q.from <= obj);
  const picked = pool
    .map((q) => ({ q, k: hash32(`${key}|${q.id}`) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 3)
    .map((e) => e.q);
  return picked.map((q) => ({ id: q.id, base: stats[q.stat] ?? 0, goal: q.goal(day), claimed: false }));
}

/** Empreinte 32 bits exacte (FNV-1a, Math.imul : pas de perte de precision). */
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------- niveaux des batiments

export type LevelId = 'crops' | 'saw' | 'cook' | 'mill' | 'stall' | 'reserve' | 'tower';

export interface LevelDef {
  id: LevelId;
  name: string;
  icon: string;
  /** Il faut avoir restaure ce chantier pour l'ameliorer. */
  needs: string | null;
  base: number;
  effect: (lvl: number) => string;
}

export const MAX_LEVEL = 10;

export const LEVELS: LevelDef[] = [
  { id: 'crops', name: 'Cultures', icon: '🌱', needs: null, base: 80, effect: (l) => `Pousse +${12 * l} %` },
  { id: 'stall', name: 'Étal', icon: '🧺', needs: null, base: 120, effect: (l) => `Prix de vente +${6 * l} %` },
  { id: 'saw', name: 'Scierie', icon: '🪚', needs: 'sawmill', base: 150, effect: (l) => `Cadence +${15 * l} %` },
  { id: 'cook', name: 'Cuisine', icon: '🍲', needs: 'kitchen', base: 220, effect: (l) => `Cadence +${15 * l} %` },
  { id: 'reserve', name: 'Réserve', icon: '📦', needs: 'shelter', base: 200, effect: (l) => `${240 + 60 * l} places` },
  { id: 'tower', name: 'Tour de guet', icon: '🗼', needs: 'tower', base: 260, effect: (l) => `Dégâts +${l}, tirs +${8 * l} %` },
  { id: 'mill', name: 'Moulin', icon: '🍞', needs: 'mill', base: 400, effect: (l) => `Cadence +${15 * l} %` },
];

/** Cout du niveau suivant : exponentiel, pour durer. */
export function levelCost(def: LevelDef, lvl: number): number {
  return Math.round((def.base * Math.pow(1.65, lvl)) / 10) * 10;
}

// ---------------------------------------------------------------- boosts et coffre

export type BoostId = 'sell' | 'grow' | 'speed';

export const BOOSTS: { id: BoostId; name: string; icon: string; desc: string; gems: number }[] = [
  { id: 'sell', name: 'Ventes ×2', icon: '💰', desc: 'Les clients paient le double', gems: 12 },
  { id: 'grow', name: 'Production ×2', icon: '⚡', desc: 'Cultures et machines deux fois plus vite', gems: 12 },
  { id: 'speed', name: 'Bottes de course', icon: '👟', desc: 'Tu cours 40 % plus vite', gems: 8 },
];
/** Duree d'un boost (secondes de jeu reel). */
export const BOOST_TIME = 180;
/** Temps entre deux coffres gratuits (ms). */
export const CHEST_EVERY = 4 * 3600 * 1000;
/** Pubs « gemmes » possibles par jour. */
export const GEM_ADS_PER_DAY = 5;
