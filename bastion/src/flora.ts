// La vegetation : arbres (decor et arbres a couper), arbres morts, buissons, rochers.
// Les plantes des potagers et des champs sont dans resources.ts.
// Formes douces et genereuses : etages de sapin festonnes, feuillages en nuages, troncs
// galbes aux racines evasees. Les teintes sont ecrites dans les sommets (vmat) : un arbre
// fusionne tient en un seul appel de dessin, sans aplat.
//
// Attention : chaque fonction consomme exactement le meme nombre de tirages r() qu'avant
// (pine 1, leafy 3, deadTree 12, bush 1, boulder 1) : le decor et la foret sont places avec
// le meme generateur, les positions ne doivent pas bouger. Les variations viennent d'un
// generateur local tire de ces valeurs.

import * as THREE from 'three';
import { C, blob, group, mixHex, paint, puff, rng, shadow, sphere, vmat } from './kit';

// ---------------------------------------------------------------- teintes

const tmpA = new THREE.Color();

/**
 * Couleur de base * facteur d'ombrage : au-dessus de 1 plus clair et un peu plus chaud
 * (bouts eclaires), en dessous plus sombre et un peu plus froid (dessous, creux).
 */
export function shadeColor(base: THREE.Color, s: number, out: THREE.Color): THREE.Color {
  out.copy(base).multiplyScalar(s);
  if (s > 1) out.b *= Math.max(0.7, 1 - (s - 1) * 0.9);
  else out.b += (1 - s) * 0.025;
  return out;
}

// ---------------------------------------------------------------- geometries organiques

/** Anneau d'une forme de revolution : [rayon, hauteur, ombrage, festons (amplitude relative), retombee des festons]. */
export type Ring = readonly [number, number, number, number?, number?];

/**
 * Forme de revolution autour de Y, festonnee : `lobes` bosses regulieres sur le pourtour
 * (pointes de branches, racines), qui peuvent retomber (`droop`, en unites). Les anneaux
 * vont du bas vers le haut ; un rayon nul est un pole. Sommets partages, normales lisses,
 * couleurs de sommets (base * ombrage, bosses plus claires). A utiliser avec vmat().
 */
export function revolveGeo(rings: ReadonlyArray<Ring>, sides: number, color: number, lobes = 0, phase = 0): THREE.BufferGeometry {
  const base = new THREE.Color(color);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const starts: number[] = [];
  for (const [r, y, s, w = 0, d = 0] of rings) {
    const start = pos.length / 3;
    if (r < 1e-5) {
      pos.push(0, y, 0);
      shadeColor(base, s, tmpA);
      col.push(tmpA.r, tmpA.g, tmpA.b);
      starts.push(-start - 1);
      continue;
    }
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const l = lobes > 0 ? Math.cos(lobes * a + phase) : 0;
      const rr = r * (1 + w * l);
      pos.push(Math.sin(a) * rr, y - d * (0.5 + 0.5 * l), Math.cos(a) * rr);
      shadeColor(base, s * (1 + w * l * 0.9), tmpA);
      col.push(tmpA.r, tmpA.g, tmpA.b);
    }
    starts.push(start);
  }
  // Sens des triangles : (dP/da x dP/dt) pointe vers l'exterieur pour un profil parcouru
  // du bas vers le haut par l'exterieur (meme convention que lathe de kit.ts).
  for (let i = 0; i < starts.length - 1; i++) {
    const A = starts[i]!;
    const B = starts[i + 1]!;
    if (A < 0 && B < 0) continue;
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      if (A < 0) idx.push(-A - 1, B + j1, B + j);
      else if (B < 0) idx.push(A + j, A + j1, -B - 1);
      else idx.push(A + j, A + j1, B + j1, A + j, B + j1, B + j);
    }
  }
  return finish(pos, col, idx);
}

/**
 * Tube courbe et effile le long d'un chemin (troncs tordus, branches, tuyaux) : `pts`
 * points, `rad` rayons, `shade` ombrage par point. Un rayon final nul ferme le bout en
 * pointe arrondie ; le depart reste ouvert (pris dans le sol ou dans le tronc).
 */
