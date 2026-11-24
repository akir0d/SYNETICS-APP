// Le decor fixe : l'interieur du camp fortifie, ses alentours, la route.
// La palissade (palisade.ts) et les chantiers (ruins.ts, buildings.ts) vivent ailleurs.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeColored } from './bake';
import {
  C, at, blob, box, capsule, cyl, glow, group, groundMat, lathe, mat, mesh, mixHex, paint, plank, puff, rbox, rcyl,
  rng, shadow, uniqueMat, vgrad, vmat,
} from './kit';
import type { Profile } from './kit';
import { CAMP, FARM, L, POND, ROAD_Z, STATION, insideCamp } from './layout';
import type { Circle, Segment } from './physics';
import {
  crate, drum, floodlight, gasBottle, hedgehog, jerrycan, jersey, paintedBoard, roofSheet, sandbags, sheet,
  tire, tireStack, wreck,
} from './props';
import { boulder, bush, deadTree, leafy, pine } from './flora';
import { campDirt, grassTexture, planarUV, rippleTexture } from './textures';

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
  /** Passages bloques tant qu'on ne les a pas degages (ou construits). */
  locks: { west: Segment; east: Segment; dock: Segment };
  /**
   * La cloture de bois de la ferme : un maillage a part (hors fusion du decor) et ses
   * segments, qu'on retire quand la palissade de la ferme la remplace.
   */
  farmFence: { mesh: THREE.Object3D; segs: Segment[] };
  /** Materiau de l'etang (ses vaguelettes s'animent). */
  water: THREE.MeshPhongMaterial | null;
}

/** Zones a garder libres de decor aleatoire (arbres, rochers). */
function reserved(x: number, z: number): boolean {
  // Le camp peut s'etendre jusqu'a ±19 : on reserve sa taille maximale.
  const nearCamp = x > -22 && x < 22 && z > CAMP.minZ - 3 && z < CAMP.maxZ + 3;
  const onRoad = Math.abs(z - ROAD_Z) < 4.5;
  const forest = x > L.forest.minX - 1 && x < L.forest.maxX + 1 && z > L.forest.minZ - 1 && z < L.forest.maxZ + 1.5;
  const ruins = x > 21 && x < 32 && z > -12 && z < 4;
  const pylon = Math.hypot(x + 21, z + 4) < 4;
  const south = z > 11 && z < 30 && x > -30 && x < 30;
  const scrap = L.scrap.some((s) => Math.hypot(x - s.x, z - s.z) < 5);
  const farm = x > FARM.minX - 2 && x < FARM.maxX + 2 && z > FARM.minZ - 2 && z < FARM.maxZ + 3;
  const station = x > STATION.minX - 2 && x < STATION.maxX + 2 && z > STATION.minZ - 2 && z < STATION.maxZ + 2;
  const pond = Math.hypot((x - POND.x) / (POND.rx + 3), (z - POND.z) / (POND.rz + 3)) < 1;
  const quarry = x > 20 && x < 44 && z > -38 && z < -11;
  return nearCamp || onRoad || forest || ruins || pylon || south || scrap || farm || station || pond || quarry;
}

