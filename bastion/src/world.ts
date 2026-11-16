// Le decor fixe : l'interieur du camp fortifie, ses alentours, la route.
// La palissade (palisade.ts) et les chantiers (ruins.ts, buildings.ts) vivent ailleurs.

import * as THREE from 'three';
import { C, at, blob, box, cone, cyl, glow, group, mat, rbox, rng, shadow, uniqueMat } from './kit';
import { CAMP, L, ROAD_Z, insideCamp } from './layout';
import type { Circle, Segment } from './physics';
import {
  crate, deadTree, drum, floodlight, gasBottle, hedgehog, jerrycan, paintedBoard, sandbags, sheet, tarp,
  tireStack, wreck,
} from './props';

export interface NightLight { light: THREE.Light; night: number; day: number; flicker?: number }

export interface World {
  walls: Segment[];
  solids: Circle[];
  swayers: { o: THREE.Object3D; phase: number; amp: number }[];
  flames: THREE.Object3D[];
  nightLights: NightLight[];
  glows: { s: THREE.Sprite; night: number; day: number }[];
  bulbMats: THREE.MeshLambertMaterial[];
  keep: Set<THREE.Object3D>;
  bounds: number;
}

/** Zones a garder libres de decor aleatoire (arbres, rochers). */
function reserved(x: number, z: number): boolean {
  const nearCamp = x > CAMP.minX - 3 && x < CAMP.maxX + 3 && z > CAMP.minZ - 3 && z < CAMP.maxZ + 3;
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
    keep: new Set(),
    bounds: 44,
  };
  const r = rng(7);

  ground(scene, r);
  road(scene, r);
  stall(scene);
  campfire(scene, w, L.campfire.x, L.campfire.z);
  seats(scene, w);
  workLight(scene, w);
  fireBarrel(scene, w, -3.7, 9.7);
  fireBarrel(scene, w, 3.6, 9.7);
  campProps(scene, w);
  rainCollector(scene, w, -11.4, 9.9);
  scene.add(shadow(at(wreck(0x8a5a3a, true), -18, 0, 5, 0.6)));
  w.solids.push({ x: -18, z: 5, r: 1.6 }, { x: -18 + Math.cos(0.6) * 1.2, z: 5 - Math.sin(0.6) * 1.2, r: 1.1 }, { x: -18 - Math.cos(0.6) * 1.2, z: 5 + Math.sin(0.6) * 1.2, r: 1.1 });
  solarRig(scene, w, -10.6, -9.6);
  waterTank(scene, w, 11.6, -9.7);
  surroundings(scene, w, r);
  return w;
}

// ---------------------------------------------------------------- sol

function blobShape(rx: number, rz: number, r: () => number, wobble = 0.22): THREE.Shape {
  const shape = new THREE.Shape();
  const n = 22;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 - wobble / 2 + r() * wobble;
    const px = Math.cos(a) * rx * k;
    const pz = Math.sin(a) * rz * k;
    if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
  }
  return shape;
}

