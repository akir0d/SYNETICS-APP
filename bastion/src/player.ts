// Le survivant : modele, marche, pile sur le dos, outils, lampe torche.

import * as THREE from 'three';
import { Stack } from './carry';
import { armParts, fuseAll, headParts, legParts, onFront, oval, torsoParts, type Fused } from './humans';
import { C, box, cone, cyl, damp, group, lathe, lookMat, pill, plank, sphere, type Profile } from './kit';
import { collide, type Circle, type Segment } from './physics';

export type Tool = 'none' | 'axe' | 'hammer' | 'pick' | 'gun';
export type Weapon = 'rifle' | 'shotgun' | 'crossbow';

/** Le heros est un peu plus grand que les autres survivants. */
const FIG = 1.05;
const HURT = new THREE.Color(0.55, 0.1, 0.06);

const PACK: Profile = [[0, 0.82], [0.18, 0.82], [0.23, 0.86], [0.25, 0.95], [0.25, 1.17], [0.22, 1.26], [0.14, 1.305], [0, 1.315]];
const ROLL: Profile = [[0, -0.28], [0.06, -0.27], [0.078, -0.235], [0.078, 0.235], [0.06, 0.27], [0, 0.28]];
const HANDLE = (len: number, r: number): Profile => [[0, -0.1], [r * 0.9, -0.095], [r, -0.06], [r * 0.85, len * 0.6], [r * 0.95, len - 0.03], [0, len]];
const GRIP: Profile = [[0.04, -0.09], [0.044, -0.05], [0.044, 0.05], [0.04, 0.09]];

/** Un assemblage fusionne en un maillage (couleurs de sommets) ; cree une seule fois. */
function solid(o: THREE.Object3D): THREE.Object3D {
  const f: Fused = fuseAll(o);
  const g = new THREE.Group();
  if (f.colored) g.add(f.colored);
  for (const t of f.tinted) g.add(t);
  return g;
}

