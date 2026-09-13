import donnees from './glyphes.json';

/**
 * Lecture des chiffres du HUD d'EVA, hors ligne.
 *
 * Le jeu dessine toujours la meme police, a la meme taille relative : on
 * reconnait donc les chiffres par comparaison de formes plutot que par un
 * moteur d'OCR generaliste, qui rend du charabia sur cette police carree.
 *
 * Les exemplaires sont conserves un a un plutot que moyennes par chiffre. Ce
 * n'est pas un detail : un 5 et un 6 ne different que par leur coin
 * bas-gauche, et la moyenne efface exactement ce detail. Mesure en validation
 * croisee sur trois rediffusions : 92,7 % de nombres exacts avec la moyenne,
 * 96,9 % avec le plus proche voisin.
 */

/** Grille de normalisation d'un glyphe. */
export const GLYPH_W = donnees.largeur;
export const GLYPH_H = donnees.hauteur;
const CELLS = GLYPH_W * GLYPH_H;

/**
 * Rapport mesure entre le pas de la police du HUD et la hauteur de ses
 * glyphes. Constant a moins de 5 % pres sur toutes les captations relevees.
 */
export const PITCH_TO_HEIGHT = 0.84;

interface Exemplar {
  char: string;
  grid: Float32Array;
}

function decodeExemplars(): Exemplar[] {
  const out: Exemplar[] = [];
  for (const [char, encodes] of Object.entries(donnees.exemplaires as Record<string, string[]>)) {
    for (const encode of encodes) {
      const binaire = atob(encode);
      const grid = new Float32Array(CELLS);
      for (let i = 0; i < CELLS && i < binaire.length; i++) grid[i] = binaire.charCodeAt(i) / 255;
      out.push({ char, grid });
    }
  }
  return out;
}

let exemplars: Exemplar[] | null = null;

function library(): Exemplar[] {
  if (!exemplars) exemplars = decodeExemplars();
  return exemplars;
}

export interface Classification {
  char: string;
  /** Distance au plus proche exemplaire. Plus c'est bas, mieux c'est. */
  distance: number;
  /** Ecart avec le plus proche exemplaire d'un *autre* chiffre. */
  margin: number;
}

/** Chiffre dont un exemplaire est le plus proche de la grille fournie. */
export function classifyGlyph(grid: Float32Array): Classification {
  let best: Exemplar | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  let otherDistance = Number.POSITIVE_INFINITY;

  for (const exemplar of library()) {
    let somme = 0;
    for (let i = 0; i < CELLS; i++) {
      const ecart = (grid[i] as number) - (exemplar.grid[i] as number);
      somme += ecart * ecart;
    }
    const distance = somme / CELLS;

    if (distance < bestDistance) {
      // Le precedent meilleur devient un concurrent, sauf s'il s'agit du meme
      // chiffre : la marge doit mesurer l'ecart avec une *autre* lecture.
      if (best && best.char !== exemplar.char) otherDistance = Math.min(otherDistance, bestDistance);
      bestDistance = distance;
      best = exemplar;
    } else if (best && exemplar.char !== best.char) {
      otherDistance = Math.min(otherDistance, distance);
    }
  }

  return {
    char: best?.char ?? '',
    distance: bestDistance,
    margin: Number.isFinite(otherDistance) ? otherDistance - bestDistance : 0,
  };
}

export interface Crop {
  /** Luminance, une valeur par pixel. */
  luma: Float32Array;
  width: number;
  height: number;
}

/**
 * Retourne une vue ou le texte est toujours clair sur fond sombre.
 *
 * Le HUD d'EVA n'a pas une polarite unique : les scores et les pseudos sont
 * clairs sur fond sombre, mais le chronometre est ecrit en sombre sur une
 * plaque claire. Plutot que de coder cette exception quelque part, on regarde
 * la luminance mediane de la zone : au-dessus du milieu, c'est un fond clair,
 * et on inverse.
 */
export function withBrightInk(crop: Crop): Crop {
  const echantillon: number[] = [];
  const pas = Math.max(1, Math.floor(crop.luma.length / 2000));
  for (let i = 0; i < crop.luma.length; i += pas) echantillon.push(crop.luma[i] as number);
  echantillon.sort((a, b) => a - b);
  const medianeFond = echantillon[echantillon.length >> 1] as number;
  if (medianeFond <= 128) return crop;

  const luma = new Float32Array(crop.luma.length);
  for (let i = 0; i < luma.length; i++) luma[i] = 255 - (crop.luma[i] as number);
  return { luma, width: crop.width, height: crop.height };
}

/**
 * Normalise un glyphe sur la grille de reference, en niveaux de gris a
 * contraste etire.
 *
 * On garde les niveaux plutot que de binariser : a cette taille,
 * l'anti-crenelage porte l'essentiel de ce qui distingue deux chiffres de
 * forme voisine.
 */
