// Ce qu'on recolte : potagers, arbres a abattre, epaves a demonter.

import * as THREE from 'three';
import { C, at, blob, box, cone, cyl, damp, group, rbox, rng, shadow, sphere } from './kit';
import { L } from './layout';
import type { Circle, Segment } from './physics';
import { leafy, overgrownCar, pine } from './world';

// ---------------------------------------------------------------- potagers

interface Plant { obj: THREE.Object3D; g: number; pos: THREE.Vector3; pop: number }

export const BED_W = 2.8;
export const BED_D = 2.0;

export class Bed {
  readonly group = new THREE.Group();
  readonly plants: Plant[] = [];
  readonly walls: Segment[];
  unlocked = false;
  readonly growTime: number;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, readonly kind: 'carrot' | 'tomato') {
    this.growTime = kind === 'carrot' ? 8 : 13;
    const g = this.group;
    g.add(rbox(BED_W, 0.4, BED_D, C.wood, 0.05, 0, 0.2, 0));
    g.add(box(BED_W - 0.3, 0.06, BED_D - 0.3, C.soil, 0, 0.41, 0));
    const r = rng(Math.round(x * 13 + z * 7));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        const px = -0.96 + j * 0.64;
        const pz = -0.55 + i * 0.55;
        const obj = kind === 'carrot' ? carrotPlant() : tomatoPlant(r);
        at(obj, px, 0.44, pz, r() * 6);
        g.add(obj);
        this.plants.push({ obj, g: 0.3 + r() * 0.7, pos: new THREE.Vector3(x + px, 0.6, z + pz), pop: 0 });
      }
    }
    shadow(g);
    g.position.set(x, 0, z);
    g.visible = false;
    scene.add(g);
    const hw = BED_W / 2;
    const hd = BED_D / 2;
    this.walls = [
      { x1: x - hw, z1: z - hd, x2: x + hw, z2: z - hd, off: true },
      { x1: x + hw, z1: z - hd, x2: x + hw, z2: z + hd, off: true },
      { x1: x + hw, z1: z + hd, x2: x - hw, z2: z + hd, off: true },
      { x1: x - hw, z1: z + hd, x2: x - hw, z2: z - hd, off: true },
    ];
  }

  unlock(): void {
    this.unlocked = true;
    this.group.visible = true;
    for (const w of this.walls) w.off = false;
  }

  /** Distance d'un point au bord du bac. */
  distance(px: number, pz: number): number {
    const dx = Math.max(Math.abs(px - this.x) - BED_W / 2, 0);
    const dz = Math.max(Math.abs(pz - this.z) - BED_D / 2, 0);
    return Math.hypot(dx, dz);
  }

  ripeCount(): number {
    return this.unlocked ? this.plants.filter((p) => p.g >= 1).length : 0;
  }

  /** Recolte la plante mure la plus proche ; renvoie sa position. */
  harvestNear(px: number, pz: number): THREE.Vector3 | null {
    let best: Plant | null = null;
    let bd = Infinity;
    for (const p of this.plants) {
      if (p.g < 1) continue;
      const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    best.g = 0;
    best.pop = 1;
    return best.pos.clone();
  }

  /** Point au bord du bac le plus proche d'une position : la ou un survivant se poste. */
  edgePoint(px: number, pz: number): THREE.Vector3 {
    const cx = Math.max(this.x - BED_W / 2, Math.min(this.x + BED_W / 2, px));
    const cz = Math.max(this.z - BED_D / 2, Math.min(this.z + BED_D / 2, pz));
    const dx = cx - this.x;
    const dz = cz - this.z;
    const nx = Math.abs(dx) / (BED_W / 2) > Math.abs(dz) / (BED_D / 2) ? Math.sign(dx) : 0;
    const nz = nx === 0 ? Math.sign(dz) || 1 : 0;
    return new THREE.Vector3(cx + nx * 0.75, 0, cz + nz * 0.75);
  }

  update(dt: number, time: number): void {
    if (!this.unlocked) return;
    for (const p of this.plants) {
      if (p.g < 1) p.g = Math.min(1, p.g + dt / this.growTime);
      p.pop = Math.max(0, p.pop - dt * 3);
      const ripe = p.g >= 1;
      const s = 0.25 + p.g * 0.75;
      p.obj.scale.setScalar(damp(p.obj.scale.x, s, 10, dt));
      p.obj.position.y = 0.44 + (ripe ? Math.abs(Math.sin(time * 3 + p.pos.x * 3)) * 0.04 : 0);
      p.obj.rotation.z = ripe ? Math.sin(time * 2 + p.pos.z * 5) * 0.08 : 0;
    }
  }
}

