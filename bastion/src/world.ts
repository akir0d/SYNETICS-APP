// Le decor : un petit camp de survivants au milieu d'un monde que la nature a repris.

import * as THREE from 'three';
import { C, at, blob, box, cone, cyl, glow, group, mat, mesh, rbox, rng, shadow, sphere, uniqueMat } from './kit';

export interface Segment { x1: number; z1: number; x2: number; z2: number }
export interface Circle { x: number; z: number; r: number }

export interface NightLight {
  light: THREE.Light;
  /** Intensite de nuit (le jour, elle tombe a `day`). */
  night: number;
  day: number;
  flicker?: number;
}

export interface World {
  walls: Segment[];
  solids: Circle[];
  swayers: { o: THREE.Object3D; phase: number; amp: number }[];
  flames: THREE.Object3D[];
  nightLights: NightLight[];
  glows: { s: THREE.Sprite; night: number; day: number }[];
  bulbMats: THREE.MeshLambertMaterial[];
  windowMats: THREE.MeshLambertMaterial[];
  woodPile: { x: number; z: number; logs: THREE.Object3D[] };
  greenhouse: THREE.Group;
  tower: THREE.Group;
  towerLight: THREE.SpotLight;
  bounds: number;
}

export const CAMP = { minX: -13, maxX: 13, minZ: -11, maxZ: 11, gate: 2.6 };

export function buildWorld(scene: THREE.Scene): World {
  const w: World = {
    walls: [], solids: [], swayers: [], flames: [], nightLights: [], glows: [], bulbMats: [], windowMats: [],
    woodPile: { x: -0.8, z: -7.9, logs: [] },
    greenhouse: new THREE.Group(),
    tower: new THREE.Group(),
    towerLight: new THREE.SpotLight(0xfff2cc, 0, 30, 0.42, 0.5, 1.2),
    bounds: 42,
  };
  const r = rng(7);

  ground(scene, r);
  road(scene, r);
  fence(scene, w);
  campfire(scene, w, -0.5, 1);
  benches(scene);
  stringLights(scene, w);
  beds(scene, w, r);
  bathtub(scene, w, -10, 5.5);
  overgrownCar(scene, w, -6.5, 8, 0.5, true);
  woodPile(scene, w);
  workbench(scene, w, 3.4, -9.2);
  solarRig(scene, w, 10.5, -8.5);
  waterTank(scene, w, -10.8, -8.6);
  lampPost(scene, w, -3.8, 12.2);
  lampPost(scene, w, 3.8, 12.2);
  buildGreenhouse(w);
  scene.add(w.greenhouse);
  buildTower(scene, w);
  surroundings(scene, w, r);
  return w;
}

// ---------------------------------------------------------------- sol

function ground(scene: THREE.Scene, r: () => number): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), mat(C.grass, { flat: false }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);

  // Plaques de terre battue : le centre du camp et les allees.
  const patches: [number, number, number, number][] = [
    [-0.5, 1, 5.2, 4.6], [0, 7, 2.2, 5], [0, 13, 2.4, 3], [-6.5, -3.4, 4.6, 4.2], [-0.8, -7.6, 3.2, 2.6],
    [6.5, -6, 4, 3.4], [9.4, 6, 2.6, 2.6], [3.2, -2, 4, 1.6],
  ];
  for (const [x, z, rx, rz] of patches) {
    const shape = new THREE.Shape();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 0.85 + r() * 0.25;
      const px = Math.cos(a) * rx * k;
      const pz = Math.sin(a) * rz * k;
      if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
    }
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat(C.dirt, { flat: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.012, z);
    m.receiveShadow = true;
    scene.add(m);
  }

  // Touffes d'herbe et fleurs sauvages, en instances (un seul appel de dessin chacune).
  const inCamp = (x: number, z: number) => patches.some(([px, pz, rx, rz]) => ((x - px) / rx) ** 2 + ((z - pz) / rz) ** 2 < 1.1);
  const onRoad = (z: number) => Math.abs(z - 19) < 3.4;

  const tuftGeo = new THREE.ConeGeometry(0.12, 0.45, 4);
  tuftGeo.translate(0, 0.22, 0);
  const tufts = new THREE.InstancedMesh(tuftGeo, mat(0xffffff), 900);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const greens = [C.grassDark, C.leaf, C.grassLight, C.leafLight];
  let n = 0;
  while (n < 900) {
    const x = (r() - 0.5) * 90;
    const z = (r() - 0.5) * 90;
    if (inCamp(x, z) || (onRoad(z) && r() < 0.8)) continue;
    e.set((r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5);
    q.setFromEuler(e);
    const s = 0.6 + r() * 0.9;
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.8), s));
    tufts.setMatrixAt(n, m4);
    tufts.setColorAt(n, col.setHex(greens[Math.floor(r() * greens.length)]!));
    n++;
  }
  tufts.receiveShadow = true;
  scene.add(tufts);

  const flowerGeo = new THREE.IcosahedronGeometry(0.11, 0);
  const flowers = new THREE.InstancedMesh(flowerGeo, mat(0xffffff), 420);
  const petals = [0xffffff, 0xffd84a, 0xff8fb1, 0xc39bff, 0xff7a5c];
  n = 0;
  while (n < 420) {
    // Les fleurs poussent en massifs, plus naturel qu'une pluie uniforme.
    const cx = (r() - 0.5) * 80;
    const cz = (r() - 0.5) * 80;
    const c = petals[Math.floor(r() * petals.length)]!;
    for (let k = 0; k < 7 && n < 420; k++) {
      const x = cx + (r() - 0.5) * 2.4;
      const z = cz + (r() - 0.5) * 2.4;
      if (inCamp(x, z) || onRoad(z)) continue;
      m4.compose(new THREE.Vector3(x, 0.18 + r() * 0.12, z), q.identity(), new THREE.Vector3(1, 0.7, 1));
      flowers.setMatrixAt(n, m4);
      flowers.setColorAt(n, col.setHex(c));
      n++;
    }
  }
  scene.add(flowers);
}

