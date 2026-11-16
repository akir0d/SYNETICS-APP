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
  // ---- le camp
  { id: 'bed2', name: 'Réparer le potager', icon: '🥕', ...L.pads.bed2, site: L.beds[1]!, cost: { coins: 25 }, after: 3 },
  { id: 'gate', name: 'Dégager la porte nord', icon: '🚪', ...L.pads.gate, site: L.northGate, cost: { coins: 40 }, after: 4 },
  { id: 'bench', name: 'Réparer l’établi', icon: '🔧', ...L.pads.bench, site: L.bench, cost: { coins: 60, log: 6 }, after: 7 },
  { id: 'sawmill', name: 'Remettre la scierie en marche', icon: '🪚', ...L.pads.sawmill, site: L.sawmill, cost: { coins: 90, log: 10 }, after: 8 },
  { id: 'tower', name: 'Relever la tour de guet', icon: '🗼', ...L.pads.tower, site: L.tower, cost: { coins: 150, plank: 8, scrap: 6 }, after: 11 },
  { id: 'bed3', name: 'Réparer le potager', icon: '🍅', ...L.pads.bed3, site: L.beds[2]!, cost: { coins: 120, plank: 4 }, after: 12 },
  { id: 'kitchen', name: 'Remettre la cuisine en état', icon: '🍲', ...L.pads.kitchen, site: L.kitchen, cost: { coins: 220, plank: 10, scrap: 6 }, after: 13 },
  { id: 'shelter', name: 'Retaper l’abri', icon: '🏠', ...L.pads.shelter, site: L.shelter, cost: { coins: 300, plank: 12 }, after: 15 },
  { id: 'farmer', name: 'Fermière', icon: '👩‍🌾', ...L.pads.farmer, cost: { coins: 250 }, after: 16 },
  { id: 'lumber', name: 'Bûcheron', icon: '🧔', ...L.pads.lumber, cost: { coins: 300 }, after: 18 },
  // ---- la ferme
  { id: 'westRoad', name: 'Dégager l’entrée de la ferme', icon: '🚜', ...L.pads.westRoad, site: L.farmGate, cost: { coins: 350, plank: 10 }, after: 19 },
  { id: 'field1', name: 'Remettre un champ en culture', icon: '🌾', ...L.pads.field1, site: L.fields[0]!, cost: { coins: 150, plank: 6 }, after: 20 },
  { id: 'mill', name: 'Restaurer le moulin', icon: '🍞', ...L.pads.mill, site: L.mill, cost: { coins: 450, plank: 20, scrap: 10 }, after: 22 },
  { id: 'field2', name: 'Remettre un champ en culture', icon: '🌾', ...L.pads.field2, site: L.fields[1]!, cost: { coins: 260, plank: 8 }, after: 24 },
  // ---- l'etang
  { id: 'dock', name: 'Réparer le ponton', icon: '🎣', ...L.pads.dock, site: L.dock, cost: { coins: 320, plank: 15 }, after: 25 },
  { id: 'fisher', name: 'Pêcheur', icon: '🧑‍🦰', ...L.pads.fisher, cost: { coins: 450 }, after: 27 },
  // ---- la station
  { id: 'eastRoad', name: 'Dégager la route de l’est', icon: '⛽', ...L.pads.eastRoad, site: L.stationGate, cost: { coins: 500, scrap: 15 }, after: 28 },
  { id: 'scav', name: 'Ferrailleur', icon: '🧑‍🔧', ...L.pads.scav, cost: { coins: 550 }, after: 30 },
  // ---- la fin
  { id: 'bed4', name: 'Réparer le potager', icon: '🍅', ...L.pads.bed4, site: L.beds[3]!, cost: { coins: 260, plank: 6 }, after: 31 },
  { id: 'field3', name: 'Remettre un champ en culture', icon: '🌾', ...L.pads.field3, site: L.fields[2]!, cost: { coins: 420, plank: 10 }, after: 32 },
  { id: 'bus1', name: 'Bus : moteur', icon: '🔧', ...L.busPad, site: L.bus, cost: { coins: 900, scrap: 30 }, after: 34 },
  { id: 'bus2', name: 'Bus : carrosserie', icon: '🚌', ...L.busPad, site: L.bus, cost: { coins: 1400, plank: 30, scrap: 15 }, after: 35 },
  { id: 'bus3', name: 'Bus : carburant', icon: '⛽', ...L.busPad, site: L.bus, cost: { coins: 2200, fuel: 12 }, after: 36 },
];

