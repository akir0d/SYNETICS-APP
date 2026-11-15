// Les visiteurs de la nuit : lents, maladroits, plus comiques que gores.

import * as THREE from 'three';
import { C, box, glow, group, rbox, shadow, sphere, uniqueMat } from './kit';
import { CAMP, insideCamp } from './layout';
import { collide, type Circle, type Segment } from './physics';

const WHITE = new THREE.Color(0xffffff);
const SHIRTS = [0x7a6a8f, 0x8f5a4a, 0x5a7a8f, 0x8a8a5a, 0x6a8f6a];
const POOL = 16;

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
    const shirt = SHIRTS[i % SHIRTS.length]!;
    const skinM = uniqueMat(0x9fc274, 0x1c2a12);
    const shirtM = uniqueMat(shirt, 0x15121a);
    const pantsM = uniqueMat(0x4a4440, 0x0e0c0c);
    const mats = [skinM, shirtM, pantsM];
    const legL = group(box(0.22, 0.6, 0.24, pantsM, 0, -0.3, 0));
    const legR = group(box(0.22, 0.6, 0.24, pantsM, 0, -0.3, 0));
    legL.position.set(-0.16, 0.66, 0);
    legR.position.set(0.16, 0.66, 0);
    const armL = group(rbox(0.18, 0.6, 0.2, shirtM, 0.07, 0, -0.28, 0), sphere(0.1, skinM, 0, -0.62, 0, 6));
    const armR = group(rbox(0.18, 0.6, 0.2, shirtM, 0.07, 0, -0.28, 0), sphere(0.1, skinM, 0, -0.62, 0, 6));
    armL.position.set(-0.4, 1.22, 0);
    armR.position.set(0.4, 1.22, 0);
    const torso = rbox(0.62, 0.66, 0.4, shirtM, 0.14, 0, 0.98, 0);
    const rip = box(0.3, 0.16, 0.02, skinM, 0.12, 0.8, 0.205);
    const head = sphere(0.29, skinM, 0, 1.56, 0.04, 10);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 4), eyeMat);
    const eyeR = eyeL.clone();
    eyeL.position.set(-0.11, 1.6, 0.3);
    eyeR.position.set(0.11, 1.58, 0.3);
    const gL = glow(0xff9a2a, 0.8);
    const gR = glow(0xff9a2a, 0.8);
    gL.position.copy(eyeL.position);
    gR.position.copy(eyeR.position);
    const body = group(torso, rip, head, eyeL, eyeR, gL, gR, legL, legR, armL, armR);
    shadow(body);
    const root = group(body);
    root.visible = false;
    this.scene.add(root);
    return {
      root, body, armL, armR, legL, legR, mats, bases: mats.map((m) => m.emissive.clone()), eyes: [gL, gR],
      hp: 3, speed: 1.3 + Math.random() * 0.9, phase: Math.random() * 6, rise: 0,
      state: 'hidden', timer: 0, flash: 0, knock: new THREE.Vector3(),
    };
  }

  startNight(n: number): void {
    this.active = true;
    this.toSpawn = 6 + 4 * (n - 1);
    this.hpPerZombie = 2 + n;
    this.spawnClock = 2;
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

  private spawn(z: Zombie, northOpen: boolean): void {
    // Ils sortent de terre hors du camp : surtout cote route, et de la foret si la porte nord est ouverte.
    const roll = Math.random();
    if (northOpen && roll < 0.3) z.root.position.set((Math.random() - 0.5) * 24, 0, -24 - Math.random() * 6);
    else if (roll < 0.8) z.root.position.set((Math.random() - 0.5) * 50, 0, 23 + Math.random() * 5);
    else z.root.position.set((Math.random() < 0.5 ? -1 : 1) * (22 + Math.random() * 6), 0, (Math.random() - 0.5) * 20);
    z.hp = this.hpPerZombie;
    z.rise = 0;
    z.state = 'rising';
    z.root.visible = true;
    z.root.scale.setScalar(1);
    z.body.rotation.set(0, 0, 0);
    z.speed = 1.3 + Math.random() * 0.9;
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

  damage(z: Zombie, dmg: number, from: THREE.Vector3): Hit | null {
    if (z.state !== 'walking') return null;
    z.hp -= dmg;
    z.flash = 1;
    const dir = z.root.position.clone().sub(from).setY(0).normalize();
    z.knock.addScaledVector(dir, 3.5);
    const pos = z.root.position.clone().setY(1.1);
    const colors = [C.zombieSkin, z.mats[1]!.color.getHex(), 0x3a2e2a];
    if (z.hp <= 0) {
      z.state = 'dying';
      z.timer = 0;
      this.kills++;
      return { pos, killed: true, colors };
    }
    return { pos, killed: false, colors };
  }

  update(dt: number, player: THREE.Vector3, walls: Segment[], solids: Circle[], nightK: number, northOpen: boolean): number {
    let contact = 0;
    if (this.active && this.toSpawn > 0) {
      this.spawnClock -= dt;
      if (this.spawnClock <= 0) {
        const free = this.zs.find((z) => z.state === 'hidden');
        if (free) {
          this.spawn(free, northOpen);
          this.toSpawn--;
        }
        this.spawnClock = 1.4;
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
      const target = waypoint(pos, player, northOpen);
      const dir = new THREE.Vector3(target.x - pos.x, 0, target.z - pos.z);
      const dist = dir.length();
      dir.normalize();
      z.phase += dt * (3 + z.speed);
      const step = z.speed * (0.7 + 0.3 * Math.abs(Math.sin(z.phase))) * dt;
      if (player.distanceTo(pos) > 0.95) pos.addScaledVector(dir, Math.min(step, dist));
      else contact++;
      pos.addScaledVector(z.knock, dt);
      z.knock.multiplyScalar(Math.exp(-8 * dt));
      this.separate(z);
      collide(pos, 0.4, walls, solids, 46);
      const want = Math.atan2(dir.x, dir.z);
      let diff = want - z.body.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      z.body.rotation.y += diff * (1 - Math.exp(-5 * dt));
      z.body.rotation.z = Math.sin(z.phase * 0.5) * 0.12;
      z.legL.rotation.x = Math.sin(z.phase) * 0.5;
      z.legR.rotation.x = -Math.sin(z.phase) * 0.5;
      z.armL.rotation.x = -1.4 + Math.sin(z.phase * 0.9) * 0.15;
      z.armR.rotation.x = -1.3 - Math.sin(z.phase * 0.8) * 0.2;
    }
    return contact;
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
