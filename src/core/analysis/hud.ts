import type { FrameFeature } from '../types';

/**
 * Lecture des marqueurs que le jeu affiche lui-meme.
 *
 * EVA structure ses rediffusions de facon tres reguliere :
 *
 * - lobby, avec le nom de carte ecrit sous le chronometre ;
 * - decompte de dix, puis **ecran noir** ;
 * - la manche ;
 * - VICTOIRE ou DEFAITE en plein ecran, avec un decompte en haut a gauche ;
 * - tableau des scores ;
 * - **ecran noir**, retour au lobby.
 *
 * Les deux ecrans noirs encadrent donc chaque manche. C'est un reperage bien
 * plus sur que le mouvement : il vient du jeu, pas d'une estimation.
 */

export interface BlackRun {
  startS: number;
  endS: number;
}

export interface BlackScreenOptions {
  /** Luminance moyenne en dessous de laquelle une image est consideree noire. */
  maxLuma: number;
  /** Saturation maximale toleree : un ecran noir n'a aucune couleur. */
  maxSaturation: number;
  /** Duree minimale d'un fondu au noir pour compter comme une transition. */
  minDurationS: number;
}

export const DEFAULT_BLACK_SCREEN: BlackScreenOptions = {
  // Les transitions d'EVA sont franches ; on garde une marge pour une
  // captation filmee a l'ecran, jamais parfaitement noire.
  maxLuma: 0.06,
  maxSaturation: 0.01,
  minDurationS: 0.3,
};

/** Repere les passages au noir de la rediffusion. */
export function detectBlackRuns(
  features: readonly FrameFeature[],
  options: Partial<BlackScreenOptions> = {},
): BlackRun[] {
  const opts = { ...DEFAULT_BLACK_SCREEN, ...options };
  const runs: BlackRun[] = [];
  let start: number | null = null;
  let previous = 0;

  for (const f of features) {
    const isBlack = f.luma <= opts.maxLuma && f.saturation <= opts.maxSaturation;
    if (isBlack && start === null) start = f.t;
    if (!isBlack && start !== null) {
      if (previous - start >= opts.minDurationS) runs.push({ startS: start, endS: previous });
      start = null;
    }
    previous = f.t;
  }

  if (start !== null && previous - start >= opts.minDurationS) {
    runs.push({ startS: start, endS: previous });
  }
  return runs;
}

/**
 * Fenetres delimitees par les ecrans noirs.
 *
 * Une fenetre part de la fin d'un ecran noir et s'arrete au debut du suivant.
 * Elle contient donc soit une manche complete (jeu, ecran de victoire, tableau
 * des scores), soit un temps de lobby : c'est au moteur de mouvement de
 * trancher entre les deux.
 */
export function windowsBetweenBlackRuns(
  runs: readonly BlackRun[],
  durationS: number,
): BlackRun[] {
  const windows: BlackRun[] = [];
  let cursor = 0;

  for (const run of runs) {
    if (run.startS - cursor > 0) windows.push({ startS: cursor, endS: run.startS });
    cursor = run.endS;
  }
  if (durationS - cursor > 0) windows.push({ startS: cursor, endS: durationS });

  return windows;
}
