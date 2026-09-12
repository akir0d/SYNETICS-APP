/**
 * Controle bout en bout du pipeline video, execute dans un vrai moteur de
 * rendu (Chromium via Electron).
 *
 * Les tests unitaires valident les heuristiques a partir de mesures
 * synthetiques ; ce controle-ci part d'un vrai fichier video encode, le fait
 * decoder, decouper, echantillonner et analyser par le code de production.
 * C'est le seul moyen de verifier que le decodage, la recherche d'instant et
 * la lecture de pixels fonctionnent reellement.
 *
 * La video de test imite une rediffusion : deux manches jouees dans deux
 * arenes de couleurs opposees, separees par des ecrans d'attente.
 */

import { analyzeVideoFile } from '../../src/core/pipeline';
import { fingerprintDistance, identifyMap, MATCH_DISTANCE } from '../../src/core/analysis/mapmatch';
import { DEFAULT_SETTINGS, type KnownMap } from '../../src/core/types';

declare global {
  interface Window {
    __SMOKE__?: { ok: boolean; report?: Record<string, unknown>; error?: string };
  }
}

const WIDTH = 320;
const HEIGHT = 180;
const DURATION_S = 42;

/**
 * Les durees reelles d'une rediffusion (manches de dix minutes, pauses de
 * plusieurs minutes) sont impossibles a enregistrer dans un controle
 * automatique : on garde la meme structure a l'echelle reduite, et on passe
 * au moteur les seuils correspondants. Ce sont des parametres explicites,
 * donc l'algorithme teste est bien celui de production.
 */
const MATCHES: Array<{ startS: number; endS: number; arena: 'froide' | 'chaude' }> = [
  { startS: 4, endS: 16, arena: 'froide' },
  { startS: 25, endS: 38, arena: 'chaude' },
];
const MIN_MATCH_S = 6;
const MIN_GAP_S = 5;
const SAMPLING_HZ = 3;

/** Voiles de degats d'une duree realiste : leur detection depend de l'echantillonnage. */
const RED_FLASH_DURATION_S = 0.45;
const RED_FLASHES = [6.2, 10.1, 13.4, 29.5, 34.2];

const ARENAS = {
  froide: { fond: '#101f38', sol: '#16304f', accent: '#4ea8ff', second: '#9fd8ff' },
  chaude: { fond: '#3a1d0c', sol: '#5a2f12', accent: '#ff9b3d', second: '#ffd9a8' },
};

function matchAt(t: number) {
  return MATCHES.find((m) => t >= m.startS && t <= m.endS);
}

