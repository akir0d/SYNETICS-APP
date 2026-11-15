// Les batiments a debloquer. Chacun est construit cache et « pousse » quand on le paie.

import * as THREE from 'three';
import { C, blob, box, cone, cyl, glow, group, mat, mesh, rbox, shadow, uniqueMat } from './kit';
import { L } from './layout';

export interface Building {
  group: THREE.Group;
  /** Ce qui s'anime une fois construit (lame de scie, vapeur, etc.). */
  anim?: (dt: number, time: number, busy: boolean) => void;
  glowMats?: THREE.MeshLambertMaterial[];
}

function hidden(g: THREE.Group, x: number, z: number, ry = 0): THREE.Group {
  shadow(g);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  g.scale.setScalar(0.001);
  g.visible = false;
  return g;
}

export function northGate(): Building {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(rbox(0.36, 3.2, 0.36, C.woodDark, 0.05, s * 2.7, 1.6, 0));
    g.add(blob(0.3, C.leaf, s * 2.7, 3.3, 0.1));
  }
  g.add(rbox(6.0, 0.4, 0.4, C.wood, 0.06, 0, 3.1, 0));
  g.add(rbox(2.2, 0.5, 0.08, 0xd9a35a, 0.05, 0, 3.1, 0.24));
  // Guirlande de fanions
  const colors = [0xd94c3a, 0xffd84a, 0x5fb9a8, 0xff8fb1];
  for (let i = 0; i < 9; i++) {
    const f = cone(0.16, 0.32, colors[i % 4]!, 3, -2.3 + i * 0.575, 2.62 - Math.sin((i / 8) * Math.PI) * 0.25, 0.22);
    f.rotation.x = Math.PI;
    g.add(f);
  }
  return { group: hidden(g, L.northGate.x, L.northGate.z) };
}

export function workbench(): Building {
  const g = group(
    rbox(2.4, 0.16, 1.1, C.woodLight, 0.04, 0, 0.95, 0),
    box(0.14, 0.9, 0.14, C.woodDark, -1.05, 0.45, -0.42), box(0.14, 0.9, 0.14, C.woodDark, 1.05, 0.45, -0.42),
    box(0.14, 0.9, 0.14, C.woodDark, -1.05, 0.45, 0.42), box(0.14, 0.9, 0.14, C.woodDark, 1.05, 0.45, 0.42),
    rbox(0.5, 0.3, 0.3, 0xd94c3a, 0.05, -0.6, 1.18, 0),
    box(1.8, 1.1, 0.06, C.wood, 0, 1.6, -0.55),
    rbox(0.5, 0.14, 0.14, C.metal, 0.03, 0.5, 1.1, 0.1),
  );
  // Outils accroches au panneau
  for (let i = 0; i < 4; i++) g.add(box(0.06, 0.5, 0.06, i % 2 ? C.metal : C.woodDark, -0.6 + i * 0.4, 1.7, -0.5));
  return { group: hidden(g, L.bench.x, L.bench.z, -Math.PI / 2) };
}

export function sawmill(): Building {
  const g = new THREE.Group();
  g.add(rbox(3.2, 0.9, 1.5, C.wood, 0.06, 0, 0.45, 0));
  g.add(rbox(3.4, 0.1, 1.7, C.woodLight, 0.03, 0, 0.95, 0));
  for (const s of [-1, 1]) for (const t of [-1, 1]) g.add(box(0.12, 2.2, 0.12, C.woodDark, s * 1.55, 1.1, t * 0.8));
  const roof = box(3.8, 0.1, 2.3, 0x8a4526, 0, 2.3, 0);
  roof.rotation.x = 0.12;
  g.add(roof);
  const blade = group(cyl(0.55, 0.55, 0.05, 0xc9d1d8, 16, 0, 0, 0), cyl(0.12, 0.12, 0.08, 0x555555, 8, 0, 0, 0));
  blade.rotation.x = Math.PI / 2;
  blade.position.set(0, 1.15, 0);
  g.add(blade);
  g.add(rbox(0.8, 0.6, 0.6, 0xd9a035, 0.06, -1.1, 1.3, 0.2));
  return {
    group: hidden(g, L.sawmill.x, L.sawmill.z),
    anim: (dt, _t, busy) => { blade.rotation.y += dt * (busy ? 18 : 1.5); },
  };
}