export function buildWorld(scene: THREE.Scene): World {
  const w: World = {
    walls: [], solids: [], swayers: [], flames: [], nightLights: [], glows: [], bulbMats: [],
    keep: new Set(),
    bounds: 54,
    locks: { west: { x1: 0, z1: 0, x2: 0, z2: 0 }, east: { x1: 0, z1: 0, x2: 0, z2: 0 }, dock: { x1: 0, z1: 0, x2: 0, z2: 0 } },
    farmFence: { mesh: new THREE.Group(), segs: [] },
    water: null,
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
  solarRig(scene, w, -10.6, -9.6);
  waterTank(scene, w, 11.6, -9.7);
  farmZone(scene, w, r);
  stationZone(scene, w, r);
  pondZone(scene, w, r);
  quarryZone(scene, w, r);
  surroundings(scene, w, r);
  return w;
}

// ---------------------------------------------------------------- outils locaux

/** Teintes du sol telles qu'on les voit (couleur x texture) : les bords des taches s'y fondent. */
const GRASS_SEEN = 0x8c9c55;
const CAMP_SEEN = 0xbb9a70;

/** Petit hachage reproductible : variations sans toucher au generateur du decor. */
function hashf(x: number, z = 0): number {
  const h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

/** Bruit doux (sommes de sinus), entre -1 et 1 : nuances de teinte a grande echelle. */
function soft(x: number, z: number): number {
  return Math.sin(x * 0.9 + z * 0.4) * 0.5 + Math.sin(x * 0.37 - z * 1.1 + 1.7) * 0.35 + Math.sin((x + z) * 2.3) * 0.15;
}

let gvMat: THREE.MeshLambertMaterial | null = null;
/** Sol a couleurs de sommets (taches, route, berges) : partage, sans ombrage d'ambiance. */
function groundVMat(): THREE.MeshLambertMaterial {
  if (!gvMat) {
    gvMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    gvMat.userData.shared = true;
  }
  return gvMat;
}

/** Geometrie indexee ; avec `up`, chaque triangle est remis face au ciel (+Y). */
function makeGeo(pos: number[], nor: number[], idx: number[], col: number[] | null, up: boolean, uv?: number[]): THREE.BufferGeometry {
  if (up) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
      const ux = pos[b]! - pos[a]!, uz = pos[b + 2]! - pos[a + 2]!;
      const vx = pos[c]! - pos[a]!, vz = pos[c + 2]! - pos[a + 2]!;
      if (uz * vx - ux * vz < 0) {
        const s = idx[t + 1]!;
        idx[t + 1] = idx[t + 2]!;
        idx[t + 2] = s;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Copie d'une geometrie du kit reduite a position + normale, avec des couleurs de sommets. */
function tinted(src: THREE.BufferGeometry, fn: (x: number, y: number, z: number, out: THREE.Color) => void): THREE.BufferGeometry {
  const g = src.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    c.setRGB(1, 1, 1);
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/**
 * Rondin couche le long de X : ecorce, bouts scies clairs avec un coeur plus sombre ;
 * `char` noircit le milieu (bois du feu). Geometrie peinte en cache par dimensions.
 */
function log(R: number, len: number, bark: number, char = false): THREE.Mesh {
  const h = len / 2;
  const e = Math.min(0.03, R * 0.25);
  const prof: Profile = [
    [0, -h], [R * 0.55, -h], [R - e, -h], [R, -h + e], [R * 1.02, -h * 0.5], [R * 1.03, 0],
    [R * 1.02, h * 0.5], [R, h - e], [R - e, h], [R * 0.55, h], [0, h],
  ];
  const heart = new THREE.Color(0xb27c48);
  const cut = new THREE.Color(0xe2b77c);
  const ring = new THREE.Color(0xcf9c62);
  const b = new THREE.Color(bark);
  const bd = new THREE.Color(mixHex(bark, 0x000000, 0.25));
  const coal = new THREE.Color(0x2c211b);
  const m = paint(lathe(prof, bark), `log${bark},${char}`, (x, y, z, out) => {
    const rr = Math.hypot(x, z);
    if (Math.abs(y) > h - 1e-4 && rr < R - e * 0.5) {
      out.copy(rr < 0.01 ? heart : rr < R * 0.6 ? cut : ring);
      return;
    }
    // Ecorce : nuance douce selon l'angle (fibres), plus sombre sur une face.
    out.copy(b).lerp(bd, 0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 3 + y * 2));
    if (char) out.lerp(coal, Math.max(0, 1 - Math.abs(y) / (h * 0.75)));
  });
  m.rotation.z = Math.PI / 2;
  return m;
}

// ---------------------------------------------------------------- sol

/**
 * Contour doux d'une tache : 23 tirages du generateur (comme avant, pour garder la suite
 * du decor), interpoles en une courbe lisse de 66 points (Catmull-Rom fermee).
 */
function outline(rx: number, rz: number, r: () => number, wobble: number): [number, number][] {
  const n = 22;
  const k: number[] = [];
  for (let i = 0; i <= n; i++) k.push(1 - wobble / 2 + r() * wobble);
  const out: [number, number][] = [];
  const M = n * 3;
  for (let j = 0; j < M; j++) {
    const t = j / 3;
    const i = Math.floor(t);
    const f = t - i;
    const p0 = k[(i + n - 1) % n]!, p1 = k[i % n]!, p2 = k[(i + 1) % n]!, p3 = k[(i + 2) % n]!;
    const kk = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
    const a = (j / M) * Math.PI * 2;
    out.push([Math.cos(a) * rx * kk, Math.sin(a) * rz * kk]);
  }
  return out;
}

function blobShape(rx: number, rz: number, r: () => number, wobble = 0.22): THREE.Shape {
  const shape = new THREE.Shape();
  outline(rx, rz, r, wobble).forEach(([px, pz], i) => {
    if (i === 0) shape.moveTo(px, pz); else shape.lineTo(px, pz);
  });
  shape.closePath();
  return shape;
}

/**
 * Tache de sol au contour lisse : coeur nuance, bord fondu vers la teinte du dessous
 * (`under`) sur une bande. Couleurs de sommets, materiau de sol partage (fusionne).
 */
function patch(scene: THREE.Scene, x: number, z: number, rx: number, rz: number, color: number, y: number, r: () => number, wobble?: number, under: number = GRASS_SEEN): void {
  const o = outline(rx, rz, r, wobble ?? 0.22);
  const band = Math.min(0.38, 0.8 / Math.min(rx, rz));
  const rings = [0.55, 1 - band, 1];
  const base = new THREE.Color(color);
  const edge = base.clone().lerp(new THREE.Color(under), 0.6);
  const c = new THREE.Color();
  const pos: number[] = [0, 0, 0];
  const nor: number[] = [0, 1, 0];
  const col: number[] = [];
  c.copy(base).multiplyScalar(0.97);
  col.push(c.r, c.g, c.b);
  const M = o.length;
  for (const s of rings) {
    for (const [px, pz] of o) {
      pos.push(px * s, 0, pz * s);
      nor.push(0, 1, 0);
      c.copy(s < 1 ? base : edge).multiplyScalar(1 + 0.05 * soft((x + px * s) * 0.6, (z + pz * s) * 0.6));
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < M; j++) idx.push(0, 1 + j, 1 + ((j + 1) % M));
  for (let q = 0; q < rings.length - 1; q++) {
    const a0 = 1 + q * M;
    const b0 = a0 + M;
    for (let j = 0; j < M; j++) {
      const j1 = (j + 1) % M;
      idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
    }
  }
  const m = new THREE.Mesh(makeGeo(pos, nor, idx, col, true), groundVMat());
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
}

let _tuft: THREE.BufferGeometry | null = null;
/**
 * Touffe d'herbe : quatre brins courbes, vrilles, qui s'ouvrent en corolle. Chaque brin a
 * ses deux faces (vu de partout) et des normales en dome : la touffe s'eclaire comme une
 * boule douce. Pied sombre, pointes claires et chaudes. 24 triangles.
 */
function tuftGeo(): THREE.BufferGeometry {
  if (_tuft) return _tuft;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const shade = [[0.6, 0.64, 0.5], [0.96, 0.98, 0.86], [1.2, 1.16, 0.92]] as const;
  const heights = [0.46, 0.35, 0.42, 0.32];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + (i % 2) * 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const tx = -dz;
    const tz = dx;
    const h = heights[i]!;
    const b = pos.length / 3;
    const P = (rad: number, y: number, off: number, lvl: number, out: number) => {
      pos.push(dx * rad + tx * off, y, dz * rad + tz * off);
      const l = Math.hypot(dx * out, 1, dz * out);
      nor.push((dx * out) / l, 1 / l, (dz * out) / l);
      const s = shade[lvl]!;
      col.push(s[0], s[1], s[2]);
    };
    P(0.02, 0, -0.05, 0, 0.5);
    P(0.02, 0, 0.05, 0, 0.5);
    P(0.08, h * 0.5, -0.02, 1, 0.6);
    P(0.08, h * 0.5, 0.055, 1, 0.6);
    P(0.2, h, 0.06, 2, 0.85);
    // Face avant puis face arriere (meme sommets, sens inverse).
    idx.push(b, b + 1, b + 3, b, b + 3, b + 2, b + 2, b + 3, b + 4);
    idx.push(b, b + 3, b + 1, b, b + 2, b + 3, b + 2, b + 4, b + 3);
  }
  _tuft = makeGeo(pos, nor, idx, col, false);
  return _tuft;
}

let _flower: THREE.BufferGeometry | null = null;
/** Fleur : cinq petales arrondis en coupelle, coeur jaune (les petales prennent la teinte de l'instance). */
function flowerGeo(): THREE.BufferGeometry {
  if (_flower) return _flower;
  const pos: number[] = [0, 0.03, 0];
  const nor: number[] = [0, 1, 0];
  const col: number[] = [1, 0.72, 0.18];
  const idx: number[] = [];
  const N = 20;
  for (let j = 0; j < N; j++) {
    const a = (j / N) * Math.PI * 2;
    const rad = 0.04 + 0.085 * Math.pow(Math.abs(Math.cos(2.5 * a)), 0.7);
    pos.push(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    const l = Math.hypot(0.35, 1);
    nor.push((Math.cos(a) * 0.35) / l, 1 / l, (Math.sin(a) * 0.35) / l);
    col.push(1, 1, 1);
    idx.push(0, 1 + j, 1 + ((j + 1) % N));
  }
  _flower = makeGeo(pos, nor, idx, col, true);
  return _flower;
}

function ground(scene: THREE.Scene, r: () => number): void {
  // Herbe texturee (grain, plaques seches), et de grandes variations de teinte par sommet
  // pour qu'aucune repetition ne se voie de haut.
  const geo = new THREE.PlaneGeometry(170, 170, 34, 34);
  const pos = geo.getAttribute('position');
  const cols = new Float32Array(pos.count * 3);
  const tint = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const n = Math.sin(x * 0.11 + 1.3) * Math.cos(y * 0.09 - 0.7) * 0.5 + Math.sin((x + y) * 0.05) * 0.5;
    tint.setRGB(1 + n * 0.07, 1 + n * 0.04, 1 - n * 0.05);
    cols.set([tint.r, tint.g, tint.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x98aa5c, map: grassTexture(30), vertexColors: true });
  const g = new THREE.Mesh(geo, grassMat);
  g.rotation.x = -Math.PI / 2;
  g.receiveShadow = true;
  scene.add(g);

  // Le camp est de la terre battue ; quelques flaques de boue et du gravier.
  const campGeo = new THREE.ShapeGeometry(blobShape(CAMP.maxX + 0.6, CAMP.maxZ + 0.6, r, 0.1));
  planarUV(campGeo, 1 / 6);
  const camp = new THREE.Mesh(campGeo, campDirt(0xc9a57a));
  camp.rotation.x = -Math.PI / 2;
  camp.position.set(0, 0.01, 0);
  camp.receiveShadow = true;
  scene.add(camp);
  const mud: [number, number, number, number, number][] = [
    [0, 0.5, 3.4, 3.0, 0x9a7650], [-7.8, -4.8, 4.2, 3.6, 0x8f6d48], [6.4, -8.2, 3.2, 2.2, 0xa88660],
    [0, 7.5, 1.6, 3.6, 0xa88660], [-9.2, 5.6, 2.6, 2.0, 0x9a7650], [10.2, -4.2, 2.6, 2.4, 0xa88660],
    [7.5, 9.4, 3.2, 1.6, 0xa88660],
  ];
  for (const [x, z, rx, rz, c] of mud) patch(scene, x, z, rx, rz, c, 0.015, r, undefined, CAMP_SEEN);
  // Chemins de terre vers les portes et vers le bus.
  const tracks: [number, number, number, number][] = [[0, 14.5, 2.4, 3.6], [0, -14.5, 2.2, 3.6], [-14, 15.8, 3, 1.6], [6.2, 13.6, 1.8, 2.6]];
  for (const [x, z, rx, rz] of tracks) patch(scene, x, z, rx, rz, C.dirt, 0.012, r);

  const COUNT = 1000;
  const tufts: Inst[] = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  // Plusieurs verts voisins, un ou deux blonds : des touffes douces, jamais un aplat.
  const greens = [0x6f8a3e, 0x80994a, 0xa1b35e, 0xb5aa6c, 0x92a157];
  const onRoad = (z: number) => Math.abs(z - ROAD_Z) < 3.4;
  let n = 0;
  let tries = 0;
  while (n < COUNT && tries++ < COUNT * 20) {
    const x = (r() - 0.5) * 96;
    const z = (r() - 0.5) * 96;
    // Pas d'herbe dans le camp, sauf des mauvaises herbes au pied de la palissade.
    // Pas d'herbe dans le camp, ni dans les bandes ou il s'agrandira (jusqu'a ±19).
    const inCamp = x > -19.6 && x < 19.6 && z > CAMP.minZ && z < CAMP.maxZ;
    const atWall = inCamp && (x < -18.9 || x > 18.9 || z < CAMP.minZ + 0.7);
    const wet = Math.hypot((x - POND.x) / (POND.rx + 0.4), (z - POND.z) / (POND.rz + 0.4)) < 1;
    const paved = Math.abs(x - 35) < 9.5 && Math.abs(z - 12) < 6.5;
    if ((inCamp && !atWall) || wet || paved || (onRoad(z) && r() < 0.85)) continue;
    // Peu d'inclinaison : les brins restent ouverts vers le ciel.
    e.set((r() - 0.5) * 0.3, r() * 6, (r() - 0.5) * 0.3);
    q.setFromEuler(e);
    const s = 0.6 + r() * 0.9;
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s * (0.8 + r() * 0.8), s));
    tufts.push({ m: m4.clone(), c: greens[Math.floor(r() * greens.length)]!, x, z });
    n++;
  }
  tiledInstances(scene, tuftGeo(), tufts, true);

  // Quelques fleurs sauvages, discretes, hors du camp.
  const FL = 140;
  const flowers: Inst[] = [];
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
      if (insideCamp(x, z) || Math.abs(x) < 21 && Math.abs(z) < 13 || onRoad(z)) continue;
      q.setFromEuler(e.set(0, n * 1.7, 0));
      m4.compose(new THREE.Vector3(x, 0.16 + r() * 0.1, z), q, new THREE.Vector3(1, 0.7, 1));
      flowers.push({ m: m4.clone(), c, x, z });
      n++;
    }
  }
  tiledInstances(scene, flowerGeo(), flowers, false);
}

interface Inst { m: THREE.Matrix4; c: number; x: number; z: number }
/**
 * Repartit des instances (herbe, fleurs) par tuiles de terrain : chaque tuile a sa sphere
 * englobante, donc seules celles a l'ecran (ou dans l'ombre) sont dessinees.
 */
function tiledInstances(scene: THREE.Scene, geo: THREE.BufferGeometry, list: Inst[], receive: boolean): void {
  const TILE = 24;
  const tiles = new Map<string, Inst[]>();
  for (const it of list) {
    const k = `${Math.floor(it.x / TILE)},${Math.floor(it.z / TILE)}`;
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = []));
    t.push(it);
  }
  const col = new THREE.Color();
  for (const t of tiles.values()) {
    const mesh = new THREE.InstancedMesh(geo, vmat(), t.length);
    t.forEach((it, i) => {
      mesh.setMatrixAt(i, it.m);
      mesh.setColorAt(i, col.setHex(it.c));
    });
    mesh.computeBoundingSphere();
    mesh.receiveShadow = receive;
    scene.add(mesh);
  }
}

