// Les survivants recrutes : ils font tourner le camp quand on a le dos tourne.

import * as THREE from 'three';
import { Stack } from './carry';
import { Human } from './humans';
import type { ItemType } from './items';
import { C, cyl, group, rbox } from './kit';
import { L } from './layout';
import { collide, type Circle, type Segment } from './physics';
import type { Bed, ChopTree } from './resources';
import { waypoint } from './zombies';

export type Job = 'farmer' | 'lumber';

export interface Drop {
  /** Endroit ou poser la charge, et ce qu'on peut y deposer. */
  at: () => { x: number; z: number } | null;
  accept: (t: ItemType) => boolean;
  put: (t: ItemType, from: THREE.Vector3) => void;
}

export interface HelperCtx {
  beds: Bed[];
  trees: ChopTree[];
  walls: Segment[];
  solids: Circle[];
  northOpen: boolean;
  night: boolean;
  /** Ou deposer les legumes / le bois selon ce qui est construit. */
  dropFor: (t: ItemType) => Drop | null;
  onHarvest: (from: THREE.Vector3, to: () => THREE.Vector3, t: ItemType) => void;
  onChop: (tree: ChopTree, h: Helper) => void;
}

export class Helper {
  readonly human: Human;
  readonly stack = new Stack(6);
  state: 'seek' | 'work' | 'deliver' | 'rest' = 'seek';
  private clock = 0;
  private bed: Bed | null = null;
  tree: ChopTree | null = null;
  working = 0;
  private stuck = 0;
  private readonly last = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly job: Job) {
    this.human = new Human(job === 'farmer'
      ? { shirt: 0xe6a23c, pants: 0x4a6a3a, hair: 0x8a4a2a, hat: 0xe0c070 }
      : { shirt: 0xb83a3a, pants: 0x3a3a4a, hair: 0x2a1a10 });
    // Accessoire de metier dans la main droite.
    const tool = job === 'farmer'
      ? group(cyl(0.03, 0.03, 0.9, C.woodLight, 5, 0, 0, 0.35), rbox(0.24, 0.04, 0.16, C.metal, 0.01, 0, 0, 0.8))
      : group(cyl(0.04, 0.04, 0.8, C.woodLight, 6, 0, 0, 0.3), rbox(0.06, 0.28, 0.2, 0x9aa3ab, 0.02, 0, 0.1, 0.62));
    (tool.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
    this.human.hand.add(tool);
    this.stack.root.position.set(0, 1.32, -0.42);
    this.human.body.add(this.stack.root);
    this.human.root.position.set(L.shelter.x - 1.5, 0, L.shelter.z + 2);
    scene.add(this.human.root);
  }

  private go(dest: THREE.Vector3, dt: number, ctx: HelperCtx, stop = 0.2): boolean {
    const p = this.human.root.position;
    const wp = waypoint(p, dest, ctx.northOpen);
    const arrived = this.human.walkTo(wp, 3.6, dt, wp === dest ? stop : 0.4) && wp === dest;
    collide(p, 0.4, ctx.walls, ctx.solids, 44);
    // Coince contre un obstacle : on glisse un peu sur le cote.
    if (p.distanceTo(this.last) < dt * 0.4 && !arrived) {
      this.stuck += dt;
      if (this.stuck > 0.6) {
        const side = new THREE.Vector3(wp.z - p.z, 0, -(wp.x - p.x)).normalize();
        p.addScaledVector(side, 0.5);
        this.stuck = 0;
      }
    } else this.stuck = 0;
    this.last.copy(p);
    return arrived;
  }

  update(dt: number, ctx: HelperCtx): void {
    const p = this.human.root.position;
    this.working = Math.max(0, this.working - dt * 2.4);
    if (ctx.night) {
      // La nuit, tout le monde se replie pres du feu.
      this.state = 'rest';
      const spot = new THREE.Vector3(L.campfire.x + (this.job === 'farmer' ? -1.6 : 1.6), 0, L.campfire.z - 1.4);
      if (this.go(spot, dt, ctx, 0.3)) this.human.face(Math.atan2(L.campfire.x - p.x, L.campfire.z - p.z), dt);
    } else if (this.state === 'rest') {
      this.state = this.stack.count ? 'deliver' : 'seek';
    }

    if (this.state === 'seek') {
      if (this.stack.full) { this.state = 'deliver'; return this.finish(dt); }
      if (this.job === 'farmer') {
        let best: Bed | null = null;
        let bd = Infinity;
        for (const b of ctx.beds) {
          if (b.ripeCount() === 0) continue;
          const d = b.distance(p.x, p.z) - b.ripeCount() * 0.4;
          if (d < bd) { bd = d; best = b; }
        }
        this.bed = best;
        if (best) this.state = 'work';
        else if (this.stack.count) this.state = 'deliver';
        else this.idle(dt, ctx);
      } else {
        let best: ChopTree | null = null;
        let bd = Infinity;
        for (const t of ctx.trees) {
          if (!t.standing) continue;
          const d = Math.hypot(t.x - p.x, t.z - p.z);
          if (d < bd) { bd = d; best = t; }
        }
        this.tree = best;
        if (best) this.state = 'work';
        else this.idle(dt, ctx);
      }
    } else if (this.state === 'work') {
      if (this.job === 'farmer') this.farm(dt, ctx);
      else this.chop(dt, ctx);
    } else if (this.state === 'deliver') {
      const t = this.stack.slots[this.stack.count - 1]?.type;
      const drop = t ? ctx.dropFor(t) : null;
      const at = drop?.at();
      if (!t || !drop || !at) {
        if (!t) this.state = 'seek';
        else this.idle(dt, ctx);
      } else if (this.go(new THREE.Vector3(at.x, 0, at.z), dt, ctx, 0.9)) {
        this.clock -= dt;
        if (this.clock <= 0) {
          this.clock = 0.14;
          const item = this.stack.take(drop.accept);
          if (item) drop.put(item.type, item.pos);
          else if (!this.stack.count) this.state = 'seek';
          else this.idle(dt, ctx);
        }
      }
    }
    this.finish(dt);
  }

  private finish(dt: number): void {
    this.human.animate(dt, this.stack.count > 0, this.working);
    this.stack.update(dt, Math.min(1, this.human.speed / 4), this.human.phase);
  }

  private idle(dt: number, ctx: HelperCtx): void {
    const home = new THREE.Vector3(L.shelter.x - 1.6, 0, L.shelter.z + 2.2);
    this.go(home, dt, ctx, 0.5);
  }

  private farm(dt: number, ctx: HelperCtx): void {
    const b = this.bed;
    if (!b || b.ripeCount() === 0 || this.stack.full) {
      this.state = this.stack.count ? 'deliver' : 'seek';
      return;
    }
    const p = this.human.root.position;
    const spot = b.edgePoint(p.x, p.z);
    if (b.distance(p.x, p.z) > 0.9) {
      this.go(spot, dt, ctx, 0.2);
      return;
    }
    this.human.face(Math.atan2(b.x - p.x, b.z - p.z), dt);
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0.32;
      const from = b.harvestNear(p.x, p.z);
      if (from) {
        this.working = 1;
        const kind: ItemType = b.kind;
        ctx.onHarvest(from, () => this.stack.topWorld(), kind);
        this.stack.add(kind);
      }
    }
  }

  private chop(dt: number, ctx: HelperCtx): void {
    const t = this.tree;
    if (!t || !t.standing || this.stack.full) {
      this.state = this.stack.count ? 'deliver' : 'seek';
      return;
    }
    const p = this.human.root.position;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    if (d > 1.5) {
      const dir = new THREE.Vector3(p.x - t.x, 0, p.z - t.z).normalize();
      this.go(new THREE.Vector3(t.x + dir.x * 1.2, 0, t.z + dir.z * 1.2), dt, ctx, 0.2);
      return;
    }
    this.human.face(Math.atan2(t.x - p.x, t.z - p.z), dt);
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0.75;
      this.working = 1;
      ctx.onChop(t, this);
    }
  }
}