function draw(ctx: CanvasRenderingContext2D, t: number): void {
  const match = matchAt(t);

  if (!match) {
    // Ecran d'attente : gris neutre, quasiment fige. Le point qui derive
    // lentement garantit que l'encodeur continue de produire des images sans
    // creer de mouvement significatif.
    ctx.fillStyle = '#2b2b2e';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = '#3d3d42';
    ctx.fillRect(WIDTH / 2 - 60, HEIGHT / 2 - 20, 120, 40);
    ctx.fillStyle = '#4a4a50';
    ctx.fillRect(20 + Math.sin(t * 0.5) * 1.5, 20, 3, 3);
    return;
  }

  const palette = ARENAS[match.arena];
  ctx.fillStyle = palette.fond;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = palette.sol;
  ctx.fillRect(0, HEIGHT * 0.62, WIDTH, HEIGHT * 0.38);

  // Beaucoup de mouvement et de contraste : c'est ce que le moteur doit voir.
  for (let i = 0; i < 12; i++) {
    const phase = t * 9 + i * 1.7;
    const x = ((Math.sin(phase) + 1) / 2) * WIDTH;
    const y = ((Math.cos(phase * 1.3) + 1) / 2) * HEIGHT;
    ctx.fillStyle = i % 2 === 0 ? palette.accent : palette.second;
    ctx.fillRect(x - 16, y - 16, 32, 32);
  }

  if (RED_FLASHES.some((f) => t >= f && t < f + RED_FLASH_DURATION_S)) {
    ctx.fillStyle = 'rgba(220, 30, 30, 0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}

async function recordSyntheticSession(): Promise<File> {
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

  return new File([new Blob(chunks, { type: 'video/webm' })], 'rediffusion.webm', {
    type: 'video/webm',
  });
}

async function main(): Promise<void> {
  const out = document.getElementById('out');
  const log = (message: string) => {
    if (out) out.textContent = message;
  };

  try {
    log(`Enregistrement de la rediffusion de test (${DURATION_S} s)...`);
    const file = await recordSyntheticSession();

    log(`Video generee (${(file.size / 1024).toFixed(0)} Ko). Analyse en cours...`);
    const result = await analyzeVideoFile({
      file,
      profile: 'tdm',
      settings: {
        ...DEFAULT_SETTINGS,
        samplingHz: SAMPLING_HZ,
        aiFrameBudget: 6,
        aiEnabled: false,
        autoSegment: true,
        minMatchS: MIN_MATCH_S,
        minGapS: MIN_GAP_S,
      },
      onProgress: (p) => log(`${p.stage} — ${p.message}`),
    });

    const analyses = result.analyses;
    const premier = analyses[0];
    const second = analyses[1];

    const report: Record<string, unknown> = {
      videoBytes: file.size,
      sourceDurationS: Number(result.sourceDurationS.toFixed(2)),
      segments: result.segments.map((s) => [
        Number(s.startS.toFixed(1)),
        Number(s.endS.toFixed(1)),
      ]),
      analyses: analyses.map((a) => ({
        titre: a.title,
        rang: `${a.segmentIndex}/${a.segmentCount}`,
        offsetS: Number(a.sourceOffsetS.toFixed(1)),
        dureeS: Number(a.video.durationS.toFixed(1)),
        images: a.metrics.sampledFrames,
        phases: a.metrics.engagementCount,
        expositions: a.metrics.exposureEvents,
        imagesCles: result.keyframes.get(a.id)?.length ?? 0,
        signatureImages: a.mapFingerprint?.frames ?? 0,
      })),
    };

    const failures: string[] = [];

    // --- Decoupage ---
    if (result.segments.length !== MATCHES.length) {
      failures.push(`decoupage : ${result.segments.length} match(s) au lieu de ${MATCHES.length}`);
    } else {
      MATCHES.forEach((attendu, i) => {
        const trouve = result.segments[i]!;
        // Le lissage elargit ou retrecit legerement les bornes : on tolere
        // quelques secondes, mais pas une confusion entre deux manches.
        if (Math.abs(trouve.startS - attendu.startS) > 4) {
          failures.push(`match ${i + 1} : debut a ${trouve.startS.toFixed(1)} s au lieu de ${attendu.startS}`);
        }
        if (Math.abs(trouve.endS - attendu.endS) > 4) {
          failures.push(`match ${i + 1} : fin a ${trouve.endS.toFixed(1)} s au lieu de ${attendu.endS}`);
        }
      });
    }

    // --- Horodatages remis a zero et decalage conserve ---
    if (premier && Math.abs(premier.sourceOffsetS - MATCHES[0]!.startS) > 4) {
      failures.push('le decalage du premier match ne correspond pas a sa position');
    }
    if (premier && premier.features[0] && premier.features[0].t > 1) {
      failures.push('les horodatages du match ne repartent pas de zero');
    }
    for (const a of analyses) {
      if (a.metrics.engagementCount < 1) failures.push(`${a.title} : aucune phase d action`);
      if (a.metrics.exposureEvents < 1) failures.push(`${a.title} : aucun flash de degats`);
      if ((result.keyframes.get(a.id)?.length ?? 0) < 3) {
        failures.push(`${a.title} : images cles manquantes`);
      }
      if ((result.keyframes.get(a.id)?.[0]?.base64.length ?? 0) < 1000) {
        failures.push(`${a.title} : image cle vide`);
      }
    }

    // --- Reconnaissance d'arene ---
    if (premier?.mapFingerprint && second?.mapFingerprint) {
      const distance = fingerprintDistance(premier.mapFingerprint, second.mapFingerprint);
      const identique = fingerprintDistance(premier.mapFingerprint, premier.mapFingerprint);
      report.distanceEntreArenes = Number(distance.toFixed(3));
      report.distanceAvecSoiMeme = Number(identique.toFixed(3));

      if (identique > 0.001) failures.push('une arene ne se reconnait pas elle-meme');
      if (distance <= MATCH_DISTANCE) {
        failures.push(
          `deux arenes opposees sont confondues (distance ${distance.toFixed(3)} <= ${MATCH_DISTANCE})`,
        );
      }

      const bibliotheque: KnownMap[] = [
        {
          id: 'map-froide',
          name: 'Arene froide',
          fingerprint: premier.mapFingerprint,
          matchCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const reconnu = identifyMap(premier.mapFingerprint, bibliotheque);
      const rejete = identifyMap(second.mapFingerprint, bibliotheque);
      report.reconnaissance = { attendu: reconnu.mapName, autreArene: rejete.mapId };

      if (reconnu.mapId !== 'map-froide') failures.push('arene deja connue non reconnue');
      if (rejete.mapId !== null) failures.push('arene inconnue rattachee a tort a une arene connue');
    } else {
      failures.push("signature d'arene absente");
    }

    URL.revokeObjectURL(result.objectUrl);

    window.__SMOKE__ = failures.length ? { ok: false, report, error: failures.join(' ; ') } : { ok: true, report };
    log(JSON.stringify(window.__SMOKE__, null, 2));
  } catch (error) {
    window.__SMOKE__ = {
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    };
    log(String(window.__SMOKE__.error));
  }
}

void main();
