import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATS,
  buildChoices,
  buildQuiz,
  exportCalloutMap,
  importCalloutMap,
  nearestCallout,
  priority,
  recordAnswer,
  type Callout,
  type CalloutMap,
} from '../callouts/quiz';

function endroit(id: string, x: number, y: number, stats = EMPTY_STATS): Callout {
  return { id, name: id.toUpperCase(), x, y, stats: { ...stats } };
}

function carte(callouts: Callout[], aspect = 1): CalloutMap {
  return {
    id: 'c', name: 'Carte', image: 'data:image/png;base64,AAAA', aspect, callouts,
    createdAt: '', updatedAt: '',
  };
}

/** Generateur pseudo-aleatoire deterministe, pour des tests reproductibles. */
function graine(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('endroit le plus proche', () => {
  it('attribue le toucher au repere le plus proche', () => {
    const m = carte([endroit('a', 0.1, 0.1), endroit('b', 0.9, 0.9)]);
    expect(nearestCallout(m, 0.3, 0.2)?.id).toBe('a');
    expect(nearestCallout(m, 0.6, 0.7)?.id).toBe('b');
  });

  it('tient compte du rapport largeur / hauteur', () => {
    // Sur un plan quatre fois plus large que haut, 0,2 en x vaut 0,8 en y.
    const m = carte([endroit('gauche', 0.3, 0.5), endroit('bas', 0.5, 0.9)], 4);
    expect(nearestCallout(m, 0.5, 0.5)?.id).toBe('bas');
  });

  it('ne renvoie rien sur une carte vide', () => {
    expect(nearestCallout(carte([]), 0.5, 0.5)).toBeNull();
  });
});

describe('suivi d apprentissage', () => {
  it('remet la serie a zero a la premiere erreur', () => {
    let s = recordAnswer(EMPTY_STATS, true, 't1');
    s = recordAnswer(s, true, 't2');
    expect(s).toEqual({ seen: 2, correct: 2, streak: 2, lastSeen: 't2' });
    s = recordAnswer(s, false, 't3');
    expect(s.streak).toBe(0);
    expect(s.correct).toBe(2);
  });

  it('fait passer les endroits jamais vus et les erreurs avant les acquis', () => {
    const acquis = { seen: 6, correct: 6, streak: 6, lastSeen: 'x' };
    const rate = { seen: 4, correct: 1, streak: 0, lastSeen: 'x' };
    expect(priority(EMPTY_STATS)).toBeGreaterThan(priority(acquis));
    expect(priority(rate)).toBeGreaterThan(priority(acquis));
    expect(priority(acquis)).toBeGreaterThan(0);
  });
});

describe('serie de questions', () => {
  const points = Array.from({ length: 8 }, (_, i) => endroit(`p${i}`, i / 8, 0.5));

  it('ne pose jamais deux fois le meme endroit', () => {
    const q = buildQuiz(carte(points), 'trouver', 20, graine(1));
    expect(q).toHaveLength(8);
    expect(new Set(q.map((x) => x.calloutId)).size).toBe(8);
  });

  it('propose quatre noms distincts dont le bon en mode nommer', () => {
    const q = buildQuiz(carte(points), 'nommer', 5, graine(2));
    for (const question of q) {
      const bon = points.find((p) => p.id === question.calloutId)!.name;
      expect(question.choices).toHaveLength(4);
      expect(new Set(question.choices).size).toBe(4);
      expect(question.choices).toContain(bon);
    }
  });

  it('prend les leurres parmi les voisins', () => {
    const choix = buildChoices(carte(points), points[0]!, 4, graine(3));
    // Les six plus proches de p0 sont p1 a p6 ; p7 est le plus eloigne.
    expect(choix).not.toContain('P7');
  });

  it('se contente de moins de propositions sur une petite carte', () => {
    const m = carte([endroit('a', 0, 0), endroit('b', 1, 1)]);
    expect(buildChoices(m, m.callouts[0]!, 4).sort()).toEqual(['A', 'B']);
  });

  it('fait tomber plus souvent les endroits rates', () => {
    const rate = { seen: 5, correct: 0, streak: 0, lastSeen: 'x' };
    const acquis = { seen: 5, correct: 5, streak: 5, lastSeen: 'x' };
    const m = carte([endroit('faible', 0, 0, rate), ...points.slice(1).map((p) => ({ ...p, stats: acquis }))]);
    const random = graine(4);
    let premier = 0;
    for (let i = 0; i < 200; i++) {
      if (buildQuiz(m, 'trouver', 1, random)[0]!.calloutId === 'faible') premier++;
    }
    // Uniforme : 1 chance sur 8. Pondere : nettement plus.
    expect(premier).toBeGreaterThan(60);
  });
});

describe('partage d une carte', () => {
  it('fait l aller-retour sans emporter le suivi personnel', () => {
    const avant = carte([endroit('a', 0.2, 0.3, { seen: 3, correct: 2, streak: 1, lastSeen: 'x' })], 1.5);
    const apres = importCalloutMap(exportCalloutMap(avant), 'maintenant');
    expect(apres.name).toBe('Carte');
    expect(apres.aspect).toBe(1.5);
    expect(apres.callouts).toHaveLength(1);
    expect(apres.callouts[0]).toMatchObject({ name: 'A', x: 0.2, y: 0.3, stats: EMPTY_STATS });
    expect(apres.id).not.toBe(avant.id);
  });

  it('refuse un fichier qui n est pas une carte', () => {
    expect(() => importCalloutMap('pas du json', 'n')).toThrow(/JSON/);
    expect(() => importCalloutMap('{"format":"autre"}', 'n')).toThrow(/callouts/);
  });
});
