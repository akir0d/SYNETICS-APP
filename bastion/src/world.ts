// Le decor fixe : le camp, ses alentours, la route. Ce qui s'anime ou se construit vit ailleurs.

import * as THREE from 'three';
import { C, at, blob, box, cone, cyl, glow, group, mat, mesh, rbox, rng, shadow, uniqueMat } from './kit';
import { CAMP, L, ROAD_Z } from './layout';
import type { Circle, Segment } from './physics';

export interface NightLight { light: THREE.Light; night: number; day: number; flicker?: number }

export interface World {
  walls: Segment[];
  solids: Circle[];
  swayers: { o: THREE.Object3D; phase: number; amp: number }[];
  flames: THREE.Object3D[];
  nightLights: NightLight[];
  glows: { s: THREE.Sprite; night: number; day: number }[];
  bulbMats: THREE.MeshLambertMaterial[];
  /** Pan de cloture qui ferme le nord tant que la porte n'est pas construite. */
  northBarrier: { group: THREE.Group; wall: Segment };
  keep: Set<THREE.Object3D>;
  bounds: number;
}

/** Zones a garder libres de decor aleatoire (arbres, rochers). */
function reserved(x: number, z: number): boolean {
  const nearCamp = x > CAMP.minX - 2.5 && x < CAMP.maxX + 2.5 && z > CAMP.minZ - 2.5 && z < CAMP.maxZ + 2.5;
  const onRoad = Math.abs(z - ROAD_Z) < 4.5;
  const forest = x > L.forest.minX - 1 && x < L.forest.maxX + 1 && z > L.forest.minZ - 1 && z < L.forest.maxZ + 1.5;
  const ruins = x > 16 && x < 30 && z > -12 && z < 12;
  const pylon = Math.hypot(x + 21, z + 4) < 4;
  const south = z > 11 && z < 30 && x > -30 && x < 30;
  const scrap = L.scrap.some((s) => Math.hypot(x - s.x, z - s.z) < 5);
  return nearCamp || onRoad || forest || ruins || pylon || south || scrap;
}

export function buildWorld(scene: THREE.Scene): World {
  const w: World = {
    walls: [], solids: [], swayers: [], flames: [], nightLights: [], glows: [], bulbMats: [],
    northBarrier: { group: new THREE.Group(), wall: { x1: -CAMP.gate, z1: CAMP.minZ, x2: CAMP.gate, z2: CAMP.minZ } },
    keep: new Set(),
    bounds: 44,
  };
  const r = rng(7);

  ground(scene, r);
  road(scene, r);
  fence(scene, w);
  stall(scene, w);
  campfire(scene, w, L.campfire.x, L.campfire.z);
  benches(scene);
  stringLights(scene, w);
  bathtub(scene, w, -11.4, 9.9);
  overgrownCar(scene, w, -18, 5, 0.6, true);
  solarRig(scene, w, -10.6, -9.6);
  waterTank(scene, w, 11.6, -9.7);
  lampPost(scene, w, -3.3, 10.2);
  lampPost(scene, w, 3.1, 10.2);
  surroundings(scene, w, r);
  return w;
}

// ---------------------------------------------------------------- sol

