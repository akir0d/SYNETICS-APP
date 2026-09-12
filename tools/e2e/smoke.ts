/**
 * Controle bout en bout du pipeline video, execute dans un vrai moteur de
 * rendu (Chromium via Electron).
 *
 * Les tests unitaires valident les heuristiques a partir de mesures
 * synthetiques ; ce controle-ci part d'un vrai fichier video encode, le fait
 * decoder, echantillonner et analyser par le code de production. C'est le
 * seul moyen de verifier que le decodage, la recherche d'instant et la
 * lecture de pixels fonctionnent reellement.
 */

import { analyzeVideoFile } from '../../src/core/pipeline';
import { DEFAULT_SETTINGS } from '../../src/core/types';

declare global {
  interface Window {
    __SMOKE__?: { ok: boolean; report?: Record<string, unknown>; error?: string };
  }
}

const WIDTH = 320;
const HEIGHT = 180;
const DURATION_S = 20;
const ACTION_WINDOWS: Array<[number, number]> = [
  [5, 9],
  [13, 17],
];
/**
 * Voiles de degats d'une duree realiste (0,45 s). Leur detection depend
 * directement de la frequence d'echantillonnage : c'est justement ce que ce
 * controle doit verifier sur les reglages par defaut.
 */
const RED_FLASH_DURATION_S = 0.45;
const RED_FLASHES = [6.2, 10.1, 14.4];

function draw(ctx: CanvasRenderingContext2D, t: number): void {
  const inAction = ACTION_WINDOWS.some(([from, to]) => t >= from && t <= to);

  // Fond fixe : une scene calme doit produire un signal quasi nul.
  ctx.fillStyle = '#1b2430';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#26303f';
  ctx.fillRect(0, HEIGHT * 0.65, WIDTH, HEIGHT * 0.35);

  if (inAction) {
    // Beaucoup de mouvement et de contraste : c'est ce que le moteur doit voir.
    for (let i = 0; i < 12; i++) {
      const phase = t * 9 + i * 1.7;
      const x = ((Math.sin(phase) + 1) / 2) * WIDTH;
      const y = ((Math.cos(phase * 1.3) + 1) / 2) * HEIGHT;
      ctx.fillStyle = i % 2 === 0 ? '#f3f6ff' : '#ffd166';
      ctx.fillRect(x - 16, y - 16, 32, 32);
    }
  } else {
    // Micro-derive lente : une video reelle n'est jamais figee au pixel pres.
    ctx.fillStyle = '#2d3846';
    ctx.fillRect(20 + Math.sin(t * 0.4) * 2, 40, 24, 24);
  }

  if (RED_FLASHES.some((f) => t >= f && t < f + RED_FLASH_DURATION_S)) {
    ctx.fillStyle = 'rgba(220, 30, 30, 0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

async function recordSyntheticMatch(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponible');

  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp8',
    videoBitsPerSecond: 2_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const startedAt = performance.now();

  await new Promise<void>((resolve) => {
    const frame = () => {
      const t = (performance.now() - startedAt) / 1000;
      draw(ctx, t);
      if (t >= DURATION_S) resolve();
      else requestAnimationFrame(frame);
    };
    frame();
  });

  recorder.stop();
  await stopped;

  return new File([new Blob(chunks, { type: 'video/webm' })], 'controle.webm', {
    type: 'video/webm',
  });
}

async function main(): Promise<void> {
  const out = document.getElementById('out');
  const log = (message: string) => {
    if (out) out.textContent = message;
  };

  try {
    log('Enregistrement de la video de test (20 s)...');
    const file = await recordSyntheticMatch();

    log(`Video generee (${(file.size / 1024).toFixed(0)} Ko). Analyse en cours...`);
    const result = await analyzeVideoFile({
      file,
      profile: 'tdm',
      // On garde volontairement la frequence par defaut : le controle doit
      // echouer si ce reglage ne suffit plus a voir un flash de degats.
      settings: { ...DEFAULT_SETTINGS, aiFrameBudget: 8, aiEnabled: false },
      onProgress: (p) => log(`${p.stage} — ${p.message}`),
    });

    const m = result.analysis.metrics;
    const report = {
      videoBytes: file.size,
      durationS: Number(result.analysis.video.durationS.toFixed(2)),
      sampledFrames: m.sampledFrames,
      engagementCount: m.engagementCount,
      engagements: m.engagements.map((e) => [
        Number(e.startS.toFixed(1)),
        Number(e.endS.toFixed(1)),
      ]),
      activeRatio: Number(m.activeRatio.toFixed(3)),
      exposureEvents: m.exposureEvents,
      keyframes: result.keyframes.length,
      firstKeyframeBytes: result.keyframes[0]?.base64.length ?? 0,
      scores: m.scores,
    };

    // Le decodage d'une video reelle n'est jamais exact a l'image pres :
    // on verifie que le moteur retrouve la structure, pas des bornes exactes.
    const failures: string[] = [];
    if (report.durationS < DURATION_S - 3) failures.push('duree trop courte');
    if (report.sampledFrames < 20) failures.push('trop peu d images echantillonnees');
    if (report.engagementCount < 2) failures.push('phases d action non retrouvees');
    if (report.activeRatio < 0.15 || report.activeRatio > 0.75) {
      failures.push(`temps en action hors plage (${report.activeRatio})`);
    }
    if (report.exposureEvents < 2) {
      failures.push(
        `flashs de degats manques : ${report.exposureEvents} detecte(s) sur ${RED_FLASHES.length}`,
      );
    }
    if (report.keyframes < 4) failures.push('images cles manquantes');
    if (report.firstKeyframeBytes < 1000) failures.push('image cle vide');

    URL.revokeObjectURL(result.objectUrl);

    window.__SMOKE__ = failures.length
      ? { ok: false, report, error: failures.join(' ; ') }
      : { ok: true, report };
    log(JSON.stringify(window.__SMOKE__, null, 2));
  } catch (error) {
    window.__SMOKE__ = { ok: false, error: error instanceof Error ? error.stack ?? error.message : String(error) };
    log(String(window.__SMOKE__.error));
  }
}

void main();
