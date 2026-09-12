import type { FrameFeature } from '../types';

export interface SyntheticOptions {
  durationS: number;
  samplingHz: number;
  /** Fenetres [debut, fin] ou le mouvement est eleve. */
  actionWindows: Array<[number, number]>;
  /** Instants ou un flash rouge marque des degats subis. */
  redFlashes: number[];
  /** Instants ou l'image change brutalement (mort, respawn, changement de vue). */
  cuts: number[];
  /**
   * Mouvement de fond hors action. La valeur par defaut represente une camera
   * qui vit legerement ; passer une valeur tres basse imite un ecran fige
   * (menu, briefing, attente entre deux manches).
   */
  idleDiff?: number;
}

/**
 * Fabrique une serie de mesures comme si elle sortait d'une vraie video.
 * Cela permet de tester le moteur de detection sans dependre d'un fichier
 * video ni d'un navigateur.
 */
export function syntheticFeatures(opts: SyntheticOptions): FrameFeature[] {
  const step = 1 / opts.samplingHz;
  const count = Math.floor(opts.durationS / step);
  const features: FrameFeature[] = [];

  for (let i = 0; i < count; i++) {
    const t = i * step;
    const inAction = opts.actionWindows.some(([from, to]) => t >= from && t <= to);

    // Un peu de bruit deterministe : une video reelle n'est jamais parfaitement stable.
    const noise = ((i * 37) % 11) / 1000;

    let diff = (inAction ? 0.22 : opts.idleDiff ?? 0.03) + noise;
    let redBias = 0.02 + noise;
    const saturation = (inAction ? 0.09 : 0.02) + noise;

    if (opts.redFlashes.some((f) => Math.abs(f - t) < step / 2)) redBias = 0.4;
    if (opts.cuts.some((c) => Math.abs(c - t) < step / 2)) diff = 0.85;

    features.push({
      t,
      luma: opts.cuts.some((c) => Math.abs(c - t) < step / 2) ? 0.05 : 0.45 + noise,
      redBias,
      diff,
      saturation,
    });
  }

  return features;
}
