import type { FrameFeature, VideoMeta } from '../types';
import { clamp01 } from '../analysis/stats';

/**
 * Decodage et echantillonnage de la video. Tout se passe en local dans le
 * lecteur de la plateforme (WebView Android ou Chromium sur PC) : la video
 * elle-meme n'est jamais envoyee sur le reseau.
 */

/** Largeur de travail pour les mesures : minuscule, car seul le signal compte. */
const FEATURE_WIDTH = 128;
const FEATURE_HEIGHT = 72;

export class AnalysisAbortedError extends Error {
  constructor() {
    super('Analyse annulee');
    this.name = 'AnalysisAbortedError';
  }
}

export interface LoadedVideo {
  element: HTMLVideoElement;
  objectUrl: string;
  meta: VideoMeta;
}

/**
 * Certains enregistrements (captures d'ecran, sorties de MediaRecorder) ne
 * declarent aucune duree dans leur en-tete : le lecteur renvoie alors
 * `Infinity`. Se placer tres loin dans le flux force le decodeur a parcourir
 * le fichier et a publier la duree reelle.
 */
function recoverDuration(video: HTMLVideoElement, timeoutMs = 5000): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) {
    return Promise.resolve(video.duration);
  }

  return new Promise((resolve) => {
    let settled = false;
    const done = (value: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.currentTime = 0;
      resolve(value);
    };

    const onDurationChange = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) done(video.duration);
    };
    const onTimeUpdate = () => {
      if (Number.isFinite(video.duration) && video.duration > 0) done(video.duration);
      else if (video.currentTime > 0) done(video.currentTime);
    };

    const timer = setTimeout(() => done(video.duration), timeoutMs);

    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.currentTime = Number.MAX_SAFE_INTEGER;
  });
}

/** Charge un fichier video et lit ses metadonnees (duree, dimensions). */
export function loadVideo(file: File): Promise<LoadedVideo> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const element = document.createElement('video');
    element.preload = 'auto';
    element.muted = true;
    element.playsInline = true;
    element.crossOrigin = 'anonymous';

    const cleanup = () => {
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('error', onError);
    };

    const onLoaded = () => {
      cleanup();
      void recoverDuration(element).then((durationS) => {
        if (!Number.isFinite(durationS) || durationS <= 0) {
          URL.revokeObjectURL(objectUrl);
          reject(new Error('Duree de la video illisible. Essayez un fichier MP4 (H.264).'));
          return;
        }
        finish(durationS);
      });
    };

    const finish = (durationS: number) => {
      resolve({
        element,
        objectUrl,
        meta: {
          name: file.name,
          sizeBytes: file.size,
          durationS,
          width: element.videoWidth,
          height: element.videoHeight,
          mimeType: file.type || 'video/mp4',
        },
      });
    };

    const onError = () => {
      cleanup();
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Format video non pris en charge par la plateforme (essayez MP4 / H.264)."));
    };

    element.addEventListener('loadedmetadata', onLoaded);
    element.addEventListener('error', onError);
    element.src = objectUrl;
  });
}

/**
 * Positionne la video sur un instant precis et attend que l'image soit
 * reellement prete a etre dessinee.
 *
 * On s'appuie uniquement sur l'evenement `seeked` : quand il se declenche,
 * l'image de la nouvelle position est disponible pour `drawImage`.
 *
 * Attendre en plus `requestVideoFrameCallback` ou un `requestAnimationFrame`
 * serait tentant, mais ces rappels sont lies au compositeur : des que la
 * fenetre passe en arriere-plan (ou que l'ecran du telephone s'eteint), ils
 * sont etrangles a une poignee d'appels par seconde et l'analyse se trainerait
 * pendant des dizaines de minutes. `seeked`, lui, n'est pas throttle.
 */
