// Les visiteurs de la nuit : lents, maladroits, plus comiques que gores.

import * as THREE from 'three';
import { mergeColored } from './bake';
import { C, box, glow, group, rbox, sphere } from './kit';
import { CAMP, insideCamp } from './layout';
import type { Palisade, Section } from './palisade';
import { route, type Region } from './nav';
import { collide, type Circle, type Segment } from './physics';

const WHITE = new THREE.Color(0xffffff);
const SHIRTS = [0x7a6a8f, 0x8f5a4a, 0x5a7a8f, 0x8a8a5a, 0x6a8f6a];
/** Hordes nombreuses : jusqu'a 60 zombies a la fois. */
const POOL = 60;
/** Degats d'un coup de zombie sur la palissade, et cadence des coups. */
const WALL_HIT = 1.4;
const WALL_RATE = 0.7;

export interface Zombie {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  mats: THREE.MeshLambertMaterial[];
  bases: THREE.Color[];
  eyes: THREE.Sprite[];
  hp: number;
  speed: number;
  phase: number;
  rise: number;
  state: 'hidden' | 'rising' | 'walking' | 'dying';
  timer: number;
  flash: number;
  knock: THREE.Vector3;
  /** Temps avant le prochain coup sur la palissade. */
  hit: number;
  /** La brute : enorme, lente, elle defonce la palissade. */
  brute: boolean;
  /** Couleur de chemise (pour les eclaboussures). */
  shirt: number;
  /** Batiment qu'il s'acharne a demolir, s'il en a choisi un. */
  target: Structure | null;
}

/** Ce que les zombies peuvent demolir dans le camp (potagers, machines, tours...). */
export interface Structure {
  id: string;
  x: number;
  z: number;
  /** Distance a laquelle on frappe (rayon de l'emprise + bras). */
  reach: number;
  hp: number;
  max: number;
  alive: () => boolean;
}

export interface Hit { pos: THREE.Vector3; killed: boolean; colors: number[] }

export class Horde {
  private readonly zs: Zombie[] = [];
  active = false;
  toSpawn = 0;
  hpPerZombie = 3;
  private spawnClock = 0;
  kills = 0;

  constructor(private readonly scene: THREE.Scene) {
    for (let i = 0; i < POOL; i++) this.zs.push(this.make(i));
  }

