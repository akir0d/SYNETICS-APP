import type { MapFingerprint } from '../types';
import { seekTo } from './sampler';

/**
 * Signature visuelle d'une arene.
 *
 * L'idee : une arene EVA a une identite chromatique stable — la couleur de ses
 * murs, son eclairage, la repartition clair/sombre entre le sol, les
 * structures et le plafond. La geometrie precise, elle, change a chaque image
 * puisque le joueur tourne la tete en permanence. On agrege donc plusieurs
 * images reparties sur le match : le mouvement se moyenne et il ne reste que
 * la palette du lieu.
 *
 * Ce descripteur ne connait aucune carte d'origine. Il sert uniquement a dire
 * « ces deux matchs se ressemblent », le nom venant du joueur.
 */

export const HUE_BINS = 12;
export const LUMA_BINS = 8;
export const ZONE_COLS = 4;
export const ZONE_ROWS = 3;

const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;

/** Teinte d'un pixel, en tours (0 a 1), plus sa saturation et sa valeur. */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h /= 6;
    if (h < 0) h += 1;
  }

  return { h, s: max > 0 ? delta / max : 0, v: max / 255 };
}

/** Accumulateur : agrege plusieurs images en une seule signature. */
export class FingerprintAccumulator {
  private readonly hue = new Float64Array(HUE_BINS);
  private readonly luma = new Float64Array(LUMA_BINS);
  private readonly zones = new Float64Array(ZONE_COLS * ZONE_ROWS * 3);
  private frames = 0;

  /** Ajoute une image, donnee en RVBA brut avec ses dimensions. */
  add(data: Uint8ClampedArray, width: number, height: number): void {
    const hue = new Float64Array(HUE_BINS);
    const luma = new Float64Array(LUMA_BINS);
    const zones = new Float64Array(ZONE_COLS * ZONE_ROWS * 3);
    const zoneCounts = new Float64Array(ZONE_COLS * ZONE_ROWS);

    let hueWeight = 0;

    for (let y = 0; y < height; y++) {
      const row = Math.min(ZONE_ROWS - 1, Math.floor((y / height) * ZONE_ROWS));
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = data[i] as number;
        const g = data[i + 1] as number;
        const b = data[i + 2] as number;

        const { h, s, v } = rgbToHsv(r, g, b);

        // Un pixel gris n'a pas de teinte exploitable : le ponderer par sa
        // saturation evite qu'une arene sombre soit decrite par du bruit.
        const weight = s * v;
        if (weight > 0.02) {
          const bin = Math.min(HUE_BINS - 1, Math.floor(h * HUE_BINS));
          hue[bin] = (hue[bin] as number) + weight;
          hueWeight += weight;
        }

        const y601 = 0.299 * r + 0.587 * g + 0.114 * b;
        const lumaBin = Math.min(LUMA_BINS - 1, Math.floor((y601 / 256) * LUMA_BINS));
        luma[lumaBin] = (luma[lumaBin] as number) + 1;

        const col = Math.min(ZONE_COLS - 1, Math.floor((x / width) * ZONE_COLS));
        const zone = row * ZONE_COLS + col;
        zones[zone * 3] = (zones[zone * 3] as number) + r;
        zones[zone * 3 + 1] = (zones[zone * 3 + 1] as number) + g;
        zones[zone * 3 + 2] = (zones[zone * 3 + 2] as number) + b;
        zoneCounts[zone] = (zoneCounts[zone] as number) + 1;
      }
    }

    const pixels = width * height;
    for (let i = 0; i < HUE_BINS; i++) {
      this.hue[i] = (this.hue[i] as number) + (hueWeight > 0 ? (hue[i] as number) / hueWeight : 0);
    }
    for (let i = 0; i < LUMA_BINS; i++) {
      this.luma[i] = (this.luma[i] as number) + (luma[i] as number) / pixels;
    }
    for (let z = 0; z < ZONE_COLS * ZONE_ROWS; z++) {
      const count = Math.max(1, zoneCounts[z] as number);
      for (let c = 0; c < 3; c++) {
        this.zones[z * 3 + c] = (this.zones[z * 3 + c] as number) + (zones[z * 3 + c] as number) / count;
      }
    }
    this.frames++;
  }

  build(): MapFingerprint {
    const n = Math.max(1, this.frames);
    return {
      hue: Array.from(this.hue, (v) => v / n),
      luma: Array.from(this.luma, (v) => v / n),
      zones: Array.from(this.zones, (v) => v / n),
      frames: this.frames,
    };
  }
}

/**
 * Construit la signature d'un match en parcourant des instants repartis
 * regulierement sur sa duree. Une douzaine d'images suffit : au-dela, la
 * moyenne ne bouge plus.
 */
export async function buildMapFingerprint(
  video: HTMLVideoElement,
  startS: number,
  endS: number,
  options: { samples?: number; signal?: AbortSignal } = {},
): Promise<MapFingerprint> {
  const samples = options.samples ?? 12;

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE_WIDTH;
  canvas.height = SAMPLE_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D indisponible sur cette plateforme.');

  const accumulator = new FingerprintAccumulator();
  const span = Math.max(0, endS - startS);

  for (let i = 0; i < samples; i++) {
    if (options.signal?.aborted) break;
    // On evite les tout premiers et tout derniers instants : entree en jeu et
    // ecran de fin ne representent pas l'arene.
    const t = startS + (span * (i + 0.5)) / samples;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    const image = ctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    accumulator.add(image.data, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  }

  return accumulator.build();
}
