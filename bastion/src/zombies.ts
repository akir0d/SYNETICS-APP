// Les visiteurs de la nuit : lents, maladroits, plus comiques que gores.

import * as THREE from 'three';
import { fusedMesh, onFront, oval } from './humans';
import { C, blob, box, glow, group, lathe, lookMat, mixHex, plank, sphere, type Profile } from './kit';
import { CAMP, insideCamp } from './layout';
import type { Palisade, Section } from './palisade';
import { route, type Region } from './nav';
import { collide, type Circle, type Segment } from './physics';

const WHITE = new THREE.Color(0xffffff);
const SHIRTS = [0x7a6a8f, 0x8f5a4a, 0x5a7a8f, 0x8a8a5a, 0x6a8f6a];
const ZSKIN = 0x9dbf72;
const ZPANTS = 0x4a4a52;
const ZHAIR = 0x4a4a3a;
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
  /** Casque et epauliere de recuperation, visibles sur les brutes seulement. */
  gear: THREE.Object3D;
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

// ---------------------------------------------------------------- modele

const ZTORSO: Profile = [[0, -0.04], [0.25, -0.04], [0.29, 0.02], [0.3, 0.2], [0.31, 0.4], [0.28, 0.54], [0.19, 0.62], [0, 0.65]];
const ZHIPS: Profile = [[0, 0.5], [0.2, 0.5], [0.26, 0.56], [0.275, 0.68], [0, 0.7]];
const ZSLEEVE: Profile = [[0, -0.3], [0.1, -0.3], [0.108, -0.26], [0.112, -0.02], [0.09, 0.08], [0, 0.11]];
const ZFOREARM: Profile = [[0, -0.52], [0.065, -0.5], [0.075, -0.4], [0.08, -0.28], [0, -0.25]];
const ZLEG: Profile = [[0, -0.5], [0.1, -0.5], [0.11, -0.47], [0.105, -0.2], [0.118, -0.02], [0.1, 0.06], [0, 0.09]];
const ZLEG_TORN: Profile = [[0, -0.28], [0.105, -0.28], [0.112, -0.2], [0.118, -0.02], [0.1, 0.06], [0, 0.09]];
const ZSHIN: Profile = [[0, -0.55], [0.075, -0.53], [0.08, -0.3], [0, -0.25]];
const BUCKET: Profile = [[0.27, 0.05], [0.292, 0.07], [0.292, 0.095], [0.245, 0.3], [0, 0.31]];
/** Le haut du corps penche en avant (pivot a la hanche). */
const HUNCH = 0.2;

/**
 * Ourlet dechire : les sommets sous `yMax` (hors axe) descendent ou remontent un peu, en
 * dents irregulieres. Copie de geometrie, creee une fois par variante (jamais affichee seule).
 */
function jag<T extends THREE.Mesh>(m: T, yMax: number, amp: number): T {
  const g = m.geometry.clone();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (y > yMax || Math.hypot(x, z) < 0.01) continue;
    const j = Math.round((Math.atan2(x, z) + Math.PI) * 4);
    const t = ((j * 37) % 7) / 6;
    pos.setY(i, y - amp * t + amp * 0.25);
  }
  m.geometry = g;
  return m;
}

/** Repere du haut du corps (penche) et de la tete, communs au tronc et a l'equipement des brutes. */
function hunched(chest: THREE.Object3D[], head: THREE.Object3D[]): THREE.Group {
  const h = group(...head);
  h.position.set(0, 0.86, 0.1);
  h.rotation.set(-0.1, 0, 0.15);
  const c = group(...chest, h);
  c.position.set(0, 0.66, 0);
  c.rotation.x = HUNCH;
  return c;
}

