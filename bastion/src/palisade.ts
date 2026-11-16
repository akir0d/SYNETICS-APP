// La palissade du camp : des rondins tailles en pointe, par troncons. Chaque troncon
// a ses points de vie : les zombies le cassent la nuit, on le repare avec des rondins.
// Les portes se ferment la nuit (pour les zombies seulement : le joueur passe toujours).

import * as THREE from 'three';
import { mergeColored } from './bake';
import { cone, cyl, group, rng } from './kit';
import { CAMP, L } from './layout';
import type { Segment } from './physics';
import { stake } from './props';

export const WALL_HP = 30;
export const GATE_HP = 60;
/** Points de vie rendus par chaque rondin. */
export const LOG_HP = 10;

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
  ring: THREE.Mesh;
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

export function logsNeeded(s: Section): number {
  return Math.ceil(Math.max(0, s.max - s.hp) / LOG_HP);
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

/** Les quatre etats d'un troncon de mur, du plus casse au plus solide. */
function wallStates(len: number, H: number, seed: number): THREE.Group[] {
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
    scene.add(mergeColored(pg));
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
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.9, 32),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(repair.x, 0.05, repair.z);
    ring.visible = false;
    this.scene.add(ring);
    const label = document.createElement('div');
    label.className = 'wall-label off';
    this.labels.appendChild(label);
    const s: Section = {
      id: this.sections.length, kind, x: f.x, z: f.z, nx: f.nx, nz: f.nz, len: f.len,
      seg: { x1, z1, x2, z2 }, hp: max, max, root, states: [], shake: 0, pop: 0, repair, ring, label, inflight: 0, enabled: true,
    };
    this.sections.push(s);
    return s;
  }

  private addWall(x1: number, z1: number, x2: number, z2: number, h: number): void {
    const s = this.base('wall', x1, z1, x2, z2, WALL_HP);
    for (const st of wallStates(s.len, h, 100 + s.id * 7)) {
      const m = mergeColored(st);
      m.visible = false;
      s.root.add(m);
      s.states.push(m);
    }
    this.walls.push(s.seg);
    this.refresh(s);
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
      const damaged = s.enabled && s.hp < s.max;
      s.ring.visible = damaged;
      if (damaged) {
        const k = 1 + Math.sin(time * 4 + s.id) * 0.06;
        s.ring.scale.set(k, k, k);
      }
    }
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
