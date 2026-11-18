// Accessoires de camp fortifie : tole ondulee, futs, pneus, sacs de sable, barbele...
// Tout est en materiaux partages : le decor fixe est ensuite fusionne (bake.ts).
// Formes rondes et biseautees (aspect figurine), couleurs de sommets pour les details.

import * as THREE from 'three';
import { mergeColored } from './bake';
import {
  C, blob, box, cone, corrugated, cyl, group, lathe, mat, mesh, mixHex, paint, plank, rbox, rng, shadow, vgrad, vmat,
  type Profile,
} from './kit';

/** Couleurs de recuperation : toles peintes, delavees, rouillees. */
export const SCRAP_TONES = [0xa5603a, 0x5f8a85, 0x8a8f91, 0x9c4a3c, 0x6f7a4a, 0xb9874a, 0x7b6a5a];

export function shade(color: number, k: number): number {
  return new THREE.Color(color).multiplyScalar(k).getHex();
}

// ---------------------------------------------------------------- modeles fusionnes partages

const tplCache = new Map<string, THREE.Group>();

/**
 * Modele compose fusionne UNE fois (mergeColored : un maillage a couleurs de sommets), puis
 * clone a chaque appel : geometries et materiaux partages, un appel de dessin par objet.
 * Pour ce qui apparait souvent (objets portes, caisses, palettes). `build` doit etre
 * reproductible (dimensions fixes) : seule la cle compte.
 */
export function merged(key: string, build: () => THREE.Object3D, vary = 0.035): THREE.Group {
  let t = tplCache.get(key);
  if (!t) {
    const src = build();
    src.position.set(0, 0, 0);
    src.rotation.set(0, 0, 0);
    src.scale.setScalar(1);
    t = shadow(mergeColored(src, vary));
    tplCache.set(key, t);
  }
  return t.clone();
}

// ---------------------------------------------------------------- petites geometries locales

/** Remet chaque triangle a l'endroit d'apres les normales de ses sommets. */
function orient(pos: number[], nor: number[], idx: number[]): THREE.BufferGeometry {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = nor[a]! + nor[b]! + nor[c]!, ny = nor[a + 1]! + nor[b + 1]! + nor[c + 1]!, nz = nor[a + 2]! + nor[b + 2]! + nor[c + 2]!;
    if (fx * nx + fy * ny + fz * nz < 0) {
      const s = idx[t + 1]!;
      idx[t + 1] = idx[t + 2]!;
      idx[t + 2] = s;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const localGeo = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = localGeo.get(key);
  if (!g) {
    g = make();
    localGeo.set(key, g);
  }
  return g;
}

/**
 * Prisme : un profil ferme (z, y) extrude le long de x, sur `len`, bouts biseautes de `bev`.
 * Normales lissees sauf aux angles de plus de ~50 degres. Profil convexe (bouchons en eventail).
 */
function prismGeo(loop: ReadonlyArray<readonly [number, number]>, len: number, bev: number): THREE.BufferGeometry {
  const n = loop.length;
  const segN: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    const dz = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dz, dy) || 1;
    segN.push([dy / l, -dz / l]);
  }
  // Sens du profil : on veut des normales vers l'exterieur.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  const flip = area > 0 ? 1 : -1;
  for (const s of segN) { s[0] *= flip; s[1] *= flip; }
  const cosC = Math.cos(0.9);
  // Par sommet du profil : normale entrante (segment precedent) et sortante (segment suivant).
  const vin: [number, number][] = [];
  const vout: [number, number][] = [];
  const avg: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const p = segN[(i + n - 1) % n]!;
    const q = segN[i]!;
    const mz = p[0] + q[0];
    const my = p[1] + q[1];
    const ml = Math.hypot(mz, my) || 1;
    avg.push([mz / ml, my / ml]);
    if (p[0] * q[0] + p[1] * q[1] < cosC) {
      vin.push(p);
      vout.push(q);
    } else {
      vin.push(avg[i]!);
      vout.push(avg[i]!);
    }
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const xs = [-len / 2, -len / 2 + bev, len / 2 - bev, len / 2];
  const ins = [bev, 0, 0, bev];
  const sx = [-1, 0, 0, 1];
  // Anneaux : pour chaque x, 2 sommets par point du profil (entrant, sortant).
  const ringAt: number[] = [];
  for (let k = 0; k < 4; k++) {
    ringAt.push(pos.length / 3);
    for (let i = 0; i < n; i++) {
      const p = loop[i]!;
      const z = p[0] - avg[i]![0] * ins[k]!;
      const y = Math.max(0, p[1] - avg[i]![1] * ins[k]!);
      for (const nn of [vin[i]!, vout[i]!]) {
        let nx = sx[k]! * 0.75;
        let nz = nn[0];
        let ny = nn[1];
        const l = Math.hypot(nx, nz, ny) || 1;
        nx /= l; nz /= l; ny /= l;
        pos.push(xs[k]!, y, z);
        nor.push(nx, ny, nz);
      }
    }
  }
  for (let k = 0; k < 3; k++) {
    const A = ringAt[k]!;
    const B = ringAt[k + 1]!;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      // Segment i -> j : sommet sortant de i, entrant de j.
      const a0 = A + i * 2 + 1, a1 = A + j * 2;
      const b0 = B + i * 2 + 1, b1 = B + j * 2;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
  }
  // Bouchons.
  for (const k of [0, 3]) {
    const s = sx[k]!;
    const c0 = pos.length / 3;
    let cz = 0;
    let cy = 0;
    for (const p of loop) { cz += p[0]; cy += p[1]; }
    pos.push(xs[k]!, cy / n, cz / n);
    nor.push(s, 0, 0);
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const v = ringAt[k]! + i * 2;
      pos.push(pos[v * 3]!, pos[v * 3 + 1]!, pos[v * 3 + 2]!);
      nor.push(s, 0, 0);
    }
    for (let i = 0; i < n; i++) idx.push(c0, base + i, base + ((i + 1) % n));
  }
  return orient(pos, nor, idx);
}