  private make(i: number): Zombie {
    // Les hordes sont nombreuses : chaque zombie est fusionne en 5 maillages (corps, 4 membres)
    // partageant un seul materiau a couleurs de sommets, qu'on fait flasher quand il prend un coup.
    const shirt = SHIRTS[i % SHIRTS.length]!;
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: 0x141a10 });
    const part = (g: THREE.Group, cast: boolean): THREE.Object3D => {
      const merged = mergeColored(g);
      merged.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) { mesh.material = m; mesh.castShadow = cast; mesh.receiveShadow = false; }
      });
      return merged;
    };
    const skin = 0x9fc274;
    const legL = part(group(box(0.22, 0.6, 0.24, 0x4a4440, 0, -0.3, 0)), false);
    const legR = part(group(box(0.22, 0.6, 0.24, 0x4a4440, 0, -0.3, 0)), false);
    legL.position.set(-0.16, 0.66, 0);
    legR.position.set(0.16, 0.66, 0);
    const armL = part(group(rbox(0.18, 0.6, 0.2, shirt, 0.07, 0, -0.28, 0), sphere(0.1, skin, 0, -0.62, 0, 6)), false);
    const armR = part(group(rbox(0.18, 0.6, 0.2, shirt, 0.07, 0, -0.28, 0), sphere(0.1, skin, 0, -0.62, 0, 6)), false);
    armL.position.set(-0.4, 1.22, 0);
    armR.position.set(0.4, 1.22, 0);
    const trunk = part(group(
      rbox(0.62, 0.66, 0.4, shirt, 0.14, 0, 0.98, 0),
      box(0.3, 0.16, 0.02, skin, 0.12, 0.8, 0.205),
      sphere(0.29, skin, 0, 1.56, 0.04, 8),
      sphere(0.055, 0xffb347, -0.11, 1.6, 0.3, 5),
      sphere(0.055, 0xffb347, 0.11, 1.58, 0.3, 5),
    ), true);
    const eyes = glow(0xff9a2a, 1.0);
    eyes.position.set(0, 1.6, 0.32);
    const body = group(trunk, eyes, legL, legR, armL, armR);
    const root = group(body);
    root.visible = false;
    this.scene.add(root);
    return {
      root, body, armL, armR, legL, legR, mats: [m], bases: [m.emissive.clone()], eyes: [eyes], shirt,
      hp: 3, speed: 1.3 + Math.random() * 0.9, phase: Math.random() * 6, rise: 0,
      state: 'hidden', timer: 0, flash: 0, knock: new THREE.Vector3(), hit: 0, brute: false, target: null,
    };
  }

  /** Brutes encore a faire sortir cette nuit. */
  private brutes = 0;
  private spawnEvery = 1;

  startNight(n: number): void {
    this.active = true;
    // Beaucoup de zombies fragiles : nombre en hausse chaque nuit, un coup de plus tous les 4 soirs.
    this.toSpawn = Math.min(160, 24 + 10 * (n - 1));
    this.hpPerZombie = 1 + Math.floor(n / 4);
    this.spawnClock = 2;
    this.spawnEvery = Math.max(0.35, 1.0 - n * 0.06);
    // Une nuit sur trois, une (puis plusieurs) brutes se joignent a la horde.
    this.brutes = n % 3 === 0 ? Math.ceil(n / 6) : 0;
    this.toSpawn += this.brutes;
  }

  get bruteNight(): boolean {
    return this.brutes > 0;
  }

  endNight(): void {
    this.active = false;
    this.toSpawn = 0;
    for (const z of this.zs) {
      if (z.state === 'walking' || z.state === 'rising') {
        z.state = 'dying';
        z.timer = 0;
      }
    }
  }

  get alive(): number {
    return this.zs.filter((z) => z.state === 'walking' || z.state === 'rising').length;
  }

  get remaining(): number {
    return this.alive + this.toSpawn;
  }

  private spawn(z: Zombie, player: THREE.Vector3): void {
    if (insideCamp(player.x, player.z)) {
      // Ils sortent de terre tout autour du camp : surtout cote route, puis de la foret, puis des flancs.
      const roll = Math.random();
      if (roll < 0.45) z.root.position.set((Math.random() - 0.5) * 50, 0, 23 + Math.random() * 5);
      else if (roll < 0.7) z.root.position.set((Math.random() - 0.5) * 24, 0, -18 - Math.random() * 6);
      else z.root.position.set((Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 6), 0, (Math.random() - 0.5) * 20);
    } else {
      // Le joueur traine dehors : ils surgissent autour de lui.
      const a = Math.random() * Math.PI * 2;
      const d = 15 + Math.random() * 6;
      z.root.position.set(player.x + Math.cos(a) * d, 0, player.z + Math.sin(a) * d);
    }
    z.root.position.x = Math.max(-52, Math.min(52, z.root.position.x));
    z.root.position.z = Math.max(-52, Math.min(52, z.root.position.z));
    z.brute = this.brutes > 0 && this.toSpawn <= this.brutes + Math.floor(Math.random() * 3);
    if (z.brute) this.brutes--;
    z.hit = 0.5 + Math.random() * 0.5;
    z.hp = this.hpPerZombie * (z.brute ? 7 : 1);
    z.rise = 0;
    z.state = 'rising';
    z.root.visible = true;
    z.root.scale.setScalar(z.brute ? 1.7 : 1);
    z.target = null;
    z.body.rotation.set(0, 0, 0);
    z.speed = z.brute ? 1.0 : 1.3 + Math.random() * 0.9;
  }

  nearest(p: THREE.Vector3, range: number): Zombie | null {
    let best: Zombie | null = null;
    let bd = range;
    for (const z of this.zs) {
      if (z.state !== 'walking') continue;
      const d = z.root.position.distanceTo(p);
      if (d < bd) { bd = d; best = z; }
    }
    return best;
  }

  /** Les n zombies les plus proches dans le rayon (fusil a pompe). */
  nearestMany(p: THREE.Vector3, range: number, n: number): Zombie[] {
    return this.zs
      .filter((z) => z.state === 'walking' && z.root.position.distanceTo(p) < range)
      .sort((a, b) => a.root.position.distanceTo(p) - b.root.position.distanceTo(p))
      .slice(0, n);
  }

  damage(z: Zombie, dmg: number, from: THREE.Vector3): Hit | null {
    if (z.state !== 'walking') return null;
    z.hp -= dmg;
    z.flash = 1;
    const dir = z.root.position.clone().sub(from).setY(0).normalize();
    z.knock.addScaledVector(dir, 3.5);
    const pos = z.root.position.clone().setY(1.1);
    const colors = [C.zombieSkin, z.shirt, 0x3a2e2a];
    if (z.hp <= 0) {
      z.state = 'dying';
      z.timer = 0;
      this.kills++;
      return { pos, killed: true, colors };
    }
    return { pos, killed: false, colors };
  }

  /**
   * Les zombies foncent droit sur le joueur. La palissade les arrete : ils cognent
   * alors le troncon qui les bloque jusqu'a le casser (`onWall` a chaque coup).
   */
  update(
    dt: number, player: THREE.Vector3, walls: Segment[], solids: Circle[], nightK: number,
    palisade: Palisade, onWall: (s: Section, at: THREE.Vector3) => void, nav: Region[] = [],
    structs: Structure[] = [], onStruct: (s: Structure, at: THREE.Vector3, dmg: number) => void = () => undefined,
  ): number {
    let contact = 0;
    if (this.active && this.toSpawn > 0) {
      this.spawnClock -= dt;
      if (this.spawnClock <= 0) {
        const free = this.zs.find((z) => z.state === 'hidden');
        if (free) {
          this.spawn(free, player);
          this.toSpawn--;
        }
        this.spawnClock = this.spawnEvery;
      }
    }
    for (const z of this.zs) {
      for (const e of z.eyes) (e.material as THREE.SpriteMaterial).opacity = 0.9 * nightK;
      if (z.flash > 0) {
        z.flash = Math.max(0, z.flash - dt * 7);
        z.mats.forEach((m, i) => m.emissive.copy(z.bases[i]!).lerp(WHITE, z.flash * 0.9));
      }
      if (z.state === 'hidden') continue;
      if (z.state === 'rising') {
        z.rise = Math.min(1, z.rise + dt * 0.9);
        z.root.position.y = -1.8 * (1 - z.rise);
        z.body.rotation.z = Math.sin(z.rise * 12) * 0.15 * (1 - z.rise);
        if (z.rise >= 1) z.state = 'walking';
        continue;
      }
      if (z.state === 'dying') {
        z.timer += dt;
        const t = z.timer;
        z.body.rotation.x = Math.min(1.5, t * 6);
        z.root.position.y = -Math.max(0, t - 0.4) * 1.5;
        if (t > 1.6) {
          z.state = 'hidden';
          z.root.visible = false;
        }
        continue;
      }

      const pos = z.root.position;
      // Le joueur tout pres : on lui court dessus. Sinon, on va demolir ce qu'on trouve.
      const toPlayer = pos.distanceTo(player);
      if (z.target && !z.target.alive()) z.target = null;
      if (toPlayer < 9) z.target = null;
      else if (!z.target && structs.length && (z.phase * 7) % 1 < 0.08) z.target = this.pickStructure(pos, structs);
      const aim = z.target ? new THREE.Vector3(z.target.x, 0, z.target.z) : player;
      // Les enclos (ferme, station) se contournent par leur entree ; la palissade, elle, se defonce.
      const goal = route(pos, aim, nav);
      const dir = new THREE.Vector3(goal.x - pos.x, 0, goal.z - pos.z);
      const dist = goal === aim ? dir.length() : Math.max(1, dir.length());
      dir.normalize();
      z.phase += dt * (3 + z.speed);
      const wall = palisade.blocking(pos, aim);
      const atStruct = z.target && !wall && Math.hypot(pos.x - z.target.x, pos.z - z.target.z) < z.target.reach;
      const step = z.speed * (0.7 + 0.3 * Math.abs(Math.sin(z.phase))) * dt;
      if (toPlayer < (z.brute ? 1.4 : 0.95)) contact += z.brute ? 3 : 1;
      else if (dist < 0.95 || atStruct) { /* au contact */ }
      else if (!wall) pos.addScaledVector(dir, Math.min(step, dist));
      if (atStruct && z.target) {
        z.body.rotation.y = Math.atan2(z.target.x - pos.x, z.target.z - pos.z);
        z.hit -= dt;
        const k = Math.max(0, z.hit / WALL_RATE);
        z.armL.rotation.x = -2.4 + k * 1.2;
        z.armR.rotation.x = -2.3 + k * 1.1;
        z.legL.rotation.x = 0;
        z.legR.rotation.x = 0;
        if (z.hit <= 0) {
          z.hit = WALL_RATE * (0.85 + Math.random() * 0.3);
          onStruct(z.target, pos.clone().setY(1.3), WALL_HIT * (z.brute ? 5 : 1));
        }
        this.separate(z);
        collide(pos, z.brute ? 0.6 : 0.4, walls, solids, 54);
        continue;
      }
      pos.addScaledVector(z.knock, dt);
      z.knock.multiplyScalar(Math.exp(-8 * dt));
      this.separate(z);
      collide(pos, z.brute ? 0.6 : 0.4, walls, solids, 54);
      // Face au mur, il frappe ; sinon il marche.
      let fx = dir.x;
      let fz = dir.z;
      if (wall) {
        const side = Math.sign((pos.x - wall.x) * wall.nx + (pos.z - wall.z) * wall.nz) || 1;
        fx = -wall.nx * side;
        fz = -wall.nz * side;
      }
      let diff = Math.atan2(fx, fz) - z.body.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      z.body.rotation.y += diff * (1 - Math.exp(-5 * dt));
      if (wall) {
        z.hit -= dt;
        const k = Math.max(0, z.hit / WALL_RATE);
        z.armL.rotation.x = -2.4 + k * 1.2;
        z.armR.rotation.x = -2.3 + k * 1.1;
        z.body.rotation.z = 0;
        z.legL.rotation.x = 0;
        z.legR.rotation.x = 0;
        if (z.hit <= 0) {
          z.hit = WALL_RATE * (0.85 + Math.random() * 0.3);
          palisade.damage(wall, WALL_HIT * (z.brute ? 5 : 1));
          onWall(wall, pos.clone().setY(1.3));
        }
        continue;
      }
      z.body.rotation.z = Math.sin(z.phase * 0.5) * 0.12;
      z.legL.rotation.x = Math.sin(z.phase) * 0.5;
      z.legR.rotation.x = -Math.sin(z.phase) * 0.5;
      z.armL.rotation.x = -1.4 + Math.sin(z.phase * 0.9) * 0.15;
      z.armR.rotation.x = -1.3 - Math.sin(z.phase * 0.8) * 0.2;
    }
    return contact;
  }

  /** Le batiment intact le plus proche, a portee de nez. */
  private pickStructure(pos: THREE.Vector3, structs: Structure[]): Structure | null {
    let best: Structure | null = null;
    let bd = 16;
    for (const s of structs) {
      if (!s.alive()) continue;
      const d = Math.hypot(s.x - pos.x, s.z - pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  private separate(z: Zombie): void {
    for (const o of this.zs) {
      if (o === z || o.state !== 'walking') continue;
      const dx = z.root.position.x - o.root.position.x;
      const dz = z.root.position.z - o.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.8 && d > 1e-4) {
        const push = (0.8 - d) * 0.5;
        z.root.position.x += (dx / d) * push;
        z.root.position.z += (dz / d) * push;
      }
    }
  }
}

/**
 * Prochain point de passage pour aller de `pos` a `dest` : on traverse la cloture
 * uniquement par une porte (sud, ou nord une fois construite).
 */
export function waypoint(pos: THREE.Vector3, dest: THREE.Vector3, northOpen: boolean): THREE.Vector3 {
  const a = insideCamp(pos.x, pos.z);
  const b = insideCamp(dest.x, dest.z);
  if (a === b) return dest;
  const gates = [{ z: CAMP.maxZ, s: 1 }];
  if (northOpen) gates.push({ z: CAMP.minZ, s: -1 });
  // Porte la plus courte pour l'ensemble du trajet.
  let best = gates[0]!;
  let bd = Infinity;
  for (const g of gates) {
    const d = Math.hypot(pos.x, pos.z - g.z) + Math.hypot(dest.x, dest.z - g.z);
    if (d < bd) { bd = d; best = g; }
  }
  const outside = new THREE.Vector3(0, 0, best.z + best.s * 1.8);
  const inside = new THREE.Vector3(0, 0, best.z - best.s * 1.8);
  const inGate = Math.abs(pos.x) < CAMP.gate - 0.5 && Math.abs(pos.z - best.z) < 1.9;
  if (inGate) return a ? outside : inside;
  return a ? inside : outside;
}
