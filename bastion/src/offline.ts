// Ce que le camp produit pendant l'absence du joueur.
//
// Pas de forfait : on rejoue a gros traits la chaine du jeu. Les survivants recoltent (au
// rythme mesure en jeu), le porteur alimente les machines et l'etal, les clients achetent,
// la caissiere encaisse. Sans porteur, tout s'entasse dans la reserve ; sans caissiere, la
// caisse deborde vite. Le rendement reste une fraction du jeu actif : jouer rapporte toujours
// plus que s'absenter, mais revenir fait plaisir.

import { ITEMS, type ItemType } from './items';
import type { OfflineReport } from './progress';

/** Rythmes mesures en jeu (objets par seconde de travail). */
const RATE = { farmer: 0.55, lumber: 0.23, fisher: 0.15, scav: 0.11, porter: 0.65, customers: 1 };
/** Part de la journee ou l'on travaille et vend (la nuit, tout le monde est a l'abri). */
const DAY_SHARE = 0.8;

export interface OfflineInput {
  /** Secondes reelles d'absence. */
  away: number;
  /** Absence comptee au plus (secondes). */
  maxAway: number;
  /** Rendement de base (0..1) : contremaitre. */
  eff: number;
  jobs: Partial<Record<'farmer' | 'lumber' | 'fisher' | 'scav' | 'porter' | 'cashier', boolean>>;
  /** Abri debout : sinon personne ne travaille. */
  shelterOk: boolean;
  /** Part du ble dans ce que recolte la fermiere (champs / tous les carres). */
  wheatShare: number;
  conv: { saw: boolean; cook: boolean; mill: boolean; forge: boolean };
  /** Ce qui attend deja dans les bacs de l'etal (vendu en premier). */
  bins: Partial<Record<ItemType, number>>;
  /** Multiplicateur de vente (etal, reclame, renommee...). */
  sellMul: number;
  /** Vitesse des survivants (contrat). */
  crewMul: number;
  /** Ce que la caisse peut contenir sans caissiere. */
  cashCap: number;
  /** Places libres dans la reserve. */
  reserveRoom: number;
  /** Pieces gagnees au plus pendant une absence (quelques minutes de jeu actif). */
  coinCap: number;
  /** Objets ranges au plus dans la reserve pendant une absence. */
  itemCap: number;
  /** Duree d'un cycle jour + nuit (secondes), 0 si les nuits n'ont pas commence. */
  cycleLen: number;
}

/** Paliers : les premieres heures comptent pleinement, ensuite de moins en moins. */
function tiered(secs: number): number {
  const h = 3600;
  const a = Math.min(secs, 2 * h);
  const b = Math.min(Math.max(0, secs - 2 * h), 4 * h);
  const c = Math.max(0, secs - 6 * h);
  return a + 0.6 * b + 0.35 * c;
}

export interface OfflineResult extends OfflineReport {
  /** Objets vendus depuis les bacs (a retirer de l'etal). */
  binsSold: Partial<Record<ItemType, number>>;
}

