import { describe, expect, it } from 'vitest';
import {
  BASE_POINTS,
  START_LIVES,
  applyAnswer,
  buildPool,
  itemKey,
  newGame,
  pickNext,
  pointsFor,
  type GameItem,
} from '../callouts/game';
import { EMPTY_STATS, type CalloutMap } from '../callouts/quiz';
import { syncBuiltin } from '../callouts/catalog';

function carte(id: string, noms: string[]): CalloutMap {
  return {
    id, name: id, image: '', aspect: 1, createdAt: '', updatedAt: '',
    callouts: noms.map((n, i) => ({ id: n, name: n, x: i / noms.length, y: 0.5, stats: { ...EMPTY_STATS } })),
  };
}

function graine(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const item: GameItem = { mapId: 'm', callout: carte('m', ['a']).callouts[0]! };

describe('points et vies', () => {
  it('recompense les series, avec un plafond', () => {
    expect(pointsFor(0)).toBe(BASE_POINTS);
    expect(pointsFor(3)).toBeGreaterThan(pointsFor(1));
    expect(pointsFor(50)).toBe(pointsFor(10));
  });

  it('retire une vie et casse la serie sur une erreur', () => {
    let s = applyAnswer(newGame(), item, true, 20);
    s = applyAnswer(s, item, true, 20);
    expect(s.streak).toBe(2);
    expect(s.score).toBe(pointsFor(0) + pointsFor(1));
    s = applyAnswer(s, item, false, 20);
    expect(s).toMatchObject({ streak: 0, bestStreak: 2, lives: START_LIVES - 1, answered: 3, correct: 2 });
    expect(s.over).toBe(false);
  });

  it('s arrete a la derniere vie perdue', () => {
    let s = newGame();
    for (let i = 0; i < START_LIVES; i++) s = applyAnswer(s, item, false, null);
    expect(s.lives).toBe(0);
    expect(s.over).toBe(true);
  });

  it('s arrete apres la derniere question d une serie, pas en mode infini', () => {
    let serie = newGame();
    let infini = newGame();
    for (let i = 0; i < 20; i++) {
      serie = applyAnswer(serie, item, true, 20);
      infini = applyAnswer(infini, item, true, null);
    }
    expect(serie.over).toBe(true);
    expect(infini.over).toBe(false);
  });
});

describe('tirage des questions', () => {
  it('melange les endroits de toutes les cartes', () => {
    const pool = buildPool([carte('A', ['a1', 'a2']), carte('B', ['b1', 'b2', 'b3'])]);
    expect(pool).toHaveLength(5);
    expect(new Set(pool.map((p) => p.mapId))).toEqual(new Set(['A', 'B']));
  });

  it('ne repose aucun endroit dans une serie quand il y en a assez', () => {
    const pool = buildPool([carte('A', Array.from({ length: 25 }, (_, i) => `p${i}`))]);
    const asked: string[] = [];
    const random = graine(7);
    for (let i = 0; i < 20; i++) asked.push(itemKey(pickNext(pool, asked, 20, random)!));
    expect(new Set(asked).size).toBe(20);
  });

  it('ne repose jamais la meme question deux fois de suite, meme sur une petite carte', () => {
    const pool = buildPool([carte('A', ['a', 'b', 'c'])]);
    const asked: string[] = [];
    const random = graine(9);
    for (let i = 0; i < 60; i++) {
      const next = itemKey(pickNext(pool, asked, null, random)!);
      expect(next).not.toBe(asked[asked.length - 1]);
      asked.push(next);
    }
  });

  it('fait tomber plus souvent les endroits rates', () => {
    const m = carte('A', Array.from({ length: 8 }, (_, i) => `p${i}`));
    m.callouts = m.callouts.map((c, i) => ({
      ...c,
      stats: i === 0 ? { seen: 5, correct: 0, streak: 0, lastSeen: 'x' } : { seen: 5, correct: 5, streak: 5, lastSeen: 'x' },
    }));
    const pool = buildPool([m]);
    const random = graine(4);
    let faible = 0;
    for (let i = 0; i < 200; i++) if (pickNext(pool, [], 20, random)!.callout.id === 'p0') faible++;
    // Uniforme : 1 chance sur 8. Pondere : nettement plus.
    expect(faible).toBeGreaterThan(60);
  });

  it('ignore les endroits sans nom', () => {
    expect(buildPool([carte('A', ['a', ' '])])).toHaveLength(1);
  });
});

describe('cartes du catalogue', () => {
  const plan = {
    id: 'builtin-x', name: 'X', version: 1, image: '/x.png', reference: '/x-calls.png', aspect: 2,
    callouts: [{ id: 'cuisine', name: 'Cuisine', x: 0.2, y: 0.3 }],
  };

  it('installe une carte absente de l appareil', () => {
    const [m] = syncBuiltin([], [plan], 't');
    expect(m).toMatchObject({ id: 'builtin-x', builtin: 1, reference: '/x-calls.png' });
    expect(m!.callouts[0]!.stats).toEqual(EMPTY_STATS);
  });

  it('ne reecrit rien quand la carte est a jour', () => {
    const installees = syncBuiltin([], [plan], 't');
    expect(syncBuiltin(installees, [plan], 't2')).toEqual([]);
  });

  it('garde la progression lors d une mise a jour', () => {
    const [m] = syncBuiltin([], [plan], 't');
    const joue = { ...m!, callouts: m!.callouts.map((c) => ({ ...c, stats: { seen: 4, correct: 3, streak: 2, lastSeen: 'x' } })) };
    const v2 = { ...plan, version: 2, callouts: [{ id: 'cuisine', name: 'Cuisine', x: 0.25, y: 0.3 }, { id: 'toit', name: 'Toit', x: 0.8, y: 0.1 }] };
    const [maj] = syncBuiltin([joue], [v2], 't3');
    expect(maj!.callouts[0]).toMatchObject({ x: 0.25, stats: { seen: 4, correct: 3 } });
    expect(maj!.callouts[1]!.stats).toEqual(EMPTY_STATS);
    expect(maj!.createdAt).toBe('t');
  });
});
