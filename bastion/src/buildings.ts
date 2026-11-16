// Les installations restaurees. Elles existent cachees ; la restauration (restore.ts)
// les fait apparaitre piece par piece a la place de leur ruine (ruins.ts).

import * as THREE from 'three';
import { C, at, blob, box, cone, cyl, glow, group, mat, mesh, rbox, shadow, uniqueMat } from './kit';
import { L } from './layout';
import { crate, drum, gasBottle, roofSheet, sandbags, sheet } from './props';

export interface Building {
  group: THREE.Group;
  /** Ce qui s'anime une fois restaure (lame de scie, vapeur, etc.). */
  anim?: (dt: number, time: number, busy: boolean) => void;
  glowMats?: THREE.MeshLambertMaterial[];
  /** Pieces qui bougent ou s'allument : jamais fusionnees avec le reste. */
  live?: THREE.Object3D[];
}

function hidden(g: THREE.Group, x: number, z: number, ry = 0): THREE.Group {
  shadow(g);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  g.visible = false;
  return g;
}

const LOG = 0x7a5a3a;
const LOG2 = 0x86643f;
const CUT = 0xd9b07a;

function logPost(x: number, z: number, h: number, r = 0.13, tone = LOG): THREE.Group {
  return group(cyl(r * 0.95, r, h, tone, 6, x, h / 2, z), cyl(r * 0.9, r * 0.9, 0.04, CUT, 6, x, h + 0.02, z));
}

export function workbench(): Building {
  const g = group(
    box(0.14, 0.9, 0.14, C.woodDark, -1.05, 0.45, -0.42), box(0.14, 0.9, 0.14, C.woodDark, 1.05, 0.45, -0.42),
    box(0.14, 0.9, 0.14, C.woodDark, -1.05, 0.45, 0.42), box(0.14, 0.9, 0.14, C.woodDark, 1.05, 0.45, 0.42),
    box(2.2, 0.08, 0.9, C.woodDark, 0, 0.3, 0),
    rbox(2.4, 0.14, 1.1, 0x7d8790, 0.03, 0, 0.95, 0),
    group(rbox(0.36, 0.22, 0.28, 0x3a5a7a, 0.04, 0.75, 1.13, 0.35), box(0.1, 0.06, 0.4, C.metal, 0.75, 1.2, 0.5)),
    box(1.9, 1.2, 0.05, 0xc8a878, 0, 1.65, -0.55),
    box(0.1, 1.6, 0.1, C.woodDark, -0.95, 1.4, -0.58), box(0.1, 1.6, 0.1, C.woodDark, 0.95, 1.4, -0.58),
  );
  // Outils accroches au panneau : scie, marteau, cles.
  g.add(box(0.6, 0.16, 0.03, C.metal, -0.45, 1.85, -0.5), box(0.06, 0.5, 0.05, C.woodDark, 0.1, 1.7, -0.5), box(0.2, 0.1, 0.06, 0x3a3a3a, 0.1, 1.95, -0.5));
  for (let i = 0; i < 3; i++) g.add(box(0.05, 0.35, 0.04, i === 1 ? 0xd94c3a : C.metal, 0.5 + i * 0.15, 1.65, -0.5));
  g.add(at(drum(0x8a3f30), 1.6, 0, 0.1), at(crate(0.5, 0x6f7a4a), -1.6, 0, 0.2));
  return { group: hidden(g, L.bench.x, L.bench.z, -Math.PI / 2) };
}

export function sawmill(): Building {
  const g = new THREE.Group();
  for (const s of [-1, 1]) for (const t of [-1, 1]) g.add(logPost(s * 1.55, t * 0.8, 2.2, 0.12, t < 0 ? LOG : LOG2));
  const beam = cyl(0.1, 0.1, 3.4, LOG, 6, 0, 2.15, -0.8);
  beam.rotation.z = Math.PI / 2;
  g.add(beam);
  const roof = roofSheet(3.8, 2.3, C.rust);
  roof.position.y = 2.35;
  roof.rotation.x = 0.12;
  g.add(roof);
  g.add(rbox(3.0, 0.85, 1.3, C.woodDark, 0.06, 0, 0.43, 0));
  g.add(box(3.2, 0.08, 1.5, C.woodLight, 0, 0.9, 0));
  const blade = group(cyl(0.55, 0.55, 0.05, 0xc9d1d8, 16, 0, 0, 0), cyl(0.12, 0.12, 0.08, 0x555555, 8, 0, 0, 0));
  blade.rotation.x = Math.PI / 2;
  blade.position.set(0, 1.15, 0);
  g.add(blade);
  g.add(group(rbox(0.8, 0.55, 0.6, 0x6f8a3a, 0.06, -1.1, 1.2, 0.2), cyl(0.1, 0.1, 0.4, 0x3a3a3a, 6, -1.1, 1.6, 0.0)));
  const dust = blob(0.5, 0xe0c08a, 1.6, 0.05, 0.9);
  dust.scale.set(1.2, 0.3, 0.8);
  g.add(dust);
  return {
    group: hidden(g, L.sawmill.x, L.sawmill.z),
    live: [blade],
    anim: (dt, _t, busy) => { blade.rotation.y += dt * (busy ? 18 : 1.5); },
  };
}