function road(scene: THREE.Scene, r: () => number): void {
  const asphalt = box(160, 0.04, 6, 0x6f6f6a, 0, 0.02, 19);
  asphalt.castShadow = false;
  scene.add(asphalt);
  for (let x = -78; x < 78; x += 5) {
    if (r() < 0.3) continue; // marquage efface par endroits
    const d = box(2.2, 0.05, 0.22, 0xe8e0c8, x, 0.03, 19);
    d.castShadow = false;
    scene.add(d);
  }
  // Fissures envahies d'herbe.
  for (let i = 0; i < 26; i++) {
    const x = (r() - 0.5) * 80;
    const z = 19 + (r() - 0.5) * 5;
    const b = blob(0.28 + r() * 0.2, r() < 0.5 ? C.grassDark : C.leaf, x, 0.08, z);
    b.scale.y = 0.5;
    scene.add(b);
  }
  // Une epave sur la route, et un panneau tombe.
  overgrownCar(scene, null, 15, 19.5, -0.3, false);
  overgrownCar(scene, null, -24, 18, 2.6, true);
  const sign = group(
    cyl(0.06, 0.06, 2.4, C.metal, 6, 0, 1.2, 0),
    rbox(1.3, 0.8, 0.06, 0xd94c3a, 0.04, 0, 2.3, 0),
    rbox(1.0, 0.18, 0.07, C.white, 0.03, 0, 2.3, 0),
  );
  sign.rotation.z = 0.5;
  scene.add(shadow(at(sign, 7.5, 0, 15.6, 0.3)));
}

// ---------------------------------------------------------------- camp

function fence(scene: THREE.Scene, w: World): void {
  const { minX, maxX, minZ, maxZ, gate } = CAMP;
  const run = (x1: number, z1: number, x2: number, z2: number) => {
    w.walls.push({ x1, z1, x2, z2 });
    const len = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.max(1, Math.round(len / 2.2));
    const ang = Math.atan2(z2 - z1, x2 - x1);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = x1 + (x2 - x1) * t;
      const z = z1 + (z2 - z1) * t;
      scene.add(shadow(at(pallet(i), x, 0, z, -ang)));
    }
  };
  run(minX, minZ, maxX, minZ);
  run(maxX, minZ, maxX, maxZ);
  run(minX, maxZ, minX, minZ);
  run(minX, maxZ, -gate, maxZ);
  run(gate, maxZ, maxX, maxZ);
}

/** Une palette de recup posee de chant : la cloture du camp. */
function pallet(i: number): THREE.Group {
  const shades = [C.wood, C.woodLight, 0xb98048, 0xcf9a62];
  const tone = shades[i % shades.length]!;
  const g = group(
    rbox(0.16, 1.25, 0.16, C.woodDark, 0.03, -1.0, 0.62, 0),
    rbox(0.16, 1.25, 0.16, C.woodDark, 0.03, 1.0, 0.62, 0),
  );
  for (let k = 0; k < 4; k++) {
    const slat = rbox(2.2, 0.2, 0.08, tone, 0.03, 0, 0.25 + k * 0.28, 0.06);
    slat.rotation.z = (i * 7 + k * 3) % 5 === 0 ? 0.06 : 0;
    g.add(slat);
  }
  return g;
}

