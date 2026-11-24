// Les chasseurs de prime : recrutes une fois a l'armurerie, ils defendent chaque nuit la zone
// qu'on leur donne (le camp ou la ferme fortifiee). Le jour, ils attendent pres de l'armurerie.
// Long manteau, chapeau a bord, fusil : on les reconnait de loin. Ils ne meurent pas.

import * as THREE from 'three';
import { Human, fusedMesh, type HumanLook } from './humans';
import { C, cyl, group, rbox } from './kit';
import { route, type Region } from './nav';
import { collide, type Circle, type Segment } from './physics';
import type { Zombie } from './zombies';

export type HuntZone = 'camp' | 'farm';

export interface HunterDef {
  name: string;
  icon: string;
  /** Avec un long manteau (look.coat) : pans fusionnes au tronc, partages par apparence. */
  look: HumanLook;
  lines: string[];
}

/** Les trois places de l'armurerie, dans l'ordre. */
export const HUNTERS: HunterDef[] = [
  {
    name: 'Silas', icon: '🤠',
    look: { coat: 0x7a5232, shirt: 0x7a5232, pants: 0x3a3532, hair: 0x2a1a10, hat: 0x4a3524, top: 0, hatStyle: 0 },
    lines: ['Une prime, c’est une prime. Même pour des morts.', 'Je dors le jour. La nuit, je travaille.', 'Garde ta palissade debout, je garde le reste.'],
  },
  {
    name: 'Margot', icon: '👩‍🦳',
    look: { coat: 0x4f5a4a, shirt: 0x4f5a4a, pants: 0x3a3a3a, hair: 0xd8d0c4, hat: 0x2f3a2c, top: 0, hatStyle: 0 },
    lines: ['Vingt ans que je chasse. Les zombies, c’est plus simple que les loups.', 'Une balle, un zombie. Je compte.', 'Tes champs seront encore là demain.'],
  },
  {
    name: 'Bastien', icon: '🧔',
    look: { coat: 0x2f3442, shirt: 0x2f3442, pants: 0x4a3a2a, hair: 0x5a3a1a, hat: 0x1f2330, top: 0, hatStyle: 0 },
    lines: ['Paie-moi bien, et tu dormiras tranquille.', 'Il en vient toujours plus. Tant mieux pour moi.', 'Ce fusil, c’est mon seul ami.'],
  },
];

/** Le chasseur de passage (renfort d'une nuit, par une pub au choix du joueur). */
export const MERC: HunterDef = {
  name: 'Joe le Borgne', icon: '🕵️',
  look: { coat: 0x8a2f2a, shirt: 0x8a2f2a, pants: 0x2a2a2a, hair: 0x1a1a1a, hat: 0x2a2a2a, top: 0, hatStyle: 0 },
  lines: ['Une nuit, pas plus. Ensuite je reprends la route.', 'On m’a dit que ça payait bien, ici.', 'Reste derrière moi.'],
};

/** Prix de chaque place (pieces) et niveau du camp qui l'ouvre (la 1re : l'armurerie, niv. 2). */
export const HUNTER_COST = [3000, 6500, 10000];
export const HUNTER_LV = [2, 3, 4];
/** Portee et cadence de tir. */
export const HUNT_RANGE = 12;
export const HUNT_EVERY = 0.8;

export interface HunterCtx {
  walls: Segment[];
  solids: Circle[];
  nav: Region[];
  /** Le soir et la nuit : il tient son poste. */
  duty: boolean;
  /** La nuit : il tire. */
  night: boolean;
  /** Ou il attend le jour. */
  rest: { x: number; z: number };
  /** Son poste de garde (il patrouille autour). */
  post: { x: number; z: number };
  /** Les points de ronde valides (l'interieur de sa zone). */
  inside: (x: number, z: number) => boolean;
  target: (from: THREE.Vector3, range: number) => Zombie | null;
  fire: (h: Hunter, z: Zombie, from: THREE.Vector3) => void;
}

/** Fusil de chasse, canon vers +z (repere de la main). */
function rifleParts(): THREE.Object3D {
  const barrel = cyl(0.026, 0.026, 0.74, 0x2b2b2b, 6, 0, 0.02, 0.42);
  barrel.rotation.x = Math.PI / 2;
  const scope = cyl(0.03, 0.03, 0.2, 0x3a3d40, 6, 0, 0.09, 0.2);
  scope.rotation.x = Math.PI / 2;
  return group(rbox(0.08, 0.12, 0.44, C.woodDark, 0.03, 0, -0.02, -0.02), barrel, scope);
}