function road(scene: THREE.Scene, r: () => number): void {
  // Bitume use mais propre : traces de roues plus claires, bord effrite, accotement de
  // gravier qui se fond dans l'herbe. Une seule nappe a couleurs de sommets (sol).
  const rows = [-3.75, -3.3, -3.04, -3.0, -2.2, -1.5, -0.8, 0, 0.8, 1.5, 2.2, 3.0, 3.04, 3.3, 3.75];
  const NX = 68;
  const DX = 170 / NX;
  const asph = new THREE.Color(0x5f5f5b);
  const worn = new THREE.Color(0x6c6b66);
  const crumb = new THREE.Color(0x6e6b64);
  const gravel = new THREE.Color(0x968d7c);
  const fade = gravel.clone().lerp(new THREE.Color(GRASS_SEEN), 0.7);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let ix = 0; ix <= NX; ix++) {
    const x = -85 + ix * DX;
    for (const dz of rows) {
      const a = Math.abs(dz);
      const out = a > 3.2 ? Math.sign(dz) * 0.28 * soft(x * 0.3, dz) : 0;
      pos.push(x, a <= 3.0 ? 0.04 : a < 3.2 ? 0.032 : 0.022, ROAD_Z + dz + out);
      nor.push(0, 1, 0);
      if (a <= 3.0) c.copy(a === 3.0 ? crumb : a === 0.8 || a === 2.2 ? worn : asph);
      else c.copy(a < 3.5 ? gravel : fade);
      c.multiplyScalar(1 + 0.05 * soft(x * 0.21, dz * 0.7));
      col.push(c.r, c.g, c.b);
    }
  }
  const R = rows.length;
  const idx: number[] = [];
  for (let ix = 0; ix < NX; ix++) {
    for (let k = 0; k < R - 1; k++) {
      const a = ix * R + k;
      const b = a + R;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const asphalt = new THREE.Mesh(makeGeo(pos, nor, idx, col, true), groundVMat());
  asphalt.receiveShadow = true;
  scene.add(asphalt);
  // Marquage central, plus ou moins efface.
  const paints = [0xd6cdb4, 0xc6bea8, 0xb2ab98];
  for (let x = -84; x < 84; x += 5) {
    if (r() < 0.45) continue;
    const d = box(2.2, 0.05, 0.22, groundMat(paints[Math.floor(hashf(x) * 3)]!), x, 0.03, ROAD_Z);
    d.castShadow = false;
    scene.add(d);
  }
  // Fissures et nids-de-poule.
  for (let i = 0; i < 40; i++) {
    const x = (r() - 0.5) * 100;
    const z = ROAD_Z + (r() - 0.5) * 5;
    if (Math.abs(x - 6.2) < 2.5) continue;
    const c0 = box(0.8 + r() * 1.8, 0.05, 0.08, groundMat(0x4a4a46), x, 0.035, z);
    c0.rotation.y = (r() - 0.5) * 1.2;
    c0.castShadow = false;
    scene.add(c0);
    if (r() < 0.3) {
      const h = cyl(0.4 + r() * 0.4, 0.4, 0.05, groundMat(0x4e4d49), 8, x + 1, 0.03, z + 0.3);
      h.castShadow = false;
      scene.add(h);
    }
  }
  // Herbes qui percent le bitume, debris, plots de chantier.
  for (let i = 0; i < 26; i++) {
    const x = (r() - 0.5) * 90;
    const z = ROAD_Z + (r() - 0.5) * 5;
    if (Math.abs(x - 6.2) < 2.5 || Math.abs(x - L.bus.x) < 4) continue;
    const b = puff(0.26 + r() * 0.2, r() < 0.5 ? C.grassDark : 0x9c9a5c, x, 0.08, z, i % 3, 0.3);
    b.scale.y = 0.55;
    scene.add(b);
  }
  const TC: Profile = [
    [0, 0], [0.2, 0], [0.215, 0.02], [0.2, 0.05], [0.172, 0.15], [0.14, 0.27], [0.138, 0.275],
    [0.115, 0.37], [0.113, 0.375], [0.06, 0.56], [0.04, 0.6], [0, 0.61],
  ];
  const orange = new THREE.Color(0xe8742a);
  const orangeDark = new THREE.Color(0xc75d1f);
  const band = new THREE.Color(C.white);
  for (const [x, z] of [[-6, 16.6], [-5.2, 16.9], [11, 16.5], [19, 21.6]] as const) {
    const body = paint(lathe(TC, 0xe8742a, 0, 0.05, 0), 'tcone', (_x, y, _z, out) => {
      out.copy(y > 0.272 && y < 0.373 ? band : y < 0.06 ? orangeDark : orange);
    });
    const cone0 = group(body, plank(0.5, 0.05, 0.5, 0x2b2b2b, 0, 0.025, 0));
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

// ---------------------------------------------------------------- feu

let _flame: THREE.BufferGeometry | null = null;
let _flameMat: THREE.MeshBasicMaterial | null = null;
/**
 * Flammes : quatre langues en goutte d'eau, penchees, fusionnees en une geometrie a
 * couleurs de sommets (coeur jaune vif, pointes orange). Materiau Basic partage : toujours
 * lumineux, un seul appel de dessin par feu.
 */
function flameMesh(): THREE.Mesh {
  if (!_flame) {
    const tongues: [number, number, number, number, number, number][] = [
      // x, z, rayon, hauteur, penche en x, penche en z
      [0, 0, 0.36, 1.05, 0.04, 0], [0.17, 0.08, 0.22, 0.74, 0.22, 0.08],
      [-0.15, 0.1, 0.2, 0.64, -0.2, 0.14], [0.02, -0.17, 0.21, 0.7, 0.04, -0.22],
    ];
    const lo = new THREE.Color(0xffe27a).multiplyScalar(1.7);
    const mid = new THREE.Color(0xffa23a).multiplyScalar(1.35);
    const hi = new THREE.Color(0xff5a1e).multiplyScalar(1.1);
    const parts: THREE.BufferGeometry[] = [];
    for (const [x, z, R, H, lx, lz] of tongues) {
      const prof: [number, number][] = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        prof.push([R * Math.sin(Math.PI * Math.pow(t, 0.62)), t * H]);
      }
      const g = tinted(lathe(prof, 0xffffff).geometry, (_x, y, _z, out) => {
        const t = y / H;
        if (t < 0.45) out.lerpColors(lo, mid, t / 0.45); else out.lerpColors(mid, hi, (t - 0.45) / 0.55);
      });
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const t = p.getY(i) / H;
        p.setXYZ(i, p.getX(i) + x + lx * t * t, p.getY(i), p.getZ(i) + z + lz * t * t);
      }
      parts.push(g);
    }
    _flame = mergeGeometries(parts, false) ?? parts[0]!;
    _flame.computeBoundingSphere();
    _flameMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  }
  const m = new THREE.Mesh(_flame, _flameMat!);
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Braises : emissif sombre et partage (les feux de camp et les futs en partagent un seul). */
const ember = (): THREE.MeshLambertMaterial => mat(0x4a2412, { emissive: 0x7a2a0a });

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
  // Plateau en trois planches de teintes voisines.
  const tones = [0xc8a878, 0xbd9c6a, 0xd0b285];
  for (let i = 0; i < 3; i++) g.add(plank(W - 0.1, 0.1, 0.33, tones[i]!, 0, 1.0, (i - 1) * 0.335));
  g.add(plank(W - 0.2, 0.05, 0.12, 0x8a6a48, 0, 1.06, 0.45));
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
  const stones = [C.stone, 0x85837b, 0xa8a59b];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const s = blob(0.26, stones[i % 3]!, Math.cos(a) * 0.75, 0.14, Math.sin(a) * 0.75);
    s.scale.set(1.05, 0.7, 0.9);
    s.rotation.y = -a;
    g.add(s);
  }
  // Lit de braises sous les buches.
  const bed = blob(0.5, ember(), 0, 0.03, 0);
  bed.scale.y = 0.2;
  g.add(bed);
  for (let i = 0; i < 4; i++) {
    const lg = log(0.11, 1.1, C.bark, true);
    lg.position.y = 0.18;
    lg.rotation.z = Math.PI / 2 - 0.35;
    const holder = group(lg);
    holder.rotation.y = (i / 4) * Math.PI * 2;
    g.add(holder);
  }
  // Trepied et marmite.
  for (let i = 0; i < 3; i++) {
    const leg = cyl(0.03, 0.03, 1.9, 0x4a4440, 4, 0, 0.9, 0);
    leg.rotation.z = 0.32;
    const h = group(leg);
    h.rotation.y = (i / 3) * Math.PI * 2;
    h.children[0]!.position.x = 0.3;
    g.add(h);
  }
  const POT: Profile = [
    [0, 0], [0.14, 0], [0.2, 0.05], [0.222, 0.15], [0.205, 0.25], [0.232, 0.265], [0.232, 0.29],
    [0.16, 0.3], [0.06, 0.33], [0.045, 0.36], [0, 0.37],
  ];
  g.add(vgrad(lathe(POT, 0x2f2f2f, 0, 0.9, 0), 0x1f1d1c, 0x45423f));
  const flame = group(at(flameMesh(), 0, 0.06, 0));
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
  const seat = log(0.33, 2.0, C.bark);
  seat.position.y = 0.32;
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
  // Groupe electrogene dans son cadre de tubes.
  const body = vgrad(rbox(1.0, 0.6, 0.6, 0x6f8a3a, 0.08, 0, 0.42, 0), 0x5c7430, 0x7f9a45);
  const gen = group(
    body,
    plank(1.1, 0.12, 0.7, 0x2b2b2b, 0, 0.08, 0),
    cyl(0.14, 0.14, 0.04, 0x2b2b2b, 10, 0.3, 0.42, 0.31),
    plank(0.34, 0.24, 0.03, 0xd9c9a3, -0.18, 0.45, 0.305),
    cyl(0.05, 0.05, 0.32, 0x3a3a3a, 8, -0.35, 0.86, 0),
  );
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) gen.add(cyl(0.028, 0.028, 0.7, 0x3a3d40, 8, sx * 0.53, 0.47, sz * 0.33));
  for (const sz of [-1, 1]) {
    const rail = cyl(0.028, 0.028, 1.08, 0x3a3d40, 8, 0, 0.82, sz * 0.33);
    rail.rotation.z = Math.PI / 2;
    gen.add(rail);
  }
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
  g.add(cyl(0.29, 0.29, 0.04, ember(), 10, 0, 0.9, 0));
  const fm = at(flameMesh(), 0, 0.88, 0);
  fm.scale.setScalar(0.62);
  const flame = group(fm);
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
}

