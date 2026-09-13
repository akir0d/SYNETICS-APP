/**
 * Controle bout en bout du pipeline video, execute dans un vrai moteur de
 * rendu (Chromium via Electron).
 *
 * Les tests unitaires valident les heuristiques a partir de mesures
 * synthetiques ; ce controle-ci part d'un vrai fichier video encode et le fait
 * traverser le code de production : decodage, recherche d'instant, lecture de
 * pixels, decoupage, empreinte de carte, extraction des images cles.
 *
 * La video de test reproduit la structure d'une rediffusion EVA :
 *
 *   lobby -> ecran noir -> manche -> victoire -> tableau des scores ->
 *   ecran noir -> lobby -> ecran noir -> manche 2 -> ... -> ecran noir
 *
 * Les deux manches se jouent dans des arenes de meme palette mais dont le nom
 * ecrit dans le HUD differe : c'est exactement le cas que la seule couleur ne
 * peut pas trancher.
 */

import { analyzeVideoFile } from '../../src/core/pipeline';
import { fingerprintDistance, identifyMap, MATCH_DISTANCE } from '../../src/core/analysis/mapmatch';
import { DEFAULT_MAP_NAME_REGION, DEFAULT_SETTINGS, type KnownMap } from '../../src/core/types';

declare global {
  interface Window {
    __SMOKE__?: { ok: boolean; report?: Record<string, unknown>; error?: string };
  }
}

// Definition realiste : en 320x180 le nom de carte du HUD ne ferait que 76 px
// de large, sans rapport avec une vraie captation. L'empreinte de texte se
// jugerait alors sur une image que le jeu ne produit jamais.
const WIDTH = 1280;
const HEIGHT = 720;
const DURATION_S = 56;

type Phase = 'lobby' | 'jeu' | 'fin' | 'noir';

interface Bloc {
  from: number;
  to: number;
  phase: Phase;
  /** Nom ecrit dans le HUD, comme le fait le jeu sous le chronometre. */
  carte?: string;
}

const SCENARIO: Bloc[] = [
  { from: 0, to: 5, phase: 'lobby', carte: 'ATLANTIS' },
  { from: 5, to: 6.5, phase: 'noir' },
  { from: 6.5, to: 20, phase: 'jeu', carte: 'ATLANTIS' },
  { from: 20, to: 25, phase: 'fin', carte: 'ATLANTIS' },
  { from: 25, to: 26.5, phase: 'noir' },
  { from: 26.5, to: 31, phase: 'lobby', carte: 'OSIRIS' },
  { from: 31, to: 32.5, phase: 'noir' },
  { from: 32.5, to: 46, phase: 'jeu', carte: 'OSIRIS' },
  { from: 46, to: 51, phase: 'fin', carte: 'OSIRIS' },
  { from: 51, to: 52.5, phase: 'noir' },
  { from: 52.5, to: 56, phase: 'lobby', carte: 'OSIRIS' },
];

const MANCHES = SCENARIO.filter((b) => b.phase === 'jeu');
const MIN_MATCH_S = 6;
const MIN_GAP_S = 4;
const SAMPLING_HZ = 3;

const RED_FLASH_DURATION_S = 0.45;
const RED_FLASHES = [9.2, 13.1, 17.4, 36.5, 42.2];

/** Meme palette pour les deux arenes : seul le nom du HUD les distingue. */
const PALETTE = { fond: '#101f38', sol: '#16304f', accent: '#4ea8ff', second: '#9fd8ff' };

function blocAt(t: number): Bloc | undefined {
  return SCENARIO.find((b) => t >= b.from && t < b.to);
}

