/**
 * Operations de bas niveau sur une image : luminance et composantes connexes.
 *
 * Ce module ne touche jamais au DOM, ce qui le rend testable hors navigateur.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const boxWidth = (b: Box): number => b.x1 - b.x0;
export const boxHeight = (b: Box): number => b.y1 - b.y0;
export const boxCenterX = (b: Box): number => (b.x0 + b.x1) / 2;
export const boxCenterY = (b: Box): number => (b.y0 + b.y1) / 2;

/** Luminance perceptuelle (Rec. 601) d'une image RVBA. */
export function luminanceOf(data: Uint8ClampedArray | Uint8Array, pixels: number): Float32Array {
  const out = new Float32Array(pixels);
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    out[p] =
      0.299 * (data[i] as number) + 0.587 * (data[i + 1] as number) + 0.114 * (data[i + 2] as number);
  }
  return out;
}

/**
 * Chrominance : ecart entre la composante la plus forte et la plus faible.
 *
 * Le HUD d'EVA ecrit ses pourcentages dans la couleur de l'equipe — orange,
 * bleu, jaune — sur un decor qui reste gris. La luminance ne suffit pas a les
 * isoler : sur une capture le « 100 % » orange se detache en clair sur un sol
 * sombre, sur une autre il se detache en sombre sur un mur blanc, et un seuil
 * sur la clarte se trompe donc de polarite d'une image a l'autre. La
 * saturation, elle, ne change pas de sens : le texte en a beaucoup, le decor
 * n'en a presque pas.
 */
export function chromaOf(data: Uint8ClampedArray | Uint8Array, pixels: number): Float32Array {
  const out = new Float32Array(pixels);
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    const r = data[i] as number;
    const v = data[i + 1] as number;
    const b = data[i + 2] as number;
    out[p] = Math.max(r, v, b) - Math.min(r, v, b);
  }
  return out;
}

/** Quantile d'un canal, sur une sous-image rectangulaire. */
export function quantileIn(
  channel: Float32Array,
  width: number,
  box: Box,
  q: number,
): number {
  const valeurs: number[] = [];
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) valeurs.push(channel[y * width + x] as number);
  }
  if (valeurs.length === 0) return 0;
  valeurs.sort((a, b) => a - b);
  const i = Math.min(valeurs.length - 1, Math.max(0, Math.round(q * (valeurs.length - 1))));
  return valeurs[i] as number;
}

/**
 * Boites englobantes des taches de pixels clairs.
 *
 * Le parcours se fait en largeur sur une pile de type entier plutot qu'en
 * recursion : une composante peut couvrir des dizaines de milliers de pixels
 * et ferait deborder la pile d'appels.
 */
export function brightComponents(
  luma: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Box[] {
  const vus = new Uint8Array(width * height);
  const pile = new Int32Array(width * height);
  const boites: Box[] = [];

  for (let depart = 0; depart < luma.length; depart++) {
    if (vus[depart] === 1 || (luma[depart] as number) <= threshold) continue;

    let sommet = 0;
    pile[sommet++] = depart;
    vus[depart] = 1;

    let x0 = depart % width;
    let x1 = x0;
    let y0 = (depart / width) | 0;
    let y1 = y0;

    while (sommet > 0) {
      const p = pile[--sommet] as number;
      const x = p % width;
      const y = (p / width) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;

      // Voisinage a quatre directions : suffisant pour du texte, et deux fois
      // moins de tests que le voisinage a huit.
      if (x > 0 && vus[p - 1] === 0 && (luma[p - 1] as number) > threshold) {
        vus[p - 1] = 1;
        pile[sommet++] = p - 1;
      }
      if (x < width - 1 && vus[p + 1] === 0 && (luma[p + 1] as number) > threshold) {
        vus[p + 1] = 1;
        pile[sommet++] = p + 1;
      }
      if (y > 0 && vus[p - width] === 0 && (luma[p - width] as number) > threshold) {
        vus[p - width] = 1;
        pile[sommet++] = p - width;
      }
      if (y < height - 1 && vus[p + width] === 0 && (luma[p + width] as number) > threshold) {
        vus[p + width] = 1;
        pile[sommet++] = p + width;
      }
    }

    boites.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 });
  }

  return boites;
}

/** Part de pixels clairs dans une boite. */
export function fillRatio(luma: Float32Array, width: number, box: Box, threshold: number): number {
  let clairs = 0;
  let total = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      if ((luma[y * width + x] as number) > threshold) clairs++;
      total++;
    }
  }
  return total > 0 ? clairs / total : 0;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const triees = [...values].sort((a, b) => a - b);
  return triees[triees.length >> 1] as number;
}