export function kitchen(): Building {
  const g = new THREE.Group();
  g.add(rbox(2.6, 0.9, 1.4, 0xb9b1a3, 0.08, 0, 0.45, 0));
  g.add(rbox(2.8, 0.1, 1.6, C.woodLight, 0.03, 0, 0.95, 0));
  const pot = group(cyl(0.45, 0.38, 0.55, 0x3a3a3a, 12, 0, 0, 0), cyl(0.4, 0.4, 0.04, 0xe08a3a, 12, 0, 0.26, 0));
  pot.position.set(-0.5, 1.28, 0);
  g.add(pot);
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  g.add(mesh(new THREE.ConeGeometry(0.3, 0.3, 6), fireMat, -0.5, 1.0, 0));
  g.add(cyl(0.12, 0.12, 2.2, 0x5a5a5a, 8, 0.9, 1.6, -0.4));
  // Toile tendue au-dessus
  const tarp = box(3.2, 0.06, 2.2, 0xd9a35a, 0, 2.6, 0);
  tarp.rotation.z = 0.08;
  g.add(tarp);
  for (const s of [-1, 1]) for (const t of [-1, 1]) g.add(cyl(0.06, 0.06, 2.6, C.woodDark, 5, s * 1.45, 1.3, t * 0.95));
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
    const leg = box(0.18, legH, 0.18, C.woodDark, sx * 0.9, legH / 2, sz * 0.9);
    leg.rotation.z = sx * -0.05;
    leg.rotation.x = sz * 0.05;
    g.add(leg);
  }
  for (const y of [1.3, 2.7]) {
    const b1 = box(1.9, 0.1, 0.1, C.wood, 0, y, 0.92);
    b1.rotation.z = 0.5;
    const b2 = b1.clone();
    b2.position.z = -0.92;
    b2.rotation.z = -0.5;
    g.add(b1, b2);
  }
  g.add(rbox(2.6, 0.2, 2.6, C.wood, 0.04, 0, legH, 0));
  for (const s of [-1, 1]) {
    g.add(box(2.6, 0.7, 0.1, C.woodLight, 0, legH + 0.45, s * 1.25));
    g.add(box(0.1, 0.7, 2.6, C.woodLight, s * 1.25, legH + 0.45, 0));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.1, 1.5, 0.1, C.woodDark, sx * 1.2, legH + 0.85, sz * 1.2));
  const roof = cone(2.2, 1.0, 0xd94c3a, 4, 0, legH + 2.05, 0);
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  for (let i = 0; i < 8; i++) g.add(box(0.7, 0.06, 0.06, C.woodLight, 0, 0.4 + i * 0.5, 1.15));
  // Le garde : un survivant au chapeau, fusil a l'epaule.
  const guard = group(
    rbox(0.5, 0.55, 0.35, 0x6b7f4a, 0.12, 0, legH + 0.75, 0),
    blob(0.24, C.skin, 0, legH + 1.25, 0),
    cyl(0.34, 0.34, 0.04, 0x7a5a3a, 10, 0, legH + 1.42, 0),
    cyl(0.2, 0.22, 0.18, 0x7a5a3a, 8, 0, 1.0 + legH + 0.5, 0),
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
  return { group: t, light, glowMats: [lampMat], muzzle: new THREE.Vector3(L.tower.x + 0.3, legH + 1.0, L.tower.z + 0.4) };
}

export function shelter(): Building {
  const g = new THREE.Group();
  // Grande tente faite de baches recousues.
  const tent = cone(2.2, 2.4, 0x7a9a6a, 4, 0, 1.2, 0);
  tent.rotation.y = Math.PI / 4;
  tent.scale.set(1.25, 1, 1);
  g.add(tent);
  const patch = box(0.8, 0.6, 0.05, 0xd9a35a, 0.6, 0.9, 1.55);
  patch.rotation.x = -0.55;
  g.add(patch, rbox(0.9, 1.3, 0.1, 0x3a2a1a, 0.05, 0, 0.65, 1.62));
  g.add(cyl(0.05, 0.05, 0.9, C.woodDark, 5, 0, 2.7, 0));
  const flag = box(0.5, 0.3, 0.03, 0xffd84a, 0.27, 3.0, 0);
  g.add(flag);
  // Sacs de couchage et caisses
  g.add(rbox(0.6, 0.45, 0.6, C.woodLight, 0.05, 1.9, 0.22, 0.8), rbox(0.5, 0.4, 0.5, C.wood, 0.05, 1.95, 0.62, 0.8));
  const winMat = uniqueMat(0xfff0c0, 0xffc870);
  winMat.emissiveIntensity = 0;
  g.add(mesh(new THREE.SphereGeometry(0.12, 8, 6), winMat, 0, 1.4, 1.65));
  return { group: hidden(g, L.shelter.x, L.shelter.z, -0.5), glowMats: [winMat] };
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