export function kitchen(): Building {
  const g = new THREE.Group();
  for (const s of [-1, 1]) for (const t of [-1, 1]) g.add(logPost(s * 1.45, t * 0.95, 2.5, 0.08));
  const roof = roofSheet(3.3, 2.3, 0x5f8a85);
  roof.position.y = 2.6;
  roof.rotation.z = 0.08;
  g.add(roof);
  // Le poele : un fut coupe, une fenetre de feu.
  const stove = drum(0x3a3a3a, false);
  stove.position.set(-0.5, 0, 0);
  g.add(stove);
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  const fire = mesh(new THREE.BoxGeometry(0.3, 0.22, 0.04), fireMat, -0.5, 0.45, 0.32);
  g.add(fire);
  const pot = group(cyl(0.45, 0.38, 0.55, 0x2f2f2f, 12, 0, 0, 0), cyl(0.4, 0.4, 0.04, 0xe08a3a, 12, 0, 0.26, 0));
  pot.position.set(-0.5, 1.2, 0);
  g.add(pot);
  g.add(cyl(0.1, 0.1, 2.0, 0x4a4a4a, 8, -0.95, 1.8, -0.2));
  g.add(rbox(1.3, 0.85, 0.8, C.woodDark, 0.05, 0.8, 0.43, 0), box(1.4, 0.06, 0.9, 0xc8a878, 0.8, 0.88, 0));
  g.add(at(gasBottle(), 1.7, 0, -0.6), at(crate(0.45, C.woodLight), 1.2, 0.9, 0.05, 0.3));
  for (let i = 0; i < 4; i++) g.add(cone(0.06, 0.25, 0xff8a2a, 5, 1.05 + i * 0.08, 1.4, 0.1 - i * 0.04));
  const steam: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const p = blob(0.16, mat(0xffffff, { opacity: 0.55 }), -0.5, 1.6 + i * 0.3, 0);
    p.castShadow = false;
    g.add(p);
    steam.push(p);
  }
  return {
    group: hidden(g, L.kitchen.x, L.kitchen.z),
    glowMats: [fireMat],
    live: [fire, ...steam],
    anim: (dt, t, busy) => {
      steam.forEach((p, i) => {
        const k = ((t * 0.6 + i / 4) % 1);
        p.position.y = 1.55 + k * 1.3;
        p.position.x = -0.5 + Math.sin(t * 2 + i) * 0.15;
        p.scale.setScalar(busy ? 0.6 + k * 1.2 : 0.001);
      });
      fireMat.emissiveIntensity = busy ? 1 + Math.sin(t * 20) * 0.3 : 0.3;
      void dt;
    },
  };
}

export interface Tower extends Building { light: THREE.SpotLight; muzzle: THREE.Vector3 }

