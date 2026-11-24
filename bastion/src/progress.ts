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
  { id: 'bench', name: 'Réparer l’établi', icon: '🔧', ...L.pads.bench, site: L.bench, cost: { coins: 80, log: 8 }, after: 7 },
  { id: 'sawmill', name: 'Remettre la scierie en marche', icon: '🪚', ...L.pads.sawmill, site: L.sawmill, cost: { coins: 180, log: 12 }, after: 8 },
  { id: 'tower', name: 'Relever la tour de guet', icon: '🗼', ...L.pads.tower, site: L.tower, cost: { coins: 400, plank: 10, scrap: 6 }, after: 11 },
  { id: 'bed3', name: 'Réparer le potager', icon: '🍅', ...L.pads.bed3, site: L.beds[2]!, cost: { coins: 300, plank: 6 }, after: 12 },
  { id: 'kitchen', name: 'Remettre la cuisine en état', icon: '🍲', ...L.pads.kitchen, site: L.kitchen, cost: { coins: 550, plank: 12, scrap: 8 }, after: 13 },
  { id: 'shelter', name: 'Retaper l’abri', icon: '🏠', ...L.pads.shelter, site: L.shelter, cost: { coins: 750, plank: 18 }, after: 15 },
  { id: 'farmer', name: 'Fermière', icon: '👩‍🌾', ...L.pads.farmer, cost: { coins: 800, soup: 6 }, after: 16 },
  { id: 'lumber', name: 'Bûcheron', icon: '🧔', ...L.pads.lumber, cost: { coins: 1100, soup: 8 }, after: 18 },
  // Automatisation : facultatifs, ils apparaissent quand la reserve se remplit.
  { id: 'cashier', name: 'Caissière', icon: '👩‍💼', x: 0.6, z: 7.0, cost: { coins: 1500, soup: 10 }, after: 17 },
  { id: 'porter', name: 'Porteur', icon: '🧑‍🌾', x: 1.2, z: -5.4, cost: { coins: 2400, soup: 12 }, after: 19 },
  // ---- la ferme
  { id: 'westRoad', name: 'Dégager l’entrée de la ferme', icon: '🚜', ...L.pads.westRoad, site: L.farmGate, cost: { coins: 2000, plank: 16, scrap: 8 }, after: 19 },
  { id: 'field1', name: 'Remettre un champ en culture', icon: '🌾', ...L.pads.field1, site: L.fields[0]!, cost: { coins: 2000, plank: 10 }, after: 20 },
  { id: 'mill', name: 'Restaurer le moulin', icon: '🍞', ...L.pads.mill, site: L.mill, cost: { coins: 3200, plank: 30, scrap: 15 }, after: 22 },
  { id: 'field2', name: 'Remettre un champ en culture', icon: '🌾', ...L.pads.field2, site: L.fields[1]!, cost: { coins: 2800, plank: 14 }, after: 24 },
  // ---- l'etang
  { id: 'dock', name: 'Réparer le ponton', icon: '🎣', ...L.pads.dock, site: L.dock, cost: { coins: 4000, plank: 24 }, after: 25 },
  { id: 'fisher', name: 'Pêcheur', icon: '🧑‍🦰', ...L.pads.fisher, cost: { coins: 5000, bread: 10 }, after: 28 },
  // ---- la station
  { id: 'eastRoad', name: 'Dégager la route de l’est', icon: '⛽', ...L.pads.eastRoad, site: L.stationGate, cost: { coins: 6800, plank: 10, scrap: 25 }, after: 29 },
  { id: 'scav', name: 'Ferrailleur', icon: '🧑‍🔧', ...L.pads.scav, cost: { coins: 8500, bread: 12, fish: 10 }, after: 32 },
  // ---- la fin
  { id: 'bed4', name: 'Réparer le potager', icon: '🍅', ...L.pads.bed4, site: L.beds[3]!, cost: { coins: 7800, plank: 12 }, after: 33 },
  { id: 'field3', name: 'Remettre un champ en culture', icon: '🌾', ...L.pads.field3, site: L.fields[2]!, cost: { coins: 9000, plank: 18 }, after: 34 },
  // ---- materiaux : pierre et metal
  { id: 'quarry', name: 'Ouvrir la carrière', icon: '⛏️', ...L.pads.quarry, site: L.quarryShed, cost: { coins: 11000, plank: 30, scrap: 10 }, after: 35 },
  { id: 'foundry', name: 'Restaurer la fonderie', icon: '🔥', ...L.pads.foundry, site: L.foundry, cost: { coins: 8500, stone: 60, scrap: 30 }, after: 38 },
  { id: 'bus1', name: 'Bus : moteur', icon: '🔧', ...L.busPad, site: L.bus, cost: { coins: 13500, scrap: 40, metal: 10 }, after: 42 },
  { id: 'bus2', name: 'Bus : carrosserie', icon: '🚌', ...L.busPad, site: L.bus, cost: { coins: 18000, plank: 50, stone: 40, scrap: 20 }, after: 43 },
  { id: 'bus3', name: 'Bus : plein et provisions', icon: '⛽', ...L.busPad, site: L.bus, cost: { coins: 20000, fuel: 20, metal: 20, bread: 20, fish: 20 }, after: 44 },
];

