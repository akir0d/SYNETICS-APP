// Ce qui rend les journees vivantes : caches a fouiller, ravitaillement parachute,
// caravane de marchands, survivants a sauver. Ici les modeles et leurs animations ;
// les regles (butin, recompenses, quand ca arrive) sont dans main.ts.

import * as THREE from 'three';
import { Human } from './humans';
import { C, blob, box, cyl, group, lathe, mixHex, paint, plank, rbox, rcyl, shadow, mat, type Profile } from './kit';
import { crate, merged, wheel } from './props';

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

// ---------------------------------------------------------------- modeles (fusionnes une fois)

const OLIVE = 0x5a6e3a;
const OLIVE_DARK = 0x3a4a2a;
const STENCIL = 0xd8cfa8;

/** Caisse militaire : corps arrondi, cerclages, poignees, etiquette au pochoir, fond sombre. */
function cacheBody(): THREE.Object3D {
  return group(
    rbox(0.9, 0.5, 0.6, OLIVE, 0.06, 0, 0.25, 0),
    plank(0.94, 0.07, 0.64, OLIVE_DARK, 0, 0.12, 0), plank(0.94, 0.07, 0.64, OLIVE_DARK, 0, 0.4, 0),
    // Interieur sombre : on le voit quand le couvercle est ouvert.
    box(0.8, 0.02, 0.5, 0x232a1a, 0, 0.5, 0),
    box(0.36, 0.13, 0.012, STENCIL, -0.17, 0.26, 0.303),
    box(0.16, 0.12, 0.04, 0xd9b44a, 0, 0.38, 0.31),
    box(0.04, 0.05, 0.24, 0x55595c, -0.47, 0.3, 0), box(0.04, 0.05, 0.24, 0x55595c, 0.47, 0.3, 0),
  );
}

/** Couvercle de la cache, dans le repere de sa charniere (arriere). */
function cacheLid(): THREE.Object3D {
  return group(
    rbox(0.92, 0.1, 0.62, 0x4a5e2a, 0.04, 0, 0, 0.31),
    box(0.16, 0.012, 0.6, STENCIL, -0.2, 0.051, 0.31),
    box(0.26, 0.035, 0.06, 0x55595c, 0.12, 0.06, 0.31),
  );
}

/** Caisse du ravitaillement : sangles blanches croisees, cornieres et patin. */
function dropCrate(): THREE.Object3D {
  const g = group(
    rbox(1.1, 0.9, 1.1, 0x4a6a3a, 0.06, 0, 0.45, 0),
    plank(1.16, 0.1, 1.16, 0x2e3a22, 0, 0.05, 0),
    box(1.14, 0.92, 0.18, C.white, 0, 0.46, 0), box(0.18, 0.92, 1.14, C.white, 0, 0.46, 0),
    box(0.3, 0.3, 0.02, 0xd9573a, 0.34, 0.6, 0.56),
  );
  for (const [x, z, ry] of [[0, 0.56, 0], [0, -0.56, 0], [0.56, 0, Math.PI / 2], [-0.56, 0, Math.PI / 2]] as const) {
    const e = plank(1.16, 0.08, 0.08, 0x2e3a22, x, 0.89, z);
    e.rotation.y = ry;
    g.add(e);
  }
  return g;
}

// Voilure : coque fermee (dessous creux, dessus bombe), axe Y, rebord a y = 0.
const CANOPY: Profile = [
  [0, 0.3], [0.5, 0.25], [1.0, 0.1], [1.4, -0.08], [1.55, -0.15], [1.6, -0.1],
  [1.5, 0.08], [1.25, 0.32], [0.8, 0.5], [0, 0.58],
];

/** Parachute a fuseaux orange et creme, et ses suspentes jusqu'aux coins de la caisse. */
function dropChute(): THREE.Object3D {
  const orange = new THREE.Color(0xe8743a);
  const cream = new THREE.Color(0xf4efe4);
  const canopy = paint(lathe(CANOPY, 0xe8743a, 0, 2.75, 0, 24), 'chute', (x, _y, z, out) => {
    const a = Math.atan2(x, z) + Math.PI;
    out.copy(Math.floor((a / (Math.PI * 2)) * 6 + 0.25) % 2 ? cream : orange);
  });
  const g = group(canopy);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const p0 = new THREE.Vector3(Math.cos(a) * 0.45, 0.92, Math.sin(a) * 0.45);
    const p1 = new THREE.Vector3(Math.cos(a) * 1.5, 2.62, Math.sin(a) * 1.5);
    const d = p1.clone().sub(p0);
    const line = cyl(0.012, 0.012, d.length(), 0x3a3a3a, 6);
    line.position.copy(p0).addScaledVector(d, 0.5);
    line.quaternion.setFromUnitVectors(up, d.normalize());
    g.add(line);
  }
  return g;
}