function ground(scene: THREE.Scene, r: () => number): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), mat(C.grass, { flat: false }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);

  const patches: [number, number, number, number][] = [
    [0, 0.5, 5, 4.4], [0, 7.5, 2.2, 4.4], [0, 13.5, 2.6, 3.4], [-7.8, -4.8, 4.4, 4.0], [6.2, 9.0, 3.4, 1.8],
    [6.4, -8.2, 3.8, 2.6], [0, -9, 2.2, 3], [0, -14, 2.4, 2.4], [10, 1.6, 2.4, 2.2], [-9.2, 5.6, 3.2, 2.6],
    [10.6, 7.6, 2.2, 2.2], [10.2, -4.2, 2.6, 2.4], [-14, 15.8, 3, 1.6],
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

  const inPatch = (x: number, z: number) => patches.some(([px, pz, rx, rz]) => ((x - px) / rx) ** 2 + ((z - pz) / rz) ** 2 < 1.15);
  const onRoad = (z: number) => Math.abs(z - ROAD_Z) < 3.4;

  const tuftGeo = new THREE.ConeGeometry(0.12, 0.45, 4);
  tuftGeo.translate(0, 0.22, 0);
  const COUNT = 1000;
  const tufts = new THREE.InstancedMesh(tuftGeo, mat(0xffffff), COUNT);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const greens = [C.grassDark, C.leaf, C.grassLight, C.leafLight];
  let n = 0;
  while (n < COUNT) {
    const x = (r() - 0.5) * 96;
    const z = (r() - 0.5) * 96;
    if (inPatch(x, z) || (onRoad(z) && r() < 0.8)) continue;
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

  const FL = 460;
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.11, 0), mat(0xffffff), FL);
  const petals = [0xffffff, 0xffd84a, 0xff8fb1, 0xc39bff, 0xff7a5c];
  n = 0;
  while (n < FL) {
    const cx = (r() - 0.5) * 84;
    const cz = (r() - 0.5) * 84;
    const c = petals[Math.floor(r() * petals.length)]!;
    for (let k = 0; k < 7 && n < FL; k++) {
      const x = cx + (r() - 0.5) * 2.4;
      const z = cz + (r() - 0.5) * 2.4;
      if (inPatch(x, z) || onRoad(z)) continue;
      m4.compose(new THREE.Vector3(x, 0.18 + r() * 0.12, z), q.identity(), new THREE.Vector3(1, 0.7, 1));
      flowers.setMatrixAt(n, m4);
      flowers.setColorAt(n, col.setHex(c));
      n++;
    }
  }
  scene.add(flowers);
}

function road(scene: THREE.Scene, r: () => number): void {
  const asphalt = box(170, 0.04, 6, 0x6f6f6a, 0, 0.02, ROAD_Z);
  asphalt.castShadow = false;
  scene.add(asphalt);
  for (let x = -84; x < 84; x += 5) {
    if (r() < 0.3) continue;
    const d = box(2.2, 0.05, 0.22, 0xe8e0c8, x, 0.03, ROAD_Z);
    d.castShadow = false;
    scene.add(d);
  }
  for (let i = 0; i < 30; i++) {
    const x = (r() - 0.5) * 90;
    const z = ROAD_Z + (r() - 0.5) * 5;
    if (Math.abs(x - 6.2) < 2 || Math.abs(x - L.bus.x) < 4) continue;
    const b = blob(0.28 + r() * 0.2, r() < 0.5 ? C.grassDark : C.leaf, x, 0.08, z);
    b.scale.y = 0.5;
    scene.add(b);
  }
  const sign = group(
    cyl(0.06, 0.06, 2.4, C.metal, 6, 0, 1.2, 0),
    rbox(1.3, 0.8, 0.06, 0xd94c3a, 0.04, 0, 2.3, 0),
    rbox(1.0, 0.18, 0.07, C.white, 0.03, 0, 2.3, 0),
  );
  sign.rotation.z = 0.5;
  scene.add(shadow(at(sign, -4.5, 0, 15.4, 0.3)));
}

// ---------------------------------------------------------------- camp

function fence(scene: THREE.Scene, w: World): void {
  const { minX, maxX, minZ, maxZ, gate } = CAMP;
  const run = (x1: number, z1: number, x2: number, z2: number, into?: THREE.Group) => {
    const len = Math.hypot(x2 - x1, z2 - z1);
    const count = Math.max(1, Math.round(len / 2.2));
    const ang = Math.atan2(z2 - z1, x2 - x1);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const p = shadow(at(pallet(i, len / count), x1 + (x2 - x1) * t, 0, z1 + (z2 - z1) * t, -ang));
      (into ?? scene).add(p);
    }
  };
  const wall = (x1: number, z1: number, x2: number, z2: number) => w.walls.push({ x1, z1, x2, z2 });
  // Nord : deux pans fixes et un pan central qui deviendra la porte.
  run(minX, minZ, -gate, minZ);
  run(gate, minZ, maxX, minZ);
  wall(minX, minZ, -gate, minZ);
  wall(gate, minZ, maxX, minZ);
  run(-gate, minZ, gate, minZ, w.northBarrier.group);
  scene.add(w.northBarrier.group);
  w.keep.add(w.northBarrier.group);
  w.walls.push(w.northBarrier.wall);
  // Est et ouest
  run(maxX, minZ, maxX, maxZ);
  run(minX, maxZ, minX, minZ);
  wall(maxX, minZ, maxX, maxZ);
  wall(minX, minZ, minX, maxZ);
  // Sud : porte au centre, etal encastre a droite.
  const s0 = L.stall.x - L.stall.w / 2;
  const s1 = L.stall.x + L.stall.w / 2;
  run(minX, maxZ, -gate, maxZ);
  run(gate, maxZ, s0, maxZ);
  run(s1, maxZ, maxX, maxZ);
  wall(minX, maxZ, -gate, maxZ);
  wall(gate, maxZ, s0, maxZ);
  wall(s1, maxZ, maxX, maxZ);
  wall(s0, maxZ, s1, maxZ);
}