/** Objectif a partir duquel les nuits (et les hordes) commencent : apres la palissade. */
export const CYCLE_FROM = 7;

export type UpId = 'bag' | 'boots' | 'axe' | 'gun' | 'health' | 'wall';

export interface UpDef { id: UpId; name: string; icon: string; costs: number[]; effect: (lvl: number) => string }

export const UPGRADES: UpDef[] = [
  { id: 'bag', name: 'Grand sac', icon: '🎒', costs: [40, 110, 240, 480], effect: (l) => `Porte ${8 + 4 * l} objets` },
  { id: 'boots', name: 'Bottes', icon: '🥾', costs: [60, 160, 360], effect: (l) => `Vitesse +${12 * l} %` },
  { id: 'axe', name: 'Hache affûtée', icon: '🪓', costs: [50, 150, 350], effect: (l) => `${3 + l} rondins par arbre, coups plus rapides` },
  { id: 'gun', name: 'Fusil', icon: '🔫', costs: [80, 200, 420, 800], effect: (l) => `Dégâts ×${1 + l}, portée ${10 + l} m` },
  { id: 'health', name: 'Trousse de soins', icon: '❤️', costs: [70, 180, 400], effect: (l) => `${100 + 30 * l} points de vie` },
  { id: 'wall', name: 'Palissade renforcée', icon: '🛡️', costs: [180, 450, 1000], effect: (l) => `Murs ${100 + 50 * l} % de solidité` },
];

export interface Stats {
  harvested: number; shelved: number; cashed: number; logs: number; planks: number; scrap: number;
  sold: number; earned: number; kills: number; nights: number; repairs: number;
  soup: number; chest: number; wheat: number; bread: number; fish: number; fuel: number;
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
  // ---- meta et boutique
  gems: number;
  /** Achats uniques deja faits (sans pub, pack de depart). */
  owned: string[];
  /** Niveaux des batiments (meta.ts, LEVELS). */
  lv: Record<string, number>;
  /** Secondes restantes de chaque boost. */
  boosts: Record<string, number>;
  /** Date (ms) a partir de laquelle le coffre gratuit est pret. */
  chestAt: number;
  quests: { key: string; list: { id: string; base: number; goal: number; claimed: boolean }[] };
  gemAds: { key: string; n: number };
}

/** Nouvelle cle : la vallee est un nouveau niveau, l'ancienne partie du camp n'est pas reprise. */
const KEY = 'dernier-bastion.vallee.v1';

export function freshSave(): Save {
  return {
    v: 3, coins: 0, built: [], paid: {}, up: { bag: 0, boots: 0, axe: 0, gun: 0, health: 0, wall: 0 },
    obj: 0, day: 1, phase: 'day', phaseT: 0, cycle: false, won: false,
    stats: { harvested: 0, shelved: 0, cashed: 0, logs: 0, planks: 0, scrap: 0, sold: 0, earned: 0, kills: 0, nights: 0, repairs: 0,
      soup: 0, chest: 0, wheat: 0, bread: 0, fish: 0, fuel: 0 },
    playTime: 0, lastSeen: Date.now(), muted: false,
    gems: 0, owned: [], lv: {}, boosts: {}, chestAt: 0, quests: { key: '', list: [] }, gemAds: { key: '', n: 0 },
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
      owned: Array.isArray(d.owned) ? d.owned : [],
      lv: { ...(d.lv ?? {}) },
      boosts: { ...(d.boosts ?? {}) },
      quests: d.quests && Array.isArray(d.quests.list) ? d.quests : base.quests,
      gemAds: d.gemAds ?? base.gemAds,
    };
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