/** Coussin (sac de sable) : boite tres arrondie, plus mince sur les bords. */
function pillowGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  return cachedGeo(`pw${w},${h},${d}`, () => {
    let g: THREE.BufferGeometry = new THREE.SphereGeometry(1, 12, 8);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g = mergeVertices(g);
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const sq = (v: number): number => Math.sign(v) * Math.pow(Math.abs(v), 0.5);
    for (let i = 0; i < p.count; i++) {
      const x = sq(p.getX(i));
      const y = sq(p.getY(i));
      const z = sq(p.getZ(i));
      const edge = Math.max(Math.abs(x), Math.abs(z));
      const pinch = 1 - 0.32 * edge * edge * edge * edge;
      p.setXYZ(i, (x * w) / 2, (y * h * pinch) / 2, (z * d) / 2);
    }
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  });
}

/** Fusionne les sommets confondus (positions seules) : normales lisses ensuite. */
function mergeVertices(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = g.index ? g.toNonIndexed() : g;
  const p = src.getAttribute('position') as THREE.BufferAttribute;
  const map = new Map<string, number>();
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let k = map.get(key);
    if (k === undefined) {
      k = pos.length / 3;
      pos.push(x, y, z);
      map.set(key, k);
    }
    idx.push(k);
  }
  // On retire les triangles degeneres (poles de la sphere).
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]!, b = idx[t + 1]!, c = idx[t + 2]!;
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  r.setIndex(out);
  return r;
}

// ---------------------------------------------------------------- toles

/** Plaque de tole ondulee, debout, centree en bas (pied un peu rouille). */
export function sheet(w: number, h: number, color: number): THREE.Group {
  const m = vgrad(corrugated(w, h, color, 0, h / 2, 0), mixHex(color, C.rustDark, 0.32), mixHex(color, 0xffffff, 0.06));
  return group(m);
}

/** Tole posee a plat (toit) : plaques de teintes voisines, ondes le long de d. */
export function roofSheet(w: number, d: number, color: number): THREE.Group {
  const m = corrugated(w, d, color);
  const base = new THREE.Color(color);
  const tones = [1, 0.9, 1.06, 0.95];
  paint(m, `rs${color}`, (x, _y, _z, out) => {
    const k = tones[Math.floor((x + w / 2) / 0.95) % tones.length]!;
    out.copy(base).multiplyScalar(k);
  });
  m.rotation.x = -Math.PI / 2;
  return group(m);
}