function carrotPlant(): THREE.Group {
  return group(
    cone(0.08, 0.24, 0xff8a2a, 5, 0, 0.04, 0),
    cone(0.06, 0.4, C.leafLight, 4, 0.04, 0.32, 0),
    cone(0.06, 0.34, C.leaf, 4, -0.04, 0.28, 0.03),
  );
}

function tomatoPlant(r: () => number): THREE.Group {
  const g = group(cyl(0.025, 0.03, 0.8, C.woodLight, 4, 0, 0.4, 0), blob(0.24, C.leafDark, 0, 0.5, 0));
  for (let i = 0; i < 3; i++) g.add(sphere(0.085, 0xe8432f, (r() - 0.5) * 0.36, 0.3 + r() * 0.4, (r() - 0.5) * 0.36, 8));
  return g;
}

// ---------------------------------------------------------------- arbres

export class ChopTree {
  readonly root = new THREE.Group();
  readonly model: THREE.Group;
  readonly stump: THREE.Mesh;
  readonly solid: Circle;
  logs = 3;
  state: 'standing' | 'falling' | 'stump' | 'growing' = 'standing';
  private t = 0;
  private shake = 0;
  private fallDir = 0;
  private readonly baseScale: number;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, r: () => number) {
    this.model = r() < 0.5 ? pine(r) : leafy(r);
    this.baseScale = 0.85 + r() * 0.3;
    this.model.scale.setScalar(this.baseScale);
    this.model.rotation.y = r() * 6;
    this.stump = shadow(cyl(0.24, 0.3, 0.35, C.woodDark, 7, 0, 0.17, 0));
    const ring = cyl(0.2, 0.2, 0.02, 0xf2cf98, 7, 0, 0.36, 0);
    this.stump.add(ring);
    this.stump.visible = false;
    this.root.add(this.model, this.stump);
    this.root.position.set(x, 0, z);
    scene.add(this.root);
    this.solid = { x, z, r: 0.55 };
  }

  get standing(): boolean {
    return this.state === 'standing';
  }

  /** Un coup de hache : renvoie true si un rondin tombe. */
  chop(fromX: number, fromZ: number, logsPerTree: number): boolean {
    if (this.state !== 'standing') return false;
    this.shake = 1;
    this.logs -= 1;
    if (this.logs <= 0) {
      this.state = 'falling';
      this.t = 0;
      this.fallDir = Math.atan2(this.x - fromX, this.z - fromZ);
      this.solid.off = true;
      this.logs = logsPerTree;
    }
    return true;
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 5);
    if (this.state === 'standing') {
      this.model.rotation.z = Math.sin(this.shake * 30) * this.shake * 0.08;
    } else if (this.state === 'falling') {
      this.t += dt;
      // Le tronc bascule dans la direction opposee au bucheron, puis disparait.
      const k = Math.min(1, this.t / 0.7);
      this.model.rotation.set(0, 0, 0);
      const axis = new THREE.Vector3(Math.cos(this.fallDir), 0, -Math.sin(this.fallDir));
      this.model.quaternion.setFromAxisAngle(axis, k * k * 1.5);
      if (this.t > 0.9) this.model.scale.setScalar(this.baseScale * Math.max(0.001, 1 - (this.t - 0.9) * 3));
      this.stump.visible = true;
      if (this.t > 1.25) {
        this.state = 'stump';
        this.t = 0;
        this.model.visible = false;
      }
    } else if (this.state === 'stump') {
      this.t += dt;
      if (this.t > 40) {
        this.state = 'growing';
        this.t = 0;
        this.model.visible = true;
        this.model.quaternion.identity();
        this.stump.visible = false;
        this.solid.off = false;
      }
    } else {
      this.t += dt;
      const k = Math.min(1, this.t / 6);
      this.model.scale.setScalar(this.baseScale * (0.15 + 0.85 * k));
      if (k >= 1) this.state = 'standing';
    }
  }
}