/** Cuve a eau de pluie : cuve laiteuse dans sa cage, sur palette, entonnoir de bache. */
function rainCollector(scene: THREE.Scene, w: World, x: number, z: number): void {
  const cage = 0x5f666b;
  const g = group(
    plank(1.2, 0.1, 0.2, C.woodDark, 0, 0.05, -0.5), plank(1.2, 0.1, 0.2, C.bark, 0, 0.05, 0), plank(1.2, 0.1, 0.2, C.woodDark, 0, 0.05, 0.5),
    // Cuve : l'eau se devine dans le bas, plus bleutee.
    vgrad(rbox(1.05, 1.05, 1.05, 0xe8e6dc, 0.1, 0, 0.62, 0), 0xa3bcbf, 0xf1eee4),
    cyl(0.2, 0.2, 0.1, 0x3f6a8a, 8, 0, 1.18, 0),
    at(drum(0x3f6a8a, false), 1.0, 0, 0.2),
  );
  // Cage de tubes : montants aux coins et au milieu des faces, deux ceintures.
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 0, 1]) {
    if (sx === 0 && sz === 0) continue;
    g.add(cyl(0.025, 0.025, 1.1, cage, 8, sx * 0.55, 0.62, sz * 0.55));
  }
  for (const y of [0.35, 0.9]) {
    for (const s of [-1, 1]) {
      const a = cyl(0.025, 0.025, 1.12, cage, 8, 0, y, s * 0.55);
      a.rotation.z = Math.PI / 2;
      const b = cyl(0.025, 0.025, 1.12, cage, 8, s * 0.55, y, 0);
      b.rotation.x = Math.PI / 2;
      g.add(a, b);
    }
  }
  const FUNNEL: Profile = [[0, 0], [0.14, 0], [0.17, 0.05], [0.6, 0.34], [0.64, 0.38], [0.62, 0.41], [0.56, 0.39], [0, 0.3]];
  g.add(lathe(FUNNEL, C.tarp, 0, 1.24, 0));
  scene.add(shadow(at(g, x, 0, z, 0.25)));
  w.solids.push({ x, z, r: 1.1 });
}

/** Deux panneaux solaires inclines : cadre alu, six cellules ou glisse un reflet de ciel. */
function solarRig(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  const deep = new THREE.Color(0x24427a);
  const sky = new THREE.Color(0x4474b2);
  for (let i = 0; i < 2; i++) {
    const panel = group(rbox(1.5, 0.07, 1.0, 0xb9c0c4, 0.03, 0, 0, 0));
    for (const cx of [-0.47, 0, 0.47]) {
      for (const cz of [-0.23, 0.23]) {
        panel.add(paint(box(0.44, 0.03, 0.42, 0x2c4f8a, cx, 0.03, cz), 'cell', (_x, _y, pz, out) => {
          out.lerpColors(deep, sky, pz / 0.42 + 0.5);
        }));
      }
    }
    panel.rotation.x = -0.5;
    panel.position.set(-0.8 + i * 1.6, 1.2, 0);
    g.add(panel, cyl(0.05, 0.05, 1.2, C.metal, 5, -0.8 + i * 1.6, 0.6, 0.2), cyl(0.04, 0.04, 1.0, C.metal, 5, -0.8 + i * 1.6, 0.5, -0.33));
  }
  const beam = cyl(0.035, 0.035, 1.7, C.metal, 8, 0, 0.55, 0.2);
  beam.rotation.z = Math.PI / 2;
  g.add(beam, at(crate(0.5, C.olive), 0.2, 0, 0.9));
  scene.add(shadow(at(g, x, 0, z, 0.4)));
  w.solids.push({ x, z, r: 1.4 });
}

/** Citerne sur pilotis : pieds et croisillons de bois, plancher de planches, cuve bombee rouillee. */
function waterTank(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(plank(0.14, 1.8, 0.14, C.woodDark, sx * 0.6, 0.9, sz * 0.6));
  // Croisillons sur les quatre faces.
  for (let f = 0; f < 4; f++) {
    const brace = plank(1.85, 0.08, 0.05, C.bark, 0, 0.95, 0.64);
    brace.rotation.z = (f % 2 ? 1 : -1) * 0.9;
    g.add(at(group(brace), 0, 0, 0, (f * Math.PI) / 2));
  }
  const deck = [C.wood, 0xb97f48, 0xcd9459, 0xbf854e, C.wood];
  for (let i = 0; i < 5; i++) g.add(plank(0.3, 0.12, 1.5, deck[i]!, -0.6 + i * 0.3, 1.8, 0));
  const TANK: Profile = [
    [0, 1.86], [0.7, 1.86], [0.75, 1.91], [0.75, 2.3], [0.75, 2.7], [0.75, 3.1], [0.72, 3.18], [0.5, 3.3],
    [0.16, 3.36], [0.16, 3.44], [0, 3.44],
  ];
  const steel = new THREE.Color(0x5a7f8f);
  const steelDark = new THREE.Color(0x4a6b7a);
  const rust = new THREE.Color(C.rust);
  const hatch = new THREE.Color(0x3f5a66);
  g.add(paint(lathe(TANK, 0x5a7f8f), 'tank', (px, py, pz, out) => {
    const rr = Math.hypot(px, pz);
    if (py > 3.35) { out.copy(hatch); return; }
    out.lerpColors(steelDark, steel, Math.min(1, (py - 1.86) / 1.2));
    // Coulures de rouille sous la ceinture haute, sur trois cotes.
    if (rr > 0.74 && py < 3.05) {
      const s = Math.pow(Math.max(0, Math.cos(Math.atan2(px, pz) * 3)), 6);
      out.lerp(rust, s * Math.min(1, (3.05 - py) / 0.8) * 0.75);
    }
  }));
  g.add(cyl(0.78, 0.78, 0.1, 0x3f5a66, 12, 0, 3.02, 0), cyl(0.78, 0.78, 0.1, 0x3f5a66, 12, 0, 2.0, 0));
  // Tuyau de vidange et son seau.
  g.add(cyl(0.045, 0.045, 1.75, C.metal, 8, 0.35, 0.92, 0.35));
  const BUCKET: Profile = [[0, 0], [0.13, 0], [0.17, 0.3], [0.18, 0.31], [0.165, 0.32], [0, 0.26]];
  g.add(lathe(BUCKET, 0x7d8790, 0.35, 0, 0.35));
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
    scene.add(r() < 0.5 ? bush(r, 0.5 + r() * 0.5, x, z) : boulder(r, 0.4 + r() * 0.5, x, z));
  }
  // Herissons anti-vehicules devant le camp : on sait ce qui rode ici.
  const hogs: [number, number][] = [[-9.6, 13.4], [-6.4, 14.0], [10.4, 13.6], [12.8, 13.2], [22, -9], [22.4, 8.5], [-21.5, 9], [-20.5, -13]];
  for (const [x, z] of hogs) {
    scene.add(shadow(at(hedgehog(), x, 0, z, r() * 3)));
    w.solids.push({ x, z, r: 0.7 });
  }
  scene.add(shadow(at(wreck(0x5f7a8a), 19.6, 0, -16.2, 1.2)));
  w.solids.push({ x: 19.6, z: -16.2, r: 1.8 });
  ruinsBlock(scene, w, r, 26.5, -3);
  pylon(scene, w, -21, -4);
}

