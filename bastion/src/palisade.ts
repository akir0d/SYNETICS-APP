// La palissade du camp : des rondins tailles en pointe, par troncons. Chaque troncon
// a ses points de vie : les zombies le cassent la nuit, on le repare avec des rondins.
// Les portes se ferment la nuit (pour les zombies seulement : le joueur passe toujours).

import * as THREE from 'three';
import { mergeColored } from './bake';
import { blob, box, cone, cyl, group, rbox, rng, sphere } from './kit';
import { CAMP, L } from './layout';
import type { Segment } from './physics';
import { SCRAP_TONES, sheet, stake } from './props';

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

interface LogProfile { x: number; r: number; h: number; tone: number; roll: number; lean: number }

function pike(x: number, r: number, h: number, tone: number, z = 0): THREE.Group {
  return group(cyl(r * 0.95, r, h, tone, 6, x, h / 2, z), cone(r, 0.42, CUT, 6, x, h + 0.21, z));
}

function stump(x: number, r: number, h: number, tone: number, z = 0): THREE.Group {
  return group(cyl(r * 0.95, r, h, tone, 6, x, h / 2, z), cyl(r * 0.9, r * 0.9, 0.05, CUT, 6, x, h + 0.02, z));
}

function fallenLog(x: number, z: number, len: number, ry: number, tone: number): THREE.Group {
  const l = cyl(0.17, 0.17, len, tone, 6, 0, 0, 0);
  l.rotation.z = Math.PI / 2;
  const g = group(l, cone(0.17, 0.4, CUT, 6, len / 2 + 0.2, 0, 0));
  (g.children[1] as THREE.Mesh).rotation.z = -Math.PI / 2;
  g.position.set(x, 0.17, z);
  g.rotation.y = ry;
  return g;
}

function beam(len: number, y: number, z: number): THREE.Mesh {
  const b = cyl(0.09, 0.09, len, 0x5e452c, 6, 0, y, z);
  b.rotation.z = Math.PI / 2;
  return b;
}

/** Les quatre etats d'un troncon (0 a terre .. 3 intact), selon le materiau. */
function wallStates(len: number, H: number, seed: number, tier: number): THREE.Group[] {
  if (tier === 1) return plankStates(len, H, seed);
  if (tier === 3) return stoneStates(len, H, seed);
  if (tier === 4) return scrapStates(len, H, seed);
  if (tier === 5) return metalStates(len, H, seed);
  return pikeStates(len, H, seed);
}

/** Niveau 1 : une cloture de planches clouees sur deux traverses, sans pointe. */
function plankStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const h = H * 0.72;
  const n = Math.max(3, Math.round(len / 0.3));
  const boards = Array.from({ length: n }, (_, i) => ({ x: -len / 2 + (i + 0.5) * (len / n), h: h * (0.92 + r() * 0.12), roll: r(), tone: [0xb98a55, 0xa87a48, 0xc69a62][i % 3]! }));
  const rails = (top: boolean) => group(beam(len, h * 0.3, 0.12), ...(top ? [beam(len, h * 0.8, 0.12)] : []));
  const build = (keep: (b: { roll: number }) => number) => {
    const g = new THREE.Group();
    for (const b of boards) {
      const k = keep(b);
      if (k <= 0) continue;
      g.add(box(len / n - 0.03, b.h * k, 0.06, b.tone, b.x, (b.h * k) / 2, 0));
    }
    return g;
  };
  const intact = group(rails(true), build(() => 1));
  const damaged = group(rails(true), build((b) => (b.roll < 0.25 ? 0 : b.roll < 0.4 ? 0.6 : 1)));
  const heavy = group(rails(false), build((b) => (b.roll < 0.55 ? 0 : 0.7)));
  const broken = group(build((b) => (b.roll < 0.7 ? 0.15 : 0.3)));
  for (let i = 0; i < 3; i++) {
    const p = box(len / n, h * 0.8, 0.06, boards[i]!.tone, (i - 1) * len * 0.3, 0.04, 0.7 + (i % 2) * 0.4);
    p.rotation.x = Math.PI / 2;
    p.rotation.z = r() * 2;
    broken.add(p);
  }
  return [broken, heavy, damaged, intact];
}