function patch(scene: THREE.Scene, x: number, z: number, rx: number, rz: number, color: number, y: number, r: () => number, wobble?: number): void {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(blobShape(rx, rz, r, wobble)), mat(color, { flat: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
}

function ground(scene: THREE.Scene, r: () => number): void {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(170, 170), mat(C.grass, { flat: false }));
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);

  // Le camp est de la terre battue ; quelques flaques de boue et du gravier.
  patch(scene, 0, 0, CAMP.maxX + 0.6, CAMP.maxZ + 0.6, C.dirt, 0.01, r, 0.1);
  const mud: [number, number, number, number, number][] = [
    [0, 0.5, 3.4, 3.0, 0x9a7650], [-7.8, -4.8, 4.2, 3.6, 0x8f6d48], [6.4, -8.2, 3.2, 2.2, 0xa88660],
    [0, 7.5, 1.6, 3.6, 0xa88660], [-9.2, 5.6, 2.6, 2.0, 0x9a7650], [10.2, -4.2, 2.6, 2.4, 0xa88660],
    [7.5, 9.4, 3.2, 1.6, 0xa88660],
  ];
  for (const [x, z, rx, rz, c] of mud) patch(scene, x, z, rx, rz, c, 0.015, r);
  // Chemins de terre vers les portes et vers le bus.
  const tracks: [number, number, number, number][] = [[0, 14.5, 2.4, 3.6], [0, -14.5, 2.2, 3.6], [-14, 15.8, 3, 1.6], [6.2, 13.6, 1.8, 2.6]];
  for (const [x, z, rx, rz] of tracks) patch(scene, x, z, rx, rz, C.dirt, 0.012, r);

  const tuftGeo = new THREE.ConeGeometry(0.12, 0.45, 4);
  tuftGeo.translate(0, 0.22, 0);
  const COUNT = 1000;
  const tufts = new THREE.InstancedMesh(tuftGeo, mat(0xffffff), COUNT);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const col = new THREE.Color();
  const greens = [C.grassDark, C.leaf, C.grassLight, 0xb5a76a, 0x9c9a5c];
  const onRoad = (z: number) => Math.abs(z - ROAD_Z) < 3.4;
  let n = 0;
  while (n < COUNT) {
    const x = (r() - 0.5) * 96;
    const z = (r() - 0.5) * 96;
    // Pas d'herbe dans le camp, sauf des mauvaises herbes au pied de la palissade.
    const inCamp = insideCamp(x, z);
    const atWall = inCamp && (x < CAMP.minX + 0.7 || x > CAMP.maxX - 0.7 || z < CAMP.minZ + 0.7);
    if ((inCamp && !atWall) || (onRoad(z) && r() < 0.85)) continue;
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

  // Quelques fleurs sauvages, discretes, hors du camp.
  const FL = 140;
  const flowers = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.1, 0), mat(0xffffff), FL);
  const petals = [0xf2eee0, 0xe8d27a, 0xb8a6d9];
  n = 0;
  let guard = 0;
  while (n < FL && guard++ < 5000) {
    const cx = (r() - 0.5) * 84;
    const cz = (r() - 0.5) * 84;
    const c = petals[Math.floor(r() * petals.length)]!;
    for (let k = 0; k < 5 && n < FL; k++) {
      const x = cx + (r() - 0.5) * 2;
      const z = cz + (r() - 0.5) * 2;
      if (insideCamp(x, z) || Math.abs(x) < 15 && Math.abs(z) < 13 || onRoad(z)) continue;
      m4.compose(new THREE.Vector3(x, 0.16 + r() * 0.1, z), q.identity(), new THREE.Vector3(1, 0.7, 1));
      flowers.setMatrixAt(n, m4);
      flowers.setColorAt(n, col.setHex(c));
      n++;
    }
  }
  flowers.count = n;
  scene.add(flowers);
}

function road(scene: THREE.Scene, r: () => number): void {
  const asphalt = box(170, 0.04, 6, 0x5f5f5b, 0, 0.02, ROAD_Z);
  asphalt.castShadow = false;
  scene.add(asphalt);
  for (let x = -84; x < 84; x += 5) {
    if (r() < 0.45) continue;
    const d = box(2.2, 0.05, 0.22, 0xcfc6ae, x, 0.03, ROAD_Z);
    d.castShadow = false;
    scene.add(d);
  }
  // Fissures et nids-de-poule.
  for (let i = 0; i < 40; i++) {
    const x = (r() - 0.5) * 100;
    const z = ROAD_Z + (r() - 0.5) * 5;
    if (Math.abs(x - 6.2) < 2.5) continue;
    const c = box(0.8 + r() * 1.8, 0.05, 0.08, 0x3f3f3c, x, 0.035, z);
    c.rotation.y = (r() - 0.5) * 1.2;
    c.castShadow = false;
    scene.add(c);
    if (r() < 0.3) {
      const h = cyl(0.4 + r() * 0.4, 0.4, 0.05, 0x484845, 8, x + 1, 0.03, z + 0.3);
      h.castShadow = false;
      scene.add(h);
    }
  }
  // Herbes qui percent le bitume, debris, plots de chantier.
  for (let i = 0; i < 26; i++) {
    const x = (r() - 0.5) * 90;
    const z = ROAD_Z + (r() - 0.5) * 5;
    if (Math.abs(x - 6.2) < 2.5 || Math.abs(x - L.bus.x) < 4) continue;
    const b = blob(0.26 + r() * 0.2, r() < 0.5 ? C.grassDark : 0x9c9a5c, x, 0.08, z);
    b.scale.y = 0.5;
    scene.add(b);
  }
  for (const [x, z] of [[-6, 16.6], [-5.2, 16.9], [11, 16.5], [19, 21.6]] as const) {
    const cone0 = group(cone(0.22, 0.6, 0xe8742a, 8, 0, 0.32, 0), box(0.5, 0.05, 0.5, 0x2b2b2b, 0, 0.03, 0), cyl(0.15, 0.17, 0.08, C.white, 8, 0, 0.36, 0));
    scene.add(shadow(at(cone0, x, 0, z)));
  }
  const sign = group(
    cyl(0.06, 0.06, 2.4, C.metal, 6, 0, 1.2, 0),
    rbox(1.3, 0.8, 0.06, 0xd94c3a, 0.04, 0, 2.3, 0),
    rbox(1.0, 0.18, 0.07, C.white, 0.03, 0, 2.3, 0),
  );
  sign.rotation.z = 0.5;
  scene.add(shadow(at(sign, -4.5, 0, 15.4, 0.3)));
  scene.add(shadow(at(tireStack(3, 4), 15.6, 0, 16.2)));
}