export function watchTower(scene: THREE.Scene): Tower {
  const g = new THREE.Group();
  const legH = 4.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = cyl(0.15, 0.17, legH, sx * sz > 0 ? LOG : LOG2, 6, sx * 0.9, legH / 2, sz * 0.9);
    leg.rotation.z = sx * -0.05;
    leg.rotation.x = sz * 0.05;
    g.add(leg);
  }
  for (const y of [1.3, 2.7]) {
    const b1 = cyl(0.07, 0.07, 2.2, LOG, 5, 0, y, 0.92);
    b1.rotation.z = Math.PI / 2 - 0.55;
    const b2 = b1.clone();
    b2.position.z = -0.92;
    b2.rotation.z = Math.PI / 2 + 0.55;
    g.add(b1, b2);
  }
  g.add(rbox(2.7, 0.2, 2.7, C.wood, 0.04, 0, legH, 0));
  // Parapet en pieux, comme la palissade, et sacs de sable.
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const o = -1.2 + i * 0.4;
      g.add(group(cyl(0.1, 0.1, 0.9, i % 2 ? LOG : LOG2, 5, o, legH + 0.55, s * 1.25), cone(0.1, 0.25, CUT, 5, o, legH + 1.12, s * 1.25)));
      g.add(group(cyl(0.1, 0.1, 0.9, i % 2 ? LOG2 : LOG, 5, s * 1.25, legH + 0.55, o), cone(0.1, 0.25, CUT, 5, s * 1.25, legH + 1.12, o)));
    }
  }
  g.add(at(sandbags(1.2, 2, 21), 0.4, legH + 0.1, 1.0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.1, 1.6, 0.1, C.woodDark, sx * 1.2, legH + 0.9, sz * 1.2));
  const roof = roofSheet(3.0, 3.0, 0x6f7a4a);
  roof.position.y = legH + 1.75;
  roof.rotation.x = -0.15;
  g.add(roof);
  for (let i = 0; i < 8; i++) g.add(box(0.7, 0.06, 0.06, C.woodLight, 0, 0.4 + i * 0.5, 1.15));
  // Le garde, fusil a l'epaule.
  const guard = group(
    rbox(0.5, 0.55, 0.35, 0x6b7f4a, 0.12, 0, legH + 0.75, 0),
    blob(0.24, C.skin, 0, legH + 1.25, 0),
    cyl(0.26, 0.28, 0.16, 0x4a5a3a, 8, 0, legH + 1.43, 0),
    box(0.06, 0.06, 0.8, 0x3a3a3a, 0.3, legH + 0.9, 0.2),
  );
  g.add(guard);
  const lampMat = uniqueMat(0xfff7d6, 0xfff2cc);
  lampMat.emissiveIntensity = 0;
  const lamp = group(cyl(0.22, 0.3, 0.4, 0x3a3a3a, 8, 0, 0, 0), mesh(new THREE.CircleGeometry(0.2, 10), lampMat, 0, -0.21, 0));
  (lamp.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
  lamp.rotation.x = -0.9;
  lamp.position.set(-0.9, legH + 1.0, 1.2);
  g.add(lamp);
  const light = new THREE.SpotLight(0xfff2cc, 0, 30, 0.45, 0.5, 1.2);
  light.position.set(-0.9, legH + 1.0, 1.3);
  light.target.position.set(-6, 0, 6);
  g.add(light, light.target);
  const t = hidden(g, L.tower.x, L.tower.z);
  scene.add(t);
  return { group: t, light, glowMats: [lampMat], live: [lamp], muzzle: new THREE.Vector3(L.tower.x + 0.3, legH + 1.0, L.tower.z + 0.4) };
}

export function shelter(): Building {
  const g = new THREE.Group();
  // Le conteneur repeint, une vraie porte, une fenetre allumee, un auvent.
  g.add(box(4.2, 2.3, 2.2, 0x4f7f7a, 0, 1.15, 0));
  for (let i = 0; i < 12; i++) g.add(box(0.06, 2.2, 0.06, 0x3f6662, -2 + i * 0.36, 1.15, 1.12));
  g.add(box(4.3, 0.12, 2.3, 0x3f6662, 0, 2.33, 0));
  g.add(rbox(1.0, 1.9, 0.1, C.wood, 0.03, 0.9, 0.95, 1.15), blob(0.05, 0xd9b44a, 0.55, 1.0, 1.22));
  const winMat = uniqueMat(0xfff0c0, 0xffc870);
  winMat.emissiveIntensity = 0;
  const win = mesh(new THREE.BoxGeometry(0.9, 0.6, 0.05), winMat, -1.0, 1.5, 1.14);
  g.add(win);
  g.add(box(1.0, 0.08, 0.1, C.woodDark, -1.0, 1.84, 1.16), box(0.08, 0.6, 0.06, C.woodDark, -1.0, 1.5, 1.17));
  const awning = sheet(2.6, 1.4, 0xb9874a);
  awning.rotation.x = Math.PI / 2 - 0.35;
  awning.position.set(-0.3, 2.2, 1.15);
  g.add(awning);
  g.add(cyl(0.05, 0.05, 1.9, C.woodDark, 5, -1.5, 0.95, 2.3), cyl(0.05, 0.05, 1.9, C.woodDark, 5, 0.9, 0.95, 2.3));
  g.add(at(sandbags(1.4, 2, 31), -1.4, 0, 2.0));
  g.add(cyl(0.04, 0.04, 1.4, C.metal, 5, 1.8, 3.0, -0.6), box(0.6, 0.35, 0.03, 0xe8b84a, 2.1, 3.5, -0.6));
  g.add(at(crate(0.55), 2.5, 0, 0.9), at(crate(0.45, C.woodLight), 2.5, 0.55, 0.9, 0.4));
  return { group: hidden(g, L.shelter.x, L.shelter.z, -0.5), glowMats: [winMat], live: [win] };
}

