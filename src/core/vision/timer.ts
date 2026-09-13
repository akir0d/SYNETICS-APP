import type { HudRegion } from '../types';
import { classifyGlyph, normalizeGlyph, withBrightInk, PITCH_TO_HEIGHT, type Crop } from './glyphs';

/**
 * Lecture du chronometre affiche en haut du HUD.
 *
 * C'est la piece maitresse de l'alignement : le chronometre est une horloge
 * partagee entre la video et les donnees du jeu. Le lire, c'est savoir a la
 * seconde pres ou l'on se trouve dans la manche — donc pouvoir poser au bon
 * endroit n'importe quel evenement date par ailleurs.
 */

/**
 * Position par defaut du chronometre : centre, tout en haut de l'image de jeu.
 * Reglable, une captation recadree ou un habillage de diffusion decalant tout
 * le HUD.
 */
/**
 * Mesure sur capture : le chronometre occupe une bande etroite, centree. Une
 * zone plus large happerait les deux pourcentages d'equipe qui l'encadrent, et
 * la lecture rendrait huit chiffres au lieu de quatre.
 */
export const DEFAULT_TIMER_REGION: HudRegion = { x: 0.478, y: 0.045, width: 0.046, height: 0.030 };

/**
 * Marge minimale pour retenir une lecture.
 *
 * La marge est l'ecart entre le meilleur chiffre et le meilleur *autre*
 * chiffre. Sur les captures, une lecture juste se situe autour de 0,03 tandis
 * qu'une lecture fausse tombe sous 0,006 : le seuil separe donc largement les
 * deux, et vaut mieux que d'accepter aveuglement ce que rend le classifieur.
 */
export const MIN_TIMER_MARGIN = 0.012;

export interface TimerReading {
  /** Secondes restantes annoncees par le chronometre. */
  remainingS: number;
  minutes: number;
  seconds: number;
  /** Confiance du maillon faible parmi les quatre chiffres. */
  margin: number;
}

interface InkBlock {
  x0: number;
  x1: number;
  /** Etendue verticale de l'encre du bloc, en fraction de la hauteur de ligne. */
  coverage: number;
}

function inkBlocks(crop: Crop, threshold: number): { blocks: InkBlock[]; y0: number; y1: number } {
  const { width, height } = crop;
  const colonnes: number[] = new Array(width).fill(0);
  let premiere = -1;
  let derniere = -1;

  for (let y = 0; y < height; y++) {
    let encree = false;
    for (let x = 0; x < width; x++) {
      if ((crop.luma[y * width + x] as number) > threshold) {
        colonnes[x] = (colonnes[x] as number) + 1;
        encree = true;
      }
    }
    if (encree) {
      if (premiere < 0) premiere = y;
      derniere = y;
    }
  }

  if (premiere < 0) return { blocks: [], y0: 0, y1: 0 };
  const hauteur = derniere - premiere + 1;

  const blocks: InkBlock[] = [];
  let debut = -1;
  for (let x = 0; x <= width; x++) {
    const encre = x < width ? (colonnes[x] as number) : 0;
    if (encre > 0 && debut < 0) debut = x;
    else if (encre === 0 && debut >= 0) {
      let haut = -1;
      let bas = -1;
      for (let y = premiere; y <= derniere; y++) {
        for (let x2 = debut; x2 < x; x2++) {
          if ((crop.luma[y * width + x2] as number) > threshold) {
            if (haut < 0) haut = y;
            bas = y;
            break;
          }
        }
      }
      blocks.push({ x0: debut, x1: x, coverage: haut < 0 ? 0 : (bas - haut + 1) / hauteur });
      debut = -1;
    }
  }

  return { blocks, y0: premiere, y1: derniere + 1 };
}

/**
 * Lit un chronometre au format MM:SS dans une zone deja recadree.
 *
 * Les deux points se reconnaissent a leur encre : ils n'occupent que la partie
 * centrale de la ligne, la ou tous les chiffres, y compris le 1, la couvrent
 * entierement. C'est un critere plus sur que la largeur, un 1 etant aussi
 * etroit qu'un deux-points.
 */
/**
 * Seuil de separation encre / fond, calcule sur la zone elle-meme.
 *
 * Un seuil fixe ne tient pas : selon la carte et l'eclairage, la plaque du
 * chronometre passe du gris clair au gris moyen. On se place aux 55 % de
 * l'etendue, ce qui privilegie l'encre franche et ignore l'anti-crenelage.
 */
function inkThreshold(crop: Crop): number {
  let bas = Number.POSITIVE_INFINITY;
  let haut = Number.NEGATIVE_INFINITY;
  for (const v of crop.luma) {
    if (v < bas) bas = v;
    if (v > haut) haut = v;
  }
  return bas + 0.55 * (haut - bas);
}