// ---------------------------------------------------------------- camp

/**
 * L'etal, encastre dans la palissade sud : une porte posee sur deux futs.
 * Rien au-dessus du comptoir : la camera voit tout ce qu'on y pose.
 */
function stall(scene: THREE.Scene): void {
  const { x, z, w: W } = L.stall;
  const g = new THREE.Group();
  // Un long plateau sur trois futs : il porte les bacs (stations.ts, Bins).
  for (const sx of [-1, 0, 1]) g.add(at(drum([0x3f6a8a, 0x6f7a4a, 0x8a3f30][sx + 1]!), sx * (W / 2 - 0.5), 0, 0.05));
  g.add(rbox(W - 0.1, 0.1, 1.0, 0xc8a878, 0.03, 0, 1.0, 0));
  g.add(box(W - 0.2, 0.05, 0.12, 0x8a6a48, 0, 1.06, 0.45));
  // Devant, cote route : une tole de facade.
  const front = sheet(W - 0.3, 0.85, 0x5f8a85);
  front.position.set(0, 0.05, 0.42);
  g.add(front);
  // Enseigne peinte, cote route, au bout du comptoir.
  g.add(at(paintedBoard('coin'), W / 2 + 0.5, 0, 0.95, -0.15));
  scene.add(shadow(at(g, x, 0, z)));
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
  // Trepied et marmite.
  for (let i = 0; i < 3; i++) {
    const leg = cyl(0.03, 0.03, 1.9, 0x3a3a3a, 4, 0, 0.9, 0);
    leg.rotation.z = 0.32;
    const h = group(leg);
    h.rotation.y = (i / 3) * Math.PI * 2;
    h.children[0]!.position.x = 0.3;
    g.add(h);
  }
  g.add(cyl(0.22, 0.18, 0.28, 0x2f2f2f, 10, 0, 1.05, 0));
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

/** Autour du feu : un rondin, des pneus, une caisse. Le coin chaleureux du camp. */
function seats(scene: THREE.Scene, w: World): void {
  const seat = cyl(0.32, 0.34, 2.0, C.wood, 8, 0, 0.32, 0);
  seat.rotation.z = Math.PI / 2;
  scene.add(shadow(at(group(seat), 0, 0, -1.8)));
  scene.add(shadow(at(tireStack(2, 11), 2.4, 0, 1.4)));
  scene.add(shadow(at(tireStack(2, 12), -2.4, 0, 1.6)));
  scene.add(shadow(at(crate(0.6), 1.8, 0, -1.2, 0.5)));
  w.solids.push({ x: 2.4, z: 1.4, r: 0.45 }, { x: -2.4, z: 1.6, r: 0.45 });
}

/** Projecteur de chantier sur un mat, branche sur un groupe electrogene. */
function workLight(scene: THREE.Scene, w: World): void {
  const lens = uniqueMat(0xfff7d6, 0xfff2cc);
  lens.emissiveIntensity = 0.1;
  w.bulbMats.push(lens);
  const x = -3.6;
  const z = -2.8;
  const pole = floodlight(3.8, lens);
  pole.rotation.y = 0.75;
  scene.add(shadow(at(pole, x, 0, z)));
  const gen = group(
    rbox(1.0, 0.6, 0.6, 0x6f8a3a, 0.06, 0, 0.42, 0),
    box(1.1, 0.12, 0.7, 0x2b2b2b, 0, 0.08, 0),
    cyl(0.14, 0.14, 0.04, 0x2b2b2b, 10, 0.3, 0.42, 0.31),
    box(0.08, 0.3, 0.08, 0x3a3a3a, -0.35, 0.85, 0),
  );
  scene.add(shadow(at(gen, x - 1.1, 0, z - 0.6, 0.3)));
  const cable = box(0.04, 0.03, 1.2, 0x1f1f1f, x - 0.5, 0.02, z - 0.3);
  cable.rotation.y = 0.9;
  scene.add(cable);
  w.solids.push({ x, z, r: 0.25 }, { x: x - 1.1, z: z - 0.6, r: 0.6 });
  const light = new THREE.PointLight(0xfff0d0, 0, 14, 1.5);
  light.position.set(0, 3, 0.6);
  scene.add(light);
  w.nightLights.push({ light, night: 10, day: 0 });
  const halo = glow(0xfff2cc, 2.2);
  halo.position.set(x + 0.1, 3.75, z + 0.1);
  scene.add(halo);
  w.glows.push({ s: halo, night: 0.9, day: 0 });
}

/** Fut d'huile ou brule un feu : la lumiere des portes la nuit. */
function fireBarrel(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = drum(0x5a4a3e);
  g.add(cyl(0.29, 0.29, 0.04, 0x1f1a16, 10, 0, 0.9, 0));
  const flame = group(
    cone(0.26, 0.7, mat(C.fire, { emissive: 0xff5a10 }), 6, 0, 1.25, 0),
    cone(0.16, 0.5, mat(0xffd34a, { emissive: 0xffb020 }), 6, 0.04, 1.18, 0.03),
  );
  flame.traverse((c) => { c.castShadow = false; });
  g.add(flame);
  w.flames.push(flame);
  w.keep.add(flame);
  const light = new THREE.PointLight(0xff9a40, 0, 11, 1.6);
  light.position.set(0, 1.6, 0);
  g.add(light);
  w.nightLights.push({ light, night: 9, day: 0.6, flicker: 0.3 });
  const halo = glow(0xff9a40, 2.6);
  halo.position.set(0, 1.3, 0);
  g.add(halo);
  w.glows.push({ s: halo, night: 0.8, day: 0.15 });
  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x, z, r: 0.4 });
}