/** Un angle d'immeuble effondre : murs en escalier casses, mousse, lierre, gravats, distributeur couche. */
function ruinsBlock(scene: THREE.Scene, w: World, r: () => number, x: number, z: number): void {
  const g = new THREE.Group();
  const grime = (c: number) => mixHex(c, 0x6f685c, 0.3);
  const wall = (len: number, along: 'x' | 'z', ox: number, oz: number) => {
    const n = Math.round(len / 0.8);
    for (let i = 0; i < n; i++) {
      const h = 1 + r() * 3.2 * Math.sin((i / n) * Math.PI) + 0.4;
      const c = r() < 0.2 ? C.concreteDark : C.concrete;
      const seg = vgrad(box(0.82, h, 0.5, c, 0, h / 2, 0), grime(c), mixHex(c, 0xffffff, 0.06));
      const px = along === 'x' ? ox + i * 0.8 : ox;
      const pz = along === 'z' ? oz + i * 0.8 : oz;
      seg.position.x = px;
      seg.position.z = pz;
      if (along === 'z') seg.rotation.y = Math.PI / 2;
      g.add(seg);
      // Bloc descelle sur la crete : la cassure n'est pas une marche nette.
      if (hashf(px, pz) < 0.5) {
        const chip = box(0.42, 0.22, 0.46, c, px + (along === 'x' ? 0.12 : 0), h + 0.06, pz + (along === 'z' ? 0.12 : 0));
        chip.rotation.set(0.12, hashf(pz, px) * 0.6, 0.18);
        g.add(chip);
      }
      if (r() < 0.45) g.add(puff(0.3 + r() * 0.25, r() < 0.5 ? C.leaf : C.leafDark, px, h, pz, i % 3, 0.28));
    }
  };
  wall(8, 'x', -4, -4);
  wall(7, 'z', -4, -4);
  // Lierre qui grimpe sur la face sud du mur, coiffe d'une touffe de feuilles.
  for (let i = 0; i < 8; i++) {
    const len = 1.5 + r() * 1.5;
    const vx = -4 + r() * 6;
    g.add(capsule(0.05, len, C.leafDark, vx, 1, -3.7));
    g.add(puff(0.2, i % 2 ? C.leaf : C.leafSun, vx, 1 + len / 2 - 0.1, -3.66, i % 3, 0.3));
  }
  const rubble = [C.concrete, mixHex(C.concrete, C.concreteDark, 0.5), C.concreteDark];
  for (let i = 0; i < 9; i++) {
    const d = rbox(0.4 + r() * 0.6, 0.3 + r() * 0.3, 0.4 + r() * 0.5, rubble[i % 3]!, 0.06, -2 + r() * 6, 0.2, -2 + r() * 6);
    d.rotation.y = r() * 3;
    g.add(d);
  }
  // Distributeur couche : caisse rouge, vitrine claire, fente sombre.
  const vending = group(
    rbox(0.9, 1.8, 0.8, 0x9c4a3c, 0.1, 0, 0, 0),
    plank(0.5, 1.1, 0.05, 0xd8d2c4, -0.12, 0.22, 0.41),
    plank(0.16, 0.5, 0.05, 0x3a3533, 0.3, 0.1, 0.41),
  );
  vending.rotation.z = Math.PI / 2;
  vending.position.set(1, 0.45, 1.5);
  g.add(vending);
  scene.add(shadow(at(g, x, 0, z)));
  w.walls.push({ x1: x - 4, z1: z - 4, x2: x + 4, z2: z - 4 }, { x1: x - 4, z1: z - 4, x2: x - 4, z2: z + 3 });
}

/** Pylone electrique abandonne : treillis, isolateurs, envahi de plantes grimpantes. */
function pylon(scene: THREE.Scene, w: World, x: number, z: number): void {
  const g = new THREE.Group();
  const H = 9;
  const steel = 0x8f969c;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = box(0.14, H, 0.14, steel, sx * 0.9, H / 2, sz * 0.9);
    leg.rotation.z = sx * 0.07;
    leg.rotation.x = -sz * 0.07;
    g.add(leg);
    // Socle de beton sous chaque pied.
    g.add(rcyl(0.24, 0.28, 0.3, C.concrete, 0.3, sx * 0.95, 0.12, sz * 0.95));
  }
  for (let y = 1; y < H; y += 1.6) {
    const s = 1 - (y / H) * 0.6;
    for (const sz of [-1, 1]) {
      const b = box(2 * s, 0.07, 0.07, steel, 0, y, sz * s * 0.95);
      b.rotation.z = 0.6;
      g.add(b);
    }
  }
  g.add(box(4.5, 0.15, 0.15, steel, 0, H - 1, 0), box(3.2, 0.15, 0.15, steel, 0, H - 2.4, 0));
  // Chaines d'isolateurs sous les bras.
  for (const [ix, iy] of [[-2.1, H - 1], [2.1, H - 1], [-1.5, H - 2.4], [1.5, H - 2.4]] as const) {
    g.add(cyl(0.02, 0.02, 0.2, 0x55595c, 8, ix, iy - 0.12, 0));
    for (let k = 0; k < 3; k++) g.add(rcyl(0.09, 0.09, 0.08, 0xd8d2c4, 0.5, ix, iy - 0.28 - k * 0.11, 0));
  }
  const rr = rng(3);
  for (let i = 0; i < 22; i++) {
    const y = rr() * rr() * (H - 1);
    g.add(puff(0.25 + rr() * 0.3, rr() < 0.5 ? C.leaf : C.leafDark, (rr() - 0.5) * 1.8 * (1 - y / H), y, (rr() - 0.5) * 1.8 * (1 - y / H), i % 3, 0.3));
  }
  scene.add(shadow(at(g, x, 0, z, 0.4)));
  w.solids.push({ x, z, r: 1.3 });
}

// ---------------------------------------------------------------- zones de la vallee

let _bar: THREE.BufferGeometry | null = null;
/** Montant de grillage : trop fin pour un biseau, une simple boite (12 triangles) partagee. */
function barGeo(): THREE.BufferGeometry {
  if (!_bar) _bar = new THREE.BoxGeometry(0.03, 1.1, 0.03);
  return _bar;
}

/** Une cloture a lisses ; `into` : groupe ou la poser (sinon la scene). Renvoie sa collision. */
function railFence(scene: THREE.Scene, w: World, x1: number, z1: number, x2: number, z2: number, metal: boolean, into?: THREE.Group): Segment {
  const len = Math.hypot(x2 - x1, z2 - z1);
  const n = Math.max(1, Math.round(len / 2.2));
  const g = new THREE.Group();
  const postC = metal ? 0x6f7479 : C.woodDark;
  const railC = metal ? 0x8f969c : C.wood;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = x1 + (x2 - x1) * t;
    const pz = z1 + (z2 - z1) * t;
    // Piquets de bois au sommet arrondi, poteaux de metal coiffes.
    if (metal) g.add(cyl(0.07, 0.08, 1.3, postC, 5, px, 0.65, pz), cyl(0.09, 0.09, 0.05, 0x5a5f63, 8, px, 1.32, pz));
    else g.add(rcyl(0.075, 0.085, 1.3, postC, 0.5, px, 0.65, pz));
  }
  const ang = Math.atan2(z2 - z1, x2 - x1);
  if (metal) {
    for (const y of [0.5, 1.0, 1.25]) {
      const rail = box(len, 0.05, 0.05, railC, (x1 + x2) / 2, y, (z1 + z2) / 2);
      rail.rotation.y = -ang;
      g.add(rail);
    }
    // Grillage : un panneau semi-ajoure figure par des montants fins.
    const barMat = mat(0x9aa0a3);
    for (let i = 0; i < n * 4; i++) {
      const t = (i + 0.5) / (n * 4);
      g.add(mesh(barGeo(), barMat, x1 + (x2 - x1) * t, 0.65, z1 + (z2 - z1) * t));
    }
  } else {
    // Lisses de bois posees travee par travee : teintes et aplombs un peu differents.
    const tones = [C.wood, mixHex(C.wood, C.woodDark, 0.25), mixHex(C.wood, C.woodLight, 0.2)];
    const span = len / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const cx = x1 + (x2 - x1) * t;
      const cz = z1 + (z2 - z1) * t;
      for (const y of [0.45, 0.95]) {
        const hsh = hashf(cx + y, cz);
        const rail = plank(span + 0.12, 0.1, 0.06, tones[Math.floor(hsh * 3)]!, cx, y + (hsh - 0.5) * 0.06, cz);
        rail.rotation.set(0, -ang, (hsh - 0.5) * 0.06);
        g.add(rail);
      }
    }
  }
  (into ?? scene).add(shadow(g));
  const seg: Segment = { x1, z1, x2, z2 };
  w.walls.push(seg);
  return seg;
}