/** Objectif a partir duquel les nuits (et les hordes) commencent : apres la palissade. */
export const CYCLE_FROM = 7;

export type UpId = 'bag' | 'boots' | 'axe' | 'gun' | 'health' | 'wall';

export interface UpDef { id: UpId; name: string; icon: string; costs: number[]; effect: (lvl: number) => string }

export const UPGRADES: UpDef[] = [
  { id: 'bag', name: 'Grand sac', icon: '🎒', costs: [60, 300, 1200, 3500, 9000], effect: (l) => `Porte ${8 + 4 * l} objets` },
  { id: 'boots', name: 'Bottes', icon: '🥾', costs: [150, 900, 3500], effect: (l) => `Vitesse +${12 * l} %` },
  { id: 'axe', name: 'Hache affûtée', icon: '🪓', costs: [120, 600, 2500], effect: (l) => `${3 + l} rondins par arbre, coups plus rapides` },
  { id: 'gun', name: 'Fusil', icon: '🔫', costs: [200, 900, 3000, 8000], effect: (l) => `Dégâts ×${1 + l}, portée ${10 + l} m` },
  { id: 'health', name: 'Trousse de soins', icon: '❤️', costs: [180, 900, 3500], effect: (l) => `${100 + 30 * l} points de vie` },
  { id: 'wall', name: 'Palissade renforcée', icon: '🛡️', costs: [5500, 11000, 20000], effect: (l) => `Murs ${100 + 50 * l} % de solidité` },
];

export interface Stats {
  harvested: number; shelved: number; cashed: number; logs: number; planks: number; scrap: number;
  sold: number; earned: number; kills: number; nights: number; repairs: number;
  soup: number; chest: number; wheat: number; bread: number; fish: number; fuel: number;
  stone: number; metal: number;
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
  /** Batiments demolis par les zombies, a reparer. */
  broken: string[];
  /** Ce qui a deja ete paye pour chaque reparation. */
  fixPaid: Record<string, Cost>;
  /** Niveau du camp (tours d'angle, portes renforcees). */
  campLv: number;
  // ---- armes, tenues, evenements, histoire
  weapons: string[];
  weapon: string;
  outfits: string[];
  outfit: string;
  /** Date (ms) a laquelle chaque cache est de nouveau pleine. */
  caches: Record<string, number>;
  rescued: number;
  radio: number[];
  /** Materiau de la palissade : 1 bois simple, 2 pieux, 3 pierre, 4 ferraille, 5 fer fondu. */
  wallTier: number;
  /** Niveau de construction des batiments : 1 bois, 2 pierre, 3 metal. */
  bt: Record<string, number>;
  /** Ce qui traine dans le camp : sac, reserve, bacs de l'etal, caisse, machines. */
  stock?: Stock;
  /** Jour de la victoire : ensuite, la menace monte encore doucement. */
  wonDay: number;
  /** Temps de jeu (s) a chaque objectif atteint : pour mesurer le rythme. */
  objT: number[];
  // ---- monetisation (equitable : plafonds par jour, rien d'obligatoire)
  /** Pubs regardees aujourd'hui, par emplacement. */
  ads: { key: string; n: Record<string, number> };
  /** Calendrier de connexion : case atteinte (0..6) et dernier jour reclame. */
  login: { step: number; last: string; total: number };
  /** Jour ou le bonus « 3 quetes » a ete pris. */
  questBonus: string;
  /** Contrats de la Ville : ameliorations permanentes payees en gemmes. */
  contracts: Record<string, number>;
  /** Le premier achat de gemmes est double : deja utilise ? */
  firstBuy: boolean;
  /** Ravitaillement mensuel : fin (ms) et dernier jour reclame. */
  monthly: { until: number; last: string };
  /** Horloge la plus avancee vue : un retour en arriere ne redonne rien. */
  clockHigh: number;
  /** Gains hors ligne pas encore encaisses (gardes si l'appli est fermee avant). */
  pendingOffline?: OfflineReport;
  /** Offres et jalons deja vus ou recompenses. */
  seen: string[];
  // ---- apres la victoire : convois vers la Ville
  convoys: number;
  /** Retour du convoi en cours (ms), 0 sinon. */
  convoyAt: number;
  /** Renommee : +3 % sur les ventes par point (max 20). */
  renown: number;
  // ---- la ferme fortifiee
  /** Palissade de la ferme : 0 aucune (cloture de bois), 1 pieux tailles, 2 pierre. */
  farmLv: number;
  /** Points de vie de chaque troncon de la palissade de la ferme. */
  farmWalls?: number[];
}