/** Niveau 3 : un mur de moellons, assises decalees et chaperon. */
function stoneStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const rows = Math.max(3, Math.round((H * 0.92) / 0.4));
  const cols = Math.max(3, Math.round(len / 0.6));
  const w = len / cols;
  const blocks: { x: number; y: number; row: number; roll: number; tone: number; w: number }[] = [];
  for (let j = 0; j < rows; j++) {
    const off = j % 2 ? w / 2 : 0;
    for (let i = 0; i < cols; i++) {
      const x = -len / 2 + w / 2 + i * w + off;
      if (x > len / 2 - w * 0.25) continue;
      blocks.push({ x, y: 0.2 + j * 0.4, row: j, roll: r(), tone: [0x9a9890, 0x85837b, 0xa8a59b, 0x8f8a80][Math.floor(r() * 4)]!, w: w - 0.04 });
    }
  }
  const build = (keepRow: (row: number, roll: number) => boolean, cap: boolean) => {
    const g = new THREE.Group();
    for (const b of blocks) if (keepRow(b.row, b.roll)) g.add(rbox(b.w, 0.38, 0.6, b.tone, 0.05, b.x, b.y, 0));
    if (cap) g.add(box(len + 0.05, 0.12, 0.7, 0x77746c, 0, rows * 0.4 + 0.06, 0));
    return g;
  };
  const intact = build(() => true, true);
  const damaged = build((row, roll) => row < rows - 1 || roll > 0.35, false);
  const heavy = build((row, roll) => row < Math.ceil(rows / 2) || (row < rows - 1 && roll > 0.7), false);
  const broken = build((row) => row === 0, false);
  for (let i = 0; i < 5; i++) {
    const b = blob(0.2 + r() * 0.2, 0x85837b, (r() - 0.5) * len, 0.15, (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5));
    b.scale.y = 0.6;
    broken.add(b);
    if (i < 3) heavy.add(b.clone());
  }
  return [broken, heavy, damaged, intact];
}

/** Niveau 4 : des toles de recuperation sur des poteaux, pointes de fer au sommet. */
function scrapStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const n = Math.max(2, Math.round(len / 0.95));
  const w = len / n;
  const sheets = Array.from({ length: n }, (_, i) => ({ x: -len / 2 + w / 2 + i * w, roll: r(), tone: SCRAP_TONES[Math.floor(r() * SCRAP_TONES.length)]!, h: H * (0.9 + r() * 0.12) }));
  const posts = () => {
    const g = new THREE.Group();
    for (let i = 0; i <= n; i++) g.add(box(0.12, H * 1.02, 0.12, 0x55595c, -len / 2 + i * w, (H * 1.02) / 2, 0.1));
    return g;
  };
  const spikes = (keep: number) => {
    const g = new THREE.Group();
    for (let i = 0; i < n * 3; i++) if (r() < keep) g.add(cone(0.05, 0.35, 0x7a8288, 4, -len / 2 + (i + 0.5) * (len / (n * 3)), H + 0.12, 0));
    return g;
  };
  const build = (mode: (sh: { roll: number }) => 'up' | 'bent' | 'down' | 'gone') => {
    const g = new THREE.Group();
    for (const sh of sheets) {
      const m = mode(sh);
      if (m === 'gone') continue;
      const panel = sheet(w + 0.06, sh.h, sh.tone);
      panel.position.x = sh.x;
      if (m === 'bent') panel.rotation.x = -0.35;
      if (m === 'down') { panel.rotation.x = -Math.PI / 2 + 0.1; panel.position.z = -0.2; }
      g.add(panel);
    }
    return g;
  };
  const intact = group(posts(), build(() => 'up'), spikes(1));
  const damaged = group(posts(), build((sh) => (sh.roll < 0.3 ? 'bent' : 'up')), spikes(0.7));
  const heavy = group(posts(), build((sh) => (sh.roll < 0.5 ? 'down' : sh.roll < 0.7 ? 'bent' : 'up')));
  const broken = group(build((sh) => (sh.roll < 0.6 ? 'down' : 'gone')));
  for (let i = 0; i <= n; i++) broken.add(box(0.12, 0.4, 0.12, 0x55595c, -len / 2 + i * w, 0.2, 0.1));
  return [broken, heavy, damaged, intact];
}

/** Niveau 5 : des plaques de fer fondu rivetees, herissees de pointes. */
function metalStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const n = Math.max(2, Math.round(len / 1.3));
  const w = len / n;
  const h = H * 1.05;
  const plates = Array.from({ length: n }, (_, i) => ({ x: -len / 2 + w / 2 + i * w, roll: r() }));
  const frame = () => group(
    box(len + 0.1, 0.16, 0.22, 0x3a3d40, 0, h, 0), box(len + 0.1, 0.16, 0.22, 0x3a3d40, 0, 0.1, 0),
    ...Array.from({ length: n + 1 }, (_, i) => box(0.16, h, 0.24, 0x3a3d40, -len / 2 + i * w, h / 2, 0)),
  );
  const plate = (x: number, k: number, tilt: number) => {
    const g = group(box(w - 0.08, (h - 0.2) * k, 0.1, 0x6f777e, 0, ((h - 0.2) * k) / 2 + 0.1, 0));
    for (const yy of [0.3, 0.7]) for (const xx of [-0.35, 0.35]) if (yy * h < (h - 0.2) * k) g.add(sphere(0.035, 0xb0b8bf, xx * w, yy * h, 0.07, 4));
    g.position.x = x;
    g.rotation.x = tilt;
    return g;
  };
  const spikes = () => {
    const g = new THREE.Group();
    for (let i = 0; i < n * 4; i++) g.add(cone(0.05, 0.4, 0x2b2e31, 4, -len / 2 + (i + 0.5) * (len / (n * 4)), h + 0.28, 0));
    return g;
  };
  const intact = group(frame(), ...plates.map((p) => plate(p.x, 1, 0)), spikes());
  const damaged = group(frame(), ...plates.map((p) => plate(p.x, 1, p.roll < 0.35 ? -0.12 : 0)));
  const heavy = group(frame(), ...plates.filter((p) => p.roll > 0.45).map((p) => plate(p.x, 0.6, -0.08)));
  const broken = group(box(len + 0.1, 0.16, 0.22, 0x3a3d40, 0, 0.1, 0), ...plates.filter((p) => p.roll > 0.6).map((p) => plate(p.x, 0.25, 0)));
  for (const p of plates.filter((q) => q.roll <= 0.6)) {
    const down = plate(p.x, 1, -Math.PI / 2 + 0.08);
    down.position.z = -0.4;
    broken.add(down);
  }
  return [broken, heavy, damaged, intact];
}

