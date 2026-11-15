// Le survivant : modele, marche, pile de bois sur le dos, lampe torche.

import * as THREE from 'three';
import { C, box, damp, group, rbox, shadow, sphere, cyl } from './kit';
import { logMesh, type Circle, type Segment } from './world';

export const MAX_STACK = 12;

export class Player {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly flashlight = new THREE.SpotLight(0xfff4d6, 0, 20, 0.5, 0.45, 1.3);
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  private readonly stackRoot = new THREE.Group();
  readonly stack: THREE.Object3D[] = [];
  private walkPhase = 0;
  private stackLean = 0;
  speed = 0;
  heading = 0;
  aiming: THREE.Vector3 | null = null;

  constructor() {
    const b = this.body;
    // Jambes et bras pivotent depuis la hanche et l'epaule.
    this.legL = limb(box(0.24, 0.6, 0.26, C.jeans, 0, -0.3, 0), box(0.28, 0.14, 0.36, 0x5a3a22, 0, -0.62, 0.05));
    this.legR = limb(box(0.24, 0.6, 0.26, C.jeans, 0, -0.3, 0), box(0.28, 0.14, 0.36, 0x5a3a22, 0, -0.62, 0.05));
    this.legL.position.set(-0.17, 0.7, 0);
    this.legR.position.set(0.17, 0.7, 0);
    this.armL = limb(rbox(0.2, 0.55, 0.22, C.jacket, 0.08, 0, -0.26, 0), sphere(0.11, C.skin, 0, -0.58, 0, 8));
    this.armR = limb(rbox(0.2, 0.55, 0.22, C.jacket, 0.08, 0, -0.26, 0), sphere(0.11, C.skin, 0, -0.58, 0, 8));
    this.armL.position.set(-0.42, 1.28, 0);
    this.armR.position.set(0.42, 1.28, 0);

    const torso = rbox(0.68, 0.66, 0.42, C.jacket, 0.16, 0, 1.02, 0);
    const zip = box(0.04, 0.5, 0.02, 0xdfe8f2, 0, 1.02, 0.215);
    const head = sphere(0.3, C.skin, 0, 1.62, 0, 14);
    const hair = sphere(0.31, 0x5a3420, 0, 1.66, -0.04, 12);
    hair.scale.set(1, 0.85, 1);
    const cap = sphere(0.32, C.cap, 0, 1.7, 0, 12);
    cap.scale.set(1, 0.62, 1);
    const brim = cyl(0.26, 0.26, 0.05, C.cap, 10, 0, 1.68, 0.24);
    brim.scale.z = 0.7;
    const eyes = group(sphere(0.04, 0x2a1a10, -0.1, 1.62, 0.27, 6), sphere(0.04, 0x2a1a10, 0.1, 1.62, 0.27, 6));
    const pack = rbox(0.5, 0.56, 0.24, 0x8a5a32, 0.1, 0, 1.05, -0.32);
    const roll = cyl(0.12, 0.12, 0.52, 0x4f7a3a, 8, 0, 1.38, -0.32);
    roll.rotation.z = Math.PI / 2;
    b.add(torso, zip, head, hair, cap, brim, eyes, pack, roll, this.legL, this.legR, this.armL, this.armR);

    // Fusil de chasse, visible la nuit seulement.
    const gun = group(
      box(0.08, 0.1, 0.7, 0x3a3a3a, 0, 0, 0.3),
      box(0.1, 0.14, 0.32, 0x7a4a2a, 0, -0.03, -0.12),
    );
    gun.name = 'gun';
    gun.position.set(0, -0.5, 0.1);
    gun.visible = false;
    this.armR.add(gun);

    this.stackRoot.position.set(0, 1.45, -0.42);
    b.add(this.stackRoot);

    this.flashlight.position.set(0.3, 1.3, 0.3);
    this.flashlight.target.position.set(0, 0, 6);
    this.flashlight.castShadow = false;
    b.add(this.flashlight, this.flashlight.target);

    this.root.add(shadow(b));
    // Ombre de contact douce sous les pieds : le perso « tient » au sol.
    const blobShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = 0.02;
    this.root.add(blobShadow);
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  set armed(on: boolean) {
    const gun = this.armR.getObjectByName('gun');
    if (gun) gun.visible = on;
  }

  /** Ajoute un rondin au sommet de la pile ; renvoie sa position monde de destination. */
  pushLog(): THREE.Object3D | null {
    if (this.stack.length >= MAX_STACK) return null;
    const log = logMesh();
    shadow(log);
    log.scale.setScalar(0.62);
    log.position.set(0, this.stack.length * 0.25, 0);
    this.stackRoot.add(log);
    this.stack.push(log);
    return log;
  }

  popLog(): THREE.Vector3 | null {
    const log = this.stack.pop();
    if (!log) return null;
    const p = new THREE.Vector3();
    log.getWorldPosition(p);
    this.stackRoot.remove(log);
    return p;
  }

  update(dt: number, move: THREE.Vector2, walls: Segment[], solids: Circle[], bounds: number, time: number): void {
    const len = Math.min(1, move.length());
    const target = len * 6.2;
    this.speed = damp(this.speed, target, 12, dt);
    if (len > 0.05) {
      const want = Math.atan2(move.x, move.y);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * (1 - Math.exp(-14 * dt));
      const p = this.root.position;
      p.x += (move.x / Math.max(len, 1e-6)) * this.speed * dt * Math.min(1, len * 1.3);
      p.z += (move.y / Math.max(len, 1e-6)) * this.speed * dt * Math.min(1, len * 1.3);
    }
    if (this.aiming) {
      // En tir, le haut du corps se tourne vers la cible.
      const want = Math.atan2(this.aiming.x - this.root.position.x, this.aiming.z - this.root.position.z);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.heading += diff * (1 - Math.exp(-20 * dt));
    }
    this.collide(walls, solids, bounds);
    this.body.rotation.y = this.heading;

    // Animation de marche : amplitude proportionnelle a la vitesse.
    const k = this.speed / 6.2;
    this.walkPhase += dt * (4 + this.speed * 1.6);
    const sw = Math.sin(this.walkPhase) * 0.75 * k;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    const carrying = this.stack.length > 0;
    const aimingNow = this.aiming !== null;
    // Charge sur le dos : les mains tiennent les bretelles, le balancement diminue.
    const swing = carrying ? 0.3 : 0.8;
    this.armL.rotation.x = -sw * swing - (carrying ? 0.25 : 0);
    this.armR.rotation.x = aimingNow ? -1.45 : sw * swing - (carrying ? 0.25 : 0);
    this.armL.rotation.z = carrying ? 0.12 : 0;
    this.armR.rotation.z = carrying && !aimingNow ? -0.12 : 0;
    this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.08 * k + Math.sin(time * 2.2) * 0.012;
    this.body.rotation.z = Math.sin(this.walkPhase) * 0.04 * k;

    // La pile oscille avec un peu de retard : c'est ce qui la rend vivante.
    this.stackLean = damp(this.stackLean, -k * 0.18, 6, dt);
    this.stack.forEach((log, i) => {
      const f = i / MAX_STACK;
      log.rotation.x = this.stackLean * f * 1.6 + Math.sin(this.walkPhase * 0.5 + i * 0.4) * 0.03 * k;
      log.position.z = this.stackLean * f * i * 0.25;
    });
  }

  private collide(walls: Segment[], solids: Circle[], bounds: number): void {
    const p = this.root.position;
    const R = 0.45;
    for (const s of solids) {
      const dx = p.x - s.x;
      const dz = p.z - s.z;
      const d = Math.hypot(dx, dz);
      const min = s.r + R;
      if (d < min && d > 1e-5) {
        p.x = s.x + (dx / d) * min;
        p.z = s.z + (dz / d) * min;
      }
    }
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
      const min = R + 0.12;
      if (d < min && d > 1e-5) {
        p.x = cx + (dx / d) * min;
        p.z = cz + (dz / d) * min;
      }
    }
    p.x = Math.max(-bounds, Math.min(bounds, p.x));
    p.z = Math.max(-bounds, Math.min(bounds, p.z));
  }
}

function limb(...parts: THREE.Object3D[]): THREE.Group {
  return group(...parts);
}
