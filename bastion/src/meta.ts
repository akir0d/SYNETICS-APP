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

// ---------------------------------------------------------------- armes et tenues

export type WeaponId = 'rifle' | 'shotgun' | 'crossbow';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  icon: string;
  desc: string;
  /** Prix : en pieces, ou en gemmes pour aller plus vite. */
  coins: number;
  gems: number;
  /** Caracteristiques selon le niveau « Fusil » de l'etabli. */
  range: (lvl: number) => number;
  interval: (lvl: number) => number;
  damage: (lvl: number) => number;
  /** Zombies touches par tir. */
  targets: number;
}

export const WEAPONS: WeaponDef[] = [
  { id: 'rifle', name: 'Fusil', icon: '🔫', desc: 'Précis, cadence rapide', coins: 0, gems: 0,
    range: (l) => 10 + l, interval: (l) => 0.32 - 0.03 * l, damage: (l) => 1 + l, targets: 1 },
  { id: 'shotgun', name: 'Fusil à pompe', icon: '💥', desc: 'Touche 4 zombies d’un coup, de près', coins: 1800, gems: 60,
    range: (l) => 7 + 0.5 * l, interval: (l) => 0.62 - 0.03 * l, damage: (l) => 1 + l, targets: 4 },
  { id: 'crossbow', name: 'Arbalète', icon: '🏹', desc: 'Très longue portée, carreaux dévastateurs', coins: 3500, gems: 120,
    range: (l) => 16 + l, interval: (l) => 0.7 - 0.04 * l, damage: (l) => 3 + 2 * l, targets: 1 },
];

export interface OutfitDef { id: string; name: string; icon: string; gems: number; jacket: number; cap: number; pants: number }

export const OUTFITS: OutfitDef[] = [
  { id: 'base', name: 'Veste de route', icon: '🧥', gems: 0, jacket: 0x3d7fd6, cap: 0xe0443a, pants: 0x34495e },
  { id: 'ranger', name: 'Garde forestier', icon: '🌲', gems: 40, jacket: 0x5a6e3a, cap: 0x3a4a2a, pants: 0x4a4030 },
  { id: 'hunter', name: 'Chasseur', icon: '🦌', gems: 50, jacket: 0xd9762a, cap: 0xd9762a, pants: 0x3a3a3a },
  { id: 'fire', name: 'Pompier', icon: '🚒', gems: 60, jacket: 0xc9412f, cap: 0xe8b84a, pants: 0x2e3439 },
  { id: 'night', name: 'Rôdeur de nuit', icon: '🌑', gems: 80, jacket: 0x2a2a33, cap: 0x1a1a1a, pants: 0x2a2a2a },
];

// ---------------------------------------------------------------- personnages et radio

/** Les survivants recrutes ont un nom et quelques repliques. */
export const CREW: Record<string, { name: string; lines: string[] }> = {
  farmer: { name: 'Rose', lines: ['Les tomates, c’est comme les gens : il faut leur parler.', 'Encore une rangée et je fais une pause.', 'Tu as vu ces carottes ? Magnifiques.'] },
  lumber: { name: 'Gaston', lines: ['Un arbre, deux arbres… je compte plus.', 'La hache, c’est mieux qu’un fusil. Ça s’enraye pas.', 'Il en faut, du bois, pour tenir cette palissade.'] },
  fisher: { name: 'Lino', lines: ['Ça mord mieux le matin.', 'Avant, je pêchais pour le plaisir.', 'Chut… tu vas faire fuir les poissons.'] },
  scav: { name: 'Vic', lines: ['Tout se recycle. Même les voitures.', 'J’ai trouvé une clé de 12. Une vraie fête.', 'La station en a encore sous le capot.'] },
  porter: { name: 'Momo', lines: ['Je porte, je porte, et je souris.', 'La réserve se vide, l’étal se remplit !', 'Mon dos me déteste.'] },
  cashier: { name: 'Nadia', lines: ['Je compte tout, rien ne se perd.', 'Les clients adorent le pain, tu sais.', 'La caisse est pleine, chef !'] },
};

/** Messages radio : l'histoire se devoile au fil des objectifs. */
export const RADIO: { at: number; from: string; text: string }[] = [
  { at: 2, from: 'Radio Bastion', text: 'Si quelqu’un entend ce message… la route du sud est sûre le jour. La nuit, barricadez-vous. Ils ne s’arrêtent jamais.' },
  { at: 7, from: 'Radio Bastion', text: 'La palissade, c’est votre vie. Réparez chaque brèche avant la tombée de la nuit.' },
  { at: 11, from: 'Une voix inconnue', text: 'Ici la Ville. On reçoit votre feu de camp au loin. Un bus fonctionnait encore il y a peu… cherchez sur la route.' },
  { at: 16, from: 'Radio Bastion', text: 'Des survivants errent dans la vallée. Un camp qui tient, ça attire du monde. Accueillez-les.' },
  { at: 19, from: 'La Ville', text: 'La vieille ferme à l’ouest avait les meilleurs champs de la région. Et un moulin.' },
  { at: 25, from: 'La Ville', text: 'Attention : on a vu des brutes. Énormes. Elles cassent le bois comme du papier.' },
  { at: 29, from: 'Radio Bastion', text: 'La station-service de l’est… il reste du carburant au fond des cuves. Assez pour un bus.' },
  { at: 35, from: 'Radio Bastion', text: 'Le bois ne suffira pas longtemps. Il y a une vieille carrière au nord-est : la pierre, elle, ne brûle pas.' },
  { at: 38, from: 'La Ville', text: 'La station avait un atelier avec un four. Fondez la ferraille : un mur de fer, ça ne se défonce pas.' },
  { at: 42, from: 'La Ville', text: 'On vous attend. Réparez ce bus, faites le plein, et venez. Il y a de la place pour tout le monde.' },
];