export function simulateOffline(i: OfflineInput): OfflineResult {
  const secs = Math.min(i.away, i.maxAway);
  const work = tiered(secs) * i.eff * (i.cycleLen > 0 ? DAY_SHARE : 1);
  const crew = work * i.crewMul;
  const items: Partial<Record<ItemType, number>> = {};
  const add = (t: ItemType, n: number) => { if (n > 0) items[t] = (items[t] ?? 0) + n; };

  // ---- recolte
  const prod: Partial<Record<ItemType, number>> = {};
  if (i.shelterOk) {
    if (i.jobs.farmer) {
      const veg = RATE.farmer * crew;
      prod.wheat = veg * i.wheatShare;
      prod.carrot = (veg - prod.wheat) / 2;
      prod.tomato = (veg - prod.wheat) / 2;
    }
    if (i.jobs.lumber) prod.log = RATE.lumber * crew;
    if (i.jobs.fisher) prod.fish = RATE.fisher * crew;
    if (i.jobs.scav) prod.scrap = RATE.scav * crew;
  }

  // ---- le porteur : machines d'abord, puis l'etal
  let carry = i.jobs.porter && i.shelterOk ? RATE.porter * crew : 0;
  const shelf: Partial<Record<ItemType, number>> = {};
  const toShelf = (t: ItemType, n: number) => { if (n > 0) shelf[t] = (shelf[t] ?? 0) + n; };
  const move = (t: ItemType): number => {
    const n = Math.min(prod[t] ?? 0, carry);
    carry -= n;
    prod[t] = (prod[t] ?? 0) - n;
    return n;
  };
  if (carry > 0) {
    const veg = move('carrot') + move('tomato');
    if (i.conv.cook) toShelf('soup', veg / 2); else { toShelf('carrot', veg / 2); toShelf('tomato', veg / 2); }
    const wheat = move('wheat');
    if (i.conv.mill) toShelf('bread', wheat / 2); else toShelf('wheat', wheat);
    toShelf('fish', move('fish'));
    const logs = move('log');
    if (i.conv.saw) toShelf('plank', logs); else toShelf('log', logs);
    // La ferraille fondue reste en metal dans la reserve : elle sert a construire.
    const scrap = move('scrap');
    if (i.conv.forge) add('metal', scrap / 2); else toShelf('scrap', scrap);
  }

  // ---- les clients : d'abord ce qui attendait dans les bacs, puis ce que le porteur a apporte
  let buy = RATE.customers * work;
  let coins = 0;
  const binsSold: Partial<Record<ItemType, number>> = {};
  // Jouer doit toujours rapporter plus que s'absenter : le gain est plafonne (et la caisse
  // deborde sans caissiere). Le plafond s'applique pendant la vente : ce qui n'est pas paye
  // reste dans les bacs (ou part a la reserve), rien n'est detruit.
  const capCoins = Math.min(i.coinCap, i.jobs.cashier ? Infinity : i.cashCap);
  const limit = capCoins / Math.max(1e-6, i.sellMul); // en pieces avant le multiplicateur
  let hit = false;
  const sell = (from: Partial<Record<ItemType, number>>, track: boolean) => {
    // Les plus chers d'abord : ce sont ceux que les clients reclament le plus.
    const order = (Object.keys(from) as ItemType[]).sort((a, b) => ITEMS[b].price - ITEMS[a].price);
    for (const t of order) {
      if (buy <= 0) break;
      let n = Math.min(Math.floor(from[t] ?? 0), Math.floor(buy));
      const fit = Math.max(0, Math.floor((limit - coins) / ITEMS[t].price));
      if (fit < n) { n = fit; hit = true; }
      if (n <= 0) continue; // un moins cher peut encore combler le reste
      buy -= n;
      from[t] = (from[t] ?? 0) - n;
      coins += n * ITEMS[t].price;
      if (track) binsSold[t] = (binsSold[t] ?? 0) + n;
    }
  };
  sell({ ...i.bins }, true);
  sell(shelf, false);
  coins = Math.max(0, Math.min(capCoins, Math.floor(coins * i.sellMul)));
  const capped = hit && !i.jobs.cashier && i.cashCap < i.coinCap;
  const limited = hit && !capped;

  // ---- ce qui reste va dans la reserve (dans la limite des places)
  let room = Math.min(i.reserveRoom, i.itemCap);
  const store = (src: Partial<Record<ItemType, number>>) => {
    for (const t of Object.keys(src) as ItemType[]) {
      const n = Math.min(Math.floor(src[t] ?? 0), room);
      if (n <= 0) continue;
      room -= n;
      add(t, n);
    }
  };
  store(prod);
  store(shelf);
  // Le metal deja compte dans items : on le borne aussi.
  if (items.metal) items.metal = Math.floor(items.metal);

  // ---- les nuits passees : la palissade s'use, sans jamais ceder
  const nights = i.cycleLen > 0 ? Math.floor(secs / i.cycleLen) : 0;

  // ---- le conseil : ce qui a le plus limite le camp
  let tip = '';
  const any = Object.values(i.jobs).some(Boolean);
  if (!i.shelterOk && any) tip = '🏠 L’abri était en ruine : personne n’a travaillé. Répare-le avant de partir.';
  else if (!any) tip = '👩‍🌾 Recrute des survivants : ils produisent même quand tu n’es pas là.';
  else if (!i.jobs.porter) tip = '🧑‍🌾 Sans porteur, la récolte reste dans la réserve. Recrute Momo pour qu’elle se vende.';
  else if (capped) tip = '👩‍💼 La caisse a débordé : avec une caissière, rien ne se perd.';
  else if (limited) tip = '📋 Plafond atteint : le contremaître (établi) augmente ce que le camp gagne sans toi.';
  else if (room <= 0) tip = '📦 La réserve était pleine : agrandis-la à l’établi.';
  else if (i.away > i.maxAway + 600) tip = '📋 Ton absence a dépassé la limite : le contremaître (établi) la repousse.';
  else if (buy > 30) tip = '🧺 Les clients manquaient de produits : remplis les bacs avant de partir.';

  return { secs, away: i.away, coins, items, wear: nights, nights, tip, eff: i.eff, binsSold };
}