function pallet(i: number, width = 2.2): THREE.Group {
  const shades = [C.wood, C.woodLight, 0xb98048, 0xcf9a62];
  const tone = shades[i % shades.length]!;
  const half = width / 2 - 0.1;
  const g = group(
    rbox(0.16, 1.25, 0.16, C.woodDark, 0.03, -half, 0.62, 0),
    rbox(0.16, 1.25, 0.16, C.woodDark, 0.03, half, 0.62, 0),
  );
  for (let k = 0; k < 4; k++) {
    const slat = rbox(width, 0.2, 0.08, tone, 0.03, 0, 0.25 + k * 0.28, 0.06);
    slat.rotation.z = (i * 7 + k * 3) % 5 === 0 ? 0.05 : 0;
    g.add(slat);
  }
  return g;
}

function stall(scene: THREE.Scene, w: World): void {
  const { x, z, w: W } = L.stall;
  const g = new THREE.Group();
  g.add(rbox(W, 1.0, 0.9, C.wood, 0.06, 0, 0.5, 0));
  g.add(rbox(W + 0.2, 0.12, 1.1, C.woodLight, 0.04, 0, 1.06, 0));
  for (const sx of [-1, 1]) g.add(cyl(0.07, 0.07, 2.2, C.woodDark, 6, (sx * W) / 2, 1.1, -0.35));
  // Auvent raye fait de vieilles baches.
  const stripes = [0xf4efe4, 0x5fb9a8];
  // L'auvent penche vers la route : il ne cache pas le comptoir cote camp.
  for (let i = 0; i < 6; i++) {
    const s = box(W / 6 + 0.02, 0.06, 1.2, stripes[i % 2]!, -W / 2 + W / 12 + (i * W) / 6, 2.05, 0.45);
    s.rotation.x = 0.38;
    g.add(s);
  }
  g.add(rbox(1.5, 0.4, 0.06, 0xd9a35a, 0.05, 0, 2.5, -0.2), box(1.1, 0.08, 0.07, 0x7a4a2a, 0, 2.5, -0.16));
  g.add(rbox(0.6, 0.4, 0.5, C.woodLight, 0.04, -W / 2 - 0.6, 0.2, 0.3), rbox(0.5, 0.35, 0.45, C.wood, 0.04, -W / 2 - 0.55, 0.58, 0.32));
  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x: x - W / 2 - 0.6, z: z + 0.3, r: 0.4 });
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
  w.keep.add(flame);

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
  const seats: [number, number, number][] = [[0, -1.8, 0], [2.6, 1.6, Math.PI / 2], [-2.6, 1.4, Math.PI / 2 + 0.2]];
  for (const [x, z, ry] of seats) {
    const seat = cyl(0.32, 0.34, 2.0, C.wood, 8, 0, 0.32, 0);
    seat.rotation.z = Math.PI / 2;
    scene.add(shadow(at(group(seat, blob(0.08, C.leafDark, 0.6, 0.62, 0.1)), x, 0, z, ry)));
  }
}

function stringLights(scene: THREE.Scene, w: World): void {
  const poles: [number, number][] = [[-3.6, -2.7], [3.6, -2.7], [3.8, 4.0], [-3.8, 4.1]];
  for (const [x, z] of poles) {
    scene.add(shadow(group(cyl(0.08, 0.1, 3.4, C.woodDark, 6, x, 1.7, z), cyl(0.12, 0.12, 0.12, C.metal, 6, x, 3.4, z))));
    w.solids.push({ x, z, r: 0.15 });
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
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.02, 4, false), mat(0x3a3a3a)));
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