function campfire(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = blob(0.26, i % 2 ? C.stone : 0x85837b, Math.cos(a) * 0.75, 0.14, Math.sin(a) * 0.75);
    s.scale.y = 0.7;
    g.add(s);
  }
  for (let i = 0; i < 4; i++) {
    const log = cyl(0.1, 0.12, 1.1, C.woodDark, 6, 0, 0.18, 0);
    log.rotation.z = Math.PI / 2 - 0.35;
    const holder = group(log);
    holder.rotation.y = (i / 4) * Math.PI * 2;
    g.add(holder);
  }
  const flame = group(
    cone(0.42, 1.0, mat(C.fire, { emissive: 0xff5a10 }), 6, 0, 0.6, 0),
    cone(0.26, 0.75, mat(0xffd34a, { emissive: 0xffb020 }), 6, 0.05, 0.55, 0.04),
  );
  flame.traverse((c) => { c.castShadow = false; });
  g.add(flame);
  w.flames.push(flame);

  const light = new THREE.PointLight(0xff9a40, 0, 16, 1.6);
  light.position.set(0, 1.3, 0);
  g.add(light);
  w.nightLights.push({ light, night: 16, day: 1.5, flicker: 0.25 });
  const halo = glow(0xff9a40, 4.5);
  halo.position.set(0, 0.9, 0);
  g.add(halo);
  w.glows.push({ s: halo, night: 0.85, day: 0.25 });

  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x, z, r: 1.1 });
}

function benches(scene: THREE.Scene): void {
  const seats: [number, number, number][] = [[-0.5, -2.2, 0], [2.4, 1.4, Math.PI / 2], [-3.5, 1.6, Math.PI / 2 + 0.2]];
  for (const [x, z, ry] of seats) {
    const g = group(
      cyl(0.32, 0.34, 2.2, C.wood, 8, 0, 0.32, 0),
      blob(0.08, C.leafDark, 0.7, 0.62, 0.1),
    );
    (g.children[0] as THREE.Mesh).rotation.z = Math.PI / 2;
    scene.add(shadow(at(g, x, 0, z, ry)));
  }
  // Une caisse en guise de table, avec une tasse.
  scene.add(shadow(group(
    rbox(0.8, 0.6, 0.8, C.woodLight, 0.06, 2.5, 0.3, -1.6),
    cyl(0.1, 0.09, 0.18, 0x4f8fd1, 8, 2.4, 0.69, -1.5),
  )));
}

function stringLights(scene: THREE.Scene, w: World): void {
  const poles: [number, number][] = [[-4.6, -2.8], [3.6, -3.6], [4.2, 4.4], [-4.4, 4.8]];
  for (const [x, z] of poles) {
    scene.add(shadow(group(cyl(0.08, 0.1, 3.4, C.woodDark, 6, x, 1.7, z), cyl(0.12, 0.12, 0.12, C.metal, 6, x, 3.4, z))));
  }
  const bulbColors = [0xffd27a, 0xff9e6b, 0xfff1b8, 0xff8fb1, 0x9fe0ff];
  for (let i = 0; i < poles.length; i++) {
    const [x1, z1] = poles[i]!;
    const [x2, z2] = poles[(i + 1) % poles.length]!;
    const pts: THREE.Vector3[] = [];
    const n = 10;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      pts.push(new THREE.Vector3(x1 + (x2 - x1) * t, 3.3 - Math.sin(t * Math.PI) * 0.9, z1 + (z2 - z1) * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const wire = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.02, 4, false), mat(0x3a3a3a));
    scene.add(wire);
    for (let k = 1; k < n; k++) {
      const p = curve.getPoint(k / n);
      const color = bulbColors[(i * 3 + k) % bulbColors.length]!;
      const m = uniqueMat(color, color);
      m.emissiveIntensity = 0.15;
      w.bulbMats.push(m);
      const b = mesh(new THREE.SphereGeometry(0.09, 8, 6), m, p.x, p.y - 0.1, p.z);
      b.castShadow = false;
      scene.add(b);
      const halo = glow(color, 0.9);
      halo.position.set(p.x, p.y - 0.1, p.z);
      scene.add(halo);
      w.glows.push({ s: halo, night: 0.9, day: 0 });
    }
  }
  const light = new THREE.PointLight(0xffc27a, 0, 13, 1.5);
  light.position.set(0, 3, 0.6);
  scene.add(light);
  w.nightLights.push({ light, night: 10, day: 0 });
}