// ---------------------------------------------------------------- futs, pneus

const DRUM: Profile = [
  [0, 0], [0.3, 0], [0.32, 0.03], [0.32, 0.27], [0.336, 0.285], [0.336, 0.315], [0.32, 0.33],
  [0.32, 0.63], [0.336, 0.645], [0.336, 0.675], [0.32, 0.69], [0.32, 0.88], [0.332, 0.905],
  [0.318, 0.922], [0.3, 0.92], [0.288, 0.9], [0, 0.9],
];

/** Fut de 200 litres : deux bourrelets, couvercle creux, une bonde ; rouille en option. */
export function drum(color = 0x3f6a8a, rust = true): THREE.Group {
  const base = new THREE.Color(color);
  const rib = new THREE.Color(shade(color, 0.82));
  const lid = new THREE.Color(shade(color, 0.76));
  const rc = new THREE.Color(C.rust);
  const rd = new THREE.Color(C.rustDark);
  const body = paint(lathe(DRUM, color), `dr${color},${rust}`, (x, y, z, out) => {
    const r = Math.hypot(x, z);
    if (y > 0.885 && r < 0.31) out.copy(lid);
    else if (r > 0.326) out.copy(rib);
    else out.copy(base);
    if (rust) {
      const a = Math.atan2(x, z);
      if (y > 0.32 && y < 0.64 && a > 0.25 && a < 1.25) out.lerp(rc, 0.8);
      if (y < 0.04) out.lerp(rd, 0.35);
    }
  });
  return group(body, cyl(0.045, 0.045, 0.03, shade(color, 0.6), 8, 0.17, 0.915, 0.06));
}

// Pneu : section arrondie (flanc bombe, bande de roulement), axe Z comme un tore.
const TIRE: Profile = [
  [0.22, 0.09], [0.22, -0.09], [0.25, -0.13], [0.4, -0.145], [0.47, -0.13], [0.5, -0.09], [0.505, 0],
  [0.5, 0.09], [0.47, 0.13], [0.4, 0.145], [0.25, 0.13], [0.22, 0.09],
];
let _tire: THREE.BufferGeometry | null = null;
function tireGeo(): THREE.BufferGeometry {
  if (!_tire) {
    const g = lathe(TIRE, 0x2b2b2b, 0, 0, 0, 16).geometry.clone();
    g.rotateX(Math.PI / 2);
    const tread = new THREE.Color(0x242424);
    const side = new THREE.Color(0x353535);
    const rim = new THREE.Color(0x2b2b2b);
    _tire = paint(new THREE.Mesh(g), 'tire', (x, y, _z, out) => {
      const r = Math.hypot(x, y);
      out.copy(r > 0.485 ? tread : r < 0.26 ? rim : side);
    }).geometry;
  }
  return _tire;
}

export function tire(): THREE.Mesh {
  const t = new THREE.Mesh(tireGeo(), vmat());
  t.rotation.x = Math.PI / 2;
  t.castShadow = true;
  t.receiveShadow = true;
  return t;
}

/** Pneu monte sur sa jante (roue d'epave, de charrette) : la jante est un enfant du pneu. */
export function wheel(hub: number): THREE.Mesh {
  const t = tire();
  const j = cyl(0.225, 0.225, 0.2, hub, 8);
  j.rotation.x = Math.PI / 2;
  const cap = cyl(0.08, 0.08, 0.24, shade(hub, 0.75), 8);
  cap.rotation.x = Math.PI / 2;
  t.add(j, cap);
  return t;
}

export function tireStack(n: number, seed = 1): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const t = tire();
    t.position.set((r() - 0.5) * 0.08, 0.15 + i * 0.27, (r() - 0.5) * 0.08);
    g.add(t);
  }
  return g;
}

// ---------------------------------------------------------------- sacs, caisses, bidons

