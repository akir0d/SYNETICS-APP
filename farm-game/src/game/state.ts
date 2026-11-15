// Moteur du jeu : etat, regles et economie. Aucun acces au DOM ici,
// tout est testable avec une horloge et un tirage aleatoire injectes.

import {
  COMBO_MAX, COMBO_STEP, CRIT_STEP, CROPS, FERTILIZER_STEP, GOLDEN_SEED_BONUS,
  MARKET_STEP, MAX_PLOTS, OFFLINE_CAP_MS, PRESTIGE_LEVEL, START_PLOTS, UPGRADES, UPGRADE_BY_ID,
  crop, henIntervalMs, offlineEfficiency, type CropDef, type UpgradeId,
} from './data';

export interface Plot {
  /** Culture en terre, ou null si le champ est vide. */
  crop: string | null;
  plantedAt: number;
  /** Duree de pousse figee au moment de planter. */
  growMs: number;
}

export interface Order {
  id: number;
  crop: string;
  qty: number;
  progress: number;
  coins: number;
  xp: number;
}

export interface GameState {
  version: 1;
  coins: number;
  xp: number;
  level: number;
  goldenSeeds: number;
  selectedCrop: string;
  plots: Plot[];
  upgrades: Record<UpgradeId, number>;
  orders: Order[];
  nextOrderId: number;
  henClock: number;
  /** Pieces gagnees depuis le debut de la saison (sert au calcul des graines d'or). */
  seasonCoins: number;
  season: number;
  lastSeen: number;
  stats: { harvests: number; totalCoins: number; bestCombo: number };
  settings: { sound: boolean; haptics: boolean };
}

export interface Rng { (): number }

export function newGame(now: number, keep?: Pick<GameState, 'goldenSeeds' | 'season' | 'stats' | 'settings'>): GameState {
  const s: GameState = {
    version: 1,
    coins: 0,
    xp: 0,
    level: 1,
    goldenSeeds: keep?.goldenSeeds ?? 0,
    selectedCrop: 'carrot',
    plots: Array.from({ length: START_PLOTS }, () => ({ crop: null, plantedAt: 0, growMs: 0 })),
    upgrades: Object.fromEntries(UPGRADES.map((u) => [u.id, 0])) as Record<UpgradeId, number>,
    orders: [],
    nextOrderId: 1,
    henClock: 0,
    seasonCoins: 0,
    season: keep?.season ?? 1,
    lastSeen: now,
    stats: keep?.stats ?? { harvests: 0, totalCoins: 0, bestCombo: 0 },
    settings: keep?.settings ?? { sound: true, haptics: true },
  };
  return s;
}

// ---------------------------------------------------------------- formules

export function xpForLevel(level: number): number {
  return Math.floor(8 * 1.3 ** (level - 1));
}

export function sellMultiplier(s: GameState): number {
  return MARKET_STEP ** s.upgrades.market * (1 + GOLDEN_SEED_BONUS * s.goldenSeeds);
}

export function growMultiplier(s: GameState): number {
  return FERTILIZER_STEP ** s.upgrades.fertilizer;
}

export function critChance(s: GameState): number {
  return Math.min(0.9, s.upgrades.greenThumb * CRIT_STEP);
}

export function comboMultiplier(combo: number): number {
  return 1 + Math.min(combo, COMBO_MAX) * COMBO_STEP;
}

export function upgradeCost(id: UpgradeId, level: number): number {
  const u = UPGRADE_BY_ID.get(id)!;
  return Math.floor(u.baseCost * u.growth ** level);
}

export function plotCost(owned: number): number {
  return Math.floor(12 * 1.75 ** (owned - START_PLOTS));
}

export function levelUpReward(level: number): number {
  return Math.floor(15 * 1.38 ** level);
}

export function unlockedCrops(s: GameState): CropDef[] {
  return CROPS.filter((c) => c.unlockLevel <= s.level);
}

export function cropsUnlockedAt(level: number): CropDef[] {
  return CROPS.filter((c) => c.unlockLevel === level);
}

export function plotProgress(p: Plot, now: number): number {
  if (!p.crop) return 0;
  if (p.growMs <= 0) return 1;
  return Math.min(1, Math.max(0, (now - p.plantedAt) / p.growMs));
}

export function isRipe(p: Plot, now: number): boolean {
  return p.crop !== null && plotProgress(p, now) >= 1;
}

// ---------------------------------------------------------------- actions

export function plant(s: GameState, index: number, now: number, cropId = s.selectedCrop): boolean {
  const p = s.plots[index];
  if (!p || p.crop) return false;
  const c = crop(cropId);
  if (c.unlockLevel > s.level) return false;
  p.crop = c.id;
  p.plantedAt = now;
  p.growMs = Math.round(c.growMs * growMultiplier(s));
  return true;
}