/** La ferme abandonnee, a l'ouest : enclos, maison effondree, meules, tracteur. */
function farmZone(scene: THREE.Scene, w: World, r: () => number): void {
  const F = FARM;
  // Fusionnee a part et gardee hors du decor fige : la palissade de la ferme la remplace.
  const fence = new THREE.Group();
  const segs = [
    railFence(scene, w, F.minX, F.minZ, F.maxX, F.minZ, false, fence),
    railFence(scene, w, F.minX, F.minZ, F.minX, F.maxZ, false, fence),
    railFence(scene, w, F.maxX, F.minZ, F.maxX, F.maxZ, false, fence),
    railFence(scene, w, F.minX, F.maxZ, F.gateX - F.gate, F.maxZ, false, fence),
    railFence(scene, w, F.gateX + F.gate, F.maxZ, F.maxX, F.maxZ, false, fence),
  ];
  const fenceMesh = mergeColored(fence);
  scene.add(fenceMesh);
  w.keep.add(fenceMesh);
  w.farmFence = { mesh: fenceMesh, segs };
  w.locks.west = { x1: F.gateX - F.gate, z1: F.maxZ, x2: F.gateX + F.gate, z2: F.maxZ };
  w.walls.push(w.locks.west);
  patch(scene, -35, 2, 12, 10, C.dirt, 0.012, r, 0.15);
  // Maison de ferme effondree : murs chaules un peu salis, poteaux d'angle, cheminee de brique.
  const hx = L.farmhouse.x;
  const hz = L.farmhouse.z;
  const lime = 0xd8cfc0;
  const wallM = (m: THREE.Mesh) => vgrad(m, mixHex(lime, 0x8a7a66, 0.3), 0xe3dacb);
  const house = group(
    wallM(box(5, 2.6, 0.3, lime, 0, 1.3, -1.8)), wallM(box(0.3, 2.6, 3.6, lime, -2.5, 1.3, 0)), wallM(box(0.3, 1.4, 3.6, lime, 2.5, 0.7, 0)),
    wallM(box(2.4, 1.8, 0.3, lime, -1.3, 0.9, 1.8)),
  );
  const roof = roofSheet(5.4, 2.4, 0x8a4526);
  roof.position.set(0.4, 1.6, -0.4);
  roof.rotation.set(0.5, 0, -0.35);
  house.add(roof, box(0.8, 1.3, 0.05, 0x2e3439, -1.0, 1.4, 1.96));
  house.add(
    plank(0.34, 2.75, 0.34, C.woodDark, -2.5, 1.37, -1.8), plank(0.34, 2.75, 0.34, C.woodDark, 2.5, 1.37, -1.8),
    plank(0.34, 1.9, 0.34, C.woodDark, -2.5, 0.95, 1.8), plank(0.34, 1.5, 0.34, C.woodDark, 2.5, 0.75, 1.8),
    rbox(0.6, 3.3, 0.6, C.brick, 0.06, -1.9, 1.65, -1.75), plank(0.72, 0.12, 0.72, mixHex(C.brick, 0x000000, 0.2), -1.9, 3.32, -1.75),
  );
  // Poutre tombee et gravats dans la piece.
  const beam = plank(2.8, 0.18, 0.18, C.bark, 0.6, 0.45, 0.4);
  beam.rotation.set(0, 0.5, 0.3);
  house.add(beam, blob(0.45, lime, 1.4, 0.15, 0.9), blob(0.32, mixHex(lime, C.concreteDark, 0.4), 1.0, 0.1, 1.3));
  scene.add(shadow(at(house, hx, 0, hz)));
  w.walls.push({ x1: hx - 2.5, z1: hz - 1.8, x2: hx + 2.5, z2: hz - 1.8 }, { x1: hx - 2.5, z1: hz - 1.8, x2: hx - 2.5, z2: hz + 1.8 },
    { x1: hx + 2.5, z1: hz - 1.8, x2: hx + 2.5, z2: hz + 1.8 }, { x1: hx - 2.5, z1: hz + 1.8, x2: hx, z2: hz + 1.8 });
  // Meules de foin, epouvantail, abreuvoir, tracteur rouille.
  const hayS = new THREE.Color(0xd9b24a);
  const hayEnd = new THREE.Color(0xe6c56a);
  const hayCore = new THREE.Color(0xbf963a);
  for (const [x, z] of [[-45, -6.5], [-44, -4.6], [-46, 0.5]] as const) {
    const hay = paint(rcyl(0.8, 0.8, 1.1, 0xd9b24a, 0.3), 'hay', (px, py, pz, out) => {
      const rr = Math.hypot(px, pz);
      if (Math.abs(py) > 0.54 && rr < 0.6) out.lerpColors(hayCore, hayEnd, rr / 0.6);
      else out.copy(hayS).multiplyScalar(1 + 0.05 * Math.sin(Math.atan2(px, pz) * 7));
    });
    hay.position.y = 0.8;
    hay.rotation.z = Math.PI / 2;
    scene.add(shadow(at(group(hay), x, 0, z, r() * 3)));
    w.solids.push({ x, z, r: 0.9 });
  }
  const HAT: Profile = [[0, 0], [0.36, 0], [0.37, 0.03], [0.2, 0.05], [0.17, 0.24], [0, 0.27]];
  const sleeve = capsule(0.09, 1.0, 0x6f7a4a, 0, 1.5, 0);
  sleeve.rotation.z = Math.PI / 2;
  const crow = group(plank(0.1, 2.0, 0.1, C.woodDark, 0, 1.0, 0), plank(1.4, 0.07, 0.07, C.woodDark, 0, 1.5, 0), sleeve,
    rbox(0.5, 0.6, 0.3, 0x6f7a4a, 0.1, 0, 1.4, 0), plank(0.14, 0.14, 0.03, C.brick, 0.1, 1.32, 0.15),
    puff(0.09, 0xd9b24a, 0.56, 1.5, 0, 1), puff(0.09, 0xd9b24a, -0.56, 1.5, 0, 2), puff(0.1, 0xd9b24a, 0, 1.08, 0, 0),
    blob(0.22, 0xcdb88c, 0, 1.9, 0), lathe(HAT, 0x8a6a3a, 0, 2.02, 0));
  scene.add(shadow(at(crow, -33.5, 0, 10.5, 0.4)));
  const red = 0xa5603a;
  const tractor = group(vgrad(rbox(2.2, 1.0, 1.3, red, 0.14, 0, 0.9, 0), mixHex(red, C.rustDark, 0.5), mixHex(red, 0xffffff, 0.05)),
    rbox(1.0, 1.0, 1.1, 0x8a4526, 0.12, -0.5, 1.8, 0),
    at(tire(), -0.6, 0.7, 0.75), at(tire(), -0.6, 0.7, -0.75), at(tire(), 0.8, 0.4, 0.7), at(tire(), 0.8, 0.4, -0.7));
  tractor.children.slice(2).forEach((t) => { t.rotation.set(0, 0, 0); t.scale.setScalar(t.position.y > 0.5 ? 1.6 : 1); });
  // Calandre, cabine (toit, vitre), echappement, garde-boues.
  tractor.add(
    plank(0.06, 0.6, 0.9, 0x3a2e28, 1.12, 0.95, 0),
    plank(1.25, 0.08, 1.25, 0x6f3a22, -0.5, 2.34, 0),
    plank(0.04, 0.5, 0.8, 0x2e3439, 0.01, 1.95, 0),
    cyl(0.05, 0.05, 0.9, 0x3a3a3a, 8, 0.6, 1.75, 0.35),
    plank(1.4, 0.08, 0.32, red, -0.6, 1.56, 0.78), plank(1.4, 0.08, 0.32, red, -0.6, 1.56, -0.78),
  );
  scene.add(shadow(at(tractor, -25.2, 0, 11.2, 0.3)));
  w.solids.push({ x: -25.2, z: 11.2, r: 1.4 });
  scene.add(shadow(at(group(rbox(1.6, 0.5, 0.6, 0x7d8790, 0.06, 0, 0.25, 0), box(1.42, 0.05, 0.42, 0x4f8fa0, 0, 0.48, 0)), -38.5, 0, 9.5, 0.2)));
  w.solids.push({ x: -38.5, z: 9.5, r: 0.8 });
}