export class Hunter {
  readonly human: Human;
  /** Bouche du fusil (monde), mise a jour a chaque tir. */
  readonly muzzle = new THREE.Vector3();
  private clock = Math.random() * 0.5;
  private wander = 0;
  private aim = 0;
  private stuck = 0;
  private readonly spot = new THREE.Vector3();
  private readonly base = new THREE.Vector3(Infinity, 0, Infinity);
  private readonly last = new THREE.Vector3();
  private readonly wp = new THREE.Vector3();

  constructor(scene: THREE.Scene, readonly def: HunterDef, x: number, z: number) {
    this.human = new Human(def.look);
    // Fusil fin : pas d'ombre portee (un appel de dessin de moins par chasseur).
    const rifle = fusedMesh('hrifle', rifleParts);
    rifle.castShadow = false;
    this.human.hand.add(rifle);
    this.human.root.position.set(x, 0, z);
    this.spot.set(x, 0, z);
    this.last.set(x, 0, z);
    scene.add(this.human.root);
  }

  private go(dest: THREE.Vector3, speed: number, dt: number, ctx: HunterCtx): boolean {
    const p = this.human.root.position;
    const wp = route(p, dest, ctx.nav);
    const final = wp === dest;
    this.wp.copy(wp);
    const arrived = this.human.walkTo(this.wp, speed, dt, final ? 0.25 : 0.4) && final;
    collide(p, 0.4, ctx.walls, ctx.solids, 52);
    // Coince contre un obstacle : il glisse un peu sur le cote.
    if (!arrived && p.distanceTo(this.last) < dt * 0.4) {
      this.stuck += dt;
      if (this.stuck > 0.6) {
        const side = new THREE.Vector3(wp.z - p.z, 0, -(wp.x - p.x)).normalize();
        p.addScaledVector(side, 0.5);
        this.stuck = 0;
        this.wander = 0;
      }
    } else this.stuck = 0;
    this.last.copy(p);
    return arrived;
  }

  update(dt: number, ctx: HunterCtx): void {
    const h = this.human;
    const p = h.root.position;
    this.clock -= dt;
    this.wander -= dt;
    this.aim = Math.max(0, this.aim - dt);
    // Le poste suit l'attaque : il y court des qu'il bouge de plus de 1,5 m.
    const src = ctx.duty ? ctx.post : ctx.rest;
    if (Math.hypot(src.x - this.base.x, src.z - this.base.z) > 1.5) {
      this.base.set(src.x, 0, src.z);
      this.spot.copy(this.base);
      this.wander = 2 + Math.random() * 2;
    }
    // Ronde : un point au hasard autour du poste, toujours dans sa zone.
    if (this.wander <= 0) {
      this.wander = 3 + Math.random() * 3;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * (ctx.duty ? 2.6 : 1.0);
      const x = this.base.x + Math.cos(a) * d;
      const z = this.base.z + Math.sin(a) * d;
      if (ctx.inside(x, z)) this.spot.set(x, 0, z);
      else this.spot.copy(this.base);
    }
    const zb = ctx.night ? ctx.target(p, HUNT_RANGE) : null;
    const heading = h.heading;
    // En visant, il avance au pas (il tire en marchant).
    this.go(this.spot, zb ? 1.8 : 3.4, dt, ctx);
    if (zb) {
      h.heading = heading;
      const t = zb.root.position;
      h.face(Math.atan2(t.x - p.x, t.z - p.z), dt);
      this.aim = 0.7;
      if (this.clock <= 0) {
        this.clock = HUNT_EVERY;
        this.muzzle.set(p.x + Math.sin(h.heading) * 1.25, 1.08, p.z + Math.cos(h.heading) * 1.25);
        ctx.fire(this, zb, this.muzzle);
      }
    }
    h.animate(dt, false);
    // Pose : fusil porte en biais, ou epaule (bras leves, canon a l'horizontale) quand il vise.
    const k = Math.min(1, this.aim * 3);
    h.armR.rotation.x = h.armR.rotation.x * (1 - k) - 1.25 * k;
    h.hand.rotation.x = -0.5 * (1 - k) + 1.25 * k;
    h.armL.rotation.x = h.armL.rotation.x * (1 - k) - 1.1 * k;
    h.armL.rotation.z = 0.35 * k;
  }
}
