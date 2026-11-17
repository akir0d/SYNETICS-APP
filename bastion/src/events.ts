// Ce qui rend les journees vivantes : caches a fouiller, ravitaillement parachute,
// caravane de marchands, survivants a sauver. Ici les modeles et leurs animations ;
// les regles (butin, recompenses, quand ca arrive) sont dans main.ts.

import * as THREE from 'three';
import { Human } from './humans';
import { C, box, cone, cyl, group, rbox, shadow, sphere } from './kit';
import { crate, tire } from './props';

export type Zone = 'farm' | 'station' | null;
export interface Spot { x: number; z: number; zone: Zone }

/** Les caches de la vallee : maisons pillees, ruines, sous-bois, bord de route. */
export const CACHE_SPOTS: Spot[] = [
  { x: 25.5, z: -4.6, zone: null }, { x: -21.4, z: -0.6, zone: null }, { x: -41, z: 8.6, zone: 'farm' },
  { x: 41, z: 9.3, zone: 'station' }, { x: -9, z: -24, zone: null }, { x: 10, z: -32, zone: null },
  { x: -15, z: -37, zone: null }, { x: 9.5, z: 30.4, zone: null }, { x: -30, z: 22.8, zone: null },
  { x: -12, z: 30, zone: null }, { x: 23, z: -13.5, zone: null }, { x: -17.5, z: 23.4, zone: null },
  { x: 44, z: 28, zone: 'station' }, { x: -46, z: -7, zone: 'farm' },
];

/** Ou un ravitaillement peut tomber : a decouvert, hors des enclos fermes. */
export const DROP_SPOTS: Spot[] = [
  { x: -6, z: 25.5, zone: null }, { x: 23.5, z: -9.5, zone: null }, { x: -21, z: 15, zone: null },
  { x: 6, z: -17.5, zone: null }, { x: 19, z: 26, zone: null }, { x: -27, z: 25, zone: null },
];

/** Ou un survivant peut etre coince. */
export const RESCUE_SPOTS: Spot[] = [
  { x: 29, z: 2, zone: null }, { x: -22, z: -11, zone: null }, { x: 15, z: 30.5, zone: null },
  { x: -26, z: 28, zone: null }, { x: -36, z: -5, zone: 'farm' }, { x: 33, z: 25, zone: 'station' },
];

/** Une caisse a fouiller : couvercle qui s'ouvre, puis elle se remplit avec le temps. */
export class Cache {
  readonly root = new THREE.Group();
  private readonly lid = new THREE.Group();
  private openK = 0;
  ready = true;

  constructor(scene: THREE.Scene, readonly spot: Spot) {
    const body = group(
      rbox(0.9, 0.5, 0.6, 0x5a6e3a, 0.04, 0, 0.25, 0),
      box(0.94, 0.06, 0.64, 0x3a4a2a, 0, 0.12, 0), box(0.94, 0.06, 0.64, 0x3a4a2a, 0, 0.4, 0),
      box(0.16, 0.12, 0.04, 0xd9b44a, 0, 0.38, 0.31),
    );
    this.lid.add(rbox(0.92, 0.1, 0.62, 0x4a5e2a, 0.03, 0, 0, 0.31));
    this.lid.position.set(0, 0.52, -0.31);
    this.root.add(body, this.lid);
    shadow(this.root);
    this.root.position.set(spot.x, 0, spot.z);
    this.root.rotation.y = (spot.x * 7 + spot.z * 3) % 3;
    scene.add(this.root);
  }

  open(): void {
    this.ready = false;
  }

  update(dt: number): void {
    this.openK += ((this.ready ? 0 : 1) - this.openK) * (1 - Math.exp(-6 * dt));
    this.lid.rotation.x = -this.openK * 1.9;
  }
}

/** Le ravitaillement : il tombe du ciel sous son parachute, fume, et attend qu'on l'ouvre. */
export class Airdrop {
  readonly root = new THREE.Group();
  private readonly chute = new THREE.Group();
  active = false;
  landed = false;
  x = 0;
  z = 0;
  private t = 0;