/** La station-service, a l'est : auvent, pompes, boutique pillee. */
function stationZone(scene: THREE.Scene, w: World, r: () => number): void {
  const S = STATION;
  railFence(scene, w, S.minX, S.minZ, S.maxX, S.minZ, true);
  railFence(scene, w, S.minX, S.maxZ, S.maxX, S.maxZ, true);
  railFence(scene, w, S.maxX, S.minZ, S.maxX, S.maxZ, true);
  railFence(scene, w, S.minX, S.minZ, S.minX, S.gateZ - S.gate, true);
  railFence(scene, w, S.minX, S.gateZ + S.gate, S.minX, S.maxZ, true);
  w.locks.east = { x1: S.minX, z1: S.gateZ - S.gate, x2: S.minX, z2: S.gateZ + S.gate };
  w.walls.push(w.locks.east);
  for (const z of [17, 19, 21]) scene.add(shadow(at(jersey(1.8, true), S.maxX - 0.6, 0, z, Math.PI / 2)));
  patch(scene, 35, 12, 9, 6, 0x8a8a84, 0.013, r, 0.08);
  // L'auvent et ses piliers : dalle blanche, bandeau rouge a liseret blanc.
  const { x, z } = L.canopy;
  const canopy = group(
    rbox(7.2, 0.3, 4.2, C.white, 0.08, 0, 3.7, 0),
    rbox(7.25, 0.32, 0.2, 0xc9412f, 0.06, 0, 3.7, 2.1), rbox(7.25, 0.32, 0.2, 0xc9412f, 0.06, 0, 3.7, -2.1),
    plank(7.3, 0.06, 0.22, C.white, 0, 3.62, 2.1), plank(7.3, 0.06, 0.22, C.white, 0, 3.62, -2.1),
  );
  for (const sx of [-3, 3]) canopy.add(rbox(0.3, 3.6, 0.3, C.concrete, 0.06, sx, 1.8, 0), plank(0.46, 0.32, 0.46, C.concreteDark, sx, 0.16, 0));
  const torn = box(2.2, 0.05, 1.4, C.white, 2.6, 2.9, 1.6);
  torn.rotation.set(0.5, 0.2, 0.4);
  canopy.add(torn);
  scene.add(shadow(at(canopy, x, 0, z)));
  w.solids.push({ x: x - 3, z, r: 0.35 }, { x: x + 3, z, r: 0.35 });
  // La boutique : murs de parpaing salis, vitrine condamnee, climatiseur sur le toit.
  const { x: bx, z: bz } = L.shop;
  const cw = (m: THREE.Mesh) => vgrad(m, mixHex(C.concrete, 0x6f685c, 0.28), mixHex(C.concrete, 0xffffff, 0.05));
  const shop = group(
    cw(box(6, 3, 0.3, C.concrete, 0, 1.5, -2)), cw(box(0.3, 3, 4, C.concrete, -3, 1.5, 0)), cw(box(0.3, 3, 4, C.concrete, 3, 1.5, 0)),
    cw(box(2.2, 3, 0.3, C.concrete, -1.9, 1.5, 2)), cw(box(2.2, 3, 0.3, C.concrete, 1.9, 1.5, 2)), plank(6.2, 0.3, 4.4, C.concreteDark, 0, 3.1, 0),
    rbox(3.4, 0.7, 0.1, 0xc9412f, 0.04, 0, 3.6, 2.2), plank(3.0, 0.1, 0.12, C.white, 0, 3.6, 2.24),
    plank(1.72, 1.32, 0.06, 0xd8d2c4, -1.9, 1.6, 2.16), box(1.5, 1.1, 0.06, 0x2e3a42, -1.9, 1.6, 2.19),
    rbox(0.9, 0.5, 0.7, 0xb9c0c4, 0.06, 1.5, 3.5, -0.8), cyl(0.24, 0.24, 0.04, 0x55595c, 12, 1.5, 3.76, -0.8),
  );
  // Vitrine condamnee : deux planches en croix.
  for (const s of [-1, 1]) {
    const b = plank(1.9, 0.16, 0.05, C.woodLight, -1.9, 1.6, 2.24);
    b.rotation.z = s * 0.55;
    shop.add(b);
  }
  scene.add(shadow(at(shop, bx, 0, bz)));
  w.walls.push({ x1: bx - 3, z1: bz - 2, x2: bx + 3, z2: bz - 2 }, { x1: bx - 3, z1: bz - 2, x2: bx - 3, z2: bz + 2 },
    { x1: bx + 3, z1: bz - 2, x2: bx + 3, z2: bz + 2 }, { x1: bx - 3, z1: bz + 2, x2: bx - 0.8, z2: bz + 2 }, { x1: bx + 0.8, z1: bz + 2, x2: bx + 3, z2: bz + 2 });
  // Panneau de prix sur un mat, futs, pneus.
  scene.add(shadow(at(group(
    cyl(0.13, 0.15, 5, 0x6f7479, 8, 0, 2.5, 0), rbox(1.6, 1.4, 0.2, C.white, 0.06, 0, 5, 0), rbox(1.6, 0.3, 0.22, 0xc9412f, 0.05, 0, 5.5, 0),
    plank(1.1, 0.16, 0.04, 0x3a3f44, 0, 4.95, 0.11), plank(1.1, 0.16, 0.04, 0x3a3f44, 0, 4.6, 0.11),
  ), 27.5, 0, 8)));
  w.solids.push({ x: 27.5, z: 8, r: 0.3 });
  for (const [px, pz] of [[38.5, 15.5], [39.2, 16.1], [46.5, 7.5]] as const) {
    scene.add(shadow(at(drum(0x3f6a8a), px, 0, pz)));
    w.solids.push({ x: px, z: pz, r: 0.4 });
  }
  scene.add(shadow(at(tireStack(3, 17), 47.5, 0, 28)));
}

const bladeGeos = new Map<string, THREE.BufferGeometry>();
/**
 * Feuille de roseau de hauteur 1 (mise a l'echelle par le maillage) : effilee, courbee
 * vers l'exterieur, deux faces, normales vers le ciel. Pied sombre, pointe blonde.
 */
function bladeGeo(color: number, variant: number): THREE.BufferGeometry {
  const key = `${color},${variant}`;
  let g = bladeGeos.get(key);
  if (!g) {
    const lean = [0.24, 0.34, 0.16][variant % 3]!;
    const pts: [number, number, number][] = [[0, 0, 0.035], [0.45, lean * 0.18, 0.03], [0.8, lean * 0.55, 0.018], [1, lean, 0]];
    const base = new THREE.Color(color).multiplyScalar(0.7);
    const tip = new THREE.Color(mixHex(color, 0xd8c88a, 0.45));
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    for (const [y, o, hw] of pts) {
      c.lerpColors(base, tip, y);
      for (const s of hw > 0 ? [-1, 1] : [0]) {
        pos.push(s * hw, y, o);
        const l = Math.hypot(0.5, 1);
        nor.push(0, 1 / l, 0.5 / l);
        col.push(c.r, c.g, c.b);
      }
    }
    // Sommets : 0-1, 2-3, 4-5, 6 (pointe).
    const tri = (a: number, b: number, d: number) => idx.push(a, b, d, a, d, b);
    tri(0, 1, 3); tri(0, 3, 2); tri(2, 3, 5); tri(2, 5, 4); tri(4, 5, 6);
    g = makeGeo(pos, nor, idx, col, false);
    bladeGeos.set(key, g);
  }
  return g;
}

/** Touffe de roseaux : trois feuilles en eventail, parfois une massette brune sur sa tige. */
function reeds(x: number, z: number, hgt: number, color: number, i: number): THREE.Group {
  const g = new THREE.Group();
  for (let k = 0; k < 3; k++) {
    const m = mesh(bladeGeo(color, i + k), vmat(), 0, 0, 0);
    m.scale.set(1, hgt * (1 - k * 0.18), 1);
    m.rotation.y = i * 2.1 + k * 2.2;
    g.add(m);
  }
  if (i % 3 === 0) {
    g.add(capsule(0.022, hgt * 1.08, 0x7f8a52, 0, hgt * 0.54, 0), capsule(0.05, 0.24, 0x6b4a2e, 0, hgt * 1.04, 0));
  }
  g.position.set(x, 0, z);
  return g;
}

