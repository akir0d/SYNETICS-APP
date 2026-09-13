import { describe, expect, it } from 'vitest';
import { applySideToSession, groupBySession, outcomeFor, recordLabel } from '../match';
import { normalizeAnalysis } from '../storage/migrate';
import type { MatchAnalysis, ScoreboardSummary, Team, TeamSide } from '../types';

function tableau(winner: ScoreboardSummary['winner']): ScoreboardSummary {
  return { atS: 10, percents: [100, 24], totals: [2200, 1350], winner, agreed: true, teams: [[], []] };
}

function manche(over: Partial<MatchAnalysis> = {}): MatchAnalysis {
  return {
    id: 'm', title: 'match', createdAt: '2026-03-01T20:00:00.000Z', updatedAt: '', profile: 'domination',
    video: { name: 'rediff.mp4', sizeBytes: 0, durationS: 600, sourceDurationS: 3600, width: 1920, height: 1080, mimeType: 'video/mp4' },
    sourceOffsetS: 0, segmentIndex: 1, segmentCount: 1, sessionId: 's1',
    map: { mapId: null, mapName: '', confidence: 0, confirmed: false, distance: 1 },
    outcome: 'inconnue',
    settings: { samplingHz: 3, aiEnabled: false, aiModel: '', aiFrameBudget: 24 },
    features: [], events: [],
    metrics: {} as MatchAnalysis['metrics'],
    notes: '',
    ...over,
  } as MatchAnalysis;
}

describe('issue d une manche', () => {
  it('reste inconnue tant que le camp n est pas indique', () => {
    // Le tableau dit quel camp gagne, jamais lequel est le votre : sans cette
    // indication, annoncer une victoire serait un coup de des sur deux.
    expect(outcomeFor(manche({ scoreboard: tableau('haut') }))).toBe('inconnue');
  });

  it('reste inconnue quand le tableau n a pas ete lu', () => {
    expect(outcomeFor(manche({ mySide: 'haut' }))).toBe('inconnue');
  });

  it('croise le camp gagnant et le votre', () => {
    expect(outcomeFor(manche({ scoreboard: tableau('haut'), mySide: 'haut' }))).toBe('victoire');
    expect(outcomeFor(manche({ scoreboard: tableau('haut'), mySide: 'bas' }))).toBe('defaite');
    expect(outcomeFor(manche({ scoreboard: tableau('bas'), mySide: 'bas' }))).toBe('victoire');
  });

  it('reconnait l egalite quel que soit le camp', () => {
    for (const side of ['haut', 'bas'] as TeamSide[]) {
      expect(outcomeFor(manche({ scoreboard: tableau('egalite'), mySide: side }))).toBe('egalite');
    }
  });
});

describe('camp applique a la rediffusion', () => {
  const manches = [
    manche({ id: 'a', sessionId: 's1', segmentIndex: 1, scoreboard: tableau('haut') }),
    manche({ id: 'b', sessionId: 's1', segmentIndex: 2, scoreboard: tableau('bas') }),
    manche({ id: 'c', sessionId: 's2', segmentIndex: 1, scoreboard: tableau('haut') }),
  ];

  it('marque toutes les manches du meme fichier, et elles seules', () => {
    // Les equipes ne changent pas de cote au sein d'une rediffusion : le dire
    // une fois doit suffire pour tout le fichier.
    const apres = applySideToSession(manches, 's1', 'haut', 'eq-gt');
    expect(apres.map((a) => a.outcome)).toEqual(['victoire', 'defaite', 'inconnue']);
    expect(apres.map((a) => a.mySide)).toEqual(['haut', 'haut', undefined]);
    expect(apres[2]!.opponentTeamId).toBeUndefined();
  });
});

describe('regroupement par rediffusion', () => {
  const equipes: Team[] = [{ id: 'eq-gt', tag: 'GT', name: 'GT', players: [] }];

  it('rassemble les manches, compte le bilan et met la plus recente en tete', () => {
    const brutes = [
      manche({ id: 'a', sessionId: 's1', segmentIndex: 2, createdAt: '2026-03-01T21:00:00.000Z', outcome: 'defaite' }),
      manche({ id: 'b', sessionId: 's1', segmentIndex: 1, createdAt: '2026-03-01T20:00:00.000Z', outcome: 'victoire', opponentTeamId: 'eq-gt', mySide: 'bas' }),
      manche({ id: 'c', sessionId: 's2', segmentIndex: 1, createdAt: '2026-03-08T20:00:00.000Z', outcome: 'egalite' }),
    ];
    const groupes = groupBySession(brutes, equipes);

    expect(groupes.map((g) => g.sessionId)).toEqual(['s2', 's1']);
    const premiere = groupes[1]!;
    expect(premiere.analyses.map((a) => a.id)).toEqual(['b', 'a']);
    expect(premiere.date).toBe('2026-03-01T20:00:00.000Z');
    expect(premiere.opponent?.tag).toBe('GT');
    expect(premiere.mySide).toBe('bas');
    expect(recordLabel(premiere)).toBe('1 V – 1 D');
  });

  it('signale les manches dont l issue reste inconnue', () => {
    const groupes = groupBySession([manche({ outcome: 'inconnue' })], []);
    expect(recordLabel(groupes[0]!)).toBe('0 V – 0 D – 1 ?');
  });
});

describe('analyses heritees', () => {
  it('regroupe sans broncher une analyse enregistree avant les equipes', () => {
    // Une analyse d'une version anterieure n'a ni tableau des scores, ni camp,
    // ni adversaire. La bibliotheque doit malgre tout s'afficher : c'est
    // exactement ce genre de champ manquant qui avait deja rendu
    // l'application entierement blanche apres une mise a jour.
    const ancienne = normalizeAnalysis({ id: 'vieux' });
    const groupes = groupBySession([ancienne], []);

    expect(groupes).toHaveLength(1);
    expect(groupes[0]!.mySide).toBeNull();
    expect(groupes[0]!.opponent).toBeNull();
    expect(groupes[0]!.analyses[0]!.scoreboard).toBeUndefined();
    expect(outcomeFor(ancienne)).toBe('inconnue');
    expect(recordLabel(groupes[0]!)).toBe('0 V – 0 D – 1 ?');
  });
});
