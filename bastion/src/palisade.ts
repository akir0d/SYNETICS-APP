// La palissade du camp : des rondins tailles en pointe, par troncons. Chaque troncon
// a ses points de vie : les zombies le cassent la nuit, on le repare avec des rondins.
// Les portes se ferment la nuit (pour les zombies seulement : le joueur passe toujours).

import * as THREE from 'three';
import { mergeColored } from './bake';
import { C, blob, box, cone, corrugated, cyl, group, lathe, mixHex, paint, plank, rbox, rng, vgrad } from './kit';
import { CAMP, L } from './layout';
import type { Segment } from './physics';
import { SCRAP_TONES } from './props';

export const WALL_HP = 30;
export const GATE_HP = 60;
/** Points de vie rendus par chaque rondin. */
export const LOG_HP = 10;

/** Les cinq palissades, de la cloture de planches au fer fondu. */
export const TIERS = [
  { name: 'Bois simple', icon: '🪵', item: 'log', mul: 1 },
  { name: 'Pieux taillés', icon: '🪓', item: 'log', mul: 1.8 },
  { name: 'Pierre', icon: '🧱', item: 'stone', mul: 3 },
  { name: 'Ferraille', icon: '🔩', item: 'scrap', mul: 4.2 },
  { name: 'Fer fondu', icon: '⚙️', item: 'metal', mul: 6 },
] as const;
export type TierItem = (typeof TIERS)[number]['item'];

const HIGH = 2.9;
const LOW = 1.6;
const BARK = [0x7a5a3a, 0x86643f, 0x6e5034, 0x8f6a44];
const CUT = 0xd9b07a;
const SPACING = 0.36;
/** Poutres de liaison, cordes, bois neuf des eclats. */
const BEAM = 0x5e452c;
const ROPE = 0xc8ab6e;
const CHIP = 0xcfa36c;

export interface Section {
  id: number;
  kind: 'wall' | 'gate';
  x: number;
  z: number;
  /** Normale vers l'interieur du camp. */
  nx: number;
  nz: number;
  len: number;
  /** Hauteur de reference du troncon (haut au nord, bas au sud). */
  h: number;
  seg: Segment;
  hp: number;
  max: number;
  root: THREE.Group;
  /** Murs : visuels par etat, 0 (detruit) a 3 (intact). */
  states: THREE.Object3D[];
  shake: number;
  /** Petit rebond quand une reparation fait changer d'etat. */
  pop: number;
  repair: { x: number; z: number };
  label: HTMLElement;
  /** Rondins en vol vers ce troncon. */
  inflight: number;
  /** La porte nord n'existe qu'une fois restauree. */
  enabled: boolean;
  gate?: GateParts;
}

interface GateParts {
  left: THREE.Object3D;
  right: THREE.Object3D;
  broken: THREE.Object3D;
  /** +1 : s'ouvre vers l'interieur, -1 : vers l'exterieur. */
  swing: number;
  angle: number;
  closed: boolean;
}

/** Etat visuel d'un troncon d'apres ses points de vie. */
export function stateOf(s: Section): number {
  if (s.hp <= 0) return 0;
  const k = s.hp / s.max;
  return k > 0.66 ? 3 : k > 0.33 ? 2 : 1;
}

/** Chaque unite de materiau rend un tiers de la solidite : trois pour un troncon a terre. */
export function unitHp(s: Section): number {
  return s.max / 3;
}

export function logsNeeded(s: Section): number {
  return Math.ceil(Math.max(0, s.max - s.hp) / unitHp(s) - 1e-6);
}

// ---------------------------------------------------------------- outils de modelage

/** Arrondi a un pas : des dimensions quantifiees partagent leurs geometries (cache du kit). */
const q = (v: number, step = 0.05): number => Math.round(v / step) * step;