function zombieTrunk(shirt: number, v: number): THREE.Object3D {
  const patch = onFront(-0.13, 0.31, 0.74);
  const p = box(0.13, 0.11, 0.014, mixHex(shirt, 0xd9b48a, 0.45), -0.13, 0.38, patch.z + 0.004);
  p.rotation.y = patch.ry;
  const belly = blob(0.1, mixHex(ZSKIN, 0x5a7a40, 0.3), 0.07, 0.18, 0.2);
  belly.scale.set(1, 0.8, 0.45);
  const head = sphere(0.27, ZSKIN, 0, 0, 0, -12);
  head.scale.set(1.05, 0.95, 1);
  // Yeux depareilles : l'un grand, l'autre petit, pupilles qui louchent.
  const eyeA = sphere(0.07, 0xf2e6a8, -0.09, 0.03, 0.235, 6);
  const eyeB = sphere(0.05, 0xf2e6a8, 0.1, 0.05, 0.235, 6);
  eyeA.scale.z = 0.7;
  eyeB.scale.z = 0.7;
  const mouth = box(0.12, 0.045, 0.03, 0x4a2a2a, 0.02, -0.12, 0.234);
  mouth.rotation.z = -0.18;
  const ear = blob(0.06, ZSKIN, 0.28, 0, 0);
  ear.scale.set(0.6, 1, 0.8);
  const tufts = v % 2 === 0
    ? [blob(0.06, ZHAIR, -0.06, 0.25, -0.02), blob(0.05, ZHAIR, 0.08, 0.24, 0.03), blob(0.055, ZHAIR, 0, 0.2, -0.17)]
    : [blob(0.065, ZHAIR, 0.02, 0.255, -0.05), blob(0.05, ZHAIR, -0.1, 0.22, 0.06)];
  return group(
    oval(lathe(ZHIPS, ZPANTS, 0, 0, 0, 12), 0.74),
    hunched(
      [jag(oval(lathe(ZTORSO, shirt, 0, 0, 0, 12), 0.74), 0.05, 0.07), p, belly],
      [
        head, eyeA, eyeB, mouth, ear, ...tufts,
        sphere(0.03, 0x2a1a10, -0.075, 0.025, 0.282, -5), sphere(0.024, 0x2a1a10, 0.09, 0.04, 0.27, -5),
        box(0.032, 0.03, 0.016, 0xeee6c8, 0.045, -0.105, 0.25),
      ],
    ),
  );
}

/** Seau cabosse en guise de casque et epauliere de tole : les brutes. */
function zombieGear(): THREE.Object3D {
  const bucket = lathe(BUCKET, C.rust, 0, 0, -0.01, 12);
  bucket.rotation.z = -0.12;
  const pad = plank(0.3, 0.06, 0.32, C.metal, -0.27, 0.58, 0);
  pad.rotation.z = 0.45;
  const strap = box(0.06, 0.6, 0.016, 0x4a3426, 0, 0.32, 0.225);
  strap.rotation.z = 0.6;
  return hunched([pad, strap, sphere(0.03, C.tin, -0.2, 0.62, 0.12, 6)], [bucket]);
}

function zombieArm(shirt: number): THREE.Object3D {
  const hand = sphere(0.085, ZSKIN, 0, -0.57, 0.01, -7);
  hand.scale.set(1, 1.15, 0.8);
  return group(jag(lathe(ZSLEEVE, shirt, 0, 0, 0, 8), -0.25, 0.06), lathe(ZFOREARM, ZSKIN, 0, 0, 0, 8), hand);
}

