import type { HudRegion, MapFingerprint } from '../types';
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

/** Definition de la grille servant a memoriser la forme du nom de carte. */
export const NAME_MASK_COLS = 64;
export const NAME_MASK_ROWS = 16;

/**
 * Reduit une zone de l'image a une grille decrivant la forme du texte qui s'y
 * trouve.
 *
 * Chaque case ne retient pas la luminance moyenne mais la **part de pixels
 * clairs** qu'elle contient : autrement dit la couverture d'encre du glyphe.
 * La moyenne, elle, noyait les jambages fins dans le fond et rendait deux noms
 * differents trop semblables — le seuil se prononce donc pixel par pixel,
 * avant tout moyennage.
 *
 * Le seuil est tire de la zone elle-meme, ce qui rend la trace insensible a la
 * luminosite generale de la captation.
 *
 * C'est une empreinte, pas une lecture : l'application ne sait pas ce qui est
 * ecrit, seulement que c'est la meme chose qu'avant.
 */
export function regionMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number[] {
  const pixels = width * height;
  const luma = new Float64Array(pixels);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const y =
      0.299 * (data[i] as number) + 0.587 * (data[i + 1] as number) + 0.114 * (data[i + 2] as number);
    luma[p] = y;
    if (y < min) min = y;
    if (y > max) max = y;
  }

  const span = max - min;
  // Zone unie : il n'y a rien d'ecrit, donc rien a memoriser.
  if (span < 12) return new Array(NAME_MASK_COLS * NAME_MASK_ROWS).fill(0);

  // Le texte du HUD est clair sur fond sombre : on place le seuil au-dessus du
  // milieu pour ne retenir que les glyphes, pas les halos de compression.
  const threshold = min + 0.55 * span;

  const ink = new Float64Array(NAME_MASK_COLS * NAME_MASK_ROWS);
  const counts = new Float64Array(NAME_MASK_COLS * NAME_MASK_ROWS);

  for (let y = 0; y < height; y++) {
    const row = Math.min(NAME_MASK_ROWS - 1, Math.floor((y / height) * NAME_MASK_ROWS));
    for (let x = 0; x < width; x++) {
      const col = Math.min(NAME_MASK_COLS - 1, Math.floor((x / width) * NAME_MASK_COLS));
      const cell = row * NAME_MASK_COLS + col;
      if ((luma[y * width + x] as number) >= threshold) ink[cell] = (ink[cell] as number) + 1;
      counts[cell] = (counts[cell] as number) + 1;
    }
  }

  return Array.from(ink, (v, i) => v / Math.max(1, counts[i] as number));
}

/** Part de la grille reellement occupee par du texte. */
export function maskInk(mask: readonly number[]): number {
  if (mask.length === 0) return 0;
  let sum = 0;
  for (const v of mask) sum += v;
  return sum / mask.length;
}

/**
 * En dessous de cette occupation, la zone ne contient pas de texte
 * exploitable : cadrage a cote, HUD masque, ecran de transition.
 */
export const MIN_MASK_INK = 0.01;

/**
 * Ecart entre deux traces de texte, sur 0..1.
 *
 * On mesure un recouvrement (indice de Dice) et non un ecart moyen case par
 * case. La difference est decisive : sur une grille dont plus de 80 % des
 * cases sont du fond vide, une moyenne d'ecarts est ecrasee par ces cases
 * identiques, et deux noms de carte totalement differents se retrouvent a
 * cinq centiemes l'un de l'autre. Le recouvrement, lui, ne compte que la ou
 * il y a de l'encre.
 */
export function maskDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 1;

  let intersection = 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i] as number;
    const vb = b[i] as number;
    intersection += Math.min(va, vb);
    total += va + vb;
  }

  // Deux zones vides ne se ressemblent pas : elles ne se comparent pas.
  if (total <= 1e-9) return 1;
  return Math.max(0, Math.min(1, 1 - (2 * intersection) / total));
}

export interface MapNameCapture {
  /** Trace du texte, moyennee sur les images echantillonnees. */
  mask: number[];
  /** Vignette JPEG en base64, pour que le joueur verifie le cadrage. */
  crop: string;
}

/**
 * Preleve la zone du HUD ou le jeu ecrit le nom de la carte, sur plusieurs
 * instants du match, et en tire une trace moyenne plus une vignette.
 */
export async function captureMapName(
  video: HTMLVideoElement,
  startS: number,
  endS: number,
  region: HudRegion,
  options: { samples?: number; signal?: AbortSignal } = {},
): Promise<MapNameCapture | null> {
  const samples = options.samples ?? 6;
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (sourceW === 0 || sourceH === 0) return null;

  const sx = Math.round(region.x * sourceW);
  const sy = Math.round(region.y * sourceH);
  const sw = Math.max(8, Math.round(region.width * sourceW));
  const sh = Math.max(8, Math.round(region.height * sourceH));
  if (sx + sw > sourceW || sy + sh > sourceH) return null;

  // On ne reechantillonne pas vers le bas : sur une captation en haute
  // definition, la zone du HUD contient largement de quoi decrire le texte, et
  // la reduire a une largeur fixe detruisait justement ce qui distingue deux
  // noms.
  const cropW = Math.min(480, Math.max(160, sw));
  const cropH = Math.max(24, Math.round((sh / sw) * cropW));
  const canvas = document.createElement('canvas');
  canvas.width = cropW;
  canvas.height = cropH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const accumulator = new Float64Array(NAME_MASK_COLS * NAME_MASK_ROWS);
  let taken = 0;
  let crop = '';
  const span = Math.max(0, endS - startS);

  for (let i = 0; i < samples; i++) {
    if (options.signal?.aborted) break;
    const t = startS + (span * (i + 0.5)) / samples;
    await seekTo(video, t);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cropW, cropH);
    const image = ctx.getImageData(0, 0, cropW, cropH);
    const mask = regionMask(image.data, cropW, cropH);
    for (let c = 0; c < accumulator.length; c++) {
      accumulator[c] = (accumulator[c] as number) + (mask[c] as number);
    }
    taken++;
    // La vignette montree au joueur vient du milieu du match, la ou le HUD est
    // le plus surement affiche.
    if (i === Math.floor(samples / 2)) {
      const url = canvas.toDataURL('image/jpeg', 0.8);
      crop = url.slice(url.indexOf(',') + 1);
    }
  }

  if (taken === 0) return null;
  return { mask: Array.from(accumulator, (v) => v / taken), crop };
}