/** Eau de l'etang : disque en anneaux, profond et sombre au milieu, clair sur les hauts-fonds. */
function waterGeo(): THREE.BufferGeometry {
  const rings: [number, number][] = [[0.4, 0x2f6676], [0.7, 0x3a7487], [0.86, 0x4f8a94], [0.95, 0x66a0a0], [1, 0x8cbcae]];
  const N = 48;
  const pos: number[] = [0, 0, 0];
  const nor: number[] = [0, 0, 1];
  const uv: number[] = [0.5, 0.5];
  const c = new THREE.Color(0x2a5e6e);
  const col: number[] = [c.r, c.g, c.b];
  for (const [s, hex] of rings) {
    c.setHex(hex);
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2;
      const px = Math.cos(a) * s;
      const py = Math.sin(a) * s;
      pos.push(px, py, 0);
      nor.push(0, 0, 1);
      uv.push(px * 0.5 + 0.5, py * 0.5 + 0.5);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < N; j++) idx.push(0, 1 + j, 1 + ((j + 1) % N));
  for (let q = 0; q < rings.length - 1; q++) {
    const a0 = 1 + q * N;
    const b0 = a0 + N;
    for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      idx.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
    }
  }
  // Dans le plan XY, face vers +Z (comme CircleGeometry) : sens trigonometrique.
  return makeGeo(pos, nor, idx, col, false, uv);
}

/** L'etang au sud de la route : eau, roseaux, une barque coulee. */
function pondZone(scene: THREE.Scene, w: World, r: () => number): void {
  const P = POND;
  // Eau : un relief de vaguelettes qui deroule lentement, ou le soleil accroche des reflets.
  const waterMat = new THREE.MeshPhongMaterial({
    color: 0xffffff, vertexColors: true, specular: 0x9cc6d2, shininess: 60, bumpMap: rippleTexture(), bumpScale: 0.8,
  });
  w.water = waterMat;
  const water = new THREE.Mesh(waterGeo(), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.scale.set(P.rx, P.rz, 1);
  water.position.set(P.x, 0.02, P.z);
  water.receiveShadow = true;
  scene.add(water);
  patch(scene, P.x, P.z, P.rx + 1.4, P.rz + 1.2, 0x8a7a55, 0.011, r, 0.12);
  const N = 24;
  const pt = (k: number) => {
    const a = (-90 - 7.5 + k * 15) * (Math.PI / 180);
    return { x: P.x + Math.cos(a) * (P.rx + 0.2), z: P.z + Math.sin(a) * (P.rz + 0.2) };
  };
  for (let k = 0; k < N; k++) {
    const a = pt(k);
    const b = pt(k + 1);
    const seg = { x1: a.x, z1: a.z, x2: b.x, z2: b.z };
    if (k === 0) w.locks.dock = seg;
    w.walls.push(seg);
  }
  for (let i = 0; i < 70; i++) {
    const a = r() * Math.PI * 2;
    const k = 0.95 + r() * 0.2;
    const x = P.x + Math.cos(a) * P.rx * k;
    const z = P.z + Math.sin(a) * P.rz * k;
    if (Math.abs(x - P.x) < 2 && z < P.z) continue;
    const hgt = 0.9 + r() * 0.6;
    const c = r() < 0.5 ? 0x6f8a4a : 0x8a9a5a;
    scene.add(shadow(reeds(x, z, hgt, c, i)));
  }
  const stones = [C.stone, 0x85837b];
  for (let i = 0; i < 8; i++) {
    const a = r() * Math.PI * 2;
    const b = blob(0.4 + r() * 0.4, stones[r() < 0.5 ? 0 : 1]!, P.x + Math.cos(a) * (P.rx + 0.8), 0.2, P.z + Math.sin(a) * (P.rz + 0.6));
    b.scale.y = 0.6;
    scene.add(b);
  }
  // Nenuphars (generateur a part : la suite du decor ne bouge pas), deux en fleur.
  const rl = rng(41);
  const pads = [0x5f8a3e, 0x6f9a48, 0x557d38];
  for (let i = 0; i < 9; i++) {
    const a = rl() * Math.PI * 2;
    const k = 0.35 + rl() * 0.45;
    const px = P.x + Math.cos(a) * P.rx * k;
    const pz = P.z + Math.sin(a) * P.rz * k;
    if (Math.abs(px - P.x) < 2.5 && pz < P.z) continue;
    const pad = cyl(0.26, 0.26, 0.03, pads[i % 3]!, 12, px, 0.035, pz);
    pad.scale.setScalar(0.8 + rl() * 0.4);
    pad.scale.y = 1;
    scene.add(pad);
    if (i % 4 === 1) scene.add(blob(0.08, 0xeaa8bc, px + 0.06, 0.08, pz));
  }
  // Barque coulee : coque de bois, bord peint, fond plein d'eau, un banc, une rame.
  const HULL: Profile = [[0, 0.02], [0.3, 0], [0.44, 0.1], [0.5, 0.3], [0.52, 0.42], [0.48, 0.45], [0.44, 0.4], [0, 0.3]];
  const wood = new THREE.Color(0x6e5034);
  const woodLow = new THREE.Color(0x553d27);
  const trim = new THREE.Color(0x4f7f8a);
  const pool = new THREE.Color(0x3d6a70);
  const hull = paint(lathe(HULL, 0x6e5034), 'hull', (px, py, pz, out) => {
    const rr = Math.hypot(px, pz);
    if (rr < 0.01 && py > 0.25) out.copy(pool);
    else if (py > 0.395 && rr > 0.465) out.copy(trim);
    else if (py > 0.395) out.copy(woodLow);
    else out.lerpColors(woodLow, wood, py / 0.4);
  });
  hull.scale.set(2.2, 1, 0.9);
  hull.position.y = -0.12;
  const oar = group(plank(1.4, 0.04, 0.07, C.wood, 0, 0, 0), plank(0.36, 0.03, 0.16, C.woodLight, 0.8, 0, 0));
  oar.position.set(-0.2, 0.3, 0.12);
  oar.rotation.y = 0.25;
  const boat = group(hull, plank(0.24, 0.05, 0.84, 0x5e452c, 0.2, 0.25, 0), oar);
  boat.rotation.z = 0.25;
  scene.add(shadow(at(boat, P.x + 5.2, 0, P.z + 1.4, 0.7)));
}

/** La carriere au nord-est : gravier, falaises entaillees, blocs epars. */
function quarryZone(scene: THREE.Scene, w: World, r: () => number): void {
  const { x, z } = L.quarry;
  patch(scene, x, z, 10, 9, 0x9a9488, 0.013, r, 0.2);
  // Falaises au nord et a l'est : la ou l'on a taille la roche. Strates claires et
  // sombres, un peu d'herbe sur la crete.
  const tones = [0x9a9890, 0x85837b, 0xa8a59b];
  const turf = new THREE.Color(C.grassDark);
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * 0.95 + (i / 15) * Math.PI * 1.15;
    const cx = x + Math.cos(a) * (10 + r() * 1.5);
    const cz = z + Math.sin(a) * (9 + r() * 1.5);
    const tone = tones[i % 3]!;
    const rad = 1.6 + r() * 1.2;
    const b = blob(rad, tone, cx, 1.2 + r() * 0.8, cz);
    const lo = new THREE.Color(mixHex(tone, 0x6a665e, 0.35));
    const hi = new THREE.Color(mixHex(tone, 0xf0ead8, 0.22));
    paint(b, `strata${tone}`, (_px, py, _pz, out) => {
      const t = py / rad;
      out.lerpColors(lo, hi, 0.5 + 0.5 * Math.sin(t * 9 + 0.6));
      if (t > 0.72) out.lerp(turf, Math.min(1, (t - 0.72) * 4));
    });
    b.scale.y = 1.2 + r() * 0.8;
    scene.add(shadow(b));
    w.solids.push({ x: cx, z: cz, r: 1.8 });
    // Eboulis au pied, cote carriere (dans le cercle de collision de la falaise).
    if (i % 2 === 0) {
      const ex = cx + (x - cx) * 0.12;
      const ez = cz + (z - cz) * 0.12;
      const sc = blob(0.5, tones[(i + 1) % 3]!, ex, 0.2, ez);
      sc.scale.set(1.2, 0.6, 1);
      scene.add(shadow(sc));
    }
  }
  for (let i = 0; i < 12; i++) {
    const b = blob(0.25 + r() * 0.3, tones[(i + 1) % 3]!, x + (r() - 0.5) * 14, 0.15, z + (r() - 0.5) * 12);
    b.scale.y = 0.6;
    scene.add(b);
  }
  // Wagonnet de gravier sur ses quatre roues.
  const cart = group(
    vgrad(rbox(1.6, 0.6, 0.9, 0x55595c, 0.06, 0, 0.5, 0), mixHex(0x55595c, C.rustDark, 0.45), 0x666b6e),
    plank(1.7, 0.08, 1.0, 0x45494c, 0, 0.82, 0),
    puff(0.55, 0x9a9488, 0, 0.82, 0, 2, 0.25),
  );
  for (const wx of [-0.55, 0.55]) {
    for (const wz of [-0.5, 0.5]) {
      const t = at(tire(), wx, 0.3, wz);
      t.rotation.set(0, 0, 0);
      t.scale.setScalar(0.62);
      cart.add(t);
    }
  }
  const load = cart.children[2]!;
  load.scale.set(1.35, 0.45, 0.75);
  scene.add(shadow(at(cart, x - 6, 0, z + 5, 0.5)));
}