/** Place et oriente un objet (angles en radians, ordre XYZ). */
function put<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): T {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

/**
 * Ecorce : stries verticales douces (selon l'angle autour de l'axe) et pied un peu plus
 * sombre, haut un peu plus clair. Ecrit dans `out` la teinte du bois en (x, y, z).
 */
function barkColor(tone: number, x: number, y: number, z: number, h: number, out: THREE.Color): void {
  const a = Math.atan2(x, z);
  const k = 1 + 0.07 * Math.sin(a * 3 + (tone % 7)) + 0.035 * Math.sin(a * 7 + 1.3);
  const t = Math.max(0, Math.min(1, y / Math.max(0.1, h)));
  out.setHex(tone).multiplyScalar(k * (0.9 + 0.14 * t));
}

const cutA = new THREE.Color(mixHex(CUT, 0x9a6a3e, 0.3));
const cutB = new THREE.Color(CUT);

/**
 * Pieu rond taille en pointe, d'une seule forme de revolution (aucun raccord visible) :
 * ecorce striee, liens de corde en bourrelet aux hauteurs `bands`, pointe de bois clair.
 * `body` = hauteur du fut ; la pointe (0.42) s'y ajoute. Origine au pied, enfonce de 0.05.
 */
function pikeMesh(r: number, body: number, tone: number, bands: number[], sides = 12): THREE.Mesh {
  const tip = Math.min(0.42, body * 0.3);
  const ht = body;
  const h = body + tip;
  const bs = bands.filter((b) => b > 0.2 && b < ht - 0.15);
  // Pied ferme (pole) : visible quand le pieu est couche (rondin tombe, porte defoncee).
  const prof: [number, number][] = [[0, -0.05], [r * 1.04, -0.05]];
  for (const b of bs) prof.push([r * (1.02 - (0.04 * b) / h), b - 0.06], [r + 0.032, b], [r * (1.02 - (0.04 * b) / h), b + 0.06]);
  prof.push([r * 0.97, ht - 0.035], [r * 0.93, ht], [r * 0.6, ht + tip * 0.42], [r * 0.27, ht + tip * 0.78], [0.028, h - 0.012], [0, h]);
  const m = lathe(prof, 0xffffff, 0, 0, 0, sides);
  const rope = new THREE.Color(ROPE);
  return paint(m, `pk${tone}|${bs.join(',')}|${ht.toFixed(3)}`, (x, y, z, out) => {
    if (y < -0.045 && Math.hypot(x, z) < r * 0.5) {
      out.copy(cutB);
      return;
    }
    if (y > ht - 0.005) {
      out.lerpColors(cutA, cutB, Math.min(1, (y - ht) / (tip * 0.5)));
      return;
    }
    for (const b of bs) {
      if (Math.abs(y - b) < 0.02) {
        out.copy(rope).multiplyScalar(1 + 0.06 * Math.sin(Math.atan2(x, z) * 4));
        return;
      }
    }
    barkColor(tone, x, y, z, h, out);
  });
}

/** Pieu casse : un chicot au dessus de bois clair (eclats ajoutes a part). */
function stumpMesh(r: number, hb: number, tone: number, sides = 12): THREE.Mesh {
  const prof: [number, number][] = [[r * 1.04, -0.05], [r, hb - 0.07], [r * 0.93, hb - 0.02], [r * 0.55, hb + 0.02], [0, hb + 0.035]];
  const m = lathe(prof, 0xffffff, 0, 0, 0, sides);
  return paint(m, `st${tone}|${hb.toFixed(3)}`, (x, y, z, out) => {
    if (y > hb - 0.035) out.lerpColors(cutA, cutB, Math.min(1, (y - hb + 0.035) / 0.06));
    else barkColor(tone, x, y, z, hb + 0.5, out);
  });
}

/** Eclats de bois plantes sur une cassure (petits cones aplatis). */
function splinters(g: THREE.Object3D, x: number, y: number, z: number, r: number, seed: number, color = CUT): void {
  const n = seed % 3 === 0 ? 1 : 2;
  for (let i = 0; i < n; i++) {
    const a = seed * 1.7 + i * 2.6;
    const s = put(cone(0.05, 0.18 + (i ? 0.06 : 0), color), x + Math.cos(a) * r * 0.5, y + 0.06, z + Math.sin(a) * r * 0.5, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
    s.scale.z = 0.55;
    g.add(s);
  }
}

/** Copeaux et bouts de planche au sol. */
function chips(g: THREE.Object3D, r: () => number, len: number, n: number, color = CHIP): void {
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    g.add(put(plank(0.2, 0.05, 0.09, color), (r() - 0.5) * len * 0.9, 0.025, side * (0.45 + r() * 0.6), 0, r() * 3, 0));
  }
}

/** Rondin abattu, couche au sol (meme geometrie que les pieux debout). */
function fallenLog(x: number, z: number, len: number, ry: number, tone: number, r = 0.17): THREE.Group {
  const l = put(pikeMesh(r, q(len, 0.1), tone, []), 0, 0, 0, 0, 0, -Math.PI / 2);
  l.position.x = -len / 2 - 0.2;
  const g = group(l);
  g.position.set(x, r * 0.92, z);
  g.rotation.y = ry;
  return g;
}

function beam(len: number, y: number, z: number): THREE.Mesh {
  return put(cyl(0.085, 0.085, len, BEAM), 0, y, z, 0, 0, Math.PI / 2);
}

/** Pieu d'arret pointe vers l'exterieur (ecorce sombre, pointe claire). */
function stakeMesh(len: number): THREE.Mesh {
  const prof: [number, number][] = [[0.072, -0.05], [0.068, len - 0.3], [0.062, len - 0.27], [0.028, len - 0.08], [0, len]];
  const m = lathe(prof, 0xffffff);
  return paint(m, `sk${len}`, (x, y, z, out) => {
    if (y > len - 0.285) out.lerpColors(cutA, cutB, Math.min(1, (y - len + 0.285) / 0.15));
    else barkColor(C.woodDark, x, y, z, len, out);
  });
}

/** Une paire de pieux croises pointes vers l'exterieur, noues au croisement. */
function cheval(x: number, H: number): THREE.Group {
  const len = H > 2 ? 1.6 : 1.2;
  const g = group(
    put(stakeMesh(len), -0.16, 0, 0, 0, 0, -0.38),
    put(stakeMesh(len), 0.16, 0, 0, 0, 0, 0.38),
    blob(0.075, ROPE, 0, 0.42, 0),
  );
  g.position.set(x, 0, -0.35);
  g.rotation.x = -0.85;
  return g;
}

// ---------------------------------------------------------------- etats des troncons

/** Les quatre etats d'un troncon (0 a terre .. 3 intact), selon le materiau. */
function wallStates(len: number, H: number, seed: number, tier: number): THREE.Group[] {
  if (tier === 1) return plankStates(len, H, seed);
  if (tier === 3) return stoneStates(len, H, seed);
  if (tier === 4) return scrapStates(len, H, seed);
  if (tier === 5) return metalStates(len, H, seed);
  return pikeStates(len, H, seed);
}

/** Niveau 1 : une cloture de planches clouees sur deux traverses, poteaux ronds, sans pointe. */
function plankStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const h = H * 0.72;
  const n = Math.max(3, Math.round(len / 0.3));
  const bw = len / n - 0.03;
  const TONES = [0xb98a55, 0xa87a48, 0xc69a62];
  // Quelques planches de recuperation, grisees par le temps.
  const OLD = 0xa39280;
  const boards = Array.from({ length: n }, (_, i) => {
    const tone = r() < 0.14 ? OLD : TONES[i % 3]!;
    return { x: -len / 2 + (i + 0.5) * (len / n), h: q(h * (0.92 + r() * 0.12)), roll: r(), tone, tilt: (r() - 0.5) * 0.05 };
  });
  const board = (b: (typeof boards)[number], k: number, splinter: boolean) => {
    const hh = Math.max(0.1, q(b.h * k));
    const topC = mixHex(b.tone, 0xfff0d0, 0.08);
    // Intacte : dessus arrondi (un disque un peu plus mince, sans scintillement des faces).
    const round = !splinter && k >= 1;
    const bh = round ? hh - bw / 2 : hh;
    const m = vgrad(plank(bw, bh, 0.06, 0xffffff), mixHex(b.tone, 0x5a3d24, 0.22), topC);
    const g = group(put(m, 0, bh / 2, 0));
    if (round) g.add(put(cyl(bw / 2, bw / 2, 0.05, topC), 0, bh, 0, Math.PI / 2, 0, 0));
    if (splinter) splinters(g, (b.roll - 0.5) * bw * 0.6, hh - 0.03, 0, 0.02, Math.floor(b.roll * 100), mixHex(b.tone, CUT, 0.5));
    g.position.x = b.x;
    g.rotation.z = b.tilt;
    return g;
  };
  const np = Math.max(1, Math.round(len / 1.3));
  const postX = Array.from({ length: np }, (_, i) => -len / 2 + (i + 0.5) * (len / np));
  const postH = q(h * 1.02 + 0.06);
  const post = (x: number, hh = postH) => lathe([[0.088, -0.05], [0.08, hh - 0.08], [0.064, hh - 0.02], [0, hh]], C.woodDark, x, 0, 0.15);
  const rail = (y: number) => plank(len, 0.1, 0.05, 0x8d6038, 0, y, 0.08);
  const brace = () => {
    const dy = h * 0.53;
    const dx = Math.min(1.2, len * 0.45);
    return put(plank(Math.hypot(dx, dy), 0.09, 0.045, 0x96683e), 0, h * 0.515, 0.11, 0, 0, Math.atan2(dy, dx));
  };
  const build = (keep: (b: { roll: number }) => number) => {
    const g = new THREE.Group();
    for (const b of boards) {
      const k = keep(b);
      if (k > 0) g.add(board(b, k, k < 1));
    }
    return g;
  };
  const intact = group(rail(h * 0.25), rail(h * 0.78), ...postX.map((x) => post(x)), build(() => 1));
  if (len > 1.5) intact.add(brace());
  const damaged = group(rail(h * 0.25), rail(h * 0.78), ...postX.map((x) => post(x)), build((b) => (b.roll < 0.25 ? 0 : b.roll < 0.4 ? 0.6 : 1)));
  chips(damaged, r, len, 2);
  const hanging = put(plank(len * 0.55, 0.1, 0.05, 0x8d6038), len * 0.2, h * 0.55, 0.08, 0, 0, 0.38);
  const heavy = group(rail(h * 0.25), hanging, ...postX.map((x) => post(x)), build((b) => (b.roll < 0.55 ? 0 : 0.7)));
  heavy.add(
    put(board(boards[0]!, 0.8, false), -len * 0.2, 0.04, 0.75, Math.PI / 2, 0, 0.5),
    put(board(boards[1 % n]!, 0.8, false), len * 0.15, 0.04, -0.6, -Math.PI / 2, 0, -0.7),
  );
  chips(heavy, r, len, 3);
  const broken = group(build((b) => (b.roll < 0.7 ? 0.15 : 0.3)));
  postX.forEach((x, i) => {
    const ph = q(0.45 + r() * 0.2);
    broken.add(lathe([[0.088, -0.05], [0.08, ph - 0.03], [0.05, ph], [0, ph + 0.01]], C.woodDark, x, 0, 0.15));
    splinters(broken, x, ph - 0.02, 0.15, 0.08, i + 1, mixHex(C.woodDark, CUT, 0.6));
  });
  for (let i = 0; i < 3; i++) {
    broken.add(put(board(boards[i % n]!, 0.8, false), (i - 1) * len * 0.3, 0.04, 0.7 + (i % 2) * 0.4, Math.PI / 2, 0, r() * 2));
  }
  broken.add(put(plank(len * 0.7, 0.1, 0.05, 0x8d6038), 0, 0.05, -0.75, Math.PI / 2, 0, 0.25));
  chips(broken, r, len, 4);
  return [broken, heavy, damaged, intact];
}