/** Le bric-a-brac d'un camp qui tient : caisses, bidons, pneus, sacs de sable. */
function campProps(scene: THREE.Scene, w: World): void {
  const put = (o: THREE.Object3D, x: number, z: number, ry: number, solid: number) => {
    scene.add(shadow(at(o, x, 0, z, ry)));
    if (solid > 0) w.solids.push({ x, z, r: solid });
  };
  // Mur ouest : reserve de caisses et bidons, panneau a croix rouge.
  put(group(at(crate(0.7), 0, 0, 0), at(crate(0.6, C.woodLight), 0.05, 0.7, 0.02, 0.3), at(crate(0.6), 0, 0, 0.75, 0.1)), -12.1, -1.6, 0, 0.8);
  put(group(at(jerrycan(), 0.0, 0, 0), at(jerrycan(0x3f6a3a), 0.25, 0, 0.12, 0.4), at(jerrycan(), -0.3, 0, 0.1, -0.3)), -12.2, 0.4, Math.PI / 2, 0.4);
  put(paintedBoard('cross'), -12.3, 2.4, Math.PI / 2, 0.3);
  // Mur est : pneus, bouteilles de gaz, bache.
  put(tireStack(4, 5), 12.1, -0.6, 0, 0.5);
  put(group(at(gasBottle(), 0, 0, 0), at(gasBottle(), 0.36, 0, 0.1), at(crate(0.55), 0.1, 0, -0.55, 0.2)), 12.1, 4.4, 0, 0.6);
  // Nord : nids de sacs de sable de part et d'autre de la porte.
  put(sandbags(1.8, 3, 7), -5.6, -10.2, 0, 0);
  w.solids.push({ x: -6.2, z: -10.2, r: 0.5 }, { x: -5.0, z: -10.2, r: 0.5 });
  put(sandbags(1.4, 3, 8), 3.4, -10.25, 0, 0);
  w.solids.push({ x: 3.4, z: -10.2, r: 0.55 });
  // Sud : sacs de sable aux montants de la porte, interieur.
  put(sandbags(1.0, 2, 9), -5.6, 10.3, 0, 0.5);
  // Bache tendue au coin sud-est, au-dessus de rien d'utile.
  const lean = group(
    cyl(0.05, 0.05, 2.2, C.woodDark, 5, -0.9, 1.1, 0.6), cyl(0.05, 0.05, 2.2, C.woodDark, 5, 0.9, 1.1, 0.6),
    at(tarp(2.2, 1.6, 0x5f7a8a, 0.5), 0, 1.75, 0.1),
    at(crate(0.5), -0.4, 0, -0.1), at(drum(0x3f6a8a), 0.45, 0, -0.2),
  );
  put(lean, 11.9, 9.8, Math.PI, 0.9);
}