const BAG = [0xc9b48a, 0xb8a276, 0xa8956a, C.sand];
/** Muret de sacs de sable : `len` metres, `rows` rangees. */
export function sandbags(len: number, rows: number, seed = 2): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const per = Math.max(1, Math.round(len / 0.62));
  const geo = pillowGeo(0.6, 0.27, 0.42);
  for (let y = 0; y < rows; y++) {
    const off = y % 2 ? 0.31 : 0;
    for (let i = 0; i < per - (y % 2); i++) {
      const b = mesh(geo, mat(BAG[Math.floor(r() * BAG.length)]!), -len / 2 + 0.31 + off + i * (len / per), 0.125 + y * 0.215, (r() - 0.5) * 0.06);
      b.rotation.y = (r() - 0.5) * 0.12;
      b.rotation.z = (r() - 0.5) * 0.06;
      g.add(b);
    }
  }
  return g;
}

/** Caisse en bois : planches biseautees, deux cerclages et deux lattes sur le couvercle. */
export function crate(s = 0.6, color: number = C.wood): THREE.Group {
  const dark = shade(color, 0.72);
  const t = s * 0.13;
  return group(
    plank(s, s, s, color, 0, s / 2, 0),
    plank(s + 0.03, t, s + 0.03, dark, 0, s * 0.2, 0),
    plank(s + 0.03, t, s + 0.03, dark, 0, s * 0.8, 0),
    plank(s + 0.03, 0.035, t, dark, 0, s + 0.006, -s * 0.27),
    plank(s + 0.03, 0.035, t, dark, 0, s + 0.006, s * 0.27),
  );
}

/** Jerrycan : corps biseaute, croix embossee sur les flancs, poignee et bec. */
export function jerrycan(color = 0xc9412f): THREE.Group {
  const dark = shade(color, 0.68);
  const hi = mixHex(color, 0xffffff, 0.14);
  const g = group(
    plank(0.34, 0.44, 0.16, color, 0, 0.22, 0),
    box(0.2, 0.05, 0.06, dark, -0.04, 0.465, 0),
  );
  const spout = cyl(0.04, 0.045, 0.09, dark, 8, 0.11, 0.47, 0);
  spout.rotation.z = -0.45;
  g.add(spout);
  for (const sz of [-1, 1]) {
    for (const a of [-0.91, 0.91]) {
      const x = box(0.4, 0.035, 0.012, hi, 0, 0.22, sz * 0.082);
      x.rotation.z = a;
      g.add(x);
    }
  }
  return g;
}

const GAS: Profile = [
  [0, 0], [0.12, 0], [0.135, 0.015], [0.135, 0.04], [0.16, 0.065], [0.16, 0.37], [0.16, 0.38], [0.16, 0.46],
  [0.16, 0.47], [0.155, 0.55], [0.13, 0.62], [0.085, 0.67], [0.045, 0.69], [0, 0.695],
];

/** Bouteille de gaz : corps rond, bande claire, col et robinet en laiton. */
export function gasBottle(): THREE.Group {
  const red = new THREE.Color(0xd94c3a);
  const band = new THREE.Color(C.white);
  const foot = new THREE.Color(0x8a2f24);
  const body = paint(lathe(GAS, 0xd94c3a), 'gas', (_x, y, _z, out) => {
    out.copy(y > 0.375 && y < 0.465 ? band : y < 0.05 ? foot : red);
  });
  return group(
    body,
    cyl(0.075, 0.075, 0.07, C.metal, 8, 0, 0.72, 0),
    cyl(0.03, 0.03, 0.08, 0xc9a23a, 8, 0, 0.77, 0),
    cyl(0.055, 0.055, 0.02, 0x2b2b2b, 8, 0, 0.81, 0),
  );
}

/** Rouleau de barbele (concertina), couche le long de l'axe x. */
export function concertina(len: number): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(len / 0.22));
  const geo = (_coil ??= new THREE.TorusGeometry(0.24, 0.02, 4, 14));
  const m = mat(0x9aa0a3);
  for (let i = 0; i < n; i++) {
    const t = new THREE.Mesh(geo, m);
    t.position.set(-len / 2 + (i + 0.5) * (len / n), 0.24, 0);
    t.rotation.y = Math.PI / 2 + (i % 2 ? 0.35 : -0.35);
    t.castShadow = true;
    g.add(t);
  }
  return g;
}
let _coil: THREE.TorusGeometry | null = null;