function beds(scene: THREE.Scene, w: World, r: () => number): void {
  const spots: [number, number, string][] = [[-8.6, -5.2, 'carrot'], [-8.6, -1.8, 'cabbage'], [-4.6, -4.8, 'tomato'], [-4.6, -1.6, 'carrot']];
  for (const [x, z, kind] of spots) {
    const g = new THREE.Group();
    g.add(rbox(3.0, 0.4, 2.2, C.wood, 0.05, 0, 0.2, 0));
    g.add(box(2.7, 0.06, 1.9, C.soil, 0, 0.41, 0));
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) {
        const px = -1.0 + j * 0.66;
        const pz = -0.6 + i * 0.6;
        const plant = makeCrop(kind, r);
        at(plant, px, 0.44, pz, r() * 6, 0.9 + r() * 0.25);
        g.add(plant);
      }
    }
    scene.add(shadow(at(g, x, 0, z)));
    w.walls.push(
      { x1: x - 1.5, z1: z - 1.1, x2: x + 1.5, z2: z - 1.1 },
      { x1: x + 1.5, z1: z - 1.1, x2: x + 1.5, z2: z + 1.1 },
      { x1: x + 1.5, z1: z + 1.1, x2: x - 1.5, z2: z + 1.1 },
      { x1: x - 1.5, z1: z + 1.1, x2: x - 1.5, z2: z - 1.1 },
    );
  }
}

function makeCrop(kind: string, r: () => number): THREE.Group {
  if (kind === 'cabbage') {
    return group(blob(0.24, 0x8fd068, 0, 0.18, 0), blob(0.17, 0xb7e58a, 0, 0.3, 0));
  }
  if (kind === 'tomato') {
    const g = group(cyl(0.025, 0.03, 0.8, C.woodLight, 4, 0, 0.4, 0), blob(0.24, C.leafDark, 0, 0.5, 0));
    for (let i = 0; i < 3; i++) g.add(sphere(0.08, 0xe8432f, (r() - 0.5) * 0.36, 0.3 + r() * 0.4, (r() - 0.5) * 0.36, 8));
    return g;
  }
  // carotte : fanes vertes + epaule orange qui depasse de la terre
  return group(
    cone(0.07, 0.22, 0xff8a2a, 5, 0, 0.04, 0),
    cone(0.05, 0.35, C.leafLight, 4, 0.04, 0.3, 0),
    cone(0.05, 0.3, C.leaf, 4, -0.04, 0.26, 0.03),
  );
}

function bathtub(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  g.add(rbox(2.2, 0.75, 1.1, C.white, 0.3, 0, 0.62, 0));
  g.add(box(1.9, 0.05, 0.8, C.soil, 0, 0.98, 0));
  for (const [fx, fz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]] as const) {
    g.add(sphere(0.1, 0xd9b44a, fx, 0.12, fz, 8));
  }
  const colors = [0xff8fb1, 0xffd84a, 0xffffff, 0xc39bff];
  for (let i = 0; i < 14; i++) {
    const fx = -0.8 + (i % 7) * 0.27;
    const fz = i < 7 ? -0.2 : 0.2;
    const stem = cyl(0.02, 0.02, 0.35, C.leaf, 4, fx, 1.15, fz);
    const head = blob(0.11, colors[i % colors.length]!, fx, 1.35, fz);
    const fl = group(stem, head);
    g.add(fl);
    w.swayers.push({ o: fl, phase: i, amp: 0.06 });
  }
  g.add(blob(0.3, C.leaf, 0.9, 1.0, 0.3));
  scene.add(shadow(at(g, x, 0, z, 0.25)));
  w.solids.push({ x, z, r: 1.2 });
}

