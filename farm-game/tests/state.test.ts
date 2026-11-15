import { describe, expect, it } from 'vitest';
import { fmt, fmtDuration } from '../src/game/format';
import { deserialize, serialize } from '../src/game/save';
import {
  addXp, buyPlot, buyUpgrade, claimOrder, computeOffline, fillOrders, harvest, idleRate, isRipe, newGame,
  plant, plotCost, prestige, prestigeGain, tickHen, xpForLevel,
} from '../src/game/state';

const never = () => 0.99;
const always = () => 0;

describe('cycle de culture', () => {
  it('plante, pousse puis se recolte', () => {
    const s = newGame(0);
    expect(plant(s, 0, 0)).toBe(true);
    expect(plant(s, 0, 0)).toBe(false);
    expect(isRipe(s.plots[0]!, 2_999)).toBe(false);
    expect(harvest(s, 0, 2_999, never)).toBeNull();
    const r = harvest(s, 0, 3_000, never)!;
    expect(r.coins).toBe(1);
    expect(s.coins).toBe(1);
    expect(s.plots[0]!.crop).toBeNull();
  });

  it('refuse une culture pas encore debloquee', () => {
    const s = newGame(0);
    expect(plant(s, 0, 0, 'grape')).toBe(false);
  });

  it("l'arroseur replante la meme culture", () => {
    const s = newGame(0);
    s.upgrades.sprinkler = 1;
    plant(s, 0, 0);
    harvest(s, 0, 3_000, never);
    expect(s.plots[0]!.crop).toBe('carrot');
    expect(s.plots[0]!.plantedAt).toBe(3_000);
  });

  it('la main verte double la recolte', () => {
    const s = newGame(0);
    s.upgrades.greenThumb = 5;
    plant(s, 0, 0);
    const r = harvest(s, 0, 3_000, always)!;
    expect(r.crit).toBe(true);
    expect(r.coins).toBe(2);
  });
});

describe('progression', () => {
  it('monte de niveau et garde le surplus', () => {
    const s = newGame(0);
    const levels = addXp(s, xpForLevel(1) + 3);
    expect(levels).toEqual([2]);
    expect(s.level).toBe(2);
    expect(s.xp).toBe(3);
    expect(s.coins).toBeGreaterThan(0);
  });

  it('peut franchir plusieurs niveaux d\'un coup', () => {
    const s = newGame(0);
    expect(addXp(s, 10_000).length).toBeGreaterThan(5);
  });

  it("les ameliorations coutent et s'arretent au maximum", () => {
    const s = newGame(0);
    s.level = 10;
    s.coins = 1e9;
    expect(buyUpgrade(s, 'sprinkler')).toBe(true);
    expect(buyUpgrade(s, 'sprinkler')).toBe(false);
    s.coins = 0;
    expect(buyUpgrade(s, 'fertilizer')).toBe(false);
  });

  it('les champs coutent de plus en plus cher', () => {
    const s = newGame(0);
    s.coins = 1e9;
    const c1 = plotCost(s.plots.length);
    buyPlot(s);
    expect(plotCost(s.plots.length)).toBeGreaterThan(c1);
    expect(s.plots.length).toBe(5);
  });
});

describe('poule et hors ligne', () => {
  it('la poule recolte au rythme prevu', () => {
    const s = newGame(0);
    s.upgrades.hen = 1;
    s.upgrades.sprinkler = 1;
    for (let i = 0; i < 4; i++) plant(s, i, 0);
    expect(tickHen(s, 3_000, 3_999, never)).toHaveLength(0);
    expect(tickHen(s, 3_000, 1, never)).toHaveLength(1);
  });

  it('rien hors ligne sans poule ni arroseur', () => {
    const s = newGame(0);
    plant(s, 0, 0);
    expect(computeOffline(s, 3600_000).coins).toBe(0);
  });

  it('les gains hors ligne sont plafonnes par le debit de la poule', () => {
    const s = newGame(0);
    s.upgrades.hen = 1;
    s.upgrades.sprinkler = 1;
    for (let i = 0; i < 4; i++) plant(s, i, 0);
    // 4 carottes (1 piece / 3 s chacune) = 1,33/s, mais la poule ne fait qu'une recolte / 4 s.
    expect(idleRate(s).coins * 1000).toBeCloseTo(0.25, 5);
    const g = computeOffline(s, 100 * 3600_000);
    expect(g.ms).toBe(8 * 3600_000);
    expect(g.coins).toBe(Math.floor(0.25 * 8 * 3600 * 0.25));
  });
});

describe('commandes et saisons', () => {
  it('une commande se remplit puis se livre', () => {
    const s = newGame(0);
    s.level = 2;
    fillOrders(s, () => 0);
    expect(s.orders).toHaveLength(3);
    const o = s.orders[0]!;
    o.progress = o.qty;
    const before = s.coins;
    const res = claimOrder(s, o.id, () => 0.5)!;
    expect(s.coins).toBeGreaterThanOrEqual(before + res.coins);
    expect(s.orders).toHaveLength(3);
  });

  it('une nouvelle saison rapporte des graines et remet la ferme a zero', () => {
    const s = newGame(0);
    s.level = 15;
    s.seasonCoins = 20_000 * 9;
    s.coins = 5_000;
    expect(prestigeGain(s)).toBe(3);
    const next = prestige(s, 1)!;
    expect(next.goldenSeeds).toBe(3);
    expect(next.coins).toBe(0);
    expect(next.level).toBe(1);
    expect(next.season).toBe(2);
  });
});

describe('sauvegarde', () => {
  it('fait un aller-retour sans perte', () => {
    const s = newGame(0);
    s.coins = 42;
    plant(s, 1, 0);
    expect(deserialize(serialize(s), 0)).toEqual(s);
  });

  it('survit a une sauvegarde abimee', () => {
    expect(deserialize('{pas du json', 0).coins).toBe(0);
    expect(deserialize(JSON.stringify({ coins: 'x', plots: [{ crop: 'inconnu' }] }), 0).coins).toBe(0);
  });
});

describe('affichage des nombres', () => {
  it('abrege proprement', () => {
    expect(fmt(999)).toBe('999');
    expect(fmt(1234)).toBe('1.23K');
    expect(fmt(45_600_000)).toBe('45.6M');
    expect(fmt(999_999)).toBe('999K');
    expect(fmtDuration(3_500)).toBe('3,5 s');
    expect(fmtDuration(125_000)).toBe('2 min 5 s');
  });
});
