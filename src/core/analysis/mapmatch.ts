import type { KnownMap, MapFingerprint, MapIdentification } from '../types';
import { clamp01 } from './stats';

/**
 * Rapprochement d'un match avec les arenes deja connues de l'appareil.
 *
 * Aucune base de cartes EVA n'est embarquee : la bibliotheque se construit au
 * fur et a mesure, a partir des noms que le joueur donne lui-meme. Le premier
 * match dans une arene est donc toujours « arene inconnue » — les suivants
 * sont reconnus.
 */

/** Distance en deca de laquelle deux matchs sont consideres joues au meme endroit. */
export const MATCH_DISTANCE = 0.22;

/** Ecart minimal avec la deuxieme meilleure arene pour trancher sans ambiguite. */
export const MIN_MARGIN = 0.05;

const WEIGHTS = { hue: 0.45, luma: 0.2, zones: 0.35 };

/** Distance L1 normalisee entre deux histogrammes de meme taille. */
function histogramDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
  // Deux histogrammes normalises different au plus de 2 en somme absolue.
  return clamp01(sum / 2);
}

/** Ecart moyen entre deux grilles de couleurs, ramene sur 0..1. */
function zoneDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || a.length !== b.length) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
  return clamp01(sum / a.length / 255);
}

/** 0 = arenes identiques, 1 = totalement differentes. */
export function fingerprintDistance(a: MapFingerprint, b: MapFingerprint): number {
  return clamp01(
    WEIGHTS.hue * histogramDistance(a.hue, b.hue) +
      WEIGHTS.luma * histogramDistance(a.luma, b.luma) +
      WEIGHTS.zones * zoneDistance(a.zones, b.zones),
  );
}

export interface MapCandidate {
  map: KnownMap;
  distance: number;
}

export interface MapMatchResult extends MapIdentification {
  /** Arenes les plus proches, de la meilleure a la moins bonne. */
  candidates: MapCandidate[];
}

/**
 * Cherche l'arene la plus proche. Elle n'est retenue que si elle est a la fois
 * assez proche *et* nettement devant la suivante : deux arenes qui se
 * ressemblent doivent produire un doute, pas un choix arbitraire.
 */
export function identifyMap(
  fingerprint: MapFingerprint,
  library: readonly KnownMap[],
): MapMatchResult {
  const candidates: MapCandidate[] = library
    .map((map) => ({ map, distance: fingerprintDistance(fingerprint, map.fingerprint) }))
    .sort((a, b) => a.distance - b.distance);

  const best = candidates[0];
  const runnerUp = candidates[1];

  const unknown: MapMatchResult = {
    mapId: null,
    mapName: '',
    confidence: 0,
    confirmed: false,
    distance: best ? best.distance : null,
    candidates: candidates.slice(0, 3),
  };

  if (!best || best.distance > MATCH_DISTANCE) return unknown;
  if (runnerUp && runnerUp.distance - best.distance < MIN_MARGIN) return unknown;

  return {
    mapId: best.map.id,
    mapName: best.map.name,
    // Une reconnaissance automatique ne depasse jamais 0,9 : seule une
    // confirmation du joueur vaut certitude.
    confidence: clamp01(0.9 * (1 - best.distance / MATCH_DISTANCE)),
    confirmed: false,
    distance: best.distance,
    candidates: candidates.slice(0, 3),
  };
}

/**
 * Affine la signature de reference d'une arene avec un nouveau match.
 *
 * La moyenne est ponderee par le nombre de matchs deja integres : une arene
 * connue de longue date ne se laisse pas deformer par un enregistrement
 * atypique, mais elle continue d'apprendre.
 */
export function mergeFingerprints(
  reference: MapFingerprint,
  addition: MapFingerprint,
  referenceWeight: number,
): MapFingerprint {
  const w = Math.max(1, referenceWeight);
  const blend = (a: readonly number[], b: readonly number[]): number[] => {
    if (a.length !== b.length) return [...a];
    return a.map((v, i) => (v * w + (b[i] as number)) / (w + 1));
  };

  return {
    hue: blend(reference.hue, addition.hue),
    luma: blend(reference.luma, addition.luma),
    zones: blend(reference.zones, addition.zones),
    frames: reference.frames + addition.frames,
  };
}

/** Identification vide, pour un match dont la signature n'a pas pu etre calculee. */
export function unknownMap(): MapIdentification {
  return { mapId: null, mapName: '', confidence: 0, confirmed: false, distance: null };
}