function overgrownCar(scene: THREE.Scene, w: World | null, x: number, z: number, ry: number, flowers: boolean): void {
  const g = new THREE.Group();
  const body = rbox(3.6, 0.9, 1.8, C.rust, 0.25, 0, 0.75, 0);
  g.add(body);
  g.add(rbox(2.0, 0.75, 1.62, C.rustDark, 0.22, -0.3, 1.45, 0));
  g.add(rbox(1.8, 0.5, 1.66, 0x4a5d6e, 0.18, -0.3, 1.45, 0));
  g.add(rbox(0.5, 0.25, 1.85, 0xd8d0c0, 0.08, 1.8, 0.6, 0));
  for (const [wx, wz] of [[-1.1, 0.85], [1.1, 0.85], [-1.1, -0.85], [1.1, -0.85]] as const) {
    const wheel = cyl(0.38, 0.38, 0.28, 0x2f2f2f, 10, wx, 0.3, wz);
    wheel.rotation.x = Math.PI / 2;
    wheel.scale.z = 0.8; // pneus a plat
    g.add(wheel);
  }
  if (flowers) {
    // La nature a repris le vehicule : mousse sur le toit, fleurs dans le capot.
    g.add(blob(0.5, C.leaf, -0.4, 1.85, 0.3), blob(0.4, C.leafLight, -0.1, 1.82, -0.35), blob(0.45, C.leafDark, 1.1, 1.2, 0.2));
    const colors = [0xff8fb1, 0xffd84a, 0xffffff, 0xff7a5c];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      g.add(blob(0.12, colors[i % colors.length]!, 1.0 + Math.cos(a) * 0.5, 1.35 + (i % 3) * 0.08, Math.sin(a) * 0.6));
    }
    for (let i = 0; i < 6; i++) {
      const v = cyl(0.04, 0.04, 0.8, C.leafDark, 4, -1.7 + i * 0.6, 0.6, 0.92);
      v.rotation.x = 0.3;
      g.add(v);
    }
  }
  scene.add(shadow(at(g, x, 0, z, ry)));
  if (w) w.solids.push({ x, z, r: 1.6 }, { x: x + Math.cos(ry) * 1.2, z: z - Math.sin(ry) * 1.2, r: 1.1 }, { x: x - Math.cos(ry) * 1.2, z: z + Math.sin(ry) * 1.2, r: 1.1 });
}

function woodPile(scene: THREE.Scene, w: World): void {
  const { x, z } = w.woodPile;
  const g = new THREE.Group();
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 4 - row; i++) {
      const log = logMesh();
      log.position.set(-0.69 + i * 0.46 + row * 0.23, 0.24 + row * 0.4, 0);
      log.rotation.y = Math.PI / 2;
      g.add(log);
      w.woodPile.logs.push(log);
    }
  }
  g.add(at(box(0.2, 0.2, 0.2, C.woodLight), 1.2, 0.1, 0.4), cyl(0.05, 0.05, 0.9, C.woodDark, 5, 1.0, 0.45, -0.2));
  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x, z, r: 0.9 });
}

export function logMesh(): THREE.Group {
  const body = cyl(0.22, 0.22, 1.2, 0xa8693a, 7, 0, 0, 0);
  body.rotation.z = Math.PI / 2;
  const capA = cyl(0.18, 0.18, 0.03, 0xf2cf98, 7, 0.6, 0, 0);
  capA.rotation.z = Math.PI / 2;
  const capB = capA.clone();
  capB.position.x = -0.6;
  return group(body, capA, capB);
}

function workbench(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = group(
    rbox(2.2, 0.16, 1.0, C.woodLight, 0.04, 0, 0.95, 0),
    box(0.14, 0.9, 0.14, C.woodDark, -0.95, 0.45, -0.38),
    box(0.14, 0.9, 0.14, C.woodDark, 0.95, 0.45, -0.38),
    box(0.14, 0.9, 0.14, C.woodDark, -0.95, 0.45, 0.38),
    box(0.14, 0.9, 0.14, C.woodDark, 0.95, 0.45, 0.38),
    rbox(0.5, 0.3, 0.3, 0xd94c3a, 0.05, -0.5, 1.18, 0),
    cyl(0.03, 0.03, 0.6, C.metal, 5, 0.4, 1.06, 0.1),
    box(1.6, 0.9, 0.06, C.wood, 0, 1.5, -0.5),
  );
  (g.children[6] as THREE.Mesh).rotation.z = Math.PI / 2;
  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x: x - 0.6, z, r: 0.7 }, { x: x + 0.6, z, r: 0.7 });
}

function solarRig(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const panel = group(
      rbox(1.5, 0.08, 1.0, 0x2c4f8a, 0.03, 0, 0, 0),
      box(1.4, 0.09, 0.03, 0x9fc0ea, 0, 0, 0),
      box(0.03, 0.09, 0.9, 0x9fc0ea, 0, 0, 0),
    );
    panel.rotation.x = -0.5;
    panel.position.set(-0.8 + i * 1.6, 1.2, 0);
    g.add(panel, cyl(0.05, 0.05, 1.2, C.metal, 5, -0.8 + i * 1.6, 0.6, 0.2));
  }
  g.add(rbox(0.5, 0.6, 0.4, 0x5b6b4a, 0.05, 1.4, 0.3, 0.6));
  scene.add(shadow(at(g, x, 0, z, -0.4)));
  w.solids.push({ x, z, r: 1.4 });
}