/** Niveau 3 : un mur de moellons arrondis maconnes, assises decalees et chaperon. */
function stoneStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const wallH = H * 0.92;
  const rows = Math.max(3, Math.round(wallH / 0.45));
  const rowH = wallH / rows;
  const cols = Math.max(2, Math.round(len / 0.62));
  const w = len / cols;
  const TONES = [0xa39d90, 0x8c877c, 0xb0aa9c, 0x968f82];
  const RADII = [0.13, 0.135, 0.14];
  const MORTAR = 0x7a7466;
  const D = 0.62;
  // Moellon : galet doux etire (trois formes partagees), dessus un peu plus clair.
  const stone = (bw: number, bh: number, d: number, tone: number, k: number) => {
    const rb = RADII[k % 3]!;
    const m = vgrad(blob(rb, 0xffffff), mixHex(tone, 0x4a463e, 0.18), mixHex(tone, 0xfffaf0, 0.1));
    m.scale.set(bw / (2 * rb), bh / (2 * rb), d / (2 * rb));
    if (k & 4) m.rotation.y = Math.PI;
    return m;
  };
  type Block = { x: number; y: number; row: number; roll: number; tone: number; w: number; k: number };
  const blocks: Block[] = [];
  for (let j = 0; j < rows; j++) {
    const y = (j + 0.5) * rowH;
    const add = (x: number, bw: number) => blocks.push({ x, y, row: j, roll: r(), tone: TONES[Math.floor(r() * 4)]!, w: bw, k: Math.floor(r() * 8) });
    if (j % 2 === 0) for (let i = 0; i < cols; i++) add(-len / 2 + (i + 0.5) * w, w * 1.02);
    else {
      // Assise decalee : une demi-pierre a chaque bout.
      add(-len / 2 + w / 4, w * 0.52);
      for (let i = 0; i < cols - 1; i++) add(-len / 2 + w + i * w, w * 1.02);
      add(len / 2 - w / 4, w * 0.52);
    }
  }
  // Une pierre ne tient que si une pierre de l'assise du dessous la porte (pas de pierre en l'air).
  const held = (keep: (b: Block) => boolean) => {
    const set = new Set<Block>();
    for (const b of blocks) {
      if (!keep(b)) continue;
      if (b.row === 0 || blocks.some((u) => u.row === b.row - 1 && set.has(u) && Math.abs(u.x - b.x) < (u.w + b.w) / 2 - 0.08)) set.add(b);
    }
    return set;
  };
  // Ame de mortier par tranche : elle s'arrete sous la premiere pierre manquante.
  const core = (keep: (b: Block) => boolean, full: boolean) => {
    const g = new THREE.Group();
    const nc = cols;
    for (let c = 0; c < nc; c++) {
      const x0 = -len / 2 + c * (len / nc);
      const x1 = x0 + len / nc;
      let top = 0;
      for (let j = 0; j < rows; j++) {
        const gone = blocks.some((b) => b.row === j && b.x + b.w / 2 > x0 + 0.05 && b.x - b.w / 2 < x1 - 0.05 && !keep(b));
        if (gone) break;
        top = j + 1;
      }
      const hh = full ? wallH : top * rowH - rowH * 0.35;
      if (hh > 0.1) g.add(box(len / nc + 0.005, q(hh, 0.01), 0.44, MORTAR, (x0 + x1) / 2, q(hh, 0.01) / 2, 0));
    }
    return g;
  };
  const build = (want: (b: Block) => boolean, cap: boolean) => {
    const set = held(want);
    const keep = (b: Block) => set.has(b);
    const g = group(core(keep, cap));
    for (const b of blocks) if (keep(b)) g.add(put(stone(b.w, rowH * 1.04, D, b.tone, b.k), b.x, b.y, 0));
    if (cap) {
      // Chaperon : un boudin de pierre aplati, plus clair, qui deborde un peu.
      const c = put(cyl(0.36, 0.36, len, 0x8f897d), 0, wallH + 0.1, 0, 0, 0, Math.PI / 2);
      c.scale.set(0.36, 1, 1);
      // Degrade sur x local (devenu la hauteur une fois couche) : dessus plus clair.
      const lo = new THREE.Color(0x7d776c);
      const hi = new THREE.Color(0xaaa496);
      g.add(paint(c, 'cap', (x, _y, _z, out) => { out.lerpColors(lo, hi, Math.max(0, Math.min(1, (x + 0.36) / 0.72))); }));
    }
    return g;
  };
  const rubble = (g: THREE.Group, n: number) => {
    for (let i = 0; i < n; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const s = stone(0.42 + r() * 0.2, 0.26, 0.4 + r() * 0.15, TONES[i % 4]!, i);
      s.position.set((r() - 0.5) * len, 0.1, side * (0.55 + r() * 0.5));
      s.rotation.y = r() * 3;
      g.add(s);
    }
    for (let i = 0; i < Math.ceil(n / 2); i++) g.add(blob(0.065, TONES[(i + 1) % 4]!, (r() - 0.5) * len, 0.03, (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.7)));
  };
  const intact = build(() => true, true);
  const damaged = build((b) => b.row < rows - 2 || (b.row === rows - 2 ? b.roll > 0.2 : b.roll > 0.4), false);
  rubble(damaged, 2);
  const heavy = build((b) => b.row < Math.ceil(rows / 2) - 1 || (b.row < rows - 1 && b.roll > 0.65), false);
  rubble(heavy, 3);
  const broken = build((b) => b.row === 0 || (b.row === 1 && b.roll > 0.5), false);
  rubble(broken, 5);
  return [broken, heavy, damaged, intact];
}