export function seekTo(video: HTMLVideoElement, time: number, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05));
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };

    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Lecture impossible a ${time.toFixed(1)} s`));
    };

    // Une image illisible ne doit pas geler toute l'analyse : on la saute.
    const timer = setTimeout(onSeeked, timeoutMs);

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = target;
  });
}

/** Extrait les mesures d'une image deja dessinee dans un contexte 2D. */
export function featuresFromImageData(
  data: Uint8ClampedArray,
  previousLuma: Float32Array | null,
): { luma: number; redBias: number; saturation: number; diff: number; lumaMap: Float32Array } {
  const pixelCount = data.length / 4;
  const lumaMap = new Float32Array(pixelCount);

  let lumaSum = 0;
  let redSum = 0;
  let saturated = 0;

  for (let p = 0; p < pixelCount; p++) {
    const i = p * 4;
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;

    // Luminance perceptuelle (Rec. 601), suffisante et rapide.
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    lumaMap[p] = y;
    lumaSum += y;

    // Dominance du rouge : c'est ce qui trahit un voile de degats.
    redSum += r - (g + b) / 2;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max > 80 && (max - min) / max > 0.5) saturated++;
  }

  let diff = 0;
  if (previousLuma && previousLuma.length === pixelCount) {
    let acc = 0;
    for (let p = 0; p < pixelCount; p++) {
      acc += Math.abs((lumaMap[p] as number) - (previousLuma[p] as number));
    }
    diff = clamp01(acc / pixelCount / 255);
  }

  return {
    luma: clamp01(lumaSum / pixelCount / 255),
    redBias: clamp01(redSum / pixelCount / 255),
    saturation: clamp01(saturated / pixelCount),
    diff,
    lumaMap,
  };
}

export interface SampleProgress {
  done: number;
  total: number;
  currentTimeS: number;
}

export interface SampleOptions {
  samplingHz: number;
  onProgress?: (p: SampleProgress) => void;
  signal?: AbortSignal;
}

/** Premiere passe : parcourt toute la video et en extrait le signal brut. */
export async function sampleVideoFeatures(
  video: HTMLVideoElement,
  opts: SampleOptions,
): Promise<FrameFeature[]> {
  const canvas = document.createElement('canvas');
  canvas.width = FEATURE_WIDTH;
  canvas.height = FEATURE_HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D indisponible sur cette plateforme.');

  const step = 1 / Math.max(0.25, opts.samplingHz);
  const duration = video.duration;
  const total = Math.max(1, Math.floor(duration / step));

  const features: FrameFeature[] = [];
  let previousLuma: Float32Array | null = null;

  for (let i = 0; i < total; i++) {
    if (opts.signal?.aborted) throw new AnalysisAbortedError();
    const t = i * step;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, FEATURE_WIDTH, FEATURE_HEIGHT);
    const img = ctx.getImageData(0, 0, FEATURE_WIDTH, FEATURE_HEIGHT);
    const f = featuresFromImageData(img.data, previousLuma);
    previousLuma = f.lumaMap;
    features.push({ t, luma: f.luma, redBias: f.redBias, saturation: f.saturation, diff: f.diff });
    opts.onProgress?.({ done: i + 1, total, currentTimeS: t });
  }

  return features;
}

export interface Keyframe {
  t: number;
  /** JPEG encode en base64, sans le prefixe `data:`. */
  base64: string;
  mediaType: 'image/jpeg';
}

/**
 * Seconde passe : ne recapture que les quelques images retenues pour l'IA,
 * cette fois en resolution lisible.
 */
export async function extractKeyframes(
  video: HTMLVideoElement,
  times: readonly number[],
  options: { width?: number; quality?: number; signal?: AbortSignal; onProgress?: (p: SampleProgress) => void } = {},
): Promise<Keyframe[]> {
  const width = options.width ?? 768;
  const quality = options.quality ?? 0.72;
  const aspect = video.videoHeight > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
  const height = Math.round(width * aspect);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D indisponible sur cette plateforme.');

  const frames: Keyframe[] = [];
  for (let i = 0; i < times.length; i++) {
    if (options.signal?.aborted) throw new AnalysisAbortedError();
    const t = times[i] as number;
    await seekTo(video, t);
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    frames.push({ t, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' });
    options.onProgress?.({ done: i + 1, total: times.length, currentTimeS: t });
  }
  return frames;
}