function bathtub(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  g.add(rbox(2.2, 0.75, 1.1, C.white, 0.3, 0, 0.62, 0));
  g.add(box(1.9, 0.05, 0.8, C.soil, 0, 0.98, 0));
  for (const [fx, fz] of [[-0.85, -0.4], [0.85, -0.4], [-0.85, 0.4], [0.85, 0.4]] as const) g.add(blob(0.1, 0xd9b44a, fx, 0.12, fz));
  const colors = [0xff8fb1, 0xffd84a, 0xffffff, 0xc39bff];
  for (let i = 0; i < 14; i++) {
    const fx = -0.8 + (i % 7) * 0.27;
    const fz = i < 7 ? -0.2 : 0.2;
    const fl = group(cyl(0.02, 0.02, 0.35, C.leaf, 4, fx, 1.15, fz), blob(0.11, colors[i % colors.length]!, fx, 1.35, fz));
    g.add(fl);
    w.swayers.push({ o: fl, phase: i, amp: 0.06 });
    w.keep.add(fl);
  }
  scene.add(shadow(at(g, x, 0, z, 0.25)));
  w.solids.push({ x, z, r: 1.2 });
}

export function overgrownCar(scene: THREE.Scene, w: World | null, x: number, z: number, ry: number, flowers: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(3.6, 0.9, 1.8, C.rust, 0.25, 0, 0.75, 0));
  g.add(rbox(2.0, 0.75, 1.62, C.rustDark, 0.22, -0.3, 1.45, 0));
  g.add(rbox(1.8, 0.5, 1.66, 0x4a5d6e, 0.18, -0.3, 1.45, 0));
  g.add(rbox(0.5, 0.25, 1.85, 0xd8d0c0, 0.08, 1.8, 0.6, 0));
  for (const [wx, wz] of [[-1.1, 0.85], [1.1, 0.85], [-1.1, -0.85], [1.1, -0.85]] as const) {
    const wheel = cyl(0.38, 0.38, 0.28, 0x2f2f2f, 10, wx, 0.3, wz);
    wheel.rotation.x = Math.PI / 2;
    wheel.scale.z = 0.8;
    g.add(wheel);
  }
  if (flowers) {
    g.add(blob(0.5, C.leaf, -0.4, 1.85, 0.3), blob(0.4, C.leafLight, -0.1, 1.82, -0.35), blob(0.45, C.leafDark, 1.1, 1.2, 0.2));
    const colors = [0xff8fb1, 0xffd84a, 0xffffff, 0xff7a5c];
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      g.add(blob(0.12, colors[i % colors.length]!, 1.0 + Math.cos(a) * 0.5, 1.35 + (i % 3) * 0.08, Math.sin(a) * 0.6));
    }
  }
  scene.add(shadow(at(g, x, 0, z, ry)));
  if (w) w.solids.push({ x, z, r: 1.6 }, { x: x + Math.cos(ry) * 1.2, z: z - Math.sin(ry) * 1.2, r: 1.1 }, { x: x - Math.cos(ry) * 1.2, z: z + Math.sin(ry) * 1.2, r: 1.1 });
  return g;
}

function solarRig(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const panel = group(rbox(1.5, 0.08, 1.0, 0x2c4f8a, 0.03, 0, 0, 0), box(1.4, 0.09, 0.03, 0x9fc0ea, 0, 0, 0), box(0.03, 0.09, 0.9, 0x9fc0ea, 0, 0, 0));
    panel.rotation.x = -0.5;
    panel.position.set(-0.8 + i * 1.6, 1.2, 0);
    g.add(panel, cyl(0.05, 0.05, 1.2, C.metal, 5, -0.8 + i * 1.6, 0.6, 0.2));
  }
  scene.add(shadow(at(g, x, 0, z, 0.4)));
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

// ---------------------------------------------------------------- alentours