/** Tole ondulee debout, origine en bas, rouillee vers le pied. */
function sheetMesh(w: number, h: number, tone: number): THREE.Mesh {
  return vgrad(corrugated(w, h, 0xffffff, 0, h / 2, 0), mixHex(tone, C.rustDark, 0.32), mixHex(tone, 0xffffff, 0.06));
}

/** Niveau 4 : des toles de recuperation rafistolees sur des poteaux, pointes de fer au sommet. */
function scrapStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const n = Math.max(2, Math.round(len / 0.95));
  const w = len / n;
  const POST = 0x55595c;
  const STRAP = 0x4c5156;
  const BOLT = 0xb7bcbe;
  const sheets = Array.from({ length: n }, (_, i) => ({
    x: -len / 2 + w / 2 + i * w,
    roll: r(),
    tone: SCRAP_TONES[Math.floor(r() * SCRAP_TONES.length)]!,
    patch: SCRAP_TONES[Math.floor(r() * SCRAP_TONES.length)]!,
    h: q(H * (0.9 + r() * 0.12)),
    tilt: (r() - 0.5) * 0.05,
    z: (i % 2 ? -0.02 : 0.02),
  }));
  const posts = (k = 1) => {
    const g = new THREE.Group();
    // Un poteau par jointure : celui de droite appartient au troncon voisin (ou a un gros poteau).
    for (let i = 0; i < n; i++) {
      const x = -len / 2 + i * w;
      const ph = q(H * 1.02 * k);
      g.add(cyl(0.065, 0.072, ph, POST, 8, x, ph / 2, 0.1));
      if (k === 1) g.add(blob(0.08, 0x666b6e, x, ph, 0.1));
    }
    return g;
  };
  const straps = (two: boolean) => {
    const g = group(plank(len, 0.08, 0.04, STRAP, 0, H * 0.3, 0.06));
    if (two) g.add(plank(len, 0.08, 0.04, STRAP, 0, H * 0.74, 0.06));
    // Boulons des traverses, un par tole.
    for (const sh of sheets) for (const y of two ? [0.3, 0.74] : [0.3]) g.add(blob(0.04, BOLT, sh.x, H * y, 0.085));
    return g;
  };
  const spikes = (keep: number) => {
    const g = new THREE.Group();
    for (let i = 0; i < n * 3; i++) if (r() < keep) g.add(cone(0.05, 0.35, 0x7a8288, 8, -len / 2 + (i + 0.5) * (len / (n * 3)), H + 0.12, 0));
    return g;
  };
  const panel = (sh: (typeof sheets)[number], m: 'up' | 'bent' | 'down') => {
    const g = group(sheetMesh(q(w + 0.06), sh.h, sh.tone));
    // Rustine : un bout de tole d'une autre couleur, rivete en biais sur l'exterieur.
    if (sh.roll > 0.35 && m !== 'down') {
      const py = sh.h * (0.25 + sh.roll * 0.35);
      const p = put(sheetMesh(0.45, 0.5, sh.patch), (sh.roll - 0.6) * w * 0.5, py - 0.25, -0.07, 0, 0, (sh.roll - 0.6) * 0.5);
      g.add(p);
      for (const [dx, dy] of [[-0.17, 0.06], [0.17, 0.06], [-0.17, 0.44], [0.17, 0.44]] as const) {
        const v = new THREE.Vector3(dx, dy, -0.04).applyEuler(p.rotation).add(p.position);
        g.add(blob(0.032, BOLT, v.x, v.y, v.z));
      }
    }
    g.position.set(sh.x, 0, sh.z);
    g.rotation.z = sh.tilt;
    if (m === 'bent') g.rotation.x = -0.35;
    if (m === 'down') { g.rotation.set(-Math.PI / 2 + 0.1, 0, sh.tilt * 6); g.position.z = -0.2; }
    return g;
  };
  const build = (mode: (sh: { roll: number }) => 'up' | 'bent' | 'down' | 'gone') => {
    const g = new THREE.Group();
    for (const sh of sheets) {
      const m = mode(sh);
      if (m !== 'gone') g.add(panel(sh, m));
    }
    return g;
  };
  const scraps = (g: THREE.Group, k: number) => {
    for (let i = 0; i < k; i++) {
      const side = i % 2 ? 1 : -1;
      g.add(put(sheetMesh(0.4, 0.35, SCRAP_TONES[(i + seed) % SCRAP_TONES.length]!), (r() - 0.5) * len, 0.04, side * (0.5 + r() * 0.5), -Math.PI / 2 + 0.12, 0, r() * 3));
    }
  };
  const intact = group(posts(), straps(true), build(() => 'up'), spikes(1));
  const damaged = group(posts(), straps(true), build((sh) => (sh.roll < 0.3 ? 'bent' : 'up')), spikes(0.7));
  scraps(damaged, 1);
  const heavy = group(posts(), straps(false), build((sh) => (sh.roll < 0.5 ? 'down' : sh.roll < 0.7 ? 'bent' : 'up')));
  scraps(heavy, 2);
  const broken = group(build((sh) => (sh.roll < 0.6 ? 'down' : 'gone')));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + i * w;
    broken.add(cyl(0.065, 0.072, 0.4, POST, 8, x, 0.2, 0.1));
    // Un bout de poteau tordu, tombe a cote.
    if (i % 2 === 0) broken.add(put(cyl(0.06, 0.065, 0.9, POST, 8), x + 0.25, 0.07, 0.45, Math.PI / 2, 0, 0.6 + i));
  }
  scraps(broken, 3);
  return [broken, heavy, damaged, intact];
}

