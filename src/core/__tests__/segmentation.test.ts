import { describe, expect, it } from 'vitest';
import { computeIntensity } from '../analysis/heuristics';
import {
  detectMatchSegments,
  sliceFeatures,
  wholeVideoSegment,
  type SegmentationOptions,
} from '../analysis/segmentation';
import { syntheticFeatures } from './fixtures';

const HZ = 2;

function segmentsOf(
  actionWindows: Array<[number, number]>,
  durationS: number,
  options: Partial<SegmentationOptions> = {},
  idleDiff?: number,
) {
  const features = syntheticFeatures({
    durationS,
    samplingHz: HZ,
    actionWindows,
    redFlashes: [],
    cuts: [],
    ...(idleDiff === undefined ? {} : { idleDiff }),
  });
  const intensity = computeIntensity(features, HZ);
  return {
    features,
    ...detectMatchSegments(features, intensity, { samplingHz: HZ, ...options }),
  };
}

describe('decoupage d une rediffusion', () => {
  it('separe deux manches eloignees par un vrai temps mort', () => {
    const { segments } = segmentsOf(
      [
        [30, 160],
        [260, 420],
      ],
      600,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]!.startS).toBeGreaterThan(20);
    expect(segments[0]!.endS).toBeLessThan(180);
    expect(segments[1]!.startS).toBeGreaterThan(250);
    expect(segments[1]!.endS).toBeLessThan(440);
    expect(segments.map((s) => s.index)).toEqual([1, 2]);
  });

  it('ne coupe pas un match sur une accalmie interne', () => {
    // Vingt secondes de calme au milieu : c'est une rotation, pas une fin de
    // manche. Le seuil de pause vaut 40 s.
    const { segments } = segmentsOf(
      [
        [30, 160],
        [180, 300],
      ],
      420,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]!.endS).toBeGreaterThan(280);
  });

  it('respecte une pause courte quand le reglage la declare significative', () => {
    // Regression : la fenetre de lissage de la densite etait figee a 20 s.
    // Avec un reglage de pause a 8 s, elle comblait le temps mort et les deux
    // manches se retrouvaient collees en une seule.
    const { segments } = segmentsOf(
      [
        [20, 140],
        [152, 280],
      ],
      320,
      { minGapS: 8, minMatchS: 60 },
    );

    expect(segments).toHaveLength(2);
    expect(segments[0]!.endS).toBeLessThan(150);
    expect(segments[1]!.startS).toBeGreaterThan(145);
  });

  it('ecarte un bloc d action trop court pour etre un match', () => {
    const { segments } = segmentsOf(
      [
        [30, 160],
        [260, 300],
      ],
      420,
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]!.startS).toBeLessThan(40);
  });

  it('ne trouve aucun match dans une captation figee', () => {
    // Un ecran de menu filme pendant dix minutes. Sans plancher de mouvement
    // absolu, la normalisation etirerait le bruit de compression jusqu'a en
    // faire de l'action.
    const { segments, gaps } = segmentsOf([], 600, {}, 0.002);
    expect(segments).toEqual([]);
    expect(gaps).toEqual([]);
  });

  it('rend un seul bloc quand la camera bouge sans arret et sans temps mort', () => {
    // Comportement assume : sans pause distinguable, le moteur ne peut pas
    // inventer de frontiere. Mieux vaut un match unique qu'un decoupage au
    // hasard — le joueur reste libre de desactiver le decoupage.
    const { segments } = segmentsOf([[0, 600]], 600);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.endS - segments[0]!.startS).toBeGreaterThan(500);
  });

  it('rend les temps morts entre les matchs', () => {
    const { gaps } = segmentsOf(
      [
        [60, 200],
        [300, 440],
      ],
      520,
    );
    // Avant le premier match, entre les deux, puis apres le dernier.
    expect(gaps).toHaveLength(3);
    expect(gaps[0]!.startS).toBe(0);
    expect(gaps[1]!.startS).toBeGreaterThan(190);
    // Le decoupage ne connait que les instants mesures : le dernier temps mort
    // s'arrete donc a la derniere image echantillonnee, un pas avant la fin.
    expect(gaps[2]!.endS).toBeGreaterThan(519);
    expect(gaps[2]!.endS).toBeLessThanOrEqual(520);
  });

  it('scinde un bloc anormalement long au creux d activite', () => {
    // Deux manches enchainees avec seulement 20 s de pause : elles fusionnent
    // d'abord, puis le garde-fou de duree maximale les resepare.
    const { segments } = segmentsOf(
      [
        [10, 400],
        [420, 800],
      ],
      820,
      { maxMatchS: 300, minMatchS: 90 },
    );
    expect(segments.length).toBeGreaterThanOrEqual(2);
    for (const segment of segments) {
      expect(segment.endS - segment.startS).toBeLessThanOrEqual(500);
    }
  });

  it('attribue une confiance plus faible a un decoupage mou', () => {
    const net = segmentsOf([[60, 260]], 400).segments[0];
    const mou = segmentsOf(
      [
        [60, 90],
        [130, 160],
        [200, 230],
      ],
      400,
      { minGapS: 60 },
    ).segments[0];

    expect(net).toBeDefined();
    expect(mou).toBeDefined();
    expect(net!.confidence).toBeGreaterThan(mou!.confidence);
  });
});

describe('extraction d un segment', () => {
  it('remet les horodatages a zero sans perdre d image', () => {
    const { features, segments } = segmentsOf([[60, 200]], 400);
    const segment = segments[0]!;
    const slice = sliceFeatures(features, segment);

    expect(slice.length).toBeGreaterThan(0);
    expect(slice[0]!.t).toBe(0);
    expect(slice[slice.length - 1]!.t).toBeCloseTo(segment.endS - segment.startS, 5);
    // Le contenu ne change pas, seul le reperage temporel bouge.
    const original = features.find((f) => Math.abs(f.t - segment.startS) < 1e-9);
    expect(slice[0]!.diff).toBe(original!.diff);
  });

  it('fournit un segment couvrant tout le fichier quand le decoupage est desactive', () => {
    const whole = wholeVideoSegment(1234);
    expect(whole.startS).toBe(0);
    expect(whole.endS).toBe(1234);
    expect(whole.index).toBe(1);
  });
});
