import { CROP_BY_ID, MAX_PLOTS, START_PLOTS } from './data';
import { newGame, type GameState } from './state';

const KEY = 'graines-dor.save.v1';

export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

/** Relit une sauvegarde en completant ce qui manque : une partie ne doit jamais etre perdue. */
export function deserialize(raw: string | null, now: number): GameState {
  const base = newGame(now);
  if (!raw) return base;
  let data: Partial<GameState>;
  try {
    data = JSON.parse(raw) as Partial<GameState>;
  } catch {
    return base;
  }
  if (!data || typeof data !== 'object') return base;

  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const s: GameState = {
    ...base,
    coins: num(data.coins, 0),
    xp: num(data.xp, 0),
    level: Math.max(1, Math.floor(num(data.level, 1))),
    goldenSeeds: num(data.goldenSeeds, 0),
    selectedCrop: typeof data.selectedCrop === 'string' && CROP_BY_ID.has(data.selectedCrop) ? data.selectedCrop : 'carrot',
    upgrades: { ...base.upgrades, ...(data.upgrades ?? {}) },
    orders: Array.isArray(data.orders) ? data.orders.filter((o) => CROP_BY_ID.has(o?.crop)) : [],
    nextOrderId: num(data.nextOrderId, 1),
    henClock: num(data.henClock, 0),
    seasonCoins: num(data.seasonCoins, 0),
    season: num(data.season, 1),
    lastSeen: num(data.lastSeen, now),
    stats: { ...base.stats, ...(data.stats ?? {}) },
    settings: { ...base.settings, ...(data.settings ?? {}) },
  };
  if (Array.isArray(data.plots) && data.plots.length >= START_PLOTS) {
    s.plots = data.plots.slice(0, MAX_PLOTS).map((p) => ({
      crop: p && typeof p.crop === 'string' && CROP_BY_ID.has(p.crop) ? p.crop : null,
      plantedAt: num(p?.plantedAt, 0),
      growMs: num(p?.growMs, 0),
    }));
  }
  return s;
}

export function loadGame(now: number): GameState {
  try {
    return deserialize(localStorage.getItem(KEY), now);
  } catch {
    return newGame(now);
  }
}

export function saveGame(s: GameState): void {
  try {
    localStorage.setItem(KEY, serialize(s));
  } catch {
    // Stockage indisponible (navigation privee) : la partie continue sans sauvegarde.
  }
}

export function wipeSave(): void {
  try { localStorage.removeItem(KEY); } catch { /* rien */ }
}