/** Niveau 5 : d'epaisses plaques de fer fondu arrondies, renforcees, rivetees, herissees de pointes. */
function metalStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const n = Math.max(2, Math.round(len / 1.3));
  const w = len / n;
  const h = H * 1.05;
  const PLATE = 0x6d757b;
  const FRAME = 0x43474b;
  const BAND = 0x545a60;
  const RIVET = 0xaab3b8;
  const plates = Array.from({ length: n }, (_, i) => ({ x: -len / 2 + w / 2 + i * w, roll: r() }));
  const spike = (x: number) => lathe([[0.07, -0.02], [0.07, 0.05], [0.045, 0.09], [0.012, 0.4], [0, 0.42]], 0x3a3d41, x, h + 0.08, 0);
  const frame = () => group(
    plank(len, 0.16, 0.22, FRAME, 0, h, 0), plank(len, 0.16, 0.22, FRAME, 0, 0.1, 0),
    ...Array.from({ length: n }, (_, i) => plank(0.18, h, 0.26, FRAME, -len / 2 + i * w, h / 2, 0)),
  );
  const plate = (x: number, k: number, tilt: number) => {
    const ph = q((h - 0.2) * k);
    const pw = q(w - 0.08);
    const body = vgrad(rbox(pw, ph, 0.12, 0xffffff, 0.05), mixHex(PLATE, 0x8a5a3c, 0.22), mixHex(PLATE, 0xdfe6ea, 0.08));
    const g = group(put(body, 0, ph / 2 + 0.1, 0));
    // Renfort horizontal des deux cotes, rivete.
    const by = Math.min(ph * 0.55, h * 0.5);
    if (by + 0.07 < ph) {
      for (const sz of [-1, 1]) {
        g.add(plank(pw + 0.02, 0.15, 0.05, BAND, 0, by + 0.1, sz * 0.08));
        for (const xx of [-0.36, 0, 0.36]) g.add(blob(0.045, RIVET, xx * pw, by + 0.1, sz * 0.108));
      }
    }
    // Rivets des coins, cote exterieur et cote interieur.
    for (const yy of [0.12, 0.88]) {
      if (yy * ph + 0.06 > ph) continue;
      for (const xx of [-0.42, 0.42]) for (const sz of [-1, 1]) g.add(blob(0.04, RIVET, xx * pw, yy * ph + 0.1, sz * 0.065));
    }
    g.position.x = x;
    g.rotation.x = tilt;
    return g;
  };
  const spikes = (keep: number) => {
    const g = new THREE.Group();
    for (let i = 0; i < n * 4; i++) if (r() < keep) g.add(spike(-len / 2 + (i + 0.5) * (len / (n * 4))));
    return g;
  };
  const bolts = (g: THREE.Group, k: number) => {
    for (let i = 0; i < k; i++) g.add(blob(0.05, RIVET, (r() - 0.5) * len, 0.03, (i % 2 ? 1 : -1) * (0.4 + r() * 0.6)));
  };
  const intact = group(frame(), ...plates.map((p) => plate(p.x, 1, 0)), spikes(1));
  const damaged = group(frame(), ...plates.map((p) => plate(p.x, 1, p.roll < 0.35 ? -0.12 : 0)), spikes(0.6));
  bolts(damaged, 2);
  // Tres abime : les plaques les plus faibles arrachees a mi-hauteur, les autres deja basses.
  const heavy = group(frame(), ...plates.map((p) => (p.roll > 0.45 ? plate(p.x, 0.6, -0.08) : plate(p.x, 0.25, 0))));
  bolts(heavy, 3);
  const broken = group(plank(len, 0.16, 0.22, FRAME, 0, 0.1, 0), ...plates.filter((p) => p.roll > 0.6).map((p) => plate(p.x, 0.25, 0)));
  for (const p of plates.filter((qq) => qq.roll <= 0.6)) {
    const down = plate(p.x, 1, -Math.PI / 2 + 0.08);
    down.position.z = -0.4;
    broken.add(down);
  }
  for (let i = 0; i < n; i++) broken.add(plank(0.18, 0.35, 0.26, FRAME, -len / 2 + i * w, 0.175, 0));
  bolts(broken, 4);
  return [broken, heavy, damaged, intact];
}