export function readTimer(source: Crop): TimerReading | null {
  const crop = withBrightInk(source);
  const threshold = inkThreshold(crop);
  const { blocks, y0, y1 } = inkBlocks(crop, threshold);
  if (blocks.length < 2) return null;

  const hauteur = y1 - y0;
  const pas = PITCH_TO_HEIGHT * hauteur;

  const chiffres: Array<{ x0: number; x1: number; apresSeparateur: boolean }> = [];
  let separateurVu = false;

  for (const bloc of blocks) {
    const largeur = bloc.x1 - bloc.x0;
    if (largeur < pas * 0.1) continue;

    if (bloc.coverage < 0.75 && largeur < pas * 0.5) {
      separateurVu = true;
      continue;
    }

    // Deux chiffres colles ne forment qu'un bloc : on les resepare au pas.
    const parts = Math.max(1, Math.round(largeur / pas + 0.19));
    for (let i = 0; i < parts; i++) {
      chiffres.push({
        x0: bloc.x0 + Math.round((largeur * i) / parts),
        x1: bloc.x0 + Math.round((largeur * (i + 1)) / parts),
        apresSeparateur: separateurVu,
      });
    }
  }

  if (chiffres.length !== 4) return null;

  let texte = '';
  let margin = Number.POSITIVE_INFINITY;
  for (const c of chiffres) {
    const lu = classifyGlyph(normalizeGlyph(crop, c.x0, y0, c.x1, y1));
    texte += lu.char;
    margin = Math.min(margin, lu.margin);
  }

  if (!/^\d{4}$/.test(texte)) return null;
  const minutes = Number.parseInt(texte.slice(0, 2), 10);
  const seconds = Number.parseInt(texte.slice(2), 10);

  // Un chronometre n'affiche jamais soixante secondes ni plus de cent minutes.
  if (seconds >= 60 || minutes >= 100) return null;

  const confiance = Number.isFinite(margin) ? margin : 0;
  if (confiance < MIN_TIMER_MARGIN) return null;

  return { remainingS: minutes * 60 + seconds, minutes, seconds, margin: confiance };
}

export interface ClockSample {
  /** Instant dans la video, en secondes. */
  videoTimeS: number;
  reading: TimerReading;
}

export interface MatchClock {
  /**
   * Instant, dans la video, ou le chronometre affichait sa valeur de depart.
   * Autrement dit le debut exact de la manche.
   */
  startS: number;
  /** Duree annoncee par le chronometre au depart, en secondes. */
  durationS: number;
  /** Nombre de lectures retenues sur le total. */
  used: number;
  total: number;
  /** Ecart median entre les lectures retenues et la droite, en secondes. */
  residualS: number;
}

/**
 * Deduit le debut exact de la manche a partir de plusieurs lectures du
 * chronometre.
 *
 * Le chronometre decroit d'une seconde par seconde : la somme
 * « instant video + temps restant » est donc constante sur toute la manche.
 * On en prend la mediane, ce qui rend le calcul insensible aux lectures
 * fausses isolees — une seule erreur de chiffre deplacerait une moyenne, elle
 * ne deplace pas une mediane.
 */
export function fitMatchClock(samples: readonly ClockSample[], toleranceS = 1.5): MatchClock | null {
  if (samples.length === 0) return null;

  // Somme « instant video + temps restant » : constante sur toute la manche.
  const constantes = samples.map((s) => s.videoTimeS + s.reading.remainingS);
  const approximation = mediane(constantes);

  const retenues = constantes.filter((v) => Math.abs(v - approximation) <= toleranceS);
  if (retenues.length === 0) return null;

  const constante = mediane(retenues);
  const ecarts = retenues.map((v) => Math.abs(v - constante));

  // Le chronometre part d'un compte rond : la plus grande valeur vue, arrondie
  // a la minute, donne la duree annoncee de la manche.
  const maximum = Math.max(...samples.map((s) => s.reading.remainingS));
  const durationS = Math.max(60, Math.round(maximum / 60) * 60);

  return {
    startS: constante - durationS,
    durationS,
    used: retenues.length,
    total: samples.length,
    residualS: mediane(ecarts),
  };
}

function mediane(valeurs: readonly number[]): number {
  const triees = [...valeurs].sort((a, b) => a - b);
  return triees[triees.length >> 1] as number;
}

/** Convertit un instant de la manche en instant de la video. */
export function matchTimeToVideo(clock: MatchClock, matchTimeS: number): number {
  return clock.startS + matchTimeS;
}

/** Convertit un instant de la video en instant de la manche. */
export function videoTimeToMatch(clock: MatchClock, videoTimeS: number): number {
  return videoTimeS - clock.startS;
}