/** Manche d'outil le long de +z (le poing en 0). */
function handle(len: number, r: number, color: number): THREE.Group {
  const h = lathe(HANDLE(len, r), color, 0, 0, 0, 8);
  const grip = lathe(GRIP, 0x4a3226, 0, 0, 0, 8);
  const g = group(h, grip);
  g.rotation.x = Math.PI / 2;
  return group(g);
}

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
  // Materiaux propres au joueur : les tenues les recolorent (nuances dans les sommets).
  private readonly jacketMat = lookMat({ color: C.jacket, vertexColors: true });
  private readonly capMat = lookMat({ color: C.cap, vertexColors: true });
  private readonly pantsMat = lookMat({ color: C.jeans, vertexColors: true });
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
  private flashShown = 0;

  constructor() {
    const b = this.body;
    // Gabarit commun aux survivants, un peu agrandi : hanches a 0.7, epaules a 1.28.
    const fig = new THREE.Group();
    fig.scale.setScalar(FIG);
    b.add(fig);
    const boot = 0x5a3a22;
    const leg = (): THREE.Object3D => solid(legParts({ pants: this.pantsMat, shoe: boot, boots: true }));
    this.legL = leg();
    this.legR = leg();
    this.legL.position.set(-0.16, 0.66, 0);
    this.legR.position.set(0.16, 0.66, 0);
    const arm = (): THREE.Object3D => {
      return solid(armParts({ sleeve: this.jacketMat, skin: C.skin, glove: 0x6a4a32 }));
    };
    this.armL = arm();
    this.armR = arm();
    this.armL.position.set(-0.4, 1.22, 0);
    this.armR.position.set(0.4, 1.22, 0);

    const torso = torsoParts({ shirt: this.jacketMat, pants: this.pantsMat, style: 0 });
    const head = headParts({ skin: C.skin, hair: 0x5a3420, hairStyle: 0, hat: { tint: this.capMat, style: 2 } });
    head.position.set(0, 1.56, 0);
    fig.add(solid(group(torso, head, this.backpack())), this.legL, this.legR, this.armL, this.armR);

    // Outils tenus dans la main droite, un seul visible a la fois (le long de +z depuis le poing).
    const steel = 0x9aa3ab;
    const edge = 0xdfe5e8;
    const axe = solid(group(
      handle(0.66, 0.034, C.woodLight),
      plank(0.05, 0.28, 0.17, steel, 0, 0.1, 0.58),
      box(0.056, 0.05, 0.19, edge, 0, 0.245, 0.58),
      box(0.07, 0.08, 0.1, 0x6f777e, 0, -0.02, 0.58),
    ));
    const hammer = solid(group(
      handle(0.52, 0.03, C.woodDark),
      cyl(0.066, 0.066, 0.28, 0x6f777e, 10, 0, 0, 0.5),
      cyl(0.072, 0.072, 0.05, 0x8d969d, 10, 0, 0.12, 0.5),
    ));
    const spike = (s: number): THREE.Mesh => {
      const c = cone(0.04, 0.3, 0x7a8288, 10, 0, s * 0.18, 0.55);
      c.rotation.x = s > 0 ? -0.3 : Math.PI + 0.3;
      return c;
    };
    const pick = solid(group(
      handle(0.6, 0.03, C.woodDark),
      plank(0.08, 0.1, 0.1, 0x5f676d, 0, 0, 0.58), spike(1), spike(-1),
    ));
    const rifle = solid(group(
      plank(0.07, 0.13, 0.3, 0x7a4a2a, 0, -0.04, -0.13),
      box(0.075, 0.09, 0.24, 0x3a3d40, 0, 0, 0.1),
      plank(0.068, 0.06, 0.22, 0x8a5a32, 0, -0.025, 0.3),
      barrel(0.022, 0.5, 0x2e3134, 0, 0.012, 0.46),
      barrel(0.028, 0.16, 0x23262a, 0, 0.075, 0.08),
    ));
    const shotgun = solid(group(
      plank(0.08, 0.14, 0.32, 0x6a3a1a, 0, -0.05, -0.13),
      box(0.1, 0.1, 0.2, 0x2b2b2b, 0, 0, 0.1),
      barrel(0.026, 0.46, 0x34373a, -0.027, 0.012, 0.42),
      barrel(0.026, 0.46, 0x34373a, 0.027, 0.012, 0.42),
      plank(0.11, 0.07, 0.2, 0x9a6a3a, 0, -0.04, 0.32),
    ));
    const limb = (s: number): THREE.Mesh => {
      const l = pill(0.026, 0.018, 0.4, 0x3a3a3a, s * 0.17, 0, 0.47);
      l.rotation.z = s * (Math.PI / 2 - 0.35);
      return l;
    };
    const crossbow = solid(group(
      plank(0.08, 0.09, 0.66, 0x6a4a2a, 0, 0, 0.2),
      limb(1), limb(-1),
      box(0.62, 0.012, 0.012, 0xe8dcc0, 0, 0.02, 0.4),
      barrel(0.012, 0.5, 0xd9b07a, 0, 0.055, 0.3),
      box(0.05, 0.03, 0.06, 0xd94a3a, 0, 0.06, 0.08),
    ));
    this.tools = { axe, hammer, pick };
    this.guns = { rifle, shotgun, crossbow };
    for (const t of [axe, hammer, pick]) {
      t.position.set(0, -0.565, 0.03);
      t.visible = false;
      this.armR.add(t);
    }
    // Les armes suivent l'axe du bras : bras tendu pour viser, canon vers l'avant.
    for (const t of [rifle, shotgun, crossbow]) {
      t.position.set(0, -0.565, 0.04);
      t.rotation.x = Math.PI / 2;
      t.visible = false;
      this.armR.add(t);
    }

    // La pile s'appuie sur le cadre du sac, sans traverser le dos ni la tete.
    this.stack.root.position.set(0, 0.95, -0.52);
    b.add(this.stack.root);

    this.flashlight.position.set(0.3, 1.3, 0.3);
    this.flashlight.target.position.set(0, 0, 6);
    b.add(this.flashlight, this.flashlight.target);

    b.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.root.add(b);
    const blobShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = 0.02;
    this.root.add(blobShadow);
  }

  /** Sac a dos de survivant : corps rond, rabat, poche, couchage roule, cadre de portage. */
  private backpack(): THREE.Group {
    const canvas = 0x8a5a32;
    const g = group(
      oval(lathe(PACK, canvas, 0, 0, -0.31, 10), 0.42),
      plank(0.4, 0.2, 0.07, 0x75492a, 0, 1.2, -0.39),
      box(0.07, 0.03, 0.03, 0xd9b24a, 0, 1.11, -0.43),
    );
    const roll = lathe(ROLL, C.olive, 0, 0.8, -0.33, 10);
    roll.rotation.z = Math.PI / 2;
    g.add(roll);
    // Bretelles sur la poitrine.
    for (const s of [-1, 1]) {
      const z = onFront(0.2, 0.31);
      const strap = box(0.07, 0.42, 0.018, 0x4a3426, s * 0.2, 1.05, z.z + 0.008);
      strap.rotation.y = s * z.ry;
      const over = box(0.07, 0.018, 0.3, 0x4a3426, s * 0.17, 1.28, -0.06);
      over.rotation.z = -s * 0.35;
      g.add(strap, over);
      // Montants du cadre ou s'appuie la pile.
      g.add(cyl(0.024, 0.024, 0.78, C.woodDark, 8, s * 0.2, 1.2, -0.44));
    }
    const bar = cyl(0.022, 0.022, 0.44, C.woodDark, 8, 0, 0.86, -0.44);
    bar.rotation.z = Math.PI / 2;
    g.add(bar);
    // Lampe torche sur la bretelle droite.
    const lamp = cyl(0.042, 0.048, 0.13, 0x2e3134, 8, 0.2, 1.18, 0.23);
    lamp.rotation.x = Math.PI / 2;
    const lens = sphere(0.034, 0xfff1c0, 0.2, 1.18, 0.29, -6);
    lens.scale.z = 0.4;
    g.add(lamp, lens);
    return g;
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
      // L'autre main soutient l'arme.
      this.armL.rotation.x = -1.2;
    } else {
      this.armR.rotation.x = sw * swingArm - (carrying ? 0.25 : 0);
    }
    this.body.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.08 * k + Math.sin(time * 2.2) * 0.012;
    this.body.rotation.z = Math.sin(this.walkPhase) * 0.04 * k;
    this.stack.update(dt, k, this.walkPhase);

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    // Flash de degat : la tenue rougeoit un instant.
    if (this.hurtFlash > 0 || this.flashShown > 0) {
      const f = this.hurtFlash;
      for (const m of [this.jacketMat, this.capMat, this.pantsMat]) m.emissive.copy(HURT).multiplyScalar(f);
      this.flashShown = f;
    }
  }
}

/** Canon (cylindre couche le long de +z). */
function barrel(r: number, len: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const c = cyl(r, r, len, color, 8, x, y, z);
  c.rotation.x = Math.PI / 2;
  return c;
}