function waterTank(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = group(
    box(0.12, 1.8, 0.12, C.woodDark, -0.6, 0.9, -0.6), box(0.12, 1.8, 0.12, C.woodDark, 0.6, 0.9, -0.6),
    box(0.12, 1.8, 0.12, C.woodDark, -0.6, 0.9, 0.6), box(0.12, 1.8, 0.12, C.woodDark, 0.6, 0.9, 0.6),
    rbox(1.5, 0.12, 1.5, C.wood, 0.03, 0, 1.8, 0),
    cyl(0.75, 0.75, 1.3, 0x4f8fd1, 12, 0, 2.5, 0),
    cyl(0.78, 0.78, 0.1, 0x3b6fa8, 12, 0, 3.15, 0),
    cyl(0.78, 0.78, 0.1, 0x3b6fa8, 12, 0, 2.0, 0),
    blob(0.35, C.leaf, 0.6, 0.3, 0.6),
  );
  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x, z, r: 1.0 });
}

function lampPost(scene: THREE.Scene, w: World, x: number, z: number): void {
  const bulbMat = uniqueMat(0xfff0c0, 0xffd27a);
  bulbMat.emissiveIntensity = 0.1;
  w.bulbMats.push(bulbMat);
  const g = group(
    cyl(0.07, 0.09, 3.2, 0x4a4a4a, 6, 0, 1.6, 0),
    rbox(0.5, 0.18, 0.5, 0x3a3a3a, 0.05, 0, 3.25, 0),
    mesh(new THREE.SphereGeometry(0.16, 8, 6), bulbMat, 0, 3.08, 0),
  );
  const light = new THREE.PointLight(0xffd59a, 0, 11, 1.6);
  light.position.set(0, 2.9, 0);
  g.add(light);
  w.nightLights.push({ light, night: 12, day: 0 });
  const halo = glow(0xffd27a, 2.2);
  halo.position.set(0, 3.05, 0);
  g.add(halo);
  w.glows.push({ s: halo, night: 0.9, day: 0 });
  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x, z, r: 0.25 });
}

// ---------------------------------------------------------------- batiments a debloquer

function buildGreenhouse(w: World): void {
  const g = w.greenhouse;
  // Serre faite de vieilles fenetres depareillees.
  const tints = [0xbfe6ff, 0xd8f5d0, 0xfff1c4, 0xcfe0ff];
  const frame = C.white;
  const W = 4.2, D = 3.2, H = 2.0;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.12, H, 0.12, frame, (sx * W) / 2, H / 2, (sz * D) / 2));
  g.add(box(W, 0.12, 0.12, frame, 0, H, -D / 2), box(W, 0.12, 0.12, frame, 0, H, D / 2));
  for (let i = 0; i < 4; i++) {
    const pane = (px: number, pz: number, ry: number) => {
      const p = box(W / 4 - 0.08, H - 0.2, 0.04, mat(tints[(i + Math.abs(Math.round(pz))) % tints.length]!, { opacity: 0.42 }), px, H / 2, pz);
      p.rotation.y = ry;
      p.castShadow = false;
      g.add(p);
    };
    pane(-W / 2 + W / 8 + (i * W) / 4, -D / 2, 0);
    if (i !== 1) pane(-W / 2 + W / 8 + (i * W) / 4, D / 2, 0);
  }
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 2; i++) {
      const p = box(D / 2 - 0.08, H - 0.2, 0.04, mat(tints[i + 1]!, { opacity: 0.42 }), (sx * W) / 2, H / 2, -D / 4 + (i * D) / 2);
      p.rotation.y = Math.PI / 2;
      p.castShadow = false;
      g.add(p);
    }
  }
  // Toit a deux pans
  for (const s of [-1, 1]) {
    const roof = box(W + 0.2, 0.05, D / 2 + 0.35, mat(0xe6f4ff, { opacity: 0.5 }), 0, H + 0.48, (s * D) / 4.4);
    roof.rotation.x = s * 0.55;
    roof.castShadow = false;
    g.add(roof);
    const beam = box(W + 0.2, 0.1, 0.1, frame, 0, H + 0.02, (s * D) / 2);
    g.add(beam);
  }
  g.add(box(W + 0.25, 0.12, 0.12, frame, 0, H + 0.95, 0));
  // Interieur : plantes en pot, lampe chaude
  for (let i = 0; i < 6; i++) {
    const px = -1.5 + i * 0.6;
    g.add(cyl(0.18, 0.14, 0.3, 0xc0623a, 8, px, 0.95, -0.9));
    g.add(blob(0.25, i % 2 ? C.leaf : C.leafLight, px, 1.25, -0.9));
  }
  g.add(rbox(3.6, 0.1, 0.7, C.wood, 0.03, 0, 0.75, -0.9));
  const winMat = uniqueMat(0xfff0c0, 0xffc870);
  winMat.emissiveIntensity = 0;
  w.windowMats.push(winMat);
  g.add(mesh(new THREE.SphereGeometry(0.14, 8, 6), winMat, 0, H - 0.2, 0));
  shadow(g);
  g.position.set(6.5, 0, -6);
  g.scale.setScalar(0.001);
  g.visible = false;
}