/** Niveau 2 : le fort de trappeurs, des pieux tailles lies a des traverses. */
function pikeStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const n = Math.max(3, Math.round(len / SPACING));
  const bands = H > 2 ? [0.65, H - 0.75] : [0.65];
  const logs = Array.from({ length: n }, (_, i) => ({
    x: -len / 2 + (i + 0.5) * (len / n),
    r: [0.165, 0.18, 0.195][Math.floor(r() * 3)]!,
    h: q(H * (0.9 + r() * 0.16), 0.08),
    tone: BARK[Math.floor(r() * BARK.length)]!,
    roll: r(),
    lean: (r() - 0.5) * 0.06,
  }));
  type Log = (typeof logs)[number];
  const pikeOf = (l: Log, lean: number) => put(pikeMesh(l.r, l.h, l.tone, bands), l.x, 0, 0, 0, 0, lean);
  const stumpOf = (g: THREE.Group, l: Log, hb: number) => {
    const hq = q(Math.max(0.15, hb), 0.1);
    g.add(put(stumpMesh(l.r, hq, l.tone), l.x, 0, 0));
    splinters(g, l.x, hq, 0, l.r, Math.floor(l.roll * 97));
  };
  const spikes = () => group(cheval(-0.25 * len, H), cheval(0.25 * len, H));
  const beams = (top: boolean) => {
    const g = group(beam(len, 0.65, 0.22));
    if (top && H > 2) g.add(beam(len, H - 0.75, 0.22));
    return g;
  };

  const intact = group(spikes(), beams(true));
  for (const l of logs) intact.add(pikeOf(l, l.lean));

  const damaged = group(spikes(), beams(true));
  logs.forEach((l, i) => {
    if (l.roll < 0.28) stumpOf(damaged, l, l.h * (0.55 + l.roll));
    else damaged.add(pikeOf(l, i === Math.floor(n / 2) ? 0.22 : l.lean));
  });
  chips(damaged, r, len, 2);

  const heavy = group(spikes(), beams(false));
  for (const l of logs) {
    if (l.roll < 0.6) stumpOf(heavy, l, l.h * (0.3 + l.roll * 0.5));
    else heavy.add(pikeOf(l, l.lean));
  }
  heavy.add(fallenLog(-len * 0.15, -0.9, H * 0.8, 0.35, logs[1 % n]!.tone), fallenLog(len * 0.2, 0.8, H * 0.7, -0.5, logs[2 % n]!.tone));
  chips(heavy, r, len, 3);

  const broken = group(cheval(-0.25 * len, H));
  for (const l of logs) stumpOf(broken, l, 0.15 + l.roll * 0.35);
  broken.add(
    fallenLog(-len * 0.25, -1.0, H * 0.85, 0.5, logs[0]!.tone),
    fallenLog(len * 0.1, 0.9, H * 0.8, -0.3, logs[3 % n]!.tone),
    fallenLog(len * 0.3, -0.6, H * 0.6, 1.2, logs[4 % n]!.tone),
  );
  chips(broken, r, len, 4);
  return [broken, heavy, damaged, intact];
}

/** Un battant de porte en rondins, charniere a l'origine, s'etendant vers +x*dir. */
function door(width: number, H: number, dir: number, seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(width / 0.3));
  const bars = [0.45, H - 0.45];
  for (let i = 0; i < n; i++) {
    const x = dir * (i + 0.5) * (width / n);
    g.add(put(pikeMesh(0.145, q(H * (0.95 + r() * 0.08), 0.08), BARK[i % BARK.length]!, []), x, 0, 0));
  }
  // Traverses et echarpe en planches epaisses, cote interieur.
  for (const y of bars) g.add(plank(width, 0.17, 0.07, BEAM, (dir * width) / 2, y, 0.17));
  const diag = plank(0.15, Math.hypot(width, H - 0.9), 0.06, 0x6a4c30, (dir * width) / 2, H / 2, 0.2);
  diag.rotation.z = dir * Math.atan2(width, H - 0.9);
  g.add(diag);
  // Pentures de fer cote exterieur, et gonds.
  for (const y of bars) {
    g.add(plank(width * 0.5, 0.11, 0.035, 0x3f4246, dir * width * 0.25, y, -0.165));
    g.add(blob(0.045, 0x9aa3a8, dir * width * 0.47, y, -0.19));
    g.add(cyl(0.05, 0.05, 0.24, 0x3f4246, 8, 0, y, 0));
  }
  return g;
}


interface RunDef { x1: number; z1: number; x2: number; z2: number; h: number }

export class Palisade {
  readonly sections: Section[] = [];
  /** Segments qui bloquent tout le monde (murs). */
  readonly walls: Segment[] = [];
  /** Segments des portes : ils ne bloquent que les zombies, et seulement fermees. */
  readonly gateWalls: Segment[] = [];
  readonly north: Section;
  private readonly extras: THREE.Object3D[] = [];
  readonly south: Section;