export function tubeGeo(pts: ReadonlyArray<THREE.Vector3>, rad: ReadonlyArray<number>, sides: number, color: number, shade?: ReadonlyArray<number>): THREE.BufferGeometry {
  const base = new THREE.Color(color);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const B = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  // Repere initial : une normale quelconque perpendiculaire a la premiere tangente.
  T.subVectors(pts[1]!, pts[0]!).normalize();
  N.set(0, 1, 0);
  if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
  N.addScaledVector(T, -N.dot(T)).normalize();
  const starts: number[] = [];
  for (let i = 0; i < n; i++) {
    // Tangente moyenne ; transport parallele du repere (pas de vrille).
    if (i === 0) T.subVectors(pts[1]!, pts[0]!);
    else if (i === n - 1) T.subVectors(pts[i]!, pts[i - 1]!);
    else T.subVectors(pts[i + 1]!, pts[i - 1]!);
    T.normalize();
    N.addScaledVector(T, -N.dot(T)).normalize();
    B.crossVectors(T, N);
    const p = pts[i]!;
    const r = rad[i]!;
    shadeColor(base, shade ? shade[i]! : 1, tmpA);
    const start = pos.length / 3;
    if (r < 1e-5) {
      pos.push(p.x, p.y, p.z);
      col.push(tmpA.r, tmpA.g, tmpA.b);
      starts.push(-start - 1);
      continue;
    }
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      tmp.copy(N).multiplyScalar(Math.cos(a) * r).addScaledVector(B, Math.sin(a) * r).add(p);
      pos.push(tmp.x, tmp.y, tmp.z);
      col.push(tmpA.r, tmpA.g, tmpA.b);
    }
    starts.push(start);
  }
  // Avec B = T x N, (A_j, A_j+1, B_j+1) tourne vers l'exterieur.
  for (let i = 0; i < n - 1; i++) {
    const A = starts[i]!;
    const Bs = starts[i + 1]!;
    if (A < 0) break;
    for (let j = 0; j < sides; j++) {
      const j1 = (j + 1) % sides;
      if (Bs < 0) idx.push(A + j, A + j1, -Bs - 1);
      else idx.push(A + j, A + j1, Bs + j1, A + j, Bs + j1, Bs + j);
    }
    if (Bs < 0) break;
  }
  return finish(pos, col, idx);
}

function finish(pos: number[], col: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Courbe de Bezier quadratique echantillonnee (k + 1 points). */
export function bend(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, k: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    const u = 1 - t;
    out.push(new THREE.Vector3(
      u * u * a.x + 2 * u * t * c.x + t * t * b.x,
      u * u * a.y + 2 * u * t * c.y + t * t * b.y,
      u * u * a.z + 2 * u * t * c.z + t * t * b.z,
    ));
  }
  return out;
}