function buildTower(scene: THREE.Scene, w: World): void {
  const g = w.tower;
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
  // Ladder
  for (let i = 0; i < 8; i++) g.add(box(0.7, 0.06, 0.06, C.woodLight, 0, 0.4 + i * 0.5, 1.15));
  g.add(box(0.06, legH, 0.06, C.woodDark, -0.35, legH / 2, 1.15), box(0.06, legH, 0.06, C.woodDark, 0.35, legH / 2, 1.15));
  // Projecteur
  const lampMat = uniqueMat(0xfff7d6, 0xfff2cc);
  lampMat.emissiveIntensity = 0;
  w.windowMats.push(lampMat);
  const lamp = group(cyl(0.22, 0.3, 0.4, 0x3a3a3a, 8, 0, 0, 0), mesh(new THREE.CircleGeometry(0.2, 10), lampMat, 0, -0.21, 0));
  (lamp.children[1] as THREE.Mesh).rotation.x = Math.PI / 2;
  lamp.rotation.x = -0.9;
  lamp.position.set(0, legH + 1.0, 1.2);
  g.add(lamp);
  shadow(g);
  w.towerLight.position.set(0, legH + 1.0, 1.3);
  w.towerLight.target.position.set(-3, 0, 9);
  g.add(w.towerLight, w.towerLight.target);
  g.position.set(9.4, 0, 6);
  g.scale.setScalar(0.001);
  g.visible = false;
  scene.add(g);
}

// ---------------------------------------------------------------- alentours

function surroundings(scene: THREE.Scene, w: World, r: () => number): void {
  // Foret au nord, bosquets ailleurs : jamais a l'interieur du camp ni sur la route.
  let placed = 0;
  let guard = 0;
  while (placed < 120 && guard++ < 4000) {
    const x = (r() - 0.5) * 100;
    const z = (r() - 0.5) * 100;
    const nearCamp = x > CAMP.minX - 2.5 && x < CAMP.maxX + 2.5 && z > CAMP.minZ - 2.5 && z < CAMP.maxZ + 2.5;
    const onRoad = Math.abs(z - 19) < 4.5;
    const ruins = x > 16 && x < 30 && z > -12 && z < 12;
    const pylon = Math.hypot(x + 21, z + 4) < 4;
    const southView = z > 11 && z < 30 && Math.abs(x) < 12;
    if (nearCamp || onRoad || ruins || pylon || southView) continue;
    const density = z < -10 ? 0.9 : 0.35;
    if (r() > density) continue;
    const t = r() < 0.55 ? pine(r) : leafy(r);
    scene.add(at(t, x, 0, z, r() * 6, 0.8 + r() * 0.6));
    w.solids.push({ x, z, r: 0.6 });
    placed++;
  }
  for (let i = 0; i < 40; i++) {
    const x = (r() - 0.5) * 90;
    const z = (r() - 0.5) * 90;
    if (x > CAMP.minX - 1 && x < CAMP.maxX + 1 && z > CAMP.minZ - 1 && z < CAMP.maxZ + 1) continue;
    if (Math.abs(z - 19) < 3.5) continue;
    const b = r() < 0.5
      ? blob(0.5 + r() * 0.5, r() < 0.5 ? C.leaf : C.leafDark, x, 0.35, z)
      : blob(0.4 + r() * 0.5, r() < 0.5 ? C.stone : 0xa8a59b, x, 0.2, z);
    b.scale.y = 0.75;
    scene.add(b);
  }
  // Petits buissons au pied de la cloture, pour adoucir le camp.
  for (let i = 0; i < 26; i++) {
    const side = i % 4;
    const t = r();
    const x = side < 2 ? CAMP.minX + t * (CAMP.maxX - CAMP.minX) : side === 2 ? CAMP.minX - 0.6 : CAMP.maxX + 0.6;
    const z = side === 0 ? CAMP.minZ - 0.6 : side === 1 ? CAMP.maxZ + 0.7 : CAMP.minZ + t * (CAMP.maxZ - CAMP.minZ);
    if (side === 1 && Math.abs(x) < CAMP.gate + 1.5) continue;
    const b = blob(0.45 + r() * 0.3, r() < 0.5 ? C.leafLight : C.leaf, x, 0.3, z);
    b.scale.y = 0.8;
    scene.add(b);
  }

  ruinsBlock(scene, w, r, 22, -2);
  pylon(scene, w, -21, -4);
}