export function plantForest(scene: THREE.Scene): ChopTree[] {
  const r = rng(41);
  const trees: ChopTree[] = [];
  const f = L.forest;
  let guard = 0;
  while (trees.length < 34 && guard++ < 2000) {
    const x = f.minX + r() * (f.maxX - f.minX);
    const z = f.minZ + r() * (f.maxZ - f.minZ);
    // Un chemin degage depuis la porte nord.
    if (Math.abs(x) < 1.6 && z > -19) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) continue;
    trees.push(new ChopTree(scene, x, z, r));
  }
  return trees;
}

// ---------------------------------------------------------------- ferraille

export class ScrapSource {
  readonly root: THREE.Group;
  amount = 6;
  readonly max = 6;
  private regen = 0;
  private shake = 0;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, ry: number, kind: 'car' | 'heap', solids: Circle[]) {
    if (kind === 'car') {
      this.root = overgrownCar(scene, null, x, z, ry, false);
    } else {
      const r = rng(9);
      const g = new THREE.Group();
      for (let i = 0; i < 14; i++) {
        const b = r() < 0.5
          ? rbox(0.6 + r() * 0.8, 0.2 + r() * 0.4, 0.5 + r() * 0.6, r() < 0.5 ? C.metal : C.rust, 0.04, (r() - 0.5) * 2, 0.2 + r() * 0.5, (r() - 0.5) * 2)
          : cyl(0.3, 0.3, 0.9, r() < 0.5 ? 0x4f7a9a : C.rustDark, 8, (r() - 0.5) * 2, 0.45, (r() - 0.5) * 2);
        b.rotation.set(r() * 0.6, r() * 3, r() * 0.6);
        g.add(b);
      }
      const tire = cyl(0.42, 0.42, 0.26, 0x2f2f2f, 10, 0.8, 0.9, 0.2);
      tire.rotation.x = 1.2;
      g.add(tire);
      this.root = shadow(at(g, x, 0, z, ry));
      scene.add(this.root);
    }
    solids.push({ x, z, r: kind === 'car' ? 1.7 : 1.4 });
  }

  get radius(): number {
    return 2.7;
  }

  hit(): boolean {
    if (this.amount <= 0) return false;
    this.amount -= 1;
    this.shake = 1;
    return true;
  }

  update(dt: number): void {
    if (this.amount < this.max) {
      this.regen += dt;
      if (this.regen > 9) {
        this.regen = 0;
        this.amount += 1;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 6);
    this.root.position.x = this.x + Math.sin(this.shake * 40) * this.shake * 0.06;
  }
}

/** Repere visuel commun : cercle pulse au sol autour des zones d'echange. */
export function zoneRing(scene: THREE.Scene, x: number, z: number, r: number, color = 0xffffff): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.22, r, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.04, z);
  scene.add(ring);
  return ring;
}

/** Petit tas d'objets pose au sol (entree ou sortie d'une machine, etal). */
export function pileSlot(i: number, perRow: number, dx = 0.46, dz = 0.4, dy = 0.24): THREE.Vector3 {
  const layer = Math.floor(i / (perRow * 2));
  const k = i % (perRow * 2);
  return new THREE.Vector3((k % perRow - (perRow - 1) / 2) * dx, layer * dy, Math.floor(k / perRow) * dz - dz / 2);
}

