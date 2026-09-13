import { describe, expect, it } from 'vitest';
import {
  fingerprintDistance,
  identifyMap,
  MATCH_DISTANCE,
  mergeFingerprints,
  unknownMap,
} from '../analysis/mapmatch';
import {
  FingerprintAccumulator,
  maskDistance,
  NAME_MASK_COLS,
  NAME_MASK_ROWS,
  regionMask,
  rgbToHsv,
  HUE_BINS,
  LUMA_BINS,
} from '../video/fingerprint';
import type { KnownMap, MapFingerprint } from '../types';

/** Fabrique une image unie de la couleur demandee. */
function solidImage(r: number, g: number, b: number, width = 8, height = 6): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function fingerprintOf(r: number, g: number, b: number): MapFingerprint {
  const acc = new FingerprintAccumulator();
  acc.add(solidImage(r, g, b), 8, 6);
  return acc.build();
}

function knownMap(id: string, name: string, fingerprint: MapFingerprint): KnownMap {
  return {
    id,
    name,
    fingerprint,
    matchCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('conversion de couleur', () => {
  it('place les teintes primaires la ou on les attend', () => {
    expect(rgbToHsv(255, 0, 0).h).toBeCloseTo(0, 3);
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(1 / 3, 3);
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(2 / 3, 3);
  });

  it('donne une saturation nulle aux gris', () => {
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
    expect(rgbToHsv(0, 0, 0).s).toBe(0);
  });
});

describe('signature d arene', () => {
  it('produit des histogrammes normalises', () => {
    const fp = fingerprintOf(40, 90, 200);
    expect(fp.hue).toHaveLength(HUE_BINS);
    expect(fp.luma).toHaveLength(LUMA_BINS);
    expect(fp.hue.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(fp.luma.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
    expect(fp.frames).toBe(1);
  });

  it('ignore la teinte des images sans couleur', () => {
    // Un gris pur n'a pas de teinte : la ponderer par la saturation evite de
    // decrire une arene sombre avec du bruit.
    const gris = fingerprintOf(120, 120, 120);
    expect(gris.hue.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('moyenne plusieurs images', () => {
    const acc = new FingerprintAccumulator();
    acc.add(solidImage(200, 30, 30), 8, 6);
    acc.add(solidImage(200, 30, 30), 8, 6);
    const fp = acc.build();
    expect(fp.frames).toBe(2);
    expect(fp.luma.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

describe('comparaison d arenes', () => {
  const bleue = fingerprintOf(40, 90, 200);
  const bleueVariante = fingerprintOf(45, 95, 195);
  const orange = fingerprintOf(220, 130, 40);

  it('reconnait une arene comme identique a elle-meme', () => {
    expect(fingerprintDistance(bleue, bleue)).toBe(0);
  });

  it('est symetrique', () => {
    expect(fingerprintDistance(bleue, orange)).toBeCloseTo(fingerprintDistance(orange, bleue), 10);
  });

  it('rapproche deux nuances de la meme arene', () => {
    expect(fingerprintDistance(bleue, bleueVariante)).toBeLessThan(MATCH_DISTANCE);
  });

  it('separe deux arenes de couleurs opposees', () => {
    expect(fingerprintDistance(bleue, orange)).toBeGreaterThan(MATCH_DISTANCE);
  });
});

describe('identification', () => {
  const bleue = fingerprintOf(40, 90, 200);
  const orange = fingerprintOf(220, 130, 40);
  const verte = fingerprintOf(50, 190, 70);

  it('ne propose rien quand la bibliotheque est vide', () => {
    const result = identifyMap(bleue, []);
    expect(result.mapId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('retrouve une arene deja nommee', () => {
    const result = identifyMap(fingerprintOf(45, 95, 195), [
      knownMap('m1', 'Station', bleue),
      knownMap('m2', 'Desert', orange),
    ]);
    expect(result.mapId).toBe('m1');
    expect(result.mapName).toBe('Station');
    expect(result.confidence).toBeGreaterThan(0);
    // Une reconnaissance automatique n'est jamais une certitude.
    expect(result.confidence).toBeLessThanOrEqual(0.9);
    expect(result.confirmed).toBe(false);
  });

  it('refuse de trancher entre deux arenes trop semblables', () => {
    // Deux entrees quasi identiques dans la bibliotheque : le bon comportement
    // est le doute, pas un choix au hasard entre les deux.
    const result = identifyMap(bleue, [
      knownMap('m1', 'Station A', fingerprintOf(41, 91, 199)),
      knownMap('m2', 'Station B', fingerprintOf(40, 90, 200)),
    ]);
    expect(result.mapId).toBeNull();
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
  });

  it('laisse une arene inconnue non rattachee', () => {
    const result = identifyMap(verte, [knownMap('m1', 'Station', bleue), knownMap('m2', 'Desert', orange)]);
    expect(result.mapId).toBeNull();
    expect(result.distance).toBeGreaterThan(MATCH_DISTANCE);
  });

  it('expose une identification vide exploitable', () => {
    const empty = unknownMap();
    expect(empty.mapId).toBeNull();
    expect(empty.mapName).toBe('');
    expect(empty.confirmed).toBe(false);
  });
});

describe('apprentissage d une arene', () => {
  const reference = fingerprintOf(40, 90, 200);
  const nouvelle = fingerprintOf(220, 130, 40);

  it('cumule les images des signatures fusionnees', () => {
    const merged = mergeFingerprints(reference, nouvelle, 1);
    expect(merged.frames).toBe(reference.frames + nouvelle.frames);
    expect(merged.hue).toHaveLength(HUE_BINS);
  });

  it('resiste d autant plus au changement que l arene est deja bien connue', () => {
    const jeune = mergeFingerprints(reference, nouvelle, 1);
    const etablie = mergeFingerprints(reference, nouvelle, 40);

    // Une arene vue quarante fois ne doit pas basculer sur un seul match atypique.
    expect(fingerprintDistance(reference, etablie)).toBeLessThan(
      fingerprintDistance(reference, jeune),
    );
  });

  it('reste normalise apres fusion', () => {
    const merged = mergeFingerprints(reference, nouvelle, 3);
    expect(merged.luma.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });
});

/** Fabrique une bande de texte factice : des colonnes claires sur fond sombre. */
function bandeTexte(colonnes: readonly number[], width = 80, height = 20): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const clair = colonnes.includes(Math.floor((x / width) * 10)) && y > 4 && y < height - 4;
      const v = clair ? 235 : 25;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('empreinte du nom de carte', () => {
  const atlantis = regionMask(bandeTexte([1, 2, 4, 7]), 80, 20);
  const atlantisAutreManche = regionMask(bandeTexte([1, 2, 4, 7]), 80, 20);
  const autreCarte = regionMask(bandeTexte([0, 3, 5, 6, 8]), 80, 20);

  it('produit une grille de la taille attendue', () => {
    expect(atlantis).toHaveLength(NAME_MASK_COLS * NAME_MASK_ROWS);
    expect(Math.min(...atlantis)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...atlantis)).toBeLessThanOrEqual(1);
  });

  it('donne la meme trace pour le meme texte', () => {
    expect(maskDistance(atlantis, atlantisAutreManche)).toBe(0);
  });

  it('separe nettement deux textes differents', () => {
    expect(maskDistance(atlantis, autreCarte)).toBeGreaterThan(0.2);
  });

  it('resiste a un changement de luminosite de la captation', () => {
    // Meme texte, image globalement plus sombre : l'etirement de contraste
    // doit annuler la difference.
    const sombre = bandeTexte([1, 2, 4, 7]);
    for (let i = 0; i < sombre.length; i += 4) {
      sombre[i] = Math.round((sombre[i] as number) * 0.5);
      sombre[i + 1] = Math.round((sombre[i + 1] as number) * 0.5);
      sombre[i + 2] = Math.round((sombre[i + 2] as number) * 0.5);
    }
    expect(maskDistance(atlantis, regionMask(sombre, 80, 20))).toBeLessThan(0.02);
  });

  it('neutralise une zone unie, ou il n y a rien a lire', () => {
    const unie = regionMask(bandeTexte([]), 80, 20);
    expect(unie.every((v) => v === 0)).toBe(true);
  });
});

describe('reconnaissance quand le nom de carte est lisible', () => {
  const paletteA = fingerprintOf(40, 90, 200);
  const paletteB = fingerprintOf(220, 130, 40);
  const nomAtlantis = regionMask(bandeTexte([1, 2, 4, 7]), 80, 20);
  const nomStation = regionMask(bandeTexte([0, 3, 5, 6, 8]), 80, 20);

  it('rapproche deux manches sur la meme carte malgre des palettes opposees', () => {
    // Meme arene filmee de jour et de nuit, ou avec un rendu different : le
    // nom ecrit dans le HUD, lui, ne change pas.
    const jour = { ...paletteA, nameMask: nomAtlantis };
    const nuit = { ...paletteB, nameMask: nomAtlantis };
    expect(fingerprintDistance(jour, nuit)).toBeLessThan(MATCH_DISTANCE);
  });

  it('separe deux cartes malgre des palettes identiques', () => {
    // Deux arenes a l'ambiance tres proche : sans le nom, elles seraient
    // confondues ; avec, elles se distinguent.
    const sansNom = fingerprintDistance(paletteA, paletteA);
    const avecNom = fingerprintDistance(
      { ...paletteA, nameMask: nomAtlantis },
      { ...paletteA, nameMask: nomStation },
    );
    expect(sansNom).toBe(0);
    expect(avecNom).toBeGreaterThan(MATCH_DISTANCE);
  });

  it('se rabat sur la palette quand une seule des deux signatures a un nom', () => {
    const avec = { ...paletteA, nameMask: nomAtlantis };
    expect(fingerprintDistance(avec, paletteA)).toBe(fingerprintDistance(paletteA, paletteA));
  });

  it('conserve la trace du nom en fusionnant deux signatures', () => {
    const fusion = mergeFingerprints(
      { ...paletteA, nameMask: nomAtlantis },
      { ...paletteA, nameMask: nomAtlantis },
      1,
    );
    expect(fusion.nameMask).toBeDefined();
    expect(maskDistance(fusion.nameMask!, nomAtlantis)).toBeLessThan(0.001);
  });
});