/** Un tapotement sur un champ qui pousse le fait avancer un peu. */
export function boost(s: GameState, index: number, now: number): boolean {
  const p = s.plots[index];
  if (!p || !p.crop || isRipe(p, now)) return false;
  const remaining = p.plantedAt + p.growMs - now;
  p.plantedAt -= Math.min(remaining, 500 + p.growMs * 0.02);
  return true;
}

export interface HarvestResult {
  index: number;
  crop: CropDef;
  coins: number;
  xp: number;
  crit: boolean;
  levelsGained: number[];
  ordersFilled: number[];
}

export function harvest(
  s: GameState, index: number, now: number, rng: Rng, combo = 0,
): HarvestResult | null {
  const p = s.plots[index];
  if (!p || !isRipe(p, now)) return null;
  const c = crop(p.crop!);
  const crit = rng() < critChance(s);
  const mult = (crit ? 2 : 1) * sellMultiplier(s) * comboMultiplier(combo);
  const coins = Math.max(1, Math.round(c.value * mult));
  const xp = c.xp * (crit ? 2 : 1);

  p.crop = null;
  addCoins(s, coins);
  s.stats.harvests += 1;
  const ordersFilled = progressOrders(s, c.id, crit ? 2 : 1);
  const levelsGained = addXp(s, xp);

  if (s.upgrades.sprinkler > 0) plant(s, index, now, c.id);
  return { index, crop: c, coins, xp, crit, levelsGained, ordersFilled };
}

export function addCoins(s: GameState, n: number): void {
  s.coins += n;
  s.seasonCoins += n;
  s.stats.totalCoins += n;
}

/** Ajoute de l'XP et renvoie la liste des niveaux atteints. */
export function addXp(s: GameState, n: number): number[] {
  s.xp += n;
  const gained: number[] = [];
  while (s.xp >= xpForLevel(s.level)) {
    s.xp -= xpForLevel(s.level);
    s.level += 1;
    gained.push(s.level);
    addCoins(s, levelUpReward(s.level));
  }
  if (gained.length) fillOrders(s, Math.random);
  return gained;
}

export function buyUpgrade(s: GameState, id: UpgradeId): boolean {
  const u = UPGRADE_BY_ID.get(id)!;
  const lvl = s.upgrades[id];
  if (lvl >= u.max || s.level < u.unlockLevel) return false;
  const cost = upgradeCost(id, lvl);
  if (s.coins < cost) return false;
  s.coins -= cost;
  s.upgrades[id] = lvl + 1;
  return true;
}

export function buyPlot(s: GameState): boolean {
  if (s.plots.length >= MAX_PLOTS) return false;
  const cost = plotCost(s.plots.length);
  if (s.coins < cost) return false;
  s.coins -= cost;
  s.plots.push({ crop: null, plantedAt: 0, growMs: 0 });
  return true;
}

// ---------------------------------------------------------------- commandes

export const ORDER_SLOTS = 3;
export const ORDERS_UNLOCK = 2;

export function makeOrder(s: GameState, rng: Rng): Order {
  const pool = unlockedCrops(s);
  const taken = new Set(s.orders.map((o) => o.crop));
  // On favorise les cultures recentes (celles que le joueur fait pousser) et on
  // evite deux commandes identiques quand c'est possible.
  let pick = pool[0]!;
  for (let tries = 0; tries < 6; tries++) {
    pick = pool[Math.min(pool.length - 1, Math.floor(pool.length * (0.3 + 0.7 * rng())))]!;
    if (!taken.has(pick.id) || taken.size >= pool.length) break;
  }
  const qty = Math.min(30, Math.max(3, Math.round(30_000 / pick.growMs + 3 + rng() * 5)));
  return {
    id: s.nextOrderId++,
    crop: pick.id,
    qty,
    progress: 0,
    coins: Math.round(pick.value * qty * 2.5 * sellMultiplier(s)),
    xp: Math.round(pick.xp * qty * 1.5),
  };
}

export function fillOrders(s: GameState, rng: Rng): void {
  if (s.level < ORDERS_UNLOCK) return;
  while (s.orders.length < ORDER_SLOTS) s.orders.push(makeOrder(s, rng));
}

function progressOrders(s: GameState, cropId: string, n: number): number[] {
  const done: number[] = [];
  for (const o of s.orders) {
    if (o.crop !== cropId || o.progress >= o.qty) continue;
    o.progress = Math.min(o.qty, o.progress + n);
    if (o.progress >= o.qty) done.push(o.id);
  }
  return done;
}