/** Herisson tcheque : trois cornieres d'acier croisees, soudees au centre. */
export function hedgehog(color = 0x5d5a55): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const c = i === 1 ? shade(color, 0.88) : i === 2 ? mixHex(color, C.rustDark, 0.25) : color;
    // Corniere en L : deux ailes.
    const b = group(box(0.15, 1.7, 0.04, c, 0, 0, -0.055), box(0.04, 1.7, 0.15, c, -0.055, 0, 0));
    b.position.y = 0.62;
    b.rotation.z = 0.9;
    const h = group(b);
    h.rotation.y = (i * Math.PI * 2) / 3;
    g.add(h);
  }
  g.add(blob(0.11, shade(color, 0.8), 0, 0.62, 0));
  return g;
}

/** Pieu taille en pointe, incline. */
export function stake(len: number, color: number = C.woodDark): THREE.Group {
  return group(cyl(0.07, 0.08, len, color, 5, 0, len / 2, 0), cone(0.075, 0.28, C.woodLight, 5, 0, len + 0.14, 0));
}

// Profil d'un separateur de chantier (z, y) : pied large, pans inclines, dessus arrondi.
const JERSEY: [number, number][] = [
  [0.31, 0], [0.31, 0.075], [0.2, 0.32], [0.15, 0.88], [0.13, 0.94], [0.08, 0.965],
  [-0.08, 0.965], [-0.13, 0.94], [-0.15, 0.88], [-0.2, 0.32], [-0.31, 0.075], [-0.31, 0],
];
const JERSEY_BAND = JERSEY.map(([z, y]): [number, number] => [z * 1.04, y > 0.01 ? y + 0.012 : 0]);

/** Separateur de chantier en beton, peint de bandes. */
export function jersey(len = 1.8, stripes = false): THREE.Group {
  const g = group(
    mesh(cachedGeo(`js${len}`, () => prismGeo(JERSEY, len, 0.035)), mat(C.concrete)),
    // Encoches de levage au pied.
    box(0.26, 0.06, 0.64, C.concreteDark, -len / 4, 0.03, 0),
    box(0.26, 0.06, 0.64, C.concreteDark, len / 4, 0.03, 0),
  );
  if (stripes) {
    const band = cachedGeo('jsb', () => prismGeo(JERSEY_BAND, 0.22, 0.01));
    for (let i = 0; i < 3; i++) g.add(mesh(band, mat(i % 2 ? C.white : 0xd94c3a), -len / 3 + (i * len) / 3, 0, 0));
  }
  return g;
}

/** Projecteur de chantier : pied, tete inclinee, materiau a part pour s'allumer la nuit. */
export function floodlight(height: number, lensMat: THREE.Material): THREE.Group {
  const dark = 0x3a3d40;
  const frame = 0x2b2d30;
  const head = group(
    rbox(0.5, 0.36, 0.22, dark, 0.06, 0, 0, -0.01),
    // Cadre autour de la vitre, ailettes de refroidissement derriere.
    box(0.5, 0.05, 0.05, frame, 0, 0.165, 0.11), box(0.5, 0.05, 0.05, frame, 0, -0.165, 0.11),
    box(0.05, 0.3, 0.05, frame, -0.235, 0, 0.11), box(0.05, 0.3, 0.05, frame, 0.235, 0, 0.11),
    box(0.42, 0.28, 0.03, lensMat, 0, 0, 0.12),
    box(0.44, 0.035, 0.06, frame, 0, 0.1, -0.14), box(0.44, 0.035, 0.06, frame, 0, 0, -0.14), box(0.44, 0.035, 0.06, frame, 0, -0.1, -0.14),
    // Etrier.
    box(0.04, 0.26, 0.06, 0x55595c, -0.28, -0.06, 0), box(0.04, 0.26, 0.06, 0x55595c, 0.28, -0.06, 0),
  );
  head.rotation.x = 0.6;
  head.position.set(0, height, 0.1);
  return group(
    cyl(0.22, 0.26, 0.08, 0x3a3d40, 8, 0, 0.04, 0),
    cyl(0.06, 0.08, height, 0x55595c, 6, 0, height / 2, 0),
    cyl(0.085, 0.085, 0.12, dark, 8, 0, 0.5, 0),
    box(0.6, 0.06, 0.06, 0x55595c, 0, height - 0.15, 0),
    head,
  );
}