/** Charrette du marchand : plateau, ridelles, bache rayee sur arceaux, banc, timon, roues. */
function cart(): THREE.Object3D {
  const canvas = new THREE.Color(C.canvas);
  const stripe = new THREE.Color(mixHex(C.canvas, 0xc9412f, 0.38));
  const cover = paint(rcyl(1.0, 1.0, 2.0, C.canvas, 0.3, 0, 1.25, 0), 'caravan-cover', (x, _y, z, out) => {
    const a = Math.atan2(x, z) + Math.PI;
    out.copy(Math.floor((a / (Math.PI * 2)) * 8 + 0.2) % 2 ? stripe : canvas);
  });
  cover.rotation.z = Math.PI / 2;
  cover.scale.set(1, 1, 0.85);
  const g = group(
    plank(3.0, 0.22, 1.7, C.woodDark, 0, 0.75, 0),
    plank(3.0, 0.24, 0.07, C.wood, 0, 0.97, 0.835), plank(3.0, 0.24, 0.07, C.wood, 0, 0.97, -0.835),
    plank(0.07, 0.24, 1.6, C.wood, 1.465, 0.97, 0), plank(0.07, 0.24, 1.6, C.wood, -1.465, 0.97, 0),
    cover,
    // Banc du conducteur, a l'avant.
    plank(0.36, 0.08, 1.3, C.woodLight, 1.22, 1.16, 0), plank(0.08, 0.3, 1.3, C.wood, 1.06, 1.3, 0),
    // Timon.
    plank(0.7, 0.09, 0.09, C.wood, 1.85, 0.72, 0), plank(0.09, 0.09, 1.0, C.wood, 2.17, 0.72, 0),
  );
  // Arceaux : demi-tores dont les bouts plongent derriere les ridelles.
  const hoop = new THREE.TorusGeometry(1.02, 0.045, 5, 14, Math.PI + 0.6);
  for (const x of [-0.7, 0, 0.7]) {
    const arcM = new THREE.Mesh(hoop, mat(C.woodDark));
    arcM.rotation.z = -0.3;
    const h = group(arcM);
    h.position.set(x, 1.25, 0);
    h.rotation.y = Math.PI / 2;
    h.scale.set(0.85, 1, 1);
    g.add(h);
  }
  // Marchandises a l'arriere, hors de la bache.
  const goods = crate(0.42);
  goods.position.set(-1.2, 0.86, -0.36);
  goods.rotation.y = 0.2;
  const sack = blob(0.22, C.sand, -1.2, 1.04, 0.34);
  sack.scale.set(1, 0.8, 1.1);
  g.add(goods, sack, plank(0.3, 0.24, 0.3, 0x8a3f30, -1.25, 0.98, 0.0));
  for (const [x, z] of [[-1, 0.9], [-1, -0.9], [1, 0.9], [1, -0.9]] as const) {
    const w = wheel(0x8d5a30);
    w.rotation.set(0, 0, 0);
    w.position.set(x, 0.5, z);
    w.scale.setScalar(1.2);
    g.add(w);
  }
  return g;
}

/** Gravats du sauvetage : poutres tombees, dalles de beton, briques, ferraillage. */
function debris(): THREE.Object3D {
  const beam = plank(1.6, 0.14, 0.26, C.woodDark, 0.2, 0.35, 0.5);
  beam.rotation.z = 0.4;
  const beam2 = plank(1.4, 0.12, 0.28, C.wood, -0.1, 0.2, 0.7);
  beam2.rotation.y = 0.15;
  const slab = rbox(0.6, 0.4, 0.5, C.concrete, 0.08, 0.8, 0.2, 0.6);
  slab.rotation.set(0.08, 0.3, 0);
  const slab2 = rbox(0.45, 0.18, 0.4, C.concreteDark, 0.06, -0.52, 0.09, 0.55);
  slab2.rotation.y = 0.5;
  const rebar = cyl(0.016, 0.016, 0.5, C.rustDark, 6, 0.9, 0.5, 0.5);
  rebar.rotation.set(0.5, 0, -0.6);
  const g = group(beam, beam2, slab, slab2, rebar,
    blob(0.14, C.stone, 0.45, 0.1, 0.76), blob(0.1, 0xb0aea6, -0.32, 0.07, 0.8), blob(0.12, C.concreteDark, 1.0, 0.08, 0.38));
  for (const [x, z, ry] of [[-0.2, 0.84, 0.4], [0.2, 0.82, -0.3], [-0.72, 0.72, 1.2]] as const) {
    const b = box(0.24, 0.1, 0.12, C.brick, x, 0.05, z);
    b.rotation.y = ry;
    g.add(b);
  }
  return g;
}

// ---------------------------------------------------------------- evenements

/** Une caisse a fouiller : couvercle qui s'ouvre, puis elle se remplit avec le temps. */
export class Cache {
  readonly root = new THREE.Group();
  private readonly lid = new THREE.Group();
  private openK = 0;
  ready = true;

  constructor(scene: THREE.Scene, readonly spot: Spot) {
    const body = merged('cache-body', cacheBody);
    this.lid.add(merged('cache-lid', cacheLid));
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
    const box0 = merged('airdrop-crate', dropCrate);
    this.chute.add(merged('airdrop-chute', dropChute));
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
    this.root.add(merged('caravan-cart', cart));
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
    this.root.add(this.human.root, merged('rescue-debris', debris));
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
