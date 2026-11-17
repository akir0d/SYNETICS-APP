// Le survivant : modele, marche, pile sur le dos, outils, lampe torche.

import * as THREE from 'three';
import { Stack } from './carry';
import { C, box, cone, cyl, damp, group, rbox, shadow, sphere } from './kit';
import { collide, type Circle, type Segment } from './physics';

export type Tool = 'none' | 'axe' | 'hammer' | 'pick' | 'gun';
export type Weapon = 'rifle' | 'shotgun' | 'crossbow';

export class Player {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly flashlight = new THREE.SpotLight(0xfff4d6, 0, 20, 0.5, 0.45, 1.3);
  readonly stack = new Stack(8);
  private readonly legL: THREE.Object3D;
  private readonly legR: THREE.Object3D;
  private readonly armL: THREE.Object3D;
  private readonly armR: THREE.Object3D;
  private readonly tools: Record<Exclude<Tool, 'none' | 'gun'>, THREE.Object3D>;
  private readonly guns: Record<Weapon, THREE.Object3D>;
  /** Arme en main quand on tire. */
  weapon: Weapon = 'rifle';
  // Materiaux propres au joueur : les tenues les recolorent.
  private readonly jacketMat = new THREE.MeshLambertMaterial({ color: C.jacket, flatShading: true });
  private readonly capMat = new THREE.MeshLambertMaterial({ color: C.cap, flatShading: true });
  private readonly pantsMat = new THREE.MeshLambertMaterial({ color: C.jeans, flatShading: true });
  private walkPhase = 0;
  /** 0..1 pendant un coup de hache ou de marteau. */
  swing = 0;
  tool: Tool = 'none';
  speed = 0;
  speedMul = 1;
  heading = Math.PI;
  aiming: THREE.Vector3 | null = null;
  hp = 100;
  maxHp = 100;
  hurtFlash = 0;