export function claimOrder(s: GameState, id: number, rng: Rng): { coins: number; xp: number; levelsGained: number[] } | null {
  const i = s.orders.findIndex((o) => o.id === id);
  const o = s.orders[i];
  if (!o || o.progress < o.qty) return null;
  s.orders.splice(i, 1);
  addCoins(s, o.coins);
  const levelsGained = addXp(s, o.xp);
  fillOrders(s, rng);
  return { coins: o.coins, xp: o.xp, levelsGained };
}

export function discardOrder(s: GameState, id: number, rng: Rng): void {
  const i = s.orders.findIndex((o) => o.id === id);
  if (i < 0) return;
  s.orders.splice(i, 1, makeOrder(s, rng));
}

// ---------------------------------------------------------------- automatisme

/**
 * Fait avancer la poule recolteuse de `dt` ms et renvoie les champs qu'elle a
 * recoltes. Elle prend toujours le champ mur depuis le plus longtemps.
 */
export function tickHen(s: GameState, now: number, dt: number, rng: Rng): HarvestResult[] {
  const lvl = s.upgrades.hen;
  if (lvl <= 0) return [];
  const interval = henIntervalMs(lvl);
  s.henClock = Math.min(s.henClock + dt, interval * 3);
  const out: HarvestResult[] = [];
  while (s.henClock >= interval) {
    let best = -1;
    let bestRipeAt = Infinity;
    s.plots.forEach((p, i) => {
      if (isRipe(p, now) && p.plantedAt + p.growMs < bestRipeAt) {
        best = i;
        bestRipeAt = p.plantedAt + p.growMs;
      }
    });
    if (best < 0) {
      // Rien a recolter : la poule attend, prete a bondir.
      s.henClock = interval;
      break;
    }
    s.henClock -= interval;
    const r = harvest(s, best, now, rng);
    if (r) out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- hors ligne

export interface OfflineGains { ms: number; coins: number; xp: number }

/**
 * Revenus par milliseconde quand la ferme tourne seule : production des champs,
 * plafonnee par le debit de la poule.
 */
export function idleRate(s: GameState): { coins: number; xp: number } {
  if (s.upgrades.hen <= 0 || s.upgrades.sprinkler <= 0) return { coins: 0, xp: 0 };
  const planted = s.plots.filter((p) => p.crop);
  if (!planted.length) return { coins: 0, xp: 0 };
  const critMult = 1 + critChance(s);
  const sell = sellMultiplier(s);
  let prodCoins = 0;
  let prodXp = 0;
  let sumCoins = 0;
  let sumXp = 0;
  for (const p of planted) {
    const c = crop(p.crop!);
    const growMs = Math.max(1, Math.round(c.growMs * growMultiplier(s)));
    const v = c.value * sell * critMult;
    const x = c.xp * critMult;
    prodCoins += v / growMs;
    prodXp += x / growMs;
    sumCoins += v;
    sumXp += x;
  }
  const harvestsPerMs = 1 / henIntervalMs(s.upgrades.hen);
  const henCoins = harvestsPerMs * (sumCoins / planted.length);
  const ratio = prodCoins > 0 ? Math.min(1, henCoins / prodCoins) : 0;
  return { coins: prodCoins * ratio, xp: prodXp * ratio };
}

export function computeOffline(s: GameState, now: number): OfflineGains {
  const ms = Math.min(OFFLINE_CAP_MS, Math.max(0, now - s.lastSeen));
  const rate = idleRate(s);
  const eff = offlineEfficiency(s.upgrades.barn);
  return { ms, coins: Math.floor(rate.coins * ms * eff), xp: Math.floor(rate.xp * ms * eff) };
}

export function applyOffline(s: GameState, gains: OfflineGains, now: number): number[] {
  addCoins(s, gains.coins);
  const levels = addXp(s, gains.xp);
  // Les champs ont continue a tourner : on les relance pour ne pas tout
  // recolter une seconde fois au retour.
  if (s.upgrades.hen > 0 && s.upgrades.sprinkler > 0 && gains.ms > 0) {
    s.plots.forEach((p) => { if (p.crop) p.plantedAt = now - Math.random() * p.growMs; });
  }
  s.lastSeen = now;
  return levels;
}

// ---------------------------------------------------------------- saisons

export function prestigeGain(s: GameState): number {
  if (s.level < PRESTIGE_LEVEL) return 0;
  return Math.floor(Math.sqrt(s.seasonCoins / 20_000));
}

export function prestige(s: GameState, now: number): GameState | null {
  const gain = prestigeGain(s);
  if (gain < 1) return null;
  return newGame(now, {
    goldenSeeds: s.goldenSeeds + gain,
    season: s.season + 1,
    stats: s.stats,
    settings: s.settings,
  });
}