/** Ecrit le nom de carte la ou le jeu le place : centre, sous le chronometre. */
function dessineHud(ctx: CanvasRenderingContext2D, carte: string): void {
  const r = DEFAULT_MAP_NAME_REGION;
  const x = r.x * WIDTH;
  const y = r.y * HEIGHT;
  const w = r.width * WIDTH;
  const h = r.height * HEIGHT;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(h * 0.55)}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(carte, x + w / 2, y + h / 2);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function draw(ctx: CanvasRenderingContext2D, t: number): void {
  const bloc = blocAt(t);

  if (!bloc || bloc.phase === 'noir') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    return;
  }

  if (bloc.phase === 'lobby' || bloc.phase === 'fin') {
    // Ecrans quasiment figes : lobby avant la manche, victoire puis tableau
    // des scores apres. Le point qui derive garantit que l'encodeur continue
    // de produire des images sans creer de mouvement significatif.
    ctx.fillStyle = bloc.phase === 'fin' ? '#20304a' : '#2b2b2e';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = bloc.phase === 'fin' ? '#e08a3c' : '#3d3d42';
    ctx.fillRect(WIDTH / 2 - 280, HEIGHT / 2 - 96, 560, 192);
    ctx.fillStyle = '#4a4a50';
    ctx.fillRect(72 + Math.sin(t * 0.5) * 6, 600, 12, 12);
    if (bloc.carte) dessineHud(ctx, bloc.carte);
    return;
  }

  ctx.fillStyle = PALETTE.fond;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = PALETTE.sol;
  ctx.fillRect(0, HEIGHT * 0.62, WIDTH, HEIGHT * 0.38);

  for (let i = 0; i < 12; i++) {
    const phase = t * 9 + i * 1.7;
    const x = ((Math.sin(phase) + 1) / 2) * WIDTH;
    const y = ((Math.cos(phase * 1.3) + 1) / 2) * HEIGHT;
    ctx.fillStyle = i % 2 === 0 ? PALETTE.accent : PALETTE.second;
    ctx.fillRect(x - 64, y - 64, 128, 128);
  }

  if (RED_FLASHES.some((f) => t >= f && t < f + RED_FLASH_DURATION_S)) {
    ctx.fillStyle = 'rgba(220, 30, 30, 0.55)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Le HUD reste affiche pendant toute la manche : c'est la que l'empreinte
  // du nom de carte est prelevee.
  if (bloc.carte) dessineHud(ctx, bloc.carte);
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
    videoBitsPerSecond: 6_000_000,
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
      profile: 'domination',
      settings: {
        ...DEFAULT_SETTINGS,
        samplingHz: SAMPLING_HZ,
        aiFrameBudget: 10,
        aiEnabled: false,
        autoSegment: true,
        useBlackScreens: true,
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
      segments: result.segments.map((s) => ({
        jeu: [Number(s.startS.toFixed(1)), Number(s.endS.toFixed(1))],
        fenetre: [Number(s.windowStartS.toFixed(1)), Number(s.windowEndS.toFixed(1))],
      })),
      analyses: analyses.map((a) => ({
        rang: `${a.segmentIndex}/${a.segmentCount}`,
        offsetS: Number(a.sourceOffsetS.toFixed(1)),
        dureeS: Number(a.video.durationS.toFixed(1)),
        phases: a.metrics.engagementCount,
        expositions: a.metrics.exposureEvents,
        imagesCles: result.keyframes.get(a.id)?.length ?? 0,
        vignetteHud: (a.mapNameCrop?.length ?? 0) > 500,
        empreinteNom: (a.mapFingerprint?.nameMask?.length ?? 0) > 0,
      })),
    };

    const failures: string[] = [];

    // --- Decoupage cale sur les ecrans noirs ---
    if (result.segments.length !== MANCHES.length) {
      failures.push(`decoupage : ${result.segments.length} manche(s) au lieu de ${MANCHES.length}`);
    } else {
      MANCHES.forEach((attendu, i) => {
        const trouve = result.segments[i]!;
        if (Math.abs(trouve.startS - attendu.from) > 3) {
          failures.push(`manche ${i + 1} : debut a ${trouve.startS.toFixed(1)} s au lieu de ${attendu.from}`);
        }
        if (Math.abs(trouve.endS - attendu.to) > 3) {
          failures.push(`manche ${i + 1} : fin a ${trouve.endS.toFixed(1)} s au lieu de ${attendu.to}`);
        }
        // Les ecrans de victoire et de score doivent rester hors du match mais
        // dans la fenetre : c'est la que l'IA va lire carte, issue et K/D/A.
        if (trouve.windowEndS - trouve.endS < 2) {
          failures.push(`manche ${i + 1} : les ecrans de fin ne sont pas dans la fenetre`);
        }
      });
    }

    for (const a of analyses) {
      if (a.metrics.engagementCount < 1) failures.push(`${a.title} : aucune phase d action`);
      if (a.metrics.exposureEvents < 1) failures.push(`${a.title} : aucun flash de degats`);
      if ((result.keyframes.get(a.id)?.length ?? 0) < 5) {
        failures.push(`${a.title} : images cles manquantes`);
      }
      if (!a.mapNameCrop) failures.push(`${a.title} : vignette du HUD absente`);
      if (!a.mapFingerprint?.nameMask) failures.push(`${a.title} : empreinte du nom absente`);
    }

    if (premier && Math.abs(premier.sourceOffsetS - MANCHES[0]!.from) > 3) {
      failures.push('le decalage du premier match ne correspond pas a sa position');
    }
    if (premier?.features[0] && premier.features[0].t > 1) {
      failures.push('les horodatages du match ne repartent pas de zero');
    }

    // --- Reconnaissance par le nom ecrit dans le HUD ---
    if (premier?.mapFingerprint && second?.mapFingerprint) {
      const distance = fingerprintDistance(premier.mapFingerprint, second.mapFingerprint);
      report.distanceEntreCartes = Number(distance.toFixed(3));
      report.distanceAvecSoiMeme = fingerprintDistance(premier.mapFingerprint, premier.mapFingerprint);

      if (distance <= MATCH_DISTANCE) {
        failures.push(
          `deux cartes de meme palette mais de nom different sont confondues (${distance.toFixed(3)})`,
        );
      }

      const bibliotheque: KnownMap[] = [
        {
          id: 'map-atlantis',
          name: 'ATLANTIS',
          fingerprint: premier.mapFingerprint,
          matchCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];
      const reconnu = identifyMap(premier.mapFingerprint, bibliotheque);
      const rejete = identifyMap(second.mapFingerprint, bibliotheque);
      report.reconnaissance = { premier: reconnu.mapName, second: rejete.mapId };

      if (reconnu.mapId !== 'map-atlantis') failures.push('carte deja connue non reconnue');
      if (rejete.mapId !== null) failures.push('carte inconnue rattachee a tort');
    } else {
      failures.push("empreinte de carte absente");
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