  constructor(private readonly scene: THREE.Scene, private readonly labels: HTMLElement) {
    const { minX, maxX, minZ, maxZ, gate } = CAMP;
    const s0 = L.stall.x - L.stall.w / 2;
    const s1 = L.stall.x + L.stall.w / 2;
    // Chaque course est orientee pour que l'interieur du camp soit a sa gauche.
    const runs: RunDef[] = [
      { x1: minX, z1: minZ, x2: -gate, z2: minZ, h: HIGH },
      { x1: gate, z1: minZ, x2: maxX, z2: minZ, h: HIGH },
      { x1: maxX, z1: minZ, x2: maxX, z2: maxZ, h: HIGH },
      { x1: maxX, z1: maxZ, x2: s1, z2: maxZ, h: LOW },
      { x1: s0, z1: maxZ, x2: gate, z2: maxZ, h: LOW },
      { x1: -gate, z1: maxZ, x2: minX, z2: maxZ, h: LOW },
      { x1: minX, z1: maxZ, x2: minX, z2: minZ, h: HIGH },
    ];
    for (const run of runs) {
      const len = Math.hypot(run.x2 - run.x1, run.z2 - run.z1);
      const k = Math.max(1, Math.round(len / 2.6));
      for (let i = 0; i < k; i++) {
        const a = i / k;
        const b = (i + 1) / k;
        this.addWall(run.x1 + (run.x2 - run.x1) * a, run.z1 + (run.z2 - run.z1) * a, run.x1 + (run.x2 - run.x1) * b, run.z1 + (run.z2 - run.z1) * b, run.h);
      }
    }
    this.north = this.addGate(-gate, minZ, gate, minZ, HIGH, 1);
    this.north.enabled = false;
    this.north.root.visible = false;
    this.south = this.addGate(gate, maxZ, -gate, maxZ, LOW, -1);

    // Poteaux d'angle et montants de l'etal : ils cachent les jointures.
    const posts: [number, number, number][] = [
      [minX, minZ, HIGH], [maxX, minZ, HIGH], [minX, maxZ, HIGH], [maxX, maxZ, HIGH],
      [s0, maxZ, LOW + 0.5], [s1, maxZ, LOW + 0.5],
    ];
    const pg = new THREE.Group();
    for (const [x, z, h] of posts) pg.add(put(pikeMesh(0.3, q(h + 0.4), BARK[0]!, h > 2 ? [0.65, h - 0.75] : [0.65], 16), x, 0, z));
    const postMesh = mergeColored(pg);
    scene.add(postMesh);
    this.extras.push(postMesh);
  }

  private frame(x1: number, z1: number, x2: number, z2: number) {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const ang = Math.atan2(z2 - z1, x2 - x1);
    const x = (x1 + x2) / 2;
    const z = (z1 + z2) / 2;
    return { len, ang, x, z, nx: -Math.sin(ang), nz: Math.cos(ang) };
  }

  private base(kind: 'wall' | 'gate', x1: number, z1: number, x2: number, z2: number, max: number): Section {
    const f = this.frame(x1, z1, x2, z2);
    const root = new THREE.Group();
    root.position.set(f.x, 0, f.z);
    root.rotation.y = -f.ang;
    this.scene.add(root);
    const repair = { x: f.x + f.nx * 1.25, z: f.z + f.nz * 1.25 };
    const label = document.createElement('div');
    label.className = 'wall-label off';
    this.labels.appendChild(label);
    const s: Section = {
      id: this.sections.length, kind, x: f.x, z: f.z, nx: f.nx, nz: f.nz, len: f.len,
      seg: { x1, z1, x2, z2 }, h: 0, hp: max, max, root, states: [], shake: 0, pop: 0, repair, label, inflight: 0, enabled: true,
    };
    this.sections.push(s);
    return s;
  }

  private addWall(x1: number, z1: number, x2: number, z2: number, h: number): void {
    const s = this.base('wall', x1, z1, x2, z2, WALL_HP);
    s.h = h;
    this.buildStates(s);
    this.walls.push(s.seg);
    this.refresh(s);
  }

  /** Niveau de materiau de la palissade (1 a 5). */
  tier = 1;
  private lvl = 0;