export function normalizeGlyph(crop: Crop, x0: number, y0: number, x1: number, y1: number): Float32Array {
  const grid = new Float32Array(CELLS);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return grid;

  let bas = Number.POSITIVE_INFINITY;
  let haut = Number.NEGATIVE_INFINITY;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = crop.luma[y * crop.width + x] as number;
      if (v < bas) bas = v;
      if (v > haut) haut = v;
    }
  }
  const etendue = haut - bas;
  if (etendue <= 1) return grid;

  for (let gy = 0; gy < GLYPH_H; gy++) {
    const ya = y0 + Math.floor((gy * h) / GLYPH_H);
    const yb = Math.max(y0 + Math.floor(((gy + 1) * h) / GLYPH_H), ya + 1);
    for (let gx = 0; gx < GLYPH_W; gx++) {
      const xa = x0 + Math.floor((gx * w) / GLYPH_W);
      const xb = Math.max(x0 + Math.floor(((gx + 1) * w) / GLYPH_W), xa + 1);
      let somme = 0;
      let n = 0;
      for (let y = ya; y < yb; y++) {
        for (let x = xa; x < xb; x++) {
          somme += ((crop.luma[y * crop.width + x] as number) - bas) / etendue;
          n++;
        }
      }
      grid[gy * GLYPH_W + gx] = n > 0 ? somme / n : 0;
    }
  }
  return grid;
}

export interface GlyphBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Decoupe une case en glyphes, de gauche a droite.
 *
 * Trois precautions, chacune tiree d'une erreur constatee sur de vraies
 * captures :
 *
 * - on part des blocs d'encre reels et non d'une grille ancree a gauche : un
 *   nombre commencant par 1 decalait toute la grille, ce chiffre etant etroit
 *   mais centre dans sa chasse ;
 * - un bloc trop large pour un seul glyphe est redecoupe, deux chiffres
 *   voisins se touchant souvent par leur anti-crenelage ;
 * - chaque glyphe est finalement cadre sur une boite de largeur constante
 *   centree sur son encre, sans quoi un chiffre isole ne se normalise pas
 *   comme le meme chiffre colle a son voisin.
 */
export function segmentGlyphs(crop: Crop, threshold: number): GlyphBox[] {
  const { width, height } = crop;
  const profil = new Int32Array(width);
  let premiereLigne = -1;
  let derniereLigne = -1;

  for (let y = 0; y < height; y++) {
    let ligneEncree = false;
    for (let x = 0; x < width; x++) {
      if ((crop.luma[y * width + x] as number) > threshold) {
        profil[x] = (profil[x] as number) + 1;
        ligneEncree = true;
      }
    }
    if (ligneEncree) {
      if (premiereLigne < 0) premiereLigne = y;
      derniereLigne = y;
    }
  }

  if (premiereLigne < 0) return [];
  const hauteur = derniereLigne - premiereLigne + 1;
  if (hauteur < height * 0.3) return [];

  const pas = PITCH_TO_HEIGHT * hauteur;

  const blocs: Array<[number, number]> = [];
  let debut = -1;
  for (let x = 0; x <= width; x++) {
    const encre = x < width ? (profil[x] as number) : 0;
    if (encre > 0 && debut < 0) debut = x;
    else if (encre === 0 && debut >= 0) {
      blocs.push([debut, x]);
      debut = -1;
    }
  }

  const centres: number[] = [];
  for (const [bx0, bx1] of blocs) {
    const largeur = bx1 - bx0;
    if (largeur < pas * 0.12) continue; // poussiere, trop etroit meme pour un 1

    const parts = Math.max(1, Math.round(largeur / pas + 0.19));
    for (let i = 0; i < parts; i++) {
      const sx0 = bx0 + (largeur * i) / parts;
      const sx1 = bx0 + (largeur * (i + 1)) / parts;
      let poids = 0;
      let total = 0;
      for (let x = Math.floor(sx0); x < Math.max(Math.floor(sx0) + 1, Math.floor(sx1)); x++) {
        const encre = profil[x] as number;
        poids += x * encre;
        total += encre;
      }
      if (total > 0) centres.push(poids / total);
    }
  }

  const demi = pas / 2;
  const boites: GlyphBox[] = [];
  for (const centre of centres) {
    const x0 = Math.max(0, Math.round(centre - demi));
    const x1 = Math.min(width, Math.round(centre + demi));
    if (x1 - x0 >= 2) boites.push({ x0, y0: premiereLigne, x1, y1: derniereLigne + 1 });
  }
  return boites;
}

export interface ReadNumber {
  text: string;
  value: number | null;
  /** Plus faible marge parmi les glyphes lus : la confiance du maillon faible. */
  margin: number;
}

/** Lit un nombre entier dans une case deja recadree. */
export function readNumber(crop: Crop, threshold: number): ReadNumber {
  const boites = segmentGlyphs(crop, threshold);
  let text = '';
  let margin = Number.POSITIVE_INFINITY;

  for (const b of boites) {
    const lu = classifyGlyph(normalizeGlyph(crop, b.x0, b.y0, b.x1, b.y1));
    text += lu.char;
    margin = Math.min(margin, lu.margin);
  }

  return {
    text,
    value: /^\d+$/.test(text) ? Number.parseInt(text, 10) : null,
    margin: Number.isFinite(margin) ? margin : 0,
  };
}
