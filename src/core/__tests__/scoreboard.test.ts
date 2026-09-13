import { describe, expect, it } from 'vitest';
import { decideWinner, readScoreboard, teamScore } from '../vision/scoreboard';
import { loadCapture } from './fixtures/captures';

/**
 * Verite terrain relevee a l'oeil sur les captures versionnees : par equipe,
 * de haut en bas, chaque carte donnant (score, K, D, A).
 */
const ATTENDU: Record<string, { titre: string; equipes: Array<Array<[number, number, number, number]>> }> = {
  cf3a69f0: {
    titre: 'Atlantis — entrainement',
    equipes: [
      [
        [700, 11, 3, 1],
        [625, 9, 8, 5],
        [475, 8, 6, 3],
        [400, 6, 4, 4],
      ],
      [
        [375, 6, 9, 0],
        [475, 8, 11, 2],
        [125, 1, 9, 2],
        [275, 5, 5, 1],
      ],
    ],
  },
  '4df5ce74': {
    titre: 'The Cliff — league',
    equipes: [
      [
        [1200, 20, 7, 0],
        [800, 10, 8, 7],
        [575, 6, 9, 4],
        [400, 5, 9, 2],
      ],
      [
        [725, 9, 11, 4],
        [700, 9, 8, 5],
        [575, 6, 14, 7],
        [550, 8, 9, 0],
      ],
    ],
  },
  df7af499: {
    titre: 'Atlantis — league',
    equipes: [
      [
        [900, 13, 5, 2],
        [775, 11, 8, 3],
        [775, 8, 4, 1],
        [700, 8, 4, 3],
      ],
      [
        [750, 10, 11, 1],
        [350, 6, 11, 2],
        [250, 2, 11, 3],
        [225, 2, 9, 1],
      ],
    ],
  },
  'carolo-moux-nnx': {
    titre: 'Atlantis — Carolo League — tableau en cours de manche',
    equipes: [
      [
        [475, 3, 9, 2],
        [375, 6, 6, 0],
        [350, 4, 7, 0],
        [150, 3, 9, 0],
      ],
      [
        [1200, 13, 4, 2],
        [650, 4, 4, 5],
        [525, 7, 5, 2],
        [450, 6, 3, 0],
      ],
    ],
  },
};

describe('reperage du tableau des scores', () => {
  for (const [nom, { titre }] of Object.entries(ATTENDU)) {
    it(`retrouve les deux equipes et leurs quatre cartes — ${titre}`, () => {
      const capture = loadCapture(nom);
      const lu = readScoreboard(capture.luma, capture.width, capture.height);
      expect(lu).not.toBeNull();
      expect(lu!.teams).toHaveLength(2);
      for (const equipe of lu!.teams) expect(equipe.cards).toHaveLength(4);
    });
  }

  it('ne voit pas de tableau sur un ecran de lobby', () => {
    // Mieux vaut ne rien annoncer qu'annoncer des chiffres tires d'un ecran
    // qui n'est pas un tableau des scores.
    const capture = loadCapture('lobby-10min');
    expect(readScoreboard(capture.luma, capture.width, capture.height)).toBeNull();
  });
});

/**
 * Progression des deux equipes et camp vainqueur, releves a l'oeil.
 *
 * Le camp est donne de haut en bas : ces captures montrent que la rangee du
 * haut n'est pas celle qui gagne — la Carolo League met Alliance en haut a
 * 24 % et Rebels en dessous a 100 %.
 */
const VERDICTS: Record<string, { percents: [number, number]; winner: 'haut' | 'bas' }> = {
  cf3a69f0: { percents: [100, 33], winner: 'haut' },
  '4df5ce74': { percents: [100, 91], winner: 'haut' },
  df7af499: { percents: [100, 6], winner: 'haut' },
  'carolo-moux-nnx': { percents: [24, 100], winner: 'bas' },
};

describe('progression et verdict', () => {
  for (const [nom, { percents, winner }] of Object.entries(VERDICTS)) {
    it(`lit la progression et designe le vainqueur — ${ATTENDU[nom]!.titre}`, () => {
      const capture = loadCapture(nom);
      const lu = readScoreboard(capture.luma, capture.width, capture.height, capture.chroma)!;
      expect(lu.teams.map((e) => e.percent)).toEqual(percents);

      const verdict = decideWinner(lu);
      expect(verdict).not.toBeNull();
      expect(verdict!.winner).toBe(winner);
      // Le cumul des scores doit confirmer le pourcentage sur ces quatre
      // manches : c'est ce second avis qui permet de signaler un doute
      // plutot que de trancher au hasard quand la lecture derape.
      expect(verdict!.agreed).toBe(true);
    });
  }

  it('ne designe personne sans progression ni scores lisibles', () => {
    const capture = loadCapture('lobby-10min');
    expect(readScoreboard(capture.luma, capture.width, capture.height, capture.chroma)).toBeNull();
  });

  it('cumule les scores de chaque equipe', () => {
    const capture = loadCapture('cf3a69f0');
    const lu = readScoreboard(capture.luma, capture.width, capture.height, capture.chroma)!;
    expect(lu.teams.map(teamScore)).toEqual([2200, 1250]);
  });
});

describe('lecture des chiffres du tableau', () => {
  let justes = 0;
  let total = 0;

  for (const [nom, { titre, equipes }] of Object.entries(ATTENDU)) {
    it(`lit les nombres — ${titre}`, () => {
      const capture = loadCapture(nom);
      const lu = readScoreboard(capture.luma, capture.width, capture.height)!;
      const fautes: string[] = [];

      equipes.forEach((cartes, e) => {
        cartes.forEach(([score, k, d, a], c) => {
          const carte = lu.teams[e]!.cards[c]!;
          const paires: Array<[string, number, number | null]> = [
            ['score', score, carte.score],
            ['K', k, carte.kills],
            ['D', d, carte.deaths],
            ['A', a, carte.assists],
          ];
          for (const [champ, attendu, obtenu] of paires) {
            total++;
            if (obtenu === attendu) justes++;
            else fautes.push(`equipe${e} carte${c} ${champ} : ${obtenu} au lieu de ${attendu}`);
          }
        });
      });

      if (fautes.length > 0) console.log(`${titre} :\n  ${fautes.join('\n  ')}`);
      expect(fautes).toEqual([]);
    });
  }

  it('lit sans faute les captures ayant servi a construire les exemplaires', () => {
    // Attention a l'interpretation : les exemplaires embarques proviennent de
    // ces memes captures. Ce test mesure donc l'apprentissage, pas la
    // generalisation, et sert de garde contre une regression du portage.
    //
    // Le chiffre honnete est ailleurs : la validation croisee de
    // `tools/glyphes/croisee.py`, ou chaque capture est lue avec des
    // exemplaires tires uniquement des autres, donne 97,7 % de nombres exacts.
    console.log(`nombres justes : ${justes}/${total} (${((100 * justes) / total).toFixed(1)} %)`);
    expect(justes).toBe(total);
  });
});