function pine(r: () => number): THREE.Group {
  const g = group(cyl(0.16, 0.22, 1.2, C.woodDark, 6, 0, 0.6, 0));
  const shade = r() < 0.5 ? C.pine : 0x4a8d55;
  for (let i = 0; i < 3; i++) g.add(cone(1.3 - i * 0.32, 1.6, shade, 7, 0, 1.4 + i * 0.85, 0));
  return shadow(g);
}

function leafy(r: () => number): THREE.Group {
  const g = group(cyl(0.18, 0.26, 1.8, C.woodDark, 6, 0, 0.9, 0));
  const shades = [C.leaf, C.leafLight, C.leafDark];
  g.add(blob(1.1, shades[Math.floor(r() * 3)]!, 0, 2.4, 0));
  g.add(blob(0.8, shades[Math.floor(r() * 3)]!, 0.6, 2.0, 0.3));
  g.add(blob(0.75, shades[Math.floor(r() * 3)]!, -0.5, 2.2, -0.3));
  return shadow(g);
}

function ruinsBlock(scene: THREE.Scene, w: World, r: () => number, x: number, z: number): void {
  const g = new THREE.Group();
  // Mur en L d'un ancien batiment, au sommet dechiquete.
  const wall = (len: number, along: 'x' | 'z', ox: number, oz: number) => {
    const n = Math.round(len / 0.8);
    for (let i = 0; i < n; i++) {
      const h = 1 + r() * 3.2 * Math.sin((i / n) * Math.PI) + 0.4;
      const seg = box(0.82, h, 0.5, r() < 0.2 ? C.concreteDark : C.concrete, 0, h / 2, 0);
      const px = along === 'x' ? ox + i * 0.8 : ox;
      const pz = along === 'z' ? oz + i * 0.8 : oz;
      seg.position.x = px;
      seg.position.z = pz;
      if (along === 'z') seg.rotation.y = Math.PI / 2;
      g.add(seg);
      if (r() < 0.45) g.add(blob(0.3 + r() * 0.25, r() < 0.5 ? C.leaf : C.leafDark, px, h, pz));
    }
  };
  wall(8, 'x', -4, -4);
  wall(7, 'z', -4, -4);
  // Fenetre vide et lierre
  for (let i = 0; i < 8; i++) {
    const v = cyl(0.05, 0.05, 1.5 + r() * 1.5, C.leafDark, 4, -4 + r() * 6, 1, -3.7);
    g.add(v);
  }
  for (let i = 0; i < 9; i++) {
    const d = rbox(0.4 + r() * 0.6, 0.3 + r() * 0.3, 0.4 + r() * 0.5, C.concrete, 0.06, -2 + r() * 6, 0.2, -2 + r() * 6);
    d.rotation.y = r() * 3;
    g.add(d);
  }
  // Un vieux distributeur renverse
  const vending = rbox(0.9, 1.8, 0.8, 0xd94c3a, 0.1, 1, 0.45, 1.5);
  vending.rotation.z = Math.PI / 2;
  g.add(vending);
  scene.add(shadow(at(g, x, 0, z)));
  w.walls.push({ x1: x - 4, z1: z - 4, x2: x + 4, z2: z - 4 }, { x1: x - 4, z1: z - 4, x2: x - 4, z2: z + 3 });
}

function pylon(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  const H = 9;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = box(0.14, H, 0.14, 0x8f969c, sx * 0.9, H / 2, sz * 0.9);
    leg.rotation.z = sx * 0.07;
    leg.rotation.x = -sz * 0.07;
    g.add(leg);
  }
  for (let y = 1; y < H; y += 1.6) {
    const s = 1 - (y / H) * 0.6;
    for (const sz of [-1, 1]) {
      const b = box(2 * s, 0.07, 0.07, 0x8f969c, 0, y, sz * s * 0.95);
      b.rotation.z = 0.6;
      g.add(b);
    }
  }
  g.add(box(4.5, 0.15, 0.15, 0x8f969c, 0, H - 1, 0), box(3.2, 0.15, 0.15, 0x8f969c, 0, H - 2.4, 0));
  // Le lierre grimpe le long du pylone.
  const r = rng(3);
  for (let i = 0; i < 22; i++) {
    const y = r() * r() * (H - 1);
    g.add(blob(0.25 + r() * 0.3, r() < 0.5 ? C.leaf : C.leafDark, (r() - 0.5) * 1.8 * (1 - y / H), y, (r() - 0.5) * 1.8 * (1 - y / H)));
  }
  scene.add(shadow(at(g, x, 0, z, 0.4)));
  w.solids.push({ x, z, r: 1.3 });
}
