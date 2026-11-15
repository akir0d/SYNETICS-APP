// Progression du camp n°1 : ce qu'on debloque, dans quel ordre, et la sauvegarde.

import type { ItemType } from './items';
import { L } from './layout';

export type Cost = { coins: number } & Partial<Record<ItemType, number>>;

export interface PadDef {
  id: string;
  name: string;
  icon: string;
  x: number;
  z: number;
  cost: Cost;
  /** Index de l'objectif a partir duquel la zone apparait. */
  after: number;
}

export const PADS: PadDef[] = [
  { id: 'bed2', name: 'Potager', icon: '🥕', ...L.beds[1]!, cost: { coins: 25 }, after: 3 },
  { id: 'gate', name: 'Porte nord', icon: '🚪', x: 0, z: -9.4, cost: { coins: 40 }, after: 4 },
  { id: 'bench', name: 'Établi', icon: '🔧', ...L.bench, cost: { coins: 60, log: 6 }, after: 6 },
  { id: 'sawmill', name: 'Scierie', icon: '🪚', ...L.sawmill, cost: { coins: 90, log: 10 }, after: 7 },
  { id: 'tower', name: 'Tour de guet', icon: '🗼', ...L.tower, cost: { coins: 150, plank: 8, scrap: 6 }, after: 10 },
  { id: 'bed3', name: 'Tomates', icon: '🍅', ...L.beds[2]!, cost: { coins: 120, plank: 4 }, after: 11 },
  { id: 'kitchen', name: 'Cuisine', icon: '🍲', ...L.kitchen, cost: { coins: 220, plank: 10, scrap: 6 }, after: 12 },
  { id: 'shelter', name: 'Abri des survivants', icon: '⛺', ...L.shelter, cost: { coins: 300, plank: 12 }, after: 13 },
  { id: 'bed4', name: 'Tomates', icon: '🍅', ...L.beds[3]!, cost: { coins: 260, plank: 6 }, after: 13 },
  { id: 'farmer', name: 'Fermière', icon: '👩‍🌾', x: 6.6, z: -2.2, cost: { coins: 250 }, after: 14 },
  { id: 'lumber', name: 'Bûcheron', icon: '🧔', x: 6.6, z: -5.4, cost: { coins: 300 }, after: 14 },
  { id: 'bus1', name: 'Bus : moteur', icon: '🔧', ...L.busPad, cost: { coins: 400, scrap: 20 }, after: 16 },
  { id: 'bus2', name: 'Bus : carrosserie', icon: '🚌', ...L.busPad, cost: { coins: 600, plank: 25, scrap: 10 }, after: 17 },
  { id: 'bus3', name: 'Bus : carburant', icon: '⛽', ...L.busPad, cost: { coins: 900 }, after: 18 },
];

export type UpId = 'bag' | 'boots' | 'axe' | 'gun' | 'health';

export interface UpDef { id: UpId; name: string; icon: string; costs: number[]; effect: (lvl: number) => string }

export const UPGRADES: UpDef[] = [
  { id: 'bag', name: 'Grand sac', icon: '🎒', costs: [40, 110, 240, 480], effect: (l) => `Porte ${8 + 4 * l} objets` },
  { id: 'boots', name: 'Bottes', icon: '🥾', costs: [60, 160, 360], effect: (l) => `Vitesse +${12 * l} %` },
  { id: 'axe', name: 'Hache affûtée', icon: '🪓', costs: [50, 150, 350], effect: (l) => `${3 + l} rondins par arbre, coups plus rapides` },
  { id: 'gun', name: 'Fusil', icon: '🔫', costs: [80, 200, 420, 800], effect: (l) => `Dégâts ×${1 + l}, portée ${10 + l} m` },
  { id: 'health', name: 'Trousse de soins', icon: '❤️', costs: [70, 180, 400], effect: (l) => `${100 + 30 * l} points de vie` },
];

export interface Stats {
  harvested: number; shelved: number; cashed: number; logs: number; planks: number; scrap: number;
  sold: number; earned: number; kills: number; nights: number;
}

export interface Save {
  v: 1;
  coins: number;
  built: string[];
  paid: Record<string, Cost>;
  up: Record<UpId, number>;
  obj: number;
  day: number;
  phase: 'day' | 'night';
  phaseT: number;
  cycle: boolean;
  won: boolean;
  stats: Stats;
  playTime: number;
  lastSeen: number;
  muted: boolean;
}

const KEY = 'dernier-bastion.camp1.v1';

export function freshSave(): Save {
  return {
    v: 1, coins: 0, built: [], paid: {}, up: { bag: 0, boots: 0, axe: 0, gun: 0, health: 0 },
    obj: 0, day: 1, phase: 'day', phaseT: 0, cycle: false, won: false,
    stats: { harvested: 0, shelved: 0, cashed: 0, logs: 0, planks: 0, scrap: 0, sold: 0, earned: 0, kills: 0, nights: 0 },
    playTime: 0, lastSeen: Date.now(), muted: false,
  };
}

export function loadSave(): Save {
  const base = freshSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const d = JSON.parse(raw) as Partial<Save>;
    return {
      ...base, ...d,
      up: { ...base.up, ...(d.up ?? {}) },
      stats: { ...base.stats, ...(d.stats ?? {}) },
      paid: d.paid ?? {},
      built: Array.isArray(d.built) ? d.built : [],
    };
  } catch {
    return base;
  }
}

export function writeSave(s: Save): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
}

export function wipeSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* rien */ }
}

export const DAY_LEN = 150;
export function nightLen(day: number): number {
  return Math.min(110, 60 + 8 * day);
}