/** Le bus : epave rouillee au depart, il se refait une beaute a chaque etape. */
export class Bus {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly rustBits: THREE.Object3D[] = [];
  private readonly wheels: THREE.Mesh[] = [];
  readonly lights: THREE.Sprite[] = [];
  private readonly smoke: THREE.Mesh[] = [];
  stage = 0;
  driving = 0;

  constructor(scene: THREE.Scene) {
    const g = this.root;
    const bodyMat = uniqueMat(0x9a6a3a);
    this.body = rbox(6.4, 2.0, 2.3, bodyMat, 0.3, 0, 1.45, 0);
    g.add(this.body);
    g.add(rbox(6.45, 0.25, 2.35, uniqueMat(0x6a4a2a), 0.08, 0, 0.6, 0));
    for (let i = 0; i < 5; i++) {
      for (const s of [-1, 1]) g.add(rbox(0.9, 0.7, 0.05, 0x4a5d6e, 0.06, -2.4 + i * 1.15, 1.85, s * 1.16));
    }
    g.add(rbox(0.06, 0.9, 1.9, 0x4a5d6e, 0.05, 3.22, 1.75, 0));
    for (const [wx, wz] of [[-2.1, 1.1], [2.1, 1.1], [-2.1, -1.1], [2.1, -1.1]] as const) {
      const w = cyl(0.5, 0.5, 0.35, 0x2a2a2a, 12, wx, 0.5, wz);
      w.rotation.x = Math.PI / 2;
      w.scale.z = 0.75;
      g.add(w);
      this.wheels.push(w);
    }
    // Rouille et vegetation qui disparaitront avec les reparations.
    const r = [blob(0.6, C.leaf, -1.5, 2.55, 0.4), blob(0.5, C.leafDark, 1.2, 2.5, -0.5), blob(0.45, C.leafLight, 2.8, 1.0, 1.1),
      rbox(1.2, 0.6, 0.05, C.rustDark, 0.05, 0.4, 1.2, 1.17), rbox(0.9, 0.5, 0.05, C.rustDark, 0.05, -2.2, 1.0, -1.17)];
    for (const b of r) { g.add(b); this.rustBits.push(b); }
    for (const s of [-1, 1]) {
      const l = glow(0xfff2b0, 1.6);
      l.position.set(3.3, 1.0, s * 0.8);
      g.add(l);
      this.lights.push(l);
    }
    for (let i = 0; i < 3; i++) {
      const p = blob(0.25, mat(0x9a9a9a, { opacity: 0.6 }), -3.4, 0.6, 0.7);
      p.castShadow = false;
      p.visible = false;
      g.add(p);
      this.smoke.push(p);
    }
    shadow(g);
    g.position.set(L.bus.x, 0, L.bus.z);
    scene.add(g);
  }

  setStage(stage: number): void {
    this.stage = stage;
    if (stage >= 1) for (const s of this.smoke) s.visible = true;
    if (stage >= 2) {
      for (const b of this.rustBits) b.visible = false;
      (this.body.material as THREE.MeshLambertMaterial).color.setHex(0xf2b632);
      for (const w of this.wheels) w.scale.z = 1;
    }
  }

  update(dt: number, time: number): void {
    this.smoke.forEach((p, i) => {
      if (!p.visible) return;
      const k = (time * 0.8 + i / 3) % 1;
      p.position.set(-3.4 - k * 0.8, 0.6 + k * 1.2, 0.7);
      p.scale.setScalar(0.5 + k * 1.5);
    });
    for (const l of this.lights) (l.material as THREE.SpriteMaterial).opacity = this.stage >= 3 ? 0.9 : 0;
    if (this.driving > 0) {
      this.driving += dt;
      const v = Math.min(12, this.driving * 5);
      this.root.position.x += v * dt;
      for (const w of this.wheels) w.rotation.y += v * dt * 2;
    }
  }
}