function rainCollector(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = group(
    box(1.2, 0.1, 1.2, 0x55595c, 0, 0.05, 0),
    rbox(1.05, 1.05, 1.05, 0xe8e6dc, 0.08, 0, 0.62, 0),
    box(1.12, 0.05, 0.05, 0x55595c, 0, 0.62, 0.55), box(1.12, 0.05, 0.05, 0x55595c, 0, 0.62, -0.55),
    box(0.05, 1.12, 0.05, 0x55595c, 0.55, 0.62, 0.55), box(0.05, 1.12, 0.05, 0x55595c, -0.55, 0.62, 0.55),
    cyl(0.2, 0.2, 0.1, 0x3f6a8a, 8, 0, 1.18, 0),
    cyl(0.6, 0.15, 0.4, 0x5f7a8a, 8, 0, 1.45, 0),
    at(drum(0x3f6a8a, false), 1.0, 0, 0.2),
  );
  scene.add(shadow(at(g, x, 0, z, 0.25)));
  w.solids.push({ x, z, r: 1.1 });
}

function solarRig(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const panel = group(rbox(1.5, 0.08, 1.0, 0x2c4f8a, 0.03, 0, 0, 0), box(1.4, 0.09, 0.03, 0x9fc0ea, 0, 0, 0), box(0.03, 0.09, 0.9, 0x9fc0ea, 0, 0, 0));
    panel.rotation.x = -0.5;
    panel.position.set(-0.8 + i * 1.6, 1.2, 0);
    g.add(panel, cyl(0.05, 0.05, 1.2, C.metal, 5, -0.8 + i * 1.6, 0.6, 0.2));
  }
  g.add(at(crate(0.5, 0x6f7a4a), 0.2, 0, 0.9));
  scene.add(shadow(at(g, x, 0, z, 0.4)));
  w.solids.push({ x, z, r: 1.4 });
}

function waterTank(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = group(
    box(0.12, 1.8, 0.12, C.woodDark, -0.6, 0.9, -0.6), box(0.12, 1.8, 0.12, C.woodDark, 0.6, 0.9, -0.6),
    box(0.12, 1.8, 0.12, C.woodDark, -0.6, 0.9, 0.6), box(0.12, 1.8, 0.12, C.woodDark, 0.6, 0.9, 0.6),
    rbox(1.5, 0.12, 1.5, C.wood, 0.03, 0, 1.8, 0),
    cyl(0.75, 0.75, 1.3, 0x5a7f8f, 12, 0, 2.5, 0),
    cyl(0.78, 0.78, 0.1, 0x3f5a66, 12, 0, 3.15, 0),
    cyl(0.78, 0.78, 0.1, 0x3f5a66, 12, 0, 2.0, 0),
    box(0.5, 0.6, 0.05, C.rustDark, 0.3, 2.5, 0.74),
  );
  scene.add(shadow(at(g, x, 0, z)));
  w.solids.push({ x, z, r: 1.0 });
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
    const roll = r();
    const t = roll < 0.22 ? deadTree(r) : roll < 0.6 ? pine(r) : leafy(r);
    scene.add(shadow(at(t, x, 0, z, r() * 6, 0.8 + r() * 0.6)));
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
  // Herissons anti-vehicules devant le camp : on sait ce qui rode ici.
  const hogs: [number, number][] = [[-9.6, 13.4], [-6.4, 14.0], [10.4, 13.6], [12.8, 13.2], [-16, 2], [-16.2, -6], [16, -3], [16.4, 6.5]];
  for (const [x, z] of hogs) {
    scene.add(shadow(at(hedgehog(), x, 0, z, r() * 3)));
    w.solids.push({ x, z, r: 0.7 });
  }
  scene.add(shadow(at(wreck(0x5f7a8a), 18.5, 0, -12, 1.2)));
  w.solids.push({ x: 18.5, z: -12, r: 1.8 });
  ruinsBlock(scene, w, r, 22, -2);
  pylon(scene, w, -21, -4);
}

export function pine(r: () => number): THREE.Group {
  const g = group(cyl(0.16, 0.22, 1.2, C.woodDark, 6, 0, 0.6, 0));
  const shade = r() < 0.5 ? C.pine : 0x4a7552;
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
  const vending = rbox(0.9, 1.8, 0.8, 0x9c4a3c, 0.1, 1, 0.45, 1.5);
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