function zombieLeg(torn: boolean): THREE.Object3D {
  const foot = sphere(0.11, torn ? mixHex(ZSKIN, 0x5a7a40, 0.25) : 0x3a3230, 0, -0.59, 0.05, -7);
  foot.scale.set(torn ? 0.85 : 1, 0.6, torn ? 1.25 : 1.4);
  const g = group(foot);
  if (torn) g.add(jag(lathe(ZLEG_TORN, ZPANTS, 0, 0, 0, 8), -0.24, 0.06), lathe(ZSHIN, ZSKIN, 0, 0, 0, 8));
  else g.add(jag(lathe(ZLEG, ZPANTS, 0, 0, 0, 8), -0.46, 0.04));
  return g;
}

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
    // Les hordes sont nombreuses : chaque zombie tient en 5 maillages (tronc, 4 membres) dont
    // les geometries sont partagees par variante de chemise, avec un materiau a couleurs de
    // sommets propre a chaque zombie, qu'on fait flasher quand il prend un coup.
    const v = i % SHIRTS.length;
    const shirt = SHIRTS[v]!;
    const m = lookMat({ vertexColors: true, emissive: 0x141a10 });
    const part = (key: string, make: () => THREE.Object3D, cast: boolean): THREE.Mesh => {
      const mesh = fusedMesh(key, make, m);
      mesh.castShadow = cast;
      mesh.receiveShadow = false;
      return mesh;
    };
    const legL = group(part('zl0', () => zombieLeg(false), false));
    const legR = group(part('zl1', () => zombieLeg(true), false));
    legL.position.set(-0.16, 0.66, 0);
    legR.position.set(0.16, 0.66, 0);
    const armL = group(part(`za${v}`, () => zombieArm(shirt), false));
    const armR = group(part(`za${v}`, () => zombieArm(shirt), false));
    armL.position.set(-0.38, 1.17, 0.1);
    armR.position.set(0.38, 1.17, 0.1);
    const trunk = part(`zt${v}`, () => zombieTrunk(shirt, v), true);
    const gear = part('zg', zombieGear, true);
    gear.visible = false;
    const eyes = glow(0xff9a2a, 1.0);
    eyes.position.set(0, 1.5, 0.52);
    const body = group(trunk, gear, eyes, legL, legR, armL, armR);
    const root = group(body);
    root.visible = false;
    this.scene.add(root);
    return {
      root, body, armL, armR, legL, legR, mats: [m], bases: [m.emissive.clone()], eyes: [eyes], shirt, gear,
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

  /**
   * Ou un zombie n'a pas le droit de sortir de terre : derriere un mur (le camp, avec une
   * marge, et ce que main.ts ajoute, comme la ferme fortifiee). Ils doivent passer la palissade.
   */
  noSpawn: (x: number, z: number) => boolean = (x, z) =>
    x > CAMP.minX - 4 && x < CAMP.maxX + 4 && z > CAMP.minZ - 4 && z < CAMP.maxZ + 4;

  private spawn(z: Zombie, player: THREE.Vector3): void {
    const p = z.root.position;
    const clamp = () => {
      p.x = Math.max(-52, Math.min(52, p.x));
      p.z = Math.max(-52, Math.min(52, p.z));
    };
    const around = () => {
      if (insideCamp(player.x, player.z)) {
        // Ils sortent de terre tout autour du camp : surtout cote route, puis de la foret, puis des flancs.
        const roll = Math.random();
        if (roll < 0.45) p.set((Math.random() - 0.5) * 50, 0, 23 + Math.random() * 5);
        else if (roll < 0.7) p.set((Math.random() - 0.5) * 24, 0, CAMP.minZ - 7 - Math.random() * 6);
        else p.set((Math.random() < 0.5 ? CAMP.minX - 7 - Math.random() * 6 : CAMP.maxX + 7 + Math.random() * 6), 0, (Math.random() - 0.5) * 20);
      } else {
        // Le joueur traine dehors : ils surgissent autour de lui.
        const a = Math.random() * Math.PI * 2;
        const d = 15 + Math.random() * 6;
        p.set(player.x + Math.cos(a) * d, 0, player.z + Math.sin(a) * d);
      }
      clamp();
    };
    // Jamais derriere un mur : on retire au sort, puis au pire ils viennent de la route.
    let tries = 0;
    do around(); while (this.noSpawn(p.x, p.z) && ++tries < 12);
    if (this.noSpawn(p.x, p.z)) {
      p.set((Math.random() - 0.5) * 50, 0, 24 + Math.random() * 4);
      clamp();
    }
    z.brute = this.brutes > 0 && this.toSpawn <= this.brutes + Math.floor(Math.random() * 3);
    if (z.brute) this.brutes--;
    z.hit = 0.5 + Math.random() * 0.5;
    z.hp = this.hpPerZombie * (z.brute ? 7 : 1);
    z.rise = 0;
    z.state = 'rising';
    z.root.visible = true;
    z.root.scale.setScalar(z.brute ? 1.7 : 1);
    z.gear.visible = z.brute;
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
   * Plusieurs palissades (camp, ferme fortifiee) : la premiere qui barre la route compte.
   */
  update(
    dt: number, player: THREE.Vector3, walls: Segment[], solids: Circle[], nightK: number,
    palisade: Palisade | Palisade[], onWall: (s: Section, at: THREE.Vector3) => void, nav: Region[] = [],
    structs: Structure[] = [], onStruct: (s: Structure, at: THREE.Vector3, dmg: number) => void = () => undefined,
  ): number {
    let contact = 0;
    const pals = Array.isArray(palisade) ? palisade : [palisade];
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
      let wall: Section | null = null;
      let wallOf: Palisade | null = null;
      for (const pl of pals) {
        wall = pl.blocking(pos, aim);
        if (wall) { wallOf = pl; break; }
      }
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
          wallOf!.damage(wall, WALL_HIT * (z.brute ? 5 : 1));
          onWall(wall, pos.clone().setY(1.3));
        }
        continue;
      }
      z.body.rotation.z = Math.sin(z.phase * 0.5) * 0.12;
      z.legL.rotation.x = Math.sin(z.phase) * 0.5;
      z.legR.rotation.x = -Math.sin(z.phase) * 0.5;
      z.armL.rotation.x = -1.15 + Math.sin(z.phase * 0.9) * 0.22;
      z.armR.rotation.x = -1.0 - Math.sin(z.phase * 0.8) * 0.26;
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
