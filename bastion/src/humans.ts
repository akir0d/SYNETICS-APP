// Silhouette humaine low-poly commune : clients de l'etal et survivants recrutes.

import * as THREE from 'three';
import { C, box, cyl, group, rbox, shadow, sphere } from './kit';

export interface HumanLook {
  shirt: number;
  pants: number;
  hair: number;
  skin?: number;
  hat?: number;
  scale?: number;
}

/** Ombre au sol partagee par tous les personnages (pas de geometrie par client qui passe). */
const BLOB_GEO = new THREE.CircleGeometry(0.5, 14);
const BLOB_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false });

export class Human {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly legL: THREE.Object3D;
  readonly legR: THREE.Object3D;
  readonly armL: THREE.Object3D;
  readonly armR: THREE.Object3D;
  readonly hand: THREE.Object3D;
  phase = Math.random() * 6;
  heading = 0;
  speed = 0;

  constructor(look: HumanLook) {
    const skin = look.skin ?? C.skin;
    this.legL = group(box(0.22, 0.58, 0.24, look.pants, 0, -0.29, 0), box(0.26, 0.12, 0.34, 0x4a3020, 0, -0.6, 0.04));
    this.legR = group(box(0.22, 0.58, 0.24, look.pants, 0, -0.29, 0), box(0.26, 0.12, 0.34, 0x4a3020, 0, -0.6, 0.04));
    this.legL.position.set(-0.16, 0.66, 0);
    this.legR.position.set(0.16, 0.66, 0);
    this.armL = group(rbox(0.19, 0.54, 0.21, look.shirt, 0.07, 0, -0.25, 0), sphere(0.1, skin, 0, -0.56, 0, 8));
    this.hand = new THREE.Group();
    this.hand.position.set(0, -0.58, 0.05);
    this.armR = group(rbox(0.19, 0.54, 0.21, look.shirt, 0.07, 0, -0.25, 0), sphere(0.1, skin, 0, -0.56, 0, 8), this.hand);
    this.armL.position.set(-0.4, 1.22, 0);
    this.armR.position.set(0.4, 1.22, 0);
    const head = sphere(0.28, skin, 0, 1.56, 0, 12);
    const hair = sphere(0.29, look.hair, 0, 1.62, -0.04, 10);
    hair.scale.set(1, 0.8, 1);
    const eyes = group(sphere(0.035, 0x2a1a10, -0.09, 1.57, 0.26, 6), sphere(0.035, 0x2a1a10, 0.09, 1.57, 0.26, 6));
    this.body.add(rbox(0.62, 0.64, 0.4, look.shirt, 0.15, 0, 0.98, 0), head, hair, eyes, this.legL, this.legR, this.armL, this.armR);
    if (look.hat !== undefined) {
      const brim = cyl(0.42, 0.42, 0.04, look.hat, 12, 0, 1.74, 0);
      const crown = cyl(0.24, 0.28, 0.22, look.hat, 10, 0, 1.86, 0);
      this.body.add(brim, crown);
    }
    this.root.add(shadow(this.body));
    const blobShadow = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = 0.02;
    this.root.add(blobShadow);
    this.root.scale.setScalar(look.scale ?? 1);
  }

  /** Avance vers une cible ; renvoie true une fois arrive. */
  walkTo(target: THREE.Vector3, maxSpeed: number, dt: number, stop = 0.15): boolean {
    const p = this.root.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) {
      this.speed = Math.max(0, this.speed - dt * 12);
      return true;
    }
    this.speed = Math.min(maxSpeed, this.speed + dt * 14);
    const step = Math.min(d, this.speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    this.face(Math.atan2(dx, dz), dt);
    return false;
  }

  face(angle: number, dt: number): void {
    let diff = angle - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * (1 - Math.exp(-12 * dt));
    this.body.rotation.y = this.heading;
  }

  animate(dt: number, carrying: boolean, working = 0): void {
    const k = Math.min(1, this.speed / 4);
    this.phase += dt * (4 + this.speed * 1.6);
    const sw = Math.sin(this.phase) * 0.7 * k;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    const swing = carrying ? 0.3 : 0.7;
    this.armL.rotation.x = -sw * swing - (carrying ? 0.2 : 0);
    this.armR.rotation.x = working > 0 ? -2.2 + Math.sin(working * Math.PI) * 2.0 : sw * swing - (carrying ? 0.2 : 0);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.07 * k;
  }
}