function surroundings(scene: THREE.Scene, w: World, r: () => number): void {
  let placed = 0;
  let guard = 0;
  while (placed < 130 && guard++ < 5000) {
    const x = (r() - 0.5) * 104;
    const z = (r() - 0.5) * 104;
    if (reserved(x, z)) continue;
    const density = z < -10 ? 0.9 : 0.35;
    if (r() > density) continue;
    const t = r() < 0.55 ? pine(r) : leafy(r);
    scene.add(at(t, x, 0, z, r() * 6, 0.8 + r() * 0.6));
    w.solids.push({ x, z, r: 0.6 });
    placed++;
  }
  for (let i = 0; i < 46; i++) {
    const x = (r() - 0.5) * 94;
    const z = (r() - 0.5) * 94;
    if (reserved(x, z)) continue;
    const b = r() < 0.5
      ? blob(0.5 + r() * 0.5, r() < 0.5 ? C.leaf : C.leafDark, x, 0.35, z)
      : blob(0.4 + r() * 0.5, r() < 0.5 ? C.stone : 0xa8a59b, x, 0.2, z);
    b.scale.y = 0.75;
    scene.add(b);
  }
  for (let i = 0; i < 30; i++) {
    const side = i % 4;
    const t = r();
    const x = side < 2 ? CAMP.minX + t * (CAMP.maxX - CAMP.minX) : side === 2 ? CAMP.minX - 0.6 : CAMP.maxX + 0.6;
    const z = side === 0 ? CAMP.minZ - 0.6 : side === 1 ? CAMP.maxZ + 0.7 : CAMP.minZ + t * (CAMP.maxZ - CAMP.minZ);
    if ((side === 0 || side === 1) && Math.abs(x) < CAMP.gate + 1.5) continue;
    if (side === 1 && Math.abs(x - L.stall.x) < 3) continue;
    const b = blob(0.45 + r() * 0.3, r() < 0.5 ? C.leafLight : C.leaf, x, 0.3, z);
    b.scale.y = 0.8;
    scene.add(b);
  }
  ruinsBlock(scene, w, r, 22, -2);
  pylon(scene, w, -21, -4);
}

export function pine(r: () => number): THREE.Group {
  const g = group(cyl(0.16, 0.22, 1.2, C.woodDark, 6, 0, 0.6, 0));
  const shade = r() < 0.5 ? C.pine : 0x4a8d55;
  for (let i = 0; i < 3; i++) g.add(cone(1.3 - i * 0.32, 1.6, shade, 7, 0, 1.4 + i * 0.85, 0));
  return shadow(g);
}

export function leafy(r: () => number): THREE.Group {
  const g = group(cyl(0.18, 0.26, 1.8, C.woodDark, 6, 0, 0.9, 0));
  const shades = [C.leaf, C.leafLight, C.leafDark];
  g.add(blob(1.1, shades[Math.floor(r() * 3)]!, 0, 2.4, 0));
  g.add(blob(0.8, shades[Math.floor(r() * 3)]!, 0.6, 2.0, 0.3));
  g.add(blob(0.75, shades[Math.floor(r() * 3)]!, -0.5, 2.2, -0.3));
  return shadow(g);
}

function ruinsBlock(scene: THREE.Scene, w: World, r: () => number, x: number, z: number): void {
  const g = new THREE.Group();
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
  for (let i = 0; i < 8; i++) g.add(cyl(0.05, 0.05, 1.5 + r() * 1.5, C.leafDark, 4, -4 + r() * 6, 1, -3.7));
  for (let i = 0; i < 9; i++) {
    const d = rbox(0.4 + r() * 0.6, 0.3 + r() * 0.3, 0.4 + r() * 0.5, C.concrete, 0.06, -2 + r() * 6, 0.2, -2 + r() * 6);
    d.rotation.y = r() * 3;
    g.add(d);
  }
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
  const rr = rng(3);
  for (let i = 0; i < 22; i++) {
    const y = rr() * rr() * (H - 1);
    g.add(blob(0.25 + rr() * 0.3, rr() < 0.5 ? C.leaf : C.leafDark, (rr() - 0.5) * 1.8 * (1 - y / H), y, (rr() - 0.5) * 1.8 * (1 - y / H)));
  }
  scene.add(shadow(at(g, x, 0, z, 0.4)));
  w.solids.push({ x, z, r: 1.3 });
}