export interface Stock {
  bag: ItemType[];
  reserve: Partial<Record<ItemType, number>>;
  bins: Partial<Record<ItemType, number>>;
  cash: number;
  conv: Record<string, [ItemType[], ItemType[]]>;
}

export interface OfflineReport {
  /** Secondes comptees (apres plafond). */
  secs: number;
  /** Secondes reelles d'absence. */
  away: number;
  coins: number;
  /** Objets ranges dans la reserve. */
  items: Partial<Record<ItemType, number>>;
  /** Usure de la palissade (points de vie perdus, jamais de breche). */
  wear: number;
  nights: number;
  /** Conseil : ce qui a limite la production. */
  tip: string;
  /** Rendement applique (0..1). */
  eff: number;
}

/** Nouvelle cle : la vallee est un nouveau niveau, l'ancienne partie du camp n'est pas reprise. */
const KEY = 'dernier-bastion.vallee.v1';

export function freshSave(): Save {
  return {
    v: 5, coins: 0, built: [], paid: {}, up: { bag: 0, boots: 0, axe: 0, gun: 0, health: 0, wall: 0 },
    obj: 0, day: 1, phase: 'day', phaseT: 0, cycle: false, won: false,
    stats: { harvested: 0, shelved: 0, cashed: 0, logs: 0, planks: 0, scrap: 0, sold: 0, earned: 0, kills: 0, nights: 0, repairs: 0,
      soup: 0, chest: 0, wheat: 0, bread: 0, fish: 0, fuel: 0, stone: 0, metal: 0 },
    playTime: 0, lastSeen: Date.now(), muted: false,
    gems: 0, owned: [], lv: {}, boosts: {}, chestAt: 0, quests: { key: '', list: [] }, gemAds: { key: '', n: 0 },
    broken: [], fixPaid: {}, campLv: 1,
    weapons: ['rifle'], weapon: 'rifle', outfits: ['base'], outfit: 'base', caches: {}, rescued: 0, radio: [],
    wallTier: 1, bt: {}, wonDay: 0, objT: [],
    ads: { key: '', n: {} }, login: { step: 0, last: '', total: 0 }, questBonus: '', contracts: {}, firstBuy: false,
    monthly: { until: 0, last: '' }, clockHigh: Date.now(), seen: [], convoys: 0, convoyAt: 0, renown: 0,
    farmLv: 0,
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
      broken: Array.isArray(d.broken) ? d.broken : [],
      fixPaid: { ...(d.fixPaid ?? {}) },
      campLv: d.campLv ?? 1,
      weapons: Array.isArray(d.weapons) ? d.weapons : ['rifle'],
      outfits: Array.isArray(d.outfits) ? d.outfits : ['base'],
      caches: { ...(d.caches ?? {}) },
      radio: Array.isArray(d.radio) ? d.radio : [],
      bt: { ...(d.bt ?? {}) },
      objT: Array.isArray(d.objT) ? d.objT : [],
      ads: d.ads && typeof d.ads.n === 'object' ? d.ads : base.ads,
      login: { ...base.login, ...(d.login ?? {}) },
      contracts: { ...(d.contracts ?? {}) },
      monthly: { ...base.monthly, ...(d.monthly ?? {}) },
      seen: Array.isArray(d.seen) ? d.seen : [],
      clockHigh: typeof d.clockHigh === 'number' ? d.clockHigh : Date.now(),
      farmLv: typeof d.farmLv === 'number' ? Math.max(0, Math.min(2, Math.floor(d.farmLv))) : 0,
      farmWalls: Array.isArray(d.farmWalls) ? d.farmWalls : undefined,
      // Les parties d'avant les materiaux avaient deja des pieux taillés.
      wallTier: d.wallTier ?? ((d.v ?? 3) < 4 ? 2 : 1),
    };
    // Version 4 : trois objectifs « agrandir le camp » inseres (avant le pecheur, le ferrailleur, le bus).
    if ((d.v ?? 3) < 5) {
      const o = s.obj + ((d.v ?? 3) < 4 && s.obj >= 33 ? 5 : 0);
      s.obj = o + (o >= 27 ? 1 : 0) + (o >= 30 ? 1 : 0) + (o >= 39 ? 1 : 0);
      s.v = 5;
    }
    // Version 3 : cinq objectifs (carriere, pierre, palissade, fonderie, metal) inseres avant la fin.
    // (v3 -> v4 deja comptee dans le calcul ci-dessus.)
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

/** Duree d'une nuit (secondes) : elle s'allonge un peu chaque soir. */
export function nightLen(day: number): number {
  return Math.min(100, 50 + 6 * day);
}
/** Le jour dure quatre fois la nuit : le temps de produire, vendre, reparer. */
export function dayLen(day: number): number {
  return 4 * nightLen(day);
}