  constructor(scene: THREE.Scene) {
    const box0 = group(
      rbox(1.1, 0.9, 1.1, 0x4a6a3a, 0.06, 0, 0.45, 0),
      box(1.14, 0.12, 0.3, C.white, 0, 0.6, 0), box(0.3, 0.12, 1.14, C.white, 0, 0.6, 0),
      box(1.14, 0.08, 1.14, 0x2e3a22, 0, 0.92, 0),
    );
    const canopy = cone(1.6, 0.9, 0xe8743a, 10, 0, 3.2, 0);
    canopy.rotation.x = Math.PI;
    const top = sphere(1.6, 0xe8743a, 0, 2.75, 0, 10);
    top.scale.set(1, 0.35, 1);
    this.chute.add(top);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const line = cyl(0.01, 0.01, 2.2, 0x3a3a3a, 3, Math.cos(a) * 0.75, 1.85, Math.sin(a) * 0.75);
      line.rotation.z = Math.cos(a) * 0.32;
      line.rotation.x = -Math.sin(a) * 0.32;
      this.chute.add(line);
    }
    this.root.add(box0, this.chute);
    shadow(this.root);
    this.root.visible = false;
    scene.add(this.root);
  }

  drop(x: number, z: number): void {
    this.active = true;
    this.landed = false;
    this.x = x;
    this.z = z;
    this.t = 0;
    this.root.visible = true;
    this.chute.visible = true;
    this.chute.scale.setScalar(1);
    this.root.position.set(x, 26, z);
  }

  /** Renvoie vrai a l'image ou il touche le sol. */
  update(dt: number, time: number): boolean {
    if (!this.active) return false;
    this.t += dt;
    if (!this.landed) {
      this.root.position.y = Math.max(0, 26 - this.t * 4.5);
      this.root.rotation.z = Math.sin(time * 1.4) * 0.08;
      if (this.root.position.y <= 0) {
        this.landed = true;
        this.root.rotation.z = 0;
        return true;
      }
    } else {
      // Le parachute retombe a cote et s'efface.
      const k = Math.min(1, (this.t - 26 / 4.5) / 1.5);
      this.chute.scale.set(1 - k, 1 - k, 1 - k);
      if (k >= 1) this.chute.visible = false;
    }
    return false;
  }

  hide(): void {
    this.active = false;
    this.root.visible = false;
  }
}

/** La caravane : une charrette bachee et son marchand, au bord de la route. */
export class Caravan {
  readonly root = new THREE.Group();
  readonly trader: Human;
  readonly x = -7.5;
  readonly z = 23.2;
  /** Ou le joueur depose ce que le marchand demande. */
  readonly zone = { x: -4.2, z: 22.2 };
  active = false;

  constructor(scene: THREE.Scene) {
    const cover = cyl(1.0, 1.0, 3.0, 0xd8cbb5, 10, 0, 1.25, 0);
    cover.rotation.z = Math.PI / 2;
    cover.scale.set(1, 1, 0.85);
    const cart = group(
      box(3.0, 0.3, 1.7, C.woodDark, 0, 0.75, 0), cover,
      box(0.08, 0.08, 1.8, C.wood, 1.9, 0.75, 0.6), box(0.08, 0.08, 1.8, C.wood, 1.9, 0.75, -0.6),
    );
    for (const [x, z] of [[-1, 0.9], [-1, -0.9], [1, 0.9], [1, -0.9]] as const) {
      const w = tire();
      w.rotation.set(0, 0, 0);
      w.position.set(x, 0.5, z);
      w.scale.setScalar(1.2);
      cart.add(w);
    }
    const goods = crate(0.5);
    goods.position.set(0.5, 0.9, -0.4);
    cart.add(goods, group(box(0.6, 0.4, 0.4, 0x8a3f30, -0.8, 1.05, 0.5)));
    this.root.add(cart);
    this.trader = new Human({ shirt: 0x8a5ad9, pants: 0x3a3a3a, hair: 0x2a1a10, hat: 0x5a3a20 });
    this.trader.root.position.set(1.8, 0, 1.3);
    this.trader.heading = Math.PI;
    this.trader.body.rotation.y = Math.PI * 0.85;
    this.root.add(this.trader.root);
    shadow(this.root);
    this.root.position.set(this.x, 0, this.z);
    this.root.visible = false;
    scene.add(this.root);
  }

  show(on: boolean): void {
    this.active = on;
    this.root.visible = on;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.trader.animate(dt, false, 0);
  }
}

/** Un survivant coince sous des gravats, qui fait signe. */
export class Rescue {
  readonly root = new THREE.Group();
  readonly human: Human;
  active = false;
  x = 0;
  z = 0;
  /** 0..1 : temps passe a degager les gravats. */
  progress = 0;
  private wave = 0;

  constructor(scene: THREE.Scene) {
    this.human = new Human({ shirt: 0xb9874a, pants: 0x4a4a3a, hair: 0x6a3a1a });
    const debris = group(
      box(1.6, 0.12, 0.3, C.woodDark, 0.2, 0.35, 0.5), box(1.4, 0.12, 0.3, C.wood, -0.1, 0.2, 0.7),
      rbox(0.6, 0.4, 0.5, C.concrete, 0.06, 0.8, 0.2, 0.6),
    );
    (debris.children[0] as THREE.Mesh).rotation.z = 0.4;
    this.root.add(this.human.root, debris);
    shadow(this.root);
    this.root.visible = false;
    scene.add(this.root);
  }

  start(x: number, z: number): void {
    this.active = true;
    this.x = x;
    this.z = z;
    this.progress = 0;
    this.root.position.set(x, 0, z);
    this.root.visible = true;
  }

  hide(): void {
    this.active = false;
    this.root.visible = false;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.wave += dt * 6;
    // Il agite le bras pour qu'on le voie.
    this.human.armR.rotation.x = -2.6 + Math.sin(this.wave) * 0.4;
    this.human.armR.rotation.z = 0.3;
  }
}
