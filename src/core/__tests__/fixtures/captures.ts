import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import jpeg from 'jpeg-js';
import { chromaOf, luminanceOf } from '../../vision/pixels';
import type { Crop } from '../../vision/glyphs';

const DOSSIER = join(process.cwd(), 'tools', 'glyphes', 'captures');

export interface Capture {
  luma: Float32Array;
  chroma: Float32Array;
  width: number;
  height: number;
}

/** Charge une capture de rediffusion versionnee avec le projet. */
export function loadCapture(nom: string): Capture {
  const brut = jpeg.decode(readFileSync(join(DOSSIER, `${nom}.jpg`)), { useTArray: true });
  const pixels = brut.width * brut.height;
  return {
    luma: luminanceOf(brut.data, pixels),
    chroma: chromaOf(brut.data, pixels),
    width: brut.width,
    height: brut.height,
  };
}

/**
 * Cadre de l'image de jeu dans chaque capture de reference.
 *
 * Ces captures sont des captures d'ecran de telephone : l'image de jeu y est
 * encadree de bandes noires, d'une barre d'etat et de l'interface du lecteur.
 * Plutot qu'une detection fragile — l'ecran de decompte est presque noir, et
 * la pellicule du bas est plus claire que le jeu — on fige la geometrie
 * mesuree une fois pour toutes.
 *
 * Rien de tout cela ne concerne l'application : une vraie rediffusion est un
 * fichier video dont l'image de jeu occupe tout le cadre.
 */
const CADRES: Record<string, { y0: number; y1: number }> = {
  'lobby-10min': { y0: 538, y1: 1645 },
  'cf3a69f0': { y0: 538, y1: 1645 },
  '4df5ce74': { y0: 88, y1: 1195 },
  'df7af499': { y0: 88, y1: 1195 },
  'league-cast': { y0: 89, y1: 1196 },
  'carolo-moux-nnx': { y0: 89, y1: 1196 },
};

export function gameFrame(nom: string): { y0: number; y1: number } {
  const cadre = CADRES[nom];
  if (!cadre) throw new Error(`cadre inconnu pour la capture ${nom}`);
  return cadre;
}

/** Extrait une zone exprimee en fractions de l'image de jeu. */
export function cropRegion(
  capture: Capture,
  frame: { y0: number; y1: number },
  region: { x: number; y: number; width: number; height: number },
): Crop {
  const hauteurJeu = frame.y1 - frame.y0;
  const x0 = Math.round(region.x * capture.width);
  const y0 = frame.y0 + Math.round(region.y * hauteurJeu);
  const w = Math.round(region.width * capture.width);
  const h = Math.round(region.height * hauteurJeu);

  const luma = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      luma[y * w + x] = capture.luma[(y0 + y) * capture.width + (x0 + x)] as number;
    }
  }
  return { luma, width: w, height: h };
}