  private buildStates(s: Section): void {
    for (const o of s.states) {
      s.root.remove(o);
      o.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry.dispose(); });
    }
    s.states = [];
    for (const st of wallStates(s.len, s.h, 100 + s.id * 7, this.tier)) {
      const m = mergeColored(st);
      m.visible = false;
      s.root.add(m);
      s.states.push(m);
    }
  }

  /** Change de materiau : tous les troncons sont reconstruits, solidite proportionnelle gardee. */
  setTier(tier: number): void {
    if (tier === this.tier) return;
    this.tier = tier;
    for (const s of this.sections) if (s.kind === 'wall') this.buildStates(s);
    this.applyMax();
  }

  /** Materiau qui repare la palissade a son niveau actuel. */
  get repairItem(): TierItem {
    return TIERS[this.tier - 1]!.item;
  }

  private addGate(x1: number, z1: number, x2: number, z2: number, h: number, swing: number): Section {
    const s = this.base('gate', x1, z1, x2, z2, GATE_HP);
    const half = s.len / 2;
    const postH = Math.max(h, 2.4) + 0.6;
    const lintel = postH - 0.35;
    const frame = group(
      put(pikeMesh(0.27, postH, BARK[2]!, [0.8, lintel], 16), -half, 0, 0),
      put(pikeMesh(0.27, postH, BARK[2]!, [0.8, lintel], 16), half, 0, 0),
    );
    // Linteau en rondin, ses deux bouts de bois clair qui depassent.
    const top = put(cyl(0.16, 0.16, s.len + 0.7, BARK[0]!), 0, lintel, 0, 0, 0, Math.PI / 2);
    frame.add(top);
    for (const sx of [-1, 1]) frame.add(put(cyl(0.135, 0.135, 0.03, CUT), sx * (s.len / 2 + 0.35), lintel, 0, 0, 0, Math.PI / 2));
    s.root.add(mergeColored(frame));
    const leftPivot = new THREE.Group();
    leftPivot.position.x = -half + 0.2;
    leftPivot.add(mergeColored(door(half - 0.2, h - 0.1, 1, s.id)));
    const rightPivot = new THREE.Group();
    rightPivot.position.x = half - 0.2;
    rightPivot.add(mergeColored(door(half - 0.2, h - 0.1, -1, s.id + 1)));
    const brokenG = new THREE.Group();
    for (const sx of [-1, 1]) {
      const d = door(half - 0.3, h - 0.1, 1, s.id + 3);
      // Enfoncees par les zombies : les battants tombent vers l'interieur.
      d.rotation.set(Math.PI / 2, 0, 0);
      d.position.set(sx < 0 ? -half + 0.3 : 0.3, 0.12, sx * 0.4);
      brokenG.add(d);
    }
    const broken = mergeColored(brokenG);
    broken.visible = false;
    s.root.add(leftPivot, rightPivot, broken);
    s.gate = { left: leftPivot, right: rightPivot, broken, swing, angle: Math.PI / 2, closed: false };
    this.gateWalls.push(s.seg);
    this.refresh(s);
    return s;
  }

  /** Met a jour le visuel et la collision d'un troncon apres un changement de PV. */
  refresh(s: Section): void {
    const st = stateOf(s);
    if (s.kind === 'wall') {
      s.states.forEach((o, i) => { o.visible = i === st; });
      s.seg.off = st === 0;
    } else {
      const g = s.gate!;
      const down = st === 0;
      g.left.visible = !down;
      g.right.visible = !down;
      g.broken.visible = down;
      s.seg.off = !s.enabled || down || !g.closed;
    }
  }

  setHp(s: Section, hp: number): void {
    s.hp = Math.max(0, Math.min(s.max, hp));
    this.refresh(s);
  }

  /** Coup de zombie ; renvoie vrai si le troncon vient de ceder. */
  damage(s: Section, dmg: number): boolean {
    if (s.hp <= 0) return false;
    const before = stateOf(s);
    s.hp = Math.max(0, s.hp - dmg);
    s.shake = Math.min(1, s.shake + 0.5);
    if (stateOf(s) !== before) this.refresh(s);
    return s.hp <= 0;
  }

  bump(s: Section): void {
    s.pop = 1;
  }

  enableNorth(): void {
    this.north.enabled = true;
    this.north.root.visible = true;
    this.refresh(this.north);
  }

  /** Le troncon qui separe une position de sa cible, si elle le touche presque. */
  blocking(pos: THREE.Vector3, target: THREE.Vector3, reach = 0.85): Section | null {
    for (const s of this.sections) {
      if (!s.enabled || s.seg.off) continue;
      const { x1, z1, x2, z2 } = s.seg;
      const vx = x2 - x1;
      const vz = z2 - z1;
      const l2 = vx * vx + vz * vz;
      const t = ((pos.x - x1) * vx + (pos.z - z1) * vz) / l2;
      if (t < -0.08 || t > 1.08) continue;
      const cx = x1 + vx * Math.max(0, Math.min(1, t));
      const cz = z1 + vz * Math.max(0, Math.min(1, t));
      if (Math.hypot(pos.x - cx, pos.z - cz) > reach) continue;
      // La cible doit etre de l'autre cote.
      const sp = (pos.x - s.x) * s.nx + (pos.z - s.z) * s.nz;
      const st = (target.x - s.x) * s.nx + (target.z - s.z) * s.nz;
      if (sp * st < 0) return s;
    }
    return null;
  }

  update(dt: number, night: boolean, time: number): void {
    for (const s of this.sections) {
      if (s.shake > 0) {
        s.shake = Math.max(0, s.shake - dt * 3);
        // Le troncon tremble perpendiculairement a lui-meme, sous les coups.
        s.root.position.x = s.x + Math.sin(time * 60) * s.shake * 0.06 * s.nx;
        s.root.position.z = s.z + Math.sin(time * 60) * s.shake * 0.06 * s.nz;
      }
      if (s.pop > 0) {
        s.pop = Math.max(0, s.pop - dt * 3);
        s.root.scale.y = 1 + Math.sin(s.pop * Math.PI) * 0.12;
      }
      const g = s.gate;
      if (g) {
        const closed = night && s.hp > 0;
        if (closed !== g.closed) {
          g.closed = closed;
          this.refresh(s);
        }
        g.angle += ((closed ? 0 : Math.PI / 2) - g.angle) * (1 - Math.exp(-4 * dt));
        g.left.rotation.y = -g.angle * g.swing;
        g.right.rotation.y = g.angle * g.swing;
      }
    }
  }

  /** Distance d'un point au troncon. */
  distanceTo(s: Section, x: number, z: number): number {
    const { x1, z1, x2, z2 } = s.seg;
    const vx = x2 - x1;
    const vz = z2 - z1;
    const t = Math.max(0, Math.min(1, ((x - x1) * vx + (z - z1) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(x - (x1 + vx * t), z - (z1 + vz * t));
  }

  /**
   * Le troncon abime le plus proche qu'on peut reparer d'ici : il suffit de longer le mur,
   * d'un cote ou de l'autre. Plus de cercle au sol, rien d'inaccessible.
   */
  repairable(x: number, z: number, reach = 1.7): Section | null {
    let best: Section | null = null;
    let bd = reach;
    for (const s of this.sections) {
      if (!s.enabled || s.hp + s.inflight * unitHp(s) >= s.max - 0.01) continue;
      const d = this.distanceTo(s, x, z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Palissade renforcee (etabli) : chaque niveau ajoute la moitie de la solidite de base. */
  setLevel(lvl: number): void {
    this.lvl = lvl;
    this.applyMax();
  }

  private applyMax(): void {
    const mul = TIERS[this.tier - 1]!.mul;
    for (const s of this.sections) {
      const base = s.kind === 'gate' ? GATE_HP : WALL_HP;
      const max = Math.round(base * mul * (1 + 0.5 * this.lvl));
      if (max === s.max) continue;
      const k = s.hp / s.max;
      s.max = max;
      s.hp = Math.round(max * k);
      this.refresh(s);
    }
  }

  /** Retire toute la palissade de la scene (le camp s'agrandit, on la reconstruit). */
  dispose(): void {
    for (const s of this.sections) {
      this.scene.remove(s.root);
      s.label.remove();
      s.root.traverse((c) => { if ((c as THREE.Mesh).isMesh) (c as THREE.Mesh).geometry.dispose(); });
    }
    for (const e of this.extras) this.scene.remove(e);
  }

  hpList(): number[] {
    return this.sections.map((s) => Math.round(s.hp));
  }

  /** Etat de depart : une vieille palissade, trouee par endroits ; portes intactes. */
  initialHp(): number[] {
    const r = rng(42);
    return this.sections.map((s) => {
      if (s.kind === 'gate') return s.max;
      const k = r();
      return k < 0.14 ? 0 : k < 0.32 ? 10 : k < 0.48 ? 18 : WALL_HP;
    });
  }
}