/** Carcasse de voiture brulee ou rouillee. */
export function wreck(color: number, burnt = false): THREE.Group {
  const body = burnt ? 0x4a3f38 : color;
  const top = burnt ? 0x3a322d : shade(color, 0.84);
  const glass = burnt ? 0x1f2326 : 0x2e3439;
  const trim = burnt ? 0x2b2622 : 0x3a3a3a;
  const g = group(
    rbox(3.6, 0.8, 1.8, body, 0.28, 0, 0.66, 0),
    rbox(2.0, 0.66, 1.6, top, 0.26, -0.3, 1.36, 0),
    // Vitres : une bande sombre tout autour de l'habitacle.
    rbox(2.06, 0.34, 1.66, glass, 0.11, -0.3, 1.34, 0),
    plank(0.24, 0.2, 1.84, trim, 1.74, 0.5, 0), plank(0.24, 0.2, 1.84, trim, -1.74, 0.5, 0),
    blob(0.09, burnt ? 0x5a5048 : 0xe8e0c0, 1.8, 0.8, 0.6), blob(0.09, burnt ? 0x5a5048 : 0xe8e0c0, 1.8, 0.8, -0.6),
    // Plaques de rouille.
    box(0.9, 0.22, 0.04, C.rustDark, 0.9, 0.66, 0.9),
    box(0.6, 0.2, 0.04, C.rust, -1.2, 0.68, -0.9),
    box(0.7, 0.03, 0.5, burnt ? 0x2b2622 : C.rust, 0.95, 1.06, 0.2),
  );
  for (const [wx, wz] of [[-1.1, 0.85], [1.1, 0.85], [-1.1, -0.85]] as const) {
    const t = wheel(burnt ? 0x3a322d : 0x6a6f73);
    t.rotation.set(0, 0, 0);
    t.position.set(wx, 0.3, wz);
    g.add(t);
  }
  // Une roue manque : la carcasse penche.
  g.rotation.z = 0.05;
  return g;
}

/** Panneau de contreplaque peint a la bombe (une fleche, une croix). */
export function paintedBoard(symbol: 'arrow' | 'cross' | 'coin'): THREE.Group {
  const g = group(
    plank(0.09, 1.6, 0.09, C.woodDark, -0.45, 0.8, -0.05),
    plank(0.09, 1.6, 0.09, C.woodDark, 0.45, 0.8, -0.05),
    plank(1.2, 0.8, 0.05, 0xc8a878, 0, 1.35, 0),
    box(1.1, 0.06, 0.03, shade(0xc8a878, 0.8), 0, 1.72, 0.03),
  );
  if (symbol === 'cross') g.add(box(0.5, 0.14, 0.03, 0xc9412f, 0, 1.35, 0.03), box(0.14, 0.5, 0.03, 0xc9412f, 0, 1.35, 0.03));
  if (symbol === 'arrow') {
    const head = cone(0.17, 0.26, 0x2b2b2b, -3, 0.3, 1.35, 0.03);
    head.rotation.z = -Math.PI / 2;
    head.scale.z = 0.25;
    g.add(box(0.5, 0.12, 0.03, 0x2b2b2b, -0.1, 1.35, 0.03), head);
  }
  if (symbol === 'coin') {
    const c = cyl(0.24, 0.24, 0.03, 0xe8b84a, 12, 0, 1.35, 0.04);
    c.rotation.x = Math.PI / 2;
    const inner = cyl(0.15, 0.15, 0.03, 0xc9962e, 12, 0, 1.35, 0.05);
    inner.rotation.x = Math.PI / 2;
    g.add(c, inner);
  }
  return g;
}

/** Bache tendue entre deux points hauts (abri de fortune). */
export function tarp(w: number, d: number, color: number, tilt: number): THREE.Group {
  const t = box(w, 0.04, d, color, 0, 0, 0);
  t.rotation.x = tilt;
  return group(t);
}
