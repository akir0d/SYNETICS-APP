// Progression du camp n°1 : ce qu'on debloque, dans quel ordre, et la sauvegarde.

import type { ItemType } from './items';
import { L } from './layout';

export type Cost = { coins: number } & Partial<Record<ItemType, number>>;

export interface PadDef {
  id: string;
  name: string;
  icon: string;
  /** Ou se tenir pour payer. */
  x: number;
  z: number;
  /** Le chantier lui-meme, s'il est ailleurs que la zone (effets, guidage). */
  site?: { x: number; z: number };
  cost: Cost;
  /** Index de l'objectif a partir duquel la zone apparait. */
  after: number;
}

export const PADS: PadDef[] = [
  { id: 'bed2', name: 'Réparer le potager', icon: '🥕', ...L.pads.bed2, site: L.beds[1]!, cost: { coins: 25 }, after: 3 },
  { id: 'gate', name: 'Dégager la porte nord', icon: '🚪', ...L.pads.gate, site: L.northGate, cost: { coins: 40 }, after: 4 },
  { id: 'bench', name: 'Réparer l’établi', icon: '🔧', ...L.pads.bench, site: L.bench, cost: { coins: 60, log: 6 }, after: 7 },
  { id: 'sawmill', name: 'Remettre la scierie en marche', icon: '🪚', ...L.pads.sawmill, site: L.sawmill, cost: { coins: 90, log: 10 }, after: 8 },
  { id: 'tower', name: 'Relever la tour de guet', icon: '🗼', ...L.pads.tower, site: L.tower, cost: { coins: 150, plank: 8, scrap: 6 }, after: 11 },
  { id: 'bed3', name: 'Réparer le potager', icon: '🍅', ...L.pads.bed3, site: L.beds[2]!, cost: { coins: 120, plank: 4 }, after: 12 },
  { id: 'kitchen', name: 'Remettre la cuisine en état', icon: '🍲', ...L.pads.kitchen, site: L.kitchen, cost: { coins: 220, plank: 10, scrap: 6 }, after: 13 },
  { id: 'shelter', name: 'Retaper l’abri', icon: '🏠', ...L.pads.shelter, site: L.shelter, cost: { coins: 300, plank: 12 }, after: 14 },
  { id: 'bed4', name: 'Réparer le potager', icon: '🍅', ...L.pads.bed4, site: L.beds[3]!, cost: { coins: 260, plank: 6 }, after: 14 },
  { id: 'farmer', name: 'Fermière', icon: '👩‍🌾', x: 6.6, z: -2.2, cost: { coins: 250 }, after: 15 },
  { id: 'lumber', name: 'Bûcheron', icon: '🧔', x: 6.6, z: -5.4, cost: { coins: 300 }, after: 15 },
  { id: 'bus1', name: 'Bus : moteur', icon: '🔧', ...L.busPad, site: L.bus, cost: { coins: 400, scrap: 20 }, after: 17 },
  { id: 'bus2', name: 'Bus : carrosserie', icon: '🚌', ...L.busPad, site: L.bus, cost: { coins: 600, plank: 25, scrap: 10 }, after: 18 },
  { id: 'bus3', name: 'Bus : carburant', icon: '⛽', ...L.busPad, site: L.bus, cost: { coins: 900 }, after: 19 },
];

/** Objectif a partir duquel les nuits (et les hordes) commencent : apres la palissade. */
export const CYCLE_FROM = 7;

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
  sold: number; earned: number; kills: number; nights: number; repairs: number;
}

export interface Save {
  /** 2 : objectif « palissade » insere en 6e position, palissade sauvegardee. */
  v: number;
  /** Points de vie de chaque troncon de palissade (absent : etat de depart). */
  walls?: number[];
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
    v: 2, coins: 0, built: [], paid: {}, up: { bag: 0, boots: 0, axe: 0, gun: 0, health: 0 },
    obj: 0, day: 1, phase: 'day', phaseT: 0, cycle: false, won: false,
    stats: { harvested: 0, shelved: 0, cashed: 0, logs: 0, planks: 0, scrap: 0, sold: 0, earned: 0, kills: 0, nights: 0, repairs: 0 },
    playTime: 0, lastSeen: Date.now(), muted: false,
  };
}

export function loadSave(): Save {
  const base = freshSave();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const d = JSON.parse(raw) as Partial<Save>;
    const s: Save = {
      ...base, ...d,
      up: { ...base.up, ...(d.up ?? {}) },
      stats: { ...base.stats, ...(d.stats ?? {}) },
      paid: d.paid ?? {},
      built: Array.isArray(d.built) ? d.built : [],
      walls: Array.isArray(d.walls) ? d.walls : undefined,
    };
    // Version 1 : l'objectif « palissade » n'existait pas, les suivants sont decales.
    if ((d.v ?? 1) < 2) {
      if (s.obj >= 7) s.obj++;
      s.v = 2;
    }
    return s;
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
