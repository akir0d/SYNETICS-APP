import type { KnownMap, MapFingerprint, MapIdentification } from '../types';
import { maskDistance, maskInk, MIN_MASK_INK } from '../video/fingerprint';
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

/**
 * Poids de la trace du nom de carte quand elle est disponible.
 *
 * C'est le signal de loin le plus sur : le jeu ecrit le meme texte, dans la
 * meme police, au meme endroit. La palette ne sert plus que d'appoint, utile
 * quand la zone du HUD est mal cadree et que la trace ne vaut rien.
 *
 * La valeur n'est pas arbitraire : deux palettes totalement opposees sont a
 * environ 0,82 l'une de l'autre. Pour que la couleur ne puisse jamais opposer
 * son veto a un nom identique, sa contribution maximale doit rester sous le
 * seuil de rapprochement, donc (1 - poids) x 0,82 < 0,22. A 0,85 la couleur
 * plafonne a 0,12, tandis que deux noms differents (environ 0,50 d'ecart)
 * pesent 0,42 et restent nettement rejetes.
 */
const NAME_WEIGHT = 0.85;

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

/** Distance fondee sur la seule palette du lieu. */
function paletteDistance(a: MapFingerprint, b: MapFingerprint): number {
  return clamp01(
    WEIGHTS.hue * histogramDistance(a.hue, b.hue) +
      WEIGHTS.luma * histogramDistance(a.luma, b.luma) +
      WEIGHTS.zones * zoneDistance(a.zones, b.zones),
  );
}

/** 0 = arenes identiques, 1 = totalement differentes. */
export function fingerprintDistance(a: MapFingerprint, b: MapFingerprint): number {
  const palette = paletteDistance(a, b);

  // La trace du nom de carte n'existe que si la zone du HUD a pu etre lue des
  // deux cotes ; sinon on se rabat entierement sur la palette. Une zone vide
  // compte comme illisible : mieux vaut la palette qu'une comparaison de rien.
  if (!a.nameMask || !b.nameMask || a.nameMask.length !== b.nameMask.length) return palette;
  if (maskInk(a.nameMask) < MIN_MASK_INK || maskInk(b.nameMask) < MIN_MASK_INK) return palette;

  return clamp01(NAME_WEIGHT * maskDistance(a.nameMask, b.nameMask) + (1 - NAME_WEIGHT) * palette);
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

  const nameMask =
    reference.nameMask && addition.nameMask && reference.nameMask.length === addition.nameMask.length
      ? blend(reference.nameMask, addition.nameMask)
      : reference.nameMask ?? addition.nameMask;

  return {
    hue: blend(reference.hue, addition.hue),
    luma: blend(reference.luma, addition.luma),
    zones: blend(reference.zones, addition.zones),
    frames: reference.frames + addition.frames,
    ...(nameMask ? { nameMask } : {}),
  };
}

/** Identification vide, pour un match dont la signature n'a pas pu etre calculee. */
export function unknownMap(): MapIdentification {
  return { mapId: null, mapName: '', confidence: 0, confirmed: false, distance: null };
}
