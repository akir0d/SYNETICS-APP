import { describe, expect, it } from 'vitest';
import { detectBlackRuns, windowsBetweenBlackRuns } from '../analysis/hud';
import { computeIntensity } from '../analysis/heuristics';
import { detectMatchSegments } from '../analysis/segmentation';
import type { FrameFeature } from '../types';

const HZ = 3;

interface Bloc {
  from: number;
  to: number;
  kind: 'jeu' | 'lobby' | 'noir' | 'ecran-fin';
}

/**
 * Fabrique une rediffusion complete telle que la produit EVA : lobby, ecran
 * noir, manche, ecran de victoire fige, tableau des scores fige, ecran noir.
 */
function rediffusion(blocs: Bloc[], durationS: number): FrameFeature[] {
  const features: FrameFeature[] = [];
  for (let i = 0; i < durationS * HZ; i++) {
    const t = i / HZ;
    const bloc = blocs.find((b) => t >= b.from && t < b.to);
    const bruit = ((i * 37) % 11) / 2000;

    if (bloc?.kind === 'noir') {
      features.push({ t, luma: 0.01, redBias: 0, diff: 0.002, saturation: 0.001 });
    } else if (bloc?.kind === 'jeu') {
      features.push({ t, luma: 0.45 + bruit, redBias: 0.02, diff: 0.2 + bruit, saturation: 0.09 });
    } else {
      // Lobby et ecrans de fin : lumineux mais quasiment figes.
      features.push({ t, luma: 0.5 + bruit, redBias: 0.03, diff: 0.004 + bruit, saturation: 0.12 });
    }
  }
  return features;
}

describe('ecrans noirs', () => {
  const features = rediffusion(
    [
      { from: 0, to: 40, kind: 'lobby' },
      { from: 40, to: 42, kind: 'noir' },
      { from: 42, to: 200, kind: 'jeu' },
      { from: 200, to: 215, kind: 'ecran-fin' },
      { from: 215, to: 217, kind: 'noir' },
      { from: 217, to: 260, kind: 'lobby' },
      { from: 260, to: 262, kind: 'noir' },
      { from: 262, to: 400, kind: 'jeu' },
      { from: 400, to: 414, kind: 'ecran-fin' },
      { from: 414, to: 416, kind: 'noir' },
    ],
    440,
  );

  it('retrouve chaque passage au noir', () => {
    const runs = detectBlackRuns(features);
    expect(runs).toHaveLength(4);
    expect(runs[0]!.startS).toBeCloseTo(40, 0);
    expect(runs[3]!.startS).toBeCloseTo(414, 0);
  });

  it('ignore un ecran simplement sombre', () => {
    // Une scene de nuit n'est pas une transition : elle garde de la couleur.
    const sombre = Array.from({ length: 90 }, (_, i) => ({
      t: i / HZ,
      luma: 0.05,
      redBias: 0.01,
      diff: 0.15,
      saturation: 0.2,
    }));
    expect(detectBlackRuns(sombre)).toEqual([]);
  });

  it('ignore un clignotement trop bref pour etre une transition', () => {
    const clignote = Array.from({ length: 90 }, (_, i) => ({
      t: i / HZ,
      luma: i === 45 ? 0.01 : 0.5,
      redBias: 0.02,
      diff: 0.1,
      saturation: i === 45 ? 0.001 : 0.1,
    }));
    expect(detectBlackRuns(clignote)).toEqual([]);
  });

  it('decoupe la rediffusion en fenetres entre deux noirs', () => {
    const fenetres = windowsBetweenBlackRuns(detectBlackRuns(features), 440);
    // Lobby, manche 1 + fin, lobby, manche 2 + fin, puis la queue du fichier.
    expect(fenetres.length).toBeGreaterThanOrEqual(4);
    expect(fenetres[0]!.startS).toBe(0);
    expect(fenetres[fenetres.length - 1]!.endS).toBe(440);
  });

  it('rend une seule fenetre quand le fichier ne contient aucun noir', () => {
    expect(windowsBetweenBlackRuns([], 300)).toEqual([{ startS: 0, endS: 300 }]);
  });
});

describe('decoupage cale sur les ecrans noirs', () => {
  const blocs: Bloc[] = [
    { from: 0, to: 40, kind: 'lobby' },
    { from: 40, to: 42, kind: 'noir' },
    { from: 42, to: 200, kind: 'jeu' },
    { from: 200, to: 215, kind: 'ecran-fin' },
    { from: 215, to: 217, kind: 'noir' },
    { from: 217, to: 260, kind: 'lobby' },
    { from: 260, to: 262, kind: 'noir' },
    { from: 262, to: 400, kind: 'jeu' },
    { from: 400, to: 414, kind: 'ecran-fin' },
    { from: 414, to: 416, kind: 'noir' },
  ];
  const features = rediffusion(blocs, 440);
  const intensity = computeIntensity(features, HZ);
  const windows = windowsBetweenBlackRuns(detectBlackRuns(features), 440);

  it('trouve exactement les deux manches et ignore les lobbys', () => {
    const { segments, usedBlackScreens } = detectMatchSegments(features, intensity, {
      samplingHz: HZ,
      minMatchS: 60,
      minGapS: 30,
      windows,
    });

    expect(usedBlackScreens).toBe(true);
    expect(segments).toHaveLength(2);
    expect(segments[0]!.startS).toBeGreaterThanOrEqual(41);
    expect(segments[0]!.endS).toBeLessThan(205);
    expect(segments[1]!.startS).toBeGreaterThanOrEqual(261);
  });

  it('exclut les ecrans de fin du match mais les garde dans la fenetre', () => {
    const { segments } = detectMatchSegments(features, intensity, {
      samplingHz: HZ,
      minMatchS: 60,
      minGapS: 30,
      windows,
    });

    const premier = segments[0]!;
    // Le jeu s'arrete a 200 s ; la victoire et le tableau des scores courent
    // jusqu'a 215 s. Ils ne comptent pas dans le match, mais la fenetre doit
    // les couvrir : c'est la que se lisent la carte, l'issue et les K/D/A.
    expect(premier.endS).toBeLessThan(205);
    expect(premier.windowEndS).toBeGreaterThan(premier.endS + 8);
    expect(premier.windowEndS).toBeLessThanOrEqual(216);
  });

  it('ne fusionne jamais deux manches separees par un ecran noir', () => {
    // Meme avec un seuil de pause absurde, l'ecran noir reste une frontiere.
    const { segments } = detectMatchSegments(features, intensity, {
      samplingHz: HZ,
      minMatchS: 60,
      minGapS: 600,
      windows,
    });
    expect(segments).toHaveLength(2);
  });

  it('sans fenetre fournie, retombe sur le decoupage par le mouvement', () => {
    const { segments, usedBlackScreens } = detectMatchSegments(features, intensity, {
      samplingHz: HZ,
      minMatchS: 60,
      minGapS: 30,
    });
    expect(usedBlackScreens).toBe(false);
    expect(segments.length).toBeGreaterThanOrEqual(1);
  });
});
