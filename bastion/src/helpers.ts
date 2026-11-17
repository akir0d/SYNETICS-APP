// Les survivants recrutes : ils font tourner le camp quand on a le dos tourne.
// Chacun a son metier et depose tout ce qu'il recolte dans la reserve.

import * as THREE from 'three';
import { Stack } from './carry';
import { Human } from './humans';
import type { ItemType } from './items';
import { C, cyl, group, rbox } from './kit';
import { L } from './layout';
import { route, type Region } from './nav';
import { collide, type Circle, type Segment } from './physics';
import type { Bed, ChopTree, ScrapSource } from './resources';

export type Job = 'farmer' | 'lumber' | 'scav' | 'fisher' | 'porter' | 'cashier';

export interface HelperCtx {
  beds: Bed[];
  trees: ChopTree[];
  scraps: ScrapSource[];
  walls: Segment[];
  solids: Circle[];
  nav: Region[];
  night: boolean;
  dockReady: boolean;
  /** Les sources qu'on peut atteindre (enclos ouverts). */
  reachable: (x: number, z: number) => boolean;
  /** La reserve : ou deposer, s'il reste de la place, et le depot lui-meme. */
  reserve: { at: { x: number; z: number }; room: () => boolean; put: (t: ItemType, from: THREE.Vector3) => void };
  onHarvest: (from: THREE.Vector3, to: () => THREE.Vector3, t: ItemType) => void;
  onChop: (tree: ChopTree, h: Helper) => void;
  onScrap: (src: ScrapSource, h: Helper) => void;
  onFish: (h: Helper) => void;
  // ---- porteur : de la reserve (et des machines) vers l'etal et les machines
  reserveCount: () => number;
  reserveTake: () => ItemType | null;
  /** Ou porter un objet (machine qui le transforme, sinon bac de l'etal) ; null : nulle part. */
  porterDrop: (t: ItemType) => { at: { x: number; z: number }; put: (t: ItemType, from: THREE.Vector3) => void } | null;
  /** Productions finies a emporter a l'etal (soupe, pain). */
  outputs: () => { at: { x: number; z: number }; take: () => { type: ItemType; pos: THREE.Vector3 } | null }[];
  // ---- caissiere
  cashSpot: { x: number; z: number };
  onCashier: (h: Helper) => void;
}

const LOOK: Record<Job, { shirt: number; pants: number; hair: number; hat?: number }> = {
  farmer: { shirt: 0xe6a23c, pants: 0x4a6a3a, hair: 0x8a4a2a, hat: 0xe0c070 },
  lumber: { shirt: 0xb83a3a, pants: 0x3a3a4a, hair: 0x2a1a10 },
  scav: { shirt: 0x5a6a7a, pants: 0x3a3a3a, hair: 0x1a1a1a, hat: 0x3a4a3a },
  fisher: { shirt: 0x3f7a8a, pants: 0x4a4a3a, hair: 0xc9a46a, hat: 0xd9b44a },
  porter: { shirt: 0x9a7a4a, pants: 0x3a4a5a, hair: 0x1a1a1a },
  cashier: { shirt: 0xd95a7a, pants: 0x2a2a3a, hair: 0x7a3a1a },
};
const REST: Record<Job, [number, number]> = { farmer: [-1.6, -1.4], lumber: [1.6, -1.4], scav: [-1.7, 1.9], fisher: [1.8, 2.0], porter: [0, -2.1], cashier: [0, 2.4] };

