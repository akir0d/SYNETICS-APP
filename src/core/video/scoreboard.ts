import type { ScoreboardSummary } from '../types';
import { chromaOf, luminanceOf } from '../vision/pixels';
import { decideWinner, readScoreboard, teamScore, type ScoreboardReading } from '../vision/scoreboard';
import { seekTo } from './sampler';

/**
 * Recherche du tableau des scores dans la video.
 *
 * Le tableau n'apparait que quelques secondes, apres l'ecran de victoire et
 * avant le retour au lobby. On ne sait pas exactement quand, alors on essaie
 * plusieurs instants de la fenetre de fin et on garde la meilleure lecture.
 * Le lecteur rend `null` sur tout ecran qui n'est pas un tableau, ce qui rend
 * cette recherche sure : une image de lobby ou de fondu ne produit jamais de
 * chiffres inventes.
 */

/**
 * Au-dela de cette largeur l'image est reduite avant lecture. Les captures de
 * reference ont l'image de jeu en 1968 pixels de large et le reperage y trouve
 * des pictogrammes de trente pixels ; descendre plus bas les ferait passer sous
 * la taille minimale que le reperage exige.
 */
const MAX_WIDTH = 1920;

export interface ScoreboardCapture {
  /** Instant, en secondes dans le fichier source, ou le tableau a ete lu. */
  atS: number;
  reading: ScoreboardReading;
}

/** Nombre de valeurs effectivement lues : sert a departager deux images. */
function completeness(reading: ScoreboardReading): number {
  let lues = 0;
  for (const equipe of reading.teams) {
    if (equipe.percent !== null) lues += 4;
    for (const carte of equipe.cards) {
      for (const v of [carte.score, carte.kills, carte.deaths, carte.assists]) {
        if (v !== null) lues += 1;
      }
    }
  }
  return lues;
}

export async function findScoreboard(
  video: HTMLVideoElement,
  times: readonly number[],
  options: { signal?: AbortSignal } = {},
): Promise<ScoreboardCapture | null> {
  const sourceW = video.videoWidth;
  const sourceH = video.videoHeight;
  if (sourceW === 0 || sourceH === 0 || times.length === 0) return null;

  const width = Math.min(MAX_WIDTH, sourceW);
  const height = Math.max(1, Math.round((sourceH / sourceW) * width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  let meilleur: ScoreboardCapture | null = null;
  let meilleurScore = 0;

  for (const t of times) {
    options.signal?.throwIfAborted();
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    const pixels = width * height;
    const lu = readScoreboard(
      luminanceOf(image.data, pixels),
      width,
      height,
      chromaOf(image.data, pixels),
    );
    if (!lu) continue;
    const score = completeness(lu);
    if (score > meilleurScore) {
      meilleurScore = score;
      meilleur = { atS: t, reading: lu };
    }
  }

  return meilleur;
}

export function summarize(capture: ScoreboardCapture): ScoreboardSummary {
  const verdict = decideWinner(capture.reading);
  return {
    atS: capture.atS,
    percents: capture.reading.teams.map((e) => e.percent),
    totals: capture.reading.teams.map(teamScore),
    winner: verdict?.winner ?? null,
    agreed: verdict?.agreed ?? false,
    teams: capture.reading.teams.map((e) =>
      e.cards.map((c) => ({ score: c.score, kills: c.kills, deaths: c.deaths, assists: c.assists })),
    ),
  };
}
