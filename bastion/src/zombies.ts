// Les visiteurs de la nuit : lents, maladroits, plus comiques que gores.

import * as THREE from 'three';
import { C, box, glow, group, rbox, shadow, sphere, uniqueMat } from './kit';
import { CAMP, type Segment } from './world';

const WHITE = new THREE.Color(0xffffff);
const SHIRTS = [0x7a6a8f, 0x8f5a4a, 0x5a7a8f, 0x8a8a5a, 0x6a8f6a];

interface Z {
  root: THREE.Group;
  body: THREE.Group;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  mats: THREE.MeshLambertMaterial[];
  eyes: THREE.Sprite[];
  hp: number;
  speed: number;
  phase: number;
  /** 0 = sous terre, 1 = debout. */
  rise: number;
  state: 'hidden' | 'rising' | 'walking' | 'dying';
  timer: number;
  flash: number;
  knock: THREE.Vector3;
}

export interface Hit { pos: THREE.Vector3; killed: boolean; colors: number[] }

export class Horde {
  private readonly zs: Z[] = [];
  active = false;

  constructor(private readonly scene: THREE.Scene, count: number) {
    for (let i = 0; i < count; i++) this.zs.push(this.make(i));
  }

  private make(i: number): Z {
    const shirt = SHIRTS[i % SHIRTS.length]!;
    // Leger emissif : la silhouette reste lisible meme hors de la lampe torche.
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
    head.scale.set(1, 0.95, 1.05);
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
      root, body, armL, armR, legL, legR, mats, eyes: [gL, gR],
      hp: 3, speed: 1.3 + Math.random() * 0.9, phase: Math.random() * 6, rise: 0,
      state: 'hidden', timer: 0.5 + i * 0.6, flash: 0, knock: new THREE.Vector3(),
    };
  }

  setActive(on: boolean): void {
    this.active = on;
    for (const z of this.zs) {
      if (on && z.state === 'hidden') z.timer = 0.6 + Math.random() * 3;
      if (!on && z.state !== 'hidden') {
        z.state = 'dying';
        z.timer = 0;
      }
    }
  }

  private spawn(z: Z): void {
    // Ils sortent de terre hors du camp, surtout cote route.
    const a = Math.PI / 2 + (Math.random() - 0.5) * 2.6;
    const d = 18 + Math.random() * 10;
    z.root.position.set(Math.cos(a) * d * 1.2, 0, Math.sin(a) * d);
    z.hp = 3;
    z.rise = 0;
    z.state = 'rising';
    z.root.visible = true;
    z.root.scale.setScalar(1);
    z.body.rotation.set(0, 0, 0);
  }

  /** Zombie le plus proche, a portee de tir. */
  nearest(p: THREE.Vector3, range: number): THREE.Vector3 | null {
    let best: Z | null = null;
    let bd = range;
    for (const z of this.zs) {
      if (z.state !== 'walking') continue;
      const d = z.root.position.distanceTo(p);
      if (d < bd) {
        bd = d;
        best = z;
      }
    }
    return best ? best.root.position : null;
  }

  shoot(target: THREE.Vector3, from: THREE.Vector3): Hit | null {
    const z = this.zs.find((x) => x.root.position === target);
    if (!z || z.state !== 'walking') return null;
    z.hp -= 1;
    z.flash = 1;
    const dir = target.clone().sub(from).setY(0).normalize();
    z.knock.addScaledVector(dir, 3.5);
    const pos = target.clone().setY(1.1);
    const colors = [C.zombieSkin, z.mats[1]!.color.getHex(), 0x3a2e2a];
    if (z.hp <= 0) {
      z.state = 'dying';
      z.timer = 0;
      return { pos, killed: true, colors };
    }
    return { pos, killed: false, colors };
  }

  update(dt: number, player: THREE.Vector3, walls: Segment[], nightK: number): number {
    let contact = 0;
    for (const z of this.zs) {
      for (const e of z.eyes) (e.material as THREE.SpriteMaterial).opacity = 0.9 * nightK;
      if (z.flash > 0) {
        z.flash = Math.max(0, z.flash - dt * 7);
        for (const m of z.mats) {
          const base = m.userData.base as THREE.Color | undefined ?? (m.userData.base = m.emissive.clone());
          m.emissive.copy(base).lerp(WHITE, z.flash * 0.9);
        }
      }
      if (z.state === 'hidden') {
        if (!this.active) continue;
        z.timer -= dt;
        if (z.timer <= 0) this.spawn(z);
        continue;
      }
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
          z.timer = this.active ? 2 + Math.random() * 4 : 0;
        }
        continue;
      }

      // Marche titubante vers le joueur, en passant par l'entree du camp.
      const pos = z.root.position;
      const target = this.waypoint(pos, player);
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
      collide(pos, walls);
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

  private waypoint(pos: THREE.Vector3, player: THREE.Vector3): THREE.Vector3 {
    const inside = (p: THREE.Vector3) => p.x > CAMP.minX && p.x < CAMP.maxX && p.z > CAMP.minZ && p.z < CAMP.maxZ;
    const zIn = inside(pos);
    const pIn = inside(player);
    if (zIn === pIn) return player;
    const gateOut = new THREE.Vector3(0, 0, CAMP.maxZ + 1.6);
    const gateIn = new THREE.Vector3(0, 0, CAMP.maxZ - 1.6);
    if (!zIn) return Math.abs(pos.x) < CAMP.gate - 0.6 && pos.z > CAMP.maxZ - 0.5 ? gateIn : gateOut;
    return Math.abs(pos.x) < CAMP.gate - 0.6 && pos.z > CAMP.maxZ - 2 ? gateOut : gateIn;
  }

  private separate(z: Z): void {
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

function collide(p: THREE.Vector3, walls: Segment[]): void {
  for (const w of walls) {
    const vx = w.x2 - w.x1;
    const vz = w.z2 - w.z1;
    const l2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((p.x - w.x1) * vx + (p.z - w.z1) * vz) / l2));
    const cx = w.x1 + vx * t;
    const cz = w.z1 + vz * t;
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d < 0.5 && d > 1e-5) {
      p.x = cx + (dx / d) * 0.5;
      p.z = cz + (dz / d) * 0.5;
    }
  }
}