  constructor() {
    const b = this.body;
    this.legL = group(box(0.24, 0.6, 0.26, this.pantsMat, 0, -0.3, 0), box(0.28, 0.14, 0.36, 0x5a3a22, 0, -0.62, 0.05));
    this.legR = group(box(0.24, 0.6, 0.26, this.pantsMat, 0, -0.3, 0), box(0.28, 0.14, 0.36, 0x5a3a22, 0, -0.62, 0.05));
    this.legL.position.set(-0.17, 0.7, 0);
    this.legR.position.set(0.17, 0.7, 0);
    this.armL = group(rbox(0.2, 0.55, 0.22, this.jacketMat, 0.08, 0, -0.26, 0), sphere(0.11, C.skin, 0, -0.58, 0, 8));
    this.armR = group(rbox(0.2, 0.55, 0.22, this.jacketMat, 0.08, 0, -0.26, 0), sphere(0.11, C.skin, 0, -0.58, 0, 8));
    this.armL.position.set(-0.42, 1.28, 0);
    this.armR.position.set(0.42, 1.28, 0);

    const torso = rbox(0.68, 0.66, 0.42, this.jacketMat, 0.16, 0, 1.02, 0);
    const zip = box(0.04, 0.5, 0.02, 0xdfe8f2, 0, 1.02, 0.215);
    const head = sphere(0.3, C.skin, 0, 1.62, 0, 14);
    const hair = sphere(0.31, 0x5a3420, 0, 1.66, -0.04, 12);
    hair.scale.set(1, 0.85, 1);
    const cap = sphere(0.32, this.capMat, 0, 1.7, 0, 12);
    cap.scale.set(1, 0.62, 1);
    const brim = cyl(0.26, 0.26, 0.05, this.capMat, 10, 0, 1.68, 0.24);
    brim.scale.z = 0.7;
    const eyes = group(sphere(0.04, 0x2a1a10, -0.1, 1.62, 0.27, 6), sphere(0.04, 0x2a1a10, 0.1, 1.62, 0.27, 6));
    const pack = rbox(0.5, 0.56, 0.24, 0x8a5a32, 0.1, 0, 1.05, -0.32);
    b.add(torso, zip, head, hair, cap, brim, eyes, pack, this.legL, this.legR, this.armL, this.armR);

    // Outils tenus dans la main droite, un seul visible a la fois.
    const axe = group(
      cyl(0.04, 0.04, 0.8, C.woodLight, 6, 0, 0, 0.3),
      rbox(0.06, 0.28, 0.2, 0x9aa3ab, 0.02, 0, 0.1, 0.62),
    );
    (axe.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
    const hammer = group(
      cyl(0.035, 0.035, 0.6, C.woodDark, 6, 0, 0, 0.22),
      rbox(0.12, 0.12, 0.26, 0x6f777e, 0.02, 0, 0, 0.5),
    );
    (hammer.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
    (hammer.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
    const rifle = group(box(0.08, 0.1, 0.7, 0x3a3a3a, 0, 0, 0.3), box(0.1, 0.14, 0.32, 0x7a4a2a, 0, -0.03, -0.12), cone(0.03, 0.06, 0x222222, 5, 0, 0, 0.66));
    const shotgun = group(
      box(0.13, 0.12, 0.55, 0x2b2b2b, 0, 0, 0.26), box(0.12, 0.16, 0.36, 0x6a3a1a, 0, -0.04, -0.12),
      box(0.12, 0.08, 0.22, 0x8a5a30, 0, -0.07, 0.28),
    );
    const crossbow = group(
      box(0.08, 0.08, 0.66, 0x6a4a2a, 0, 0, 0.22), box(0.7, 0.05, 0.06, 0x3a3a3a, 0, 0, 0.48),
      box(0.03, 0.03, 0.5, 0xd9b07a, 0, 0.05, 0.3),
    );
    const pick = group(
      cyl(0.035, 0.035, 0.75, C.woodDark, 6, 0, 0, 0.28),
      rbox(0.07, 0.07, 0.6, 0x7a8288, 0.02, 0, 0, 0.6),
    );
    (pick.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
    (pick.children[1] as THREE.Mesh).rotation.y = Math.PI / 2;
    this.tools = { axe, hammer, pick };
    this.guns = { rifle, shotgun, crossbow };
    for (const t of [axe, hammer, pick, rifle, shotgun, crossbow]) {
      t.position.set(0, -0.58, 0.05);
      t.visible = false;
      this.armR.add(t);
    }

    this.stack.root.position.set(0, 1.38, -0.46);
    b.add(this.stack.root);

    this.flashlight.position.set(0.3, 1.3, 0.3);
    this.flashlight.target.position.set(0, 0, 6);
    b.add(this.flashlight, this.flashlight.target);

    this.root.add(shadow(b));
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

  setTool(t: Tool): void {
    if (t === this.tool) return;
    this.tool = t;
    this.refreshTools();
  }

  setWeapon(w: Weapon): void {
    this.weapon = w;
    this.refreshTools();
  }

  private refreshTools(): void {
    for (const [k, o] of Object.entries(this.tools)) o.visible = k === this.tool;
    for (const [k, o] of Object.entries(this.guns)) o.visible = this.tool === 'gun' && k === this.weapon;
  }

  /** Change de tenue : veste, casquette, pantalon. */
  setOutfit(jacket: number, cap: number, pants: number): void {
    this.jacketMat.color.setHex(jacket);
    this.capMat.color.setHex(cap);
    this.pantsMat.color.setHex(pants);
  }

  /** Lance un coup d'outil ; renvoie false s'il y en a deja un en cours. */
  strike(): boolean {
    if (this.swing > 0) return false;
    this.swing = 1;
    return true;
  }

  faceTowards(x: number, z: number, dt: number): void {
    const want = Math.atan2(x - this.root.position.x, z - this.root.position.z);
    let diff = want - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * (1 - Math.exp(-16 * dt));
  }

  update(dt: number, move: THREE.Vector2, walls: Segment[], solids: Circle[], bounds: number, time: number): void {
    const len = Math.min(1, move.length());
    const maxSpeed = 6.2 * this.speedMul;
    this.speed = damp(this.speed, len * maxSpeed, 12, dt);
    if (len > 0.05) {
      const want = Math.atan2(move.x, move.y);
      let diff = want - this.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (!this.aiming) this.heading += diff * (1 - Math.exp(-14 * dt));
      const p = this.root.position;
      const k = this.speed * dt * Math.min(1, len * 1.3) / Math.max(len, 1e-6);
      p.x += move.x * k;
      p.z += move.y * k;
    }
    if (this.aiming) this.faceTowards(this.aiming.x, this.aiming.z, dt);
    collide(this.root.position, 0.45, walls, solids, bounds);
    this.body.rotation.y = this.heading;

    const k = this.speed / maxSpeed;
    this.walkPhase += dt * (4 + this.speed * 1.6);
    const sw = Math.sin(this.walkPhase) * 0.75 * k;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    const carrying = this.stack.count > 0;
    const swingArm = carrying ? 0.3 : 0.8;
    this.armL.rotation.x = -sw * swingArm - (carrying ? 0.25 : 0);
    if (this.swing > 0) {
      // Coup d'outil : on arme vers l'arriere puis on abat vers l'avant.
      this.swing = Math.max(0, this.swing - dt * 3.2);
      const t = 1 - this.swing;
      this.armR.rotation.x = t < 0.45 ? -2.6 * (t / 0.45) : -2.6 + ((t - 0.45) / 0.55) * 2.9;
    } else if (this.aiming) {
      this.armR.rotation.x = -1.45;
    } else {
      this.armR.rotation.x = sw * swingArm - (carrying ? 0.25 : 0);
    }
    this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.08 * k + Math.sin(time * 2.2) * 0.012;
    this.body.rotation.z = Math.sin(this.walkPhase) * 0.04 * k;
    this.stack.update(dt, k, this.walkPhase);

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
  }
}
