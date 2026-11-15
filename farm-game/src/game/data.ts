// Donnees du jeu : cultures, ameliorations, constantes d'equilibrage.

export interface CropDef {
  id: string;
  name: string;
  emoji: string;
  /** Temps de pousse de base, en millisecondes. */
  growMs: number;
  /** Pieces gagnees a la recolte (avant multiplicateurs). */
  value: number;
  xp: number;
  unlockLevel: number;
}

export const CROPS: readonly CropDef[] = [
  { id: 'carrot', name: 'Carotte', emoji: '🥕', growMs: 3_000, value: 1, xp: 1, unlockLevel: 1 },
  { id: 'wheat', name: 'Blé', emoji: '🌾', growMs: 6_000, value: 3, xp: 2, unlockLevel: 2 },
  { id: 'tomato', name: 'Tomate', emoji: '🍅', growMs: 12_000, value: 8, xp: 4, unlockLevel: 4 },
  { id: 'corn', name: 'Maïs', emoji: '🌽', growMs: 20_000, value: 18, xp: 7, unlockLevel: 6 },
  { id: 'eggplant', name: 'Aubergine', emoji: '🍆', growMs: 35_000, value: 40, xp: 12, unlockLevel: 9 },
  { id: 'pumpkin', name: 'Citrouille', emoji: '🎃', growMs: 60_000, value: 90, xp: 20, unlockLevel: 12 },
  { id: 'strawberry', name: 'Fraise', emoji: '🍓', growMs: 90_000, value: 200, xp: 32, unlockLevel: 16 },
  { id: 'sunflower', name: 'Tournesol', emoji: '🌻', growMs: 150_000, value: 480, xp: 50, unlockLevel: 20 },
  { id: 'melon', name: 'Pastèque', emoji: '🍉', growMs: 240_000, value: 1_100, xp: 80, unlockLevel: 25 },
  { id: 'pineapple', name: 'Ananas', emoji: '🍍', growMs: 400_000, value: 2_600, xp: 130, unlockLevel: 30 },
  { id: 'grape', name: 'Raisin', emoji: '🍇', growMs: 600_000, value: 6_000, xp: 200, unlockLevel: 36 },
];

export const CROP_BY_ID: ReadonlyMap<string, CropDef> = new Map(CROPS.map((c) => [c.id, c]));

export function crop(id: string): CropDef {
  const c = CROP_BY_ID.get(id);
  if (!c) throw new Error(`Culture inconnue : ${id}`);
  return c;
}

export type UpgradeId = 'fertilizer' | 'market' | 'greenThumb' | 'sprinkler' | 'hen' | 'barn';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  emoji: string;
  baseCost: number;
  growth: number;
  max: number;
  unlockLevel: number;
  /** Effet au niveau donne, en texte court. */
  effect: (level: number) => string;
}

export const UPGRADES: readonly UpgradeDef[] = [
  {
    id: 'fertilizer', name: 'Engrais', emoji: '🧪', baseCost: 30, growth: 1.65, max: 25, unlockLevel: 1,
    effect: (l) => `Pousse ${Math.round((1 - FERTILIZER_STEP ** l) * 100)} % plus vite`,
  },
  {
    id: 'market', name: 'Étal du marché', emoji: '🧺', baseCost: 25, growth: 1.55, max: 60, unlockLevel: 2,
    effect: (l) => `Ventes ×${(MARKET_STEP ** l).toFixed(2)}`,
  },
  {
    id: 'greenThumb', name: 'Main verte', emoji: '🍀', baseCost: 80, growth: 1.75, max: 20, unlockLevel: 3,
    effect: (l) => `${Math.round(l * CRIT_STEP * 100)} % de récolte double`,
  },
  {
    id: 'sprinkler', name: 'Arroseur', emoji: '💧', baseCost: 150, growth: 1, max: 1, unlockLevel: 3,
    effect: (l) => (l > 0 ? 'Replante tout seul après la récolte' : 'Replantation automatique'),
  },
  {
    id: 'hen', name: 'Poule récolteuse', emoji: '🐔', baseCost: 250, growth: 1.9, max: 20, unlockLevel: 5,
    effect: (l) => (l > 0 ? `Récolte un champ toutes les ${(henIntervalMs(l) / 1000).toFixed(1)} s` : 'Récolte automatique'),
  },
  {
    id: 'barn', name: 'Grange', emoji: '🛖', baseCost: 500, growth: 2.1, max: 7, unlockLevel: 7,
    effect: (l) => `Gains hors ligne : ${Math.round(offlineEfficiency(l) * 100)} %`,
  },
];

export const UPGRADE_BY_ID: ReadonlyMap<UpgradeId, UpgradeDef> = new Map(UPGRADES.map((u) => [u.id, u]));

export const FERTILIZER_STEP = 0.94;
export const MARKET_STEP = 1.12;
export const CRIT_STEP = 0.03;
export const GOLDEN_SEED_BONUS = 0.1;

export const START_PLOTS = 4;
export const MAX_PLOTS = 20;
export const PRESTIGE_LEVEL = 15;
export const OFFLINE_CAP_MS = 8 * 3600_000;
export const COMBO_WINDOW_MS = 700;
export const COMBO_STEP = 0.02;
export const COMBO_MAX = 25;

export function henIntervalMs(level: number): number {
  return 4_000 * 0.85 ** Math.max(0, level - 1);
}

export function offlineEfficiency(barnLevel: number): number {
  return 0.25 + 0.1 * barnLevel;
}