export class Helper {
  readonly human: Human;
  readonly stack = new Stack(6);
  state: 'seek' | 'work' | 'deliver' | 'rest' = 'seek';
  private clock = 0;
  private bed: Bed | null = null;
  private side = 1;
  tree: ChopTree | null = null;
  private src: ScrapSource | null = null;
  /** Porteur : d'ou il charge (la reserve, ou la sortie d'une machine). */
  private load: { at: { x: number; z: number }; take: () => ItemType | null } | null = null;
  working = 0;
  private stuck = 0;
  /** Temps passe sans approcher du but : au-dela, on change de cible. */
  private blocked = 0;
  private readonly last = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly job: Job) {
    this.human = new Human(LOOK[job]);
    const tool = job === 'farmer'
      ? group(cyl(0.03, 0.03, 0.9, C.woodLight, 5, 0, 0, 0.35), rbox(0.24, 0.04, 0.16, C.metal, 0.01, 0, 0, 0.8))
      : job === 'lumber'
        ? group(cyl(0.04, 0.04, 0.8, C.woodLight, 6, 0, 0, 0.3), rbox(0.06, 0.28, 0.2, 0x9aa3ab, 0.02, 0, 0.1, 0.62))
        : job === 'scav'
          ? group(cyl(0.04, 0.04, 0.6, C.woodDark, 6, 0, 0, 0.25), rbox(0.14, 0.12, 0.3, 0x55595c, 0.02, 0, 0.05, 0.55))
          : job === 'fisher'
            ? group(cyl(0.02, 0.025, 1.6, C.woodDark, 5, 0, 0, 0.7))
            : group(cyl(0.01, 0.01, 0.01, C.woodDark, 3, 0, 0, 0));
    (tool.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
    this.human.hand.add(tool);
    this.stack.root.position.set(0, 1.32, -0.42);
    this.human.body.add(this.stack.root);
    this.human.root.position.set(L.shelter.x - 3.2, 0, L.shelter.z + 2.4);
    scene.add(this.human.root);
  }

  private go(dest: THREE.Vector3, dt: number, ctx: HelperCtx, stop = 0.2): boolean {
    const p = this.human.root.position;
    const wp = route(p, dest, ctx.nav);
    const final = wp === dest;
    const arrived = this.human.walkTo(wp, 3.6, dt, final ? stop : 0.4) && final;
    collide(p, 0.4, ctx.walls, ctx.solids, 52);
    // Coince contre un obstacle : on glisse un peu sur le cote.
    if (p.distanceTo(this.last) < dt * 0.4 && !arrived) {
      this.stuck += dt;
      this.blocked += dt;
      if (this.stuck > 0.6) {
        const side = new THREE.Vector3(wp.z - p.z, 0, -(wp.x - p.x)).normalize();
        p.addScaledVector(side, 0.5);
        this.stuck = 0;
      }
    } else {
      this.stuck = 0;
      this.blocked = Math.max(0, this.blocked - dt * 0.5);
    }
    this.last.copy(p);
    return arrived;
  }

  update(dt: number, ctx: HelperCtx): void {
    const p = this.human.root.position;
    this.working = Math.max(0, this.working - dt * 2.4);
    if (ctx.night) {
      // La nuit, tout le monde se replie pres du feu.
      this.state = 'rest';
      const [ox, oz] = REST[this.job];
      const spot = new THREE.Vector3(L.campfire.x + ox, 0, L.campfire.z + oz);
      if (this.go(spot, dt, ctx, 0.3)) this.human.face(Math.atan2(L.campfire.x - p.x, L.campfire.z - p.z), dt);
      return this.finish(dt);
    }
    if (this.state === 'rest') this.state = this.stack.count ? 'deliver' : 'seek';
    // Bloque trop longtemps : on livre ce qu'on a, ou on cherche ailleurs.
    if (this.blocked > 4) {
      this.blocked = 0;
      this.side = -this.side;
      this.bed = null;
      this.tree = null;
      this.src = null;
      this.state = this.stack.count ? 'deliver' : 'seek';
    }

    if (this.state === 'seek') {
      if (this.stack.full) this.state = 'deliver';
      else if (!this.pick(ctx)) {
        if (this.stack.count) this.state = 'deliver';
        else this.idle(dt, ctx);
      } else this.state = 'work';
    } else if (this.state === 'work') {
      if (this.job === 'farmer') this.farm(dt, ctx);
      else if (this.job === 'lumber') this.chop(dt, ctx);
      else if (this.job === 'scav') this.scavenge(dt, ctx);
      else if (this.job === 'porter') this.haul(dt, ctx);
      else if (this.job === 'cashier') this.cash(dt, ctx);
      else this.fish(dt, ctx);
    } else if (this.state === 'deliver' && this.job === 'porter') {
      this.dispatch(dt, ctx);
    } else if (this.state === 'deliver') {
      if (!this.stack.count) this.state = 'seek';
      else if (!ctx.reserve.room()) this.idle(dt, ctx);
      else if (this.go(new THREE.Vector3(ctx.reserve.at.x, 0, ctx.reserve.at.z), dt, ctx, 0.8)) {
        this.clock -= dt;
        if (this.clock <= 0) {
          this.clock = 0.14;
          const item = this.stack.take(() => true);
          if (item) ctx.reserve.put(item.type, item.pos);
          if (!this.stack.count) this.state = 'seek';
        }
      }
    }
    this.finish(dt);
  }

  /** Choisit une cible de travail ; faux s'il n'y a rien a faire. */
  private pick(ctx: HelperCtx): boolean {
    const p = this.human.root.position;
    if (this.job === 'farmer') {
      let best: Bed | null = null;
      let bd = Infinity;
      for (const b of ctx.beds) {
        if (b.ripeCount() === 0 || !ctx.reachable(b.x, b.z)) continue;
        const d = b.distance(p.x, p.z) - b.ripeCount() * 0.3;
        if (d < bd) { bd = d; best = b; }
      }
      if (best && best !== this.bed) this.side = p.z < best.z ? -1 : 1;
      this.bed = best;
      return !!best;
    }
    if (this.job === 'lumber') {
      let best: ChopTree | null = null;
      let bd = Infinity;
      for (const t of ctx.trees) {
        if (!t.standing) continue;
        const d = Math.hypot(t.x - p.x, t.z - p.z);
        if (d < bd) { bd = d; best = t; }
      }
      this.tree = best;
      return !!best;
    }
    if (this.job === 'scav') {
      let best: ScrapSource | null = null;
      let bd = Infinity;
      for (const s of ctx.scraps) {
        if (s.amount <= 0 || !ctx.reachable(s.x, s.z)) continue;
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < bd) { bd = d; best = s; }
      }
      this.src = best;
      return !!best;
    }
    if (this.job === 'porter') {
      if (ctx.reserveCount() > 0) {
        this.load = { at: ctx.reserve.at, take: ctx.reserveTake };
        return true;
      }
      const out = ctx.outputs()[0];
      if (out) {
        this.load = { at: out.at, take: () => out.take()?.type ?? null };
        return true;
      }
      return false;
    }
    if (this.job === 'cashier') return true;
    return ctx.dockReady;
  }

  /** Porteur : il charge a la reserve (ou a la sortie d'une machine) jusqu'a avoir les bras pleins. */
  private haul(dt: number, ctx: HelperCtx): void {
    const l = this.load;
    if (!l || this.stack.full) {
      this.state = this.stack.count ? 'deliver' : 'seek';
      return;
    }
    if (!this.go(new THREE.Vector3(l.at.x, 0, l.at.z), dt, ctx, 0.8)) return;
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 0.12;
    const t = l.take();
    if (t) {
      this.stack.add(t);
      this.working = 0.5;
    } else {
      this.load = null;
      this.state = this.stack.count ? 'deliver' : 'seek';
    }
  }

  /** Porteur : chaque objet va la ou il sert (machine) ou se vend (etal). */
  private dispatch(dt: number, ctx: HelperCtx): void {
    const top = this.stack.slots[this.stack.count - 1]?.type;
    if (!top) {
      this.state = 'seek';
      return;
    }
    const d = ctx.porterDrop(top);
    if (!d) {
      this.idle(dt, ctx);
      return;
    }
    if (!this.go(new THREE.Vector3(d.at.x, 0, d.at.z), dt, ctx, 0.9)) return;
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 0.14;
    const item = this.stack.take((x) => x === top);
    if (item) d.put(item.type, item.pos);
    if (!this.stack.count) this.state = 'seek';
  }

  /** Caissiere : elle tient la caisse et rentre l'argent des ventes. */
  private cash(dt: number, ctx: HelperCtx): void {
    const p = this.human.root.position;
    const spot = new THREE.Vector3(ctx.cashSpot.x, 0, ctx.cashSpot.z);
    if (!this.go(spot, dt, ctx, 0.3)) return;
    this.human.face(Math.atan2(L.cash.x - p.x, L.cash.z - p.z), dt);
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 2.2;
      ctx.onCashier(this);
    }
  }

  private finish(dt: number): void {
    this.human.animate(dt, this.stack.count > 0, this.working);
    this.stack.update(dt, Math.min(1, this.human.speed / 4), this.human.phase);
  }

  private idle(dt: number, ctx: HelperCtx): void {
    const home = new THREE.Vector3(L.shelter.x - 3.2, 0, L.shelter.z + 2.4);
    this.go(home, dt, ctx, 0.5);
  }

  private farm(dt: number, ctx: HelperCtx): void {
    const b = this.bed;
    if (!b || b.ripeCount() === 0 || this.stack.full) {
      this.state = this.stack.count ? 'deliver' : 'seek';
      return;
    }
    const p = this.human.root.position;
    if (b.distance(p.x, p.z) > 0.95) {
      this.go(b.edgePoint(p.x, p.z, this.side), dt, ctx, 0.2);
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

  private scavenge(dt: number, ctx: HelperCtx): void {
    const s = this.src;
    if (!s || s.amount <= 0 || this.stack.full) {
      this.state = this.stack.count ? 'deliver' : 'seek';
      return;
    }
    const p = this.human.root.position;
    const d = Math.hypot(s.x - p.x, s.z - p.z);
    if (d > 2.3) {
      const dir = new THREE.Vector3(p.x - s.x, 0, p.z - s.z).normalize();
      this.go(new THREE.Vector3(s.x + dir.x * 2.0, 0, s.z + dir.z * 2.0), dt, ctx, 0.2);
      return;
    }
    this.human.face(Math.atan2(s.x - p.x, s.z - p.z), dt);
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 0.9;
      this.working = 1;
      ctx.onScrap(s, this);
    }
  }

  private fish(dt: number, ctx: HelperCtx): void {
    if (!ctx.dockReady || this.stack.full) {
      this.state = this.stack.count ? 'deliver' : 'seek';
      return;
    }
    const spot = new THREE.Vector3(L.fishSpot.x, 0, L.fishSpot.z);
    if (!this.go(spot, dt, ctx, 0.3)) return;
    this.human.face(0, dt);
    this.clock -= dt;
    if (this.clock <= 0) {
      this.clock = 3.2;
      this.working = 1;
      ctx.onFish(this);
    }
  }
}