/** Les quatre etats d'un troncon de mur, du plus casse au plus solide. */
function pikeStates(len: number, H: number, seed: number): THREE.Group[] {
  const r = rng(seed);
  const n = Math.max(3, Math.round(len / SPACING));
  const logs: LogProfile[] = [];
  for (let i = 0; i < n; i++) {
    logs.push({
      x: -len / 2 + (i + 0.5) * (len / n),
      r: 0.16 + r() * 0.05,
      h: H * (0.9 + r() * 0.16),
      tone: BARK[Math.floor(r() * BARK.length)]!,
      roll: r(),
      lean: (r() - 0.5) * 0.06,
    });
  }
  const spikes = () => {
    const g = new THREE.Group();
    for (const sx of [-0.25, 0.25]) {
      const s = stake(H > 2 ? 1.6 : 1.2);
      s.position.set(sx * len, 0, -0.35);
      s.rotation.x = -0.85;
      g.add(s);
    }
    return g;
  };
  const beams = (top: boolean) => {
    const g = group(beam(len, 0.65, 0.22));
    if (top && H > 2) g.add(beam(len, H - 0.75, 0.22));
    return g;
  };

  const intact = group(spikes(), beams(true));
  for (const l of logs) {
    const p = pike(l.x, l.r, l.h, l.tone);
    p.rotation.z = l.lean;
    intact.add(p);
  }

  const damaged = group(spikes(), beams(true));
  logs.forEach((l, i) => {
    if (l.roll < 0.28) damaged.add(stump(l.x, l.r, l.h * (0.55 + l.roll), l.tone));
    else {
      const p = pike(l.x, l.r, l.h, l.tone);
      p.rotation.z = i === Math.floor(n / 2) ? 0.22 : l.lean;
      damaged.add(p);
    }
  });

  const heavy = group(spikes(), beams(false));
  for (const l of logs) {
    if (l.roll < 0.6) heavy.add(stump(l.x, l.r, l.h * (0.3 + l.roll * 0.5), l.tone));
    else heavy.add(pike(l.x, l.r, l.h, l.tone));
  }
  heavy.add(fallenLog(-len * 0.15, -0.9, H * 0.8, 0.35, logs[1 % n]!.tone), fallenLog(len * 0.2, 0.8, H * 0.7, -0.5, logs[2 % n]!.tone));

  const broken = group();
  const sp = spikes();
  sp.children[1]!.visible = false;
  broken.add(sp);
  for (const l of logs) broken.add(stump(l.x, l.r, 0.15 + l.roll * 0.35, l.tone));
  broken.add(
    fallenLog(-len * 0.25, -1.0, H * 0.85, 0.5, logs[0]!.tone),
    fallenLog(len * 0.1, 0.9, H * 0.8, -0.3, logs[3 % n]!.tone),
    fallenLog(len * 0.3, -0.6, H * 0.6, 1.2, logs[4 % n]!.tone),
  );
  return [broken, heavy, damaged, intact];
}

/** Un battant de porte en rondins, charniere a l'origine, s'etendant vers +x*dir. */
function door(width: number, H: number, dir: number, seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(width / 0.3));
  for (let i = 0; i < n; i++) {
    const x = dir * (i + 0.5) * (width / n);
    g.add(pike(x, 0.14, H * (0.95 + r() * 0.08), BARK[i % BARK.length]!));
  }
  for (const y of [0.45, H - 0.45]) {
    const b = cyl(0.08, 0.08, width, 0x5e452c, 6, (dir * width) / 2, y, 0.17);
    b.rotation.z = Math.PI / 2;
    g.add(b);
  }
  const diag = cyl(0.07, 0.07, Math.hypot(width, H - 0.9), 0x5e452c, 6, (dir * width) / 2, H / 2, 0.19);
  diag.rotation.z = dir * Math.atan2(width, H - 0.9);
  g.add(diag);
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
    for (const [x, z, h] of posts) pg.add(pike(x, 0.3, h + 0.4, BARK[0]!, z));
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
    const frame = group(pike(-half, 0.27, postH, BARK[2]!), pike(half, 0.27, postH, BARK[2]!));
    const top = cyl(0.16, 0.16, s.len + 0.7, BARK[0]!, 6, 0, postH - 0.35, 0);
    top.rotation.z = Math.PI / 2;
    frame.add(top);
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