/** Maillage a couleurs de sommets (vmat partage) : fusionnable sans perdre ses teintes. */
export function vmesh(g: THREE.BufferGeometry, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(g, vmat());
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

/**
 * Feuillage en nuage avec degrade : sombre et frais dessous, clair et chaud au sommet.
 * Geometrie partagee (puff du kit) peinte une fois par couleur.
 */
export function foliage(r: number, color: number, x: number, y: number, z: number, seed: number, lump = 0.24): THREE.Mesh {
  const base = new THREE.Color(color);
  return paint(puff(r, color, x, y, z, seed, lump), `fol${color}`, (px, py, pz, out) => {
    const k = 1 / r;
    const t = smooth((py * k + 0.75) / 1.6);
    // Les bosses qui depassent sur les cotes accrochent un peu plus la lumiere.
    const bulge = Math.max(0, Math.hypot(px, py, pz) * k - 0.95) * 1.2;
    shadeColor(base, 0.5 + 0.68 * t + bulge, out);
  });
}

// ---------------------------------------------------------------- sapin

/** Etage de sapin festonne : dessous creux et sombre, bord arrondi qui retombe, pointes claires. */
function tierGeo(R: number, H: number, sides: number, lobes: number, phase: number, color: number, top: boolean): THREE.BufferGeometry {
  const key = `tier${R},${H},${sides},${lobes},${phase.toFixed(2)},${color},${top}`;
  return cachedGeo(key, () => revolveGeo([
    [0, H * 0.2, 0.42],
    [R * 0.48, H * 0.11, 0.5, 0.04],
    [R * 0.86, 0, 0.66, 0.1, H * 0.06],
    [R * 1.0, H * 0.065, 0.95, 0.12, H * 0.07],
    [R * 0.93, H * 0.16, 1.12, 0.11, H * 0.05],
    [R * 0.64, H * 0.4, 1.0, 0.05],
    [R * 0.34, H * 0.66, 0.98, 0.02],
    [R * (top ? 0.1 : 0.13), H * (top ? 0.9 : 0.88), 1.05],
    [0, H, 1.12],
  ], sides, color, lobes, phase));
}

/** Tronc galbe aux racines evasees, ouvert en bas (pris dans le sol). */
function trunkGeo(rBase: number, rTop: number, h: number, sides: number, roots: number, phase: number, color: number): THREE.BufferGeometry {
  const key = `trunk${rBase},${rTop},${h},${sides},${roots},${phase.toFixed(2)},${color}`;
  return cachedGeo(key, () => revolveGeo([
    [rBase * 1.55, -0.04, 0.62, 0.32],
    [rBase * 1.22, 0.06, 0.7, 0.24],
    [rBase * 1.02, 0.2, 0.82, 0.1],
    [rBase * 0.92, h * 0.34, 0.95, 0.03],
    [rTop, h * 0.97, 1.08],
    [0, h, 1.1],
  ], sides, color, roots, phase));
}

export function pine(r: () => number): THREE.Group {
  const v = r();
  const q = rng(Math.floor(v * 1e6) + 7);
  const shade = v < 0.5 ? C.pine : 0x4a7552;
  const g = group(vmesh(trunkGeo(0.2, 0.13, 1.0, 14, 5, q() * 6, C.bark)));
  // Trois etages : le bas plus sombre, le haut plus tendre ; festons et quart de tour varies.
  const tiers: [number, number, number, number, number][] = [
    // R, H, base y, cotes, festons (cotes = 5 x festons : festons reguliers et arrondis)
    [1.24, 1.42, 0.62, 40, 8],
    [0.97, 1.36, 1.4, 35, 7],
    [0.68, 1.64, 2.2, 30, 6],
  ];
  tiers.forEach(([R, H, y, sides, lobes], i) => {
    const c = i === 0 ? mixHex(shade, C.leafDeep, 0.2) : i === 1 ? shade : mixHex(shade, C.pineLight, 0.45);
    const ph = Math.floor(q() * 4) * 0.4;
    const m = vmesh(tierGeo(R, H, sides, lobes, ph, c, i === 2), (q() - 0.5) * 0.06, y, (q() - 0.5) * 0.06);
    m.rotation.y = q() * 6;
    g.add(m);
  });
  return shadow(g);
}

// ---------------------------------------------------------------- feuillu

const LEAF_PALETTES: [number, number, number][] = [
  // dessous, milieu, sommet
  [C.leafDark, C.leaf, C.leafSun],
  [C.leaf, C.leafLight, C.leafSun],
  [C.leafDeep, C.leafDark, C.leaf],
];

export function leafy(r: () => number): THREE.Group {
  const pal = LEAF_PALETTES[Math.floor(r() * 3)]!;
  const seed = Math.floor(r() * 3);
  const side = r() < 0.5 ? 1 : -1;
  const q = rng(seed * 31 + (side > 0 ? 5 : 9));
  const g = group(vmesh(trunkGeo(0.2, 0.12, 2.0, 12, 4, seed * 1.3, C.bark)));
  // Deux branches maitresses qui filent dans le feuillage.
  const branch = (tx: number, ty: number, tz: number): void => {
    const pts = bend(new THREE.Vector3(0, 1.25, 0), new THREE.Vector3(tx * 0.25, ty * 0.82, tz * 0.25), new THREE.Vector3(tx, ty, tz), 3);
    g.add(vmesh(tubeGeo(pts, [0.1, 0.08, 0.065, 0.05], 7, C.bark, [0.85, 0.95, 1.0, 1.0])));
  };
  branch(0.6 * side, 2.05, 0.3);
  branch(-0.55 * side, 2.2, -0.32);
  // Grappes de feuillage : la grosse au centre, trois autour, la plus claire en haut
  // (chacune tournee sur elle-meme : les lobes ne se repetent pas d'un arbre a l'autre).
  const puffs = [
    foliage(1.0, pal[1], 0, 2.5, 0, seed, 0.24),
    foliage(0.72, pal[0], 0.66 * side, 2.0, 0.34, seed + 3, 0.26),
    foliage(0.66, mixHex(pal[0], pal[1], 0.5), -0.62 * side, 2.15, -0.36, seed + 6, 0.26),
    foliage(0.56, pal[2], 0.12 * side, 3.06, -0.12, seed + 9, 0.22),
  ];
  for (const p of puffs) {
    p.rotation.y = q() * 6;
    g.add(p);
  }
  return shadow(g);
}

// ---------------------------------------------------------------- arbre mort

export function deadTree(r: () => number): THREE.Group {
  const q = rng(Math.floor(r() * 1e6) + 3);
  // Les 11 autres tirages d'origine (4 branches x 3, moins le premier) : sequence conservee.
  for (let i = 0; i < 11; i++) r();
  const wood = 0x6e6259;
  const g = group(vmesh(revolveGeo([
    [0.42, -0.04, 0.62, 0.34],
    [0.32, 0.06, 0.7, 0.26],
    [0.24, 0.22, 0.82, 0.08],
    [0.2, 0.5, 0.9],
    [0, 0.6, 0.9],
  ], 12, wood, 4, q() * 6)));
  // Tronc legerement tordu, qui blanchit vers le haut.
  const lean = new THREE.Vector3((q() - 0.5) * 0.5, 0, (q() - 0.5) * 0.5);
  const trunk = bend(new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(-lean.x * 0.6, 1.4, -lean.z * 0.6), new THREE.Vector3(lean.x, 2.6, lean.z), 5);
  trunk.push(new THREE.Vector3(lean.x * 1.05, 2.74, lean.z * 1.05));
  g.add(vmesh(tubeGeo(trunk, [0.2, 0.18, 0.15, 0.12, 0.09, 0.06, 0], 9, wood, [0.88, 0.94, 1.0, 1.05, 1.1, 1.14, 1.16])));
  const at = (t: number): THREE.Vector3 => {
    const i = Math.min(4, Math.floor(t * 5));
    return trunk[i]!.clone().lerp(trunk[i + 1]!, t * 5 - i);
  };
  // Quatre branches qui montent en s'arquant ; deux d'entre elles fourchent.
  for (let i = 0; i < 4; i++) {
    const a = i * 2.1 + q();
    const len = 0.75 + q() * 0.45;
    const s = at(0.42 + i * 0.15);
    const dx = Math.sin(a);
    const dz = Math.cos(a);
    const e = new THREE.Vector3(s.x + dx * len, s.y + 0.45 + q() * 0.35, s.z + dz * len);
    const c = new THREE.Vector3(s.x + dx * len * 0.7, s.y + 0.05, s.z + dz * len * 0.7);
    const pts = bend(s, c, e, 3);
    g.add(vmesh(tubeGeo(pts, [0.075 - i * 0.008, 0.055, 0.035, 0], 7, wood, [0.95, 1.05, 1.12, 1.18])));
    if (i % 2 === 0) {
      const f = pts[1]!.clone().lerp(pts[2]!, 0.5);
      const a2 = a + 0.9;
      const e2 = new THREE.Vector3(f.x + Math.sin(a2) * 0.45, f.y + 0.4, f.z + Math.cos(a2) * 0.45);
      const c2 = new THREE.Vector3(f.x + Math.sin(a2) * 0.3, f.y + 0.1, f.z + Math.cos(a2) * 0.3);
      g.add(vmesh(tubeGeo(bend(f, c2, e2, 2), [0.035, 0.022, 0], 5, wood, [1.05, 1.12, 1.2])));
    }
  }
  return g;
}

// ---------------------------------------------------------------- buisson et rocher

const BERRY = 0xd0473a;
const FLOWER = 0xf3e9d2;
const FLOWER_HEART = 0xf2c14e;

/** Un buisson du decor (pose au sol, a la position donnee) : touffe ronde, parfois des baies ou des fleurs. */
export function bush(r: () => number, size: number, x: number, z: number): THREE.Object3D {
  const v = r();
  const leaf = v < 0.5 ? C.leaf : C.leafDark;
  const q = rng(Math.floor(v * 1e6) + 11);
  const seed = Math.floor(q() * 4);
  const g = new THREE.Group();
  const main = foliage(size, leaf, 0, size * 0.55, 0, seed, 0.26);
  main.scale.y = 0.8;
  const a = q() * 6;
  const s2 = Math.round(size * 0.62 * 20) / 20;
  g.add(main,
    foliage(s2, mixHex(leaf, C.leafSun, 0.25), Math.sin(a) * size * 0.56, size * 0.38, Math.cos(a) * size * 0.56, seed + 2, 0.24),
    foliage(s2, mixHex(leaf, C.leafDeep, 0.3), Math.sin(a + 2.4) * size * 0.52, size * 0.32, Math.cos(a + 2.4) * size * 0.52, seed + 5, 0.24));
  // Baies rouges, fleurs claires, ou rien : posees sur le haut de la touffe.
  const kind = (v * 7) % 1;
  if (kind < 0.62) {
    const berries = kind < 0.3;
    for (let i = 0; i < 6; i++) {
      const th = a + i * 1.05 + q() * 0.4;
      const ph = 0.5 + q() * 0.6;
      const px = Math.sin(th) * Math.sin(ph) * size * 0.93;
      const pz = Math.cos(th) * Math.sin(ph) * size * 0.93;
      const py = size * 0.55 + Math.cos(ph) * size * 0.8 * 0.93;
      if (berries) g.add(sphere(0.065, BERRY, px, py, pz, -6));
      else {
        const f = sphere(0.075, i % 3 === 0 ? FLOWER_HEART : FLOWER, px, py, pz, -6);
        f.scale.y = 0.55;
        g.add(f);
      }
    }
  }
  g.position.set(x, 0, z);
  return shadow(g);
}

const MOSS = new THREE.Color(0x7c8f45);

/** Pierre arrondie et litee (bandes de teinte, dessus plus clair, parfois moussu). */
export function stone(r: number, color: number, moss: boolean, x: number, y: number, z: number): THREE.Mesh {
  const base = new THREE.Color(color);
  return paint(blob(r, color, x, y, z), `st${color},${moss}`, (px, py, pz, out) => {
    const k = 1 / r;
    const ny = py * k;
    const band = 1 + 0.08 * Math.sin(ny * 8.5 + px * k * 1.3 + 1.1);
    shadeColor(base, (0.74 + 0.36 * smooth((ny + 0.9) / 1.7)) * band, out);
    if (moss) out.lerp(MOSS, 0.8 * smooth((ny - 0.45) / 0.35 + pz * k * 0.15));
  });
}

/** Un rocher du decor (pose au sol, a la position donnee) : un gros galet lite, un plus petit appuye, un caillou. */
export function boulder(r: () => number, size: number, x: number, z: number): THREE.Object3D {
  const v = r();
  const color = v < 0.5 ? C.stone : 0xa8a59b;
  const q = rng(Math.floor(v * 1e6) + 13);
  const moss = q() < 0.45;
  const g = new THREE.Group();
  const main = stone(size, color, moss, 0, size * 0.42, 0);
  main.scale.set(1.08, 0.72, 0.94);
  main.rotation.y = q() * 6;
  const a = q() * 6;
  const second = stone(Math.round(size * 0.55 * 20) / 20, mixHex(color, 0xb3a58c, 0.35), false, Math.sin(a) * size * 0.6, size * 0.26, Math.cos(a) * size * 0.6);
  second.scale.y = 0.78;
  second.rotation.set(0.25, q() * 6, 0.15);
  const pebble = stone(0.14, mixHex(color, C.concreteDark, 0.3), false, Math.sin(a + 2.3) * size * 0.88, 0.07, Math.cos(a + 2.3) * size * 0.88);
  pebble.scale.y = 0.7;
  g.add(main, second, pebble);
  g.position.set(x, 0, z);
  return shadow(g);
}
