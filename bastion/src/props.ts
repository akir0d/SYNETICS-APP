// Accessoires de camp fortifie : tole ondulee, futs, pneus, sacs de sable, barbele...
// Tout est en materiaux partages : le decor fixe est ensuite fusionne (bake.ts).

import * as THREE from 'three';
import { C, at, blob, box, cone, cyl, group, mat, rbox, rng } from './kit';

/** Couleurs de recuperation : toles peintes, delavees, rouillees. */
export const SCRAP_TONES = [0xa5603a, 0x5f8a85, 0x8a8f91, 0x9c4a3c, 0x6f7a4a, 0xb9874a, 0x7b6a5a];

export function shade(color: number, k: number): number {
  return new THREE.Color(color).multiplyScalar(k).getHex();
}

/** Plaque de tole ondulee, debout, centree en bas. */
export function sheet(w: number, h: number, color: number): THREE.Group {
  const g = group(box(w, h, 0.05, color, 0, h / 2, 0));
  const rib = shade(color, 0.8);
  const n = Math.max(2, Math.round(w / 0.24));
  for (let i = 0; i < n; i++) g.add(box(0.05, h, 0.09, rib, -w / 2 + (i + 0.5) * (w / n), h / 2, 0));
  return g;
}

/** Tole posee a plat (toit). */
export function roofSheet(w: number, d: number, color: number): THREE.Group {
  const g = group(box(w, 0.05, d, color, 0, 0, 0));
  const rib = shade(color, 0.8);
  const n = Math.max(2, Math.round(w / 0.26));
  for (let i = 0; i < n; i++) g.add(box(0.06, 0.08, d, rib, -w / 2 + (i + 0.5) * (w / n), 0.02, 0));
  return g;
}

export function drum(color = 0x3f6a8a, rust = true): THREE.Group {
  const g = group(
    cyl(0.32, 0.32, 0.92, color, 10, 0, 0.46, 0),
    cyl(0.335, 0.335, 0.05, shade(color, 0.7), 10, 0, 0.3, 0),
    cyl(0.335, 0.335, 0.05, shade(color, 0.7), 10, 0, 0.66, 0),
  );
  if (rust) g.add(box(0.2, 0.3, 0.05, C.rustDark, 0.12, 0.5, 0.3));
  return g;
}

export function tire(): THREE.Mesh {
  const t = new THREE.Mesh(tireGeo(), mat(0x2b2b2b));
  t.rotation.x = Math.PI / 2;
  t.castShadow = true;
  t.receiveShadow = true;
  return t;
}
let _tire: THREE.TorusGeometry | null = null;
function tireGeo(): THREE.TorusGeometry {
  return (_tire ??= new THREE.TorusGeometry(0.36, 0.15, 5, 10));
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

const BAG = [0xc9b48a, 0xb8a276, 0xa8956a];
/** Muret de sacs de sable : `len` metres, `rows` rangees. */
export function sandbags(len: number, rows: number, seed = 2): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const per = Math.max(1, Math.round(len / 0.62));
  for (let y = 0; y < rows; y++) {
    const off = y % 2 ? 0.31 : 0;
    for (let i = 0; i < per - (y % 2); i++) {
      const b = rbox(0.6, 0.24, 0.42, BAG[Math.floor(r() * BAG.length)]!, 0.1, -len / 2 + 0.31 + off + i * (len / per), 0.12 + y * 0.22, (r() - 0.5) * 0.06);
      b.rotation.y = (r() - 0.5) * 0.12;
      g.add(b);
    }
  }
  return g;
}

export function crate(s = 0.6, color: number = C.wood): THREE.Group {
  return group(
    rbox(s, s, s, color, 0.03, 0, s / 2, 0),
    box(s + 0.02, 0.08, s + 0.02, shade(color, 0.75), 0, s * 0.2, 0),
    box(s + 0.02, 0.08, s + 0.02, shade(color, 0.75), 0, s * 0.8, 0),
  );
}

export function jerrycan(color = 0xc9412f): THREE.Group {
  return group(rbox(0.34, 0.46, 0.16, color, 0.04, 0, 0.23, 0), box(0.16, 0.06, 0.06, shade(color, 0.7), 0.06, 0.5, 0));
}

export function gasBottle(): THREE.Group {
  return group(cyl(0.16, 0.16, 0.6, 0xd94c3a, 10, 0, 0.3, 0), blob(0.16, 0xd94c3a, 0, 0.6, 0), cyl(0.05, 0.05, 0.12, C.metal, 6, 0, 0.75, 0));
}

/** Rouleau de barbele (concertina), couche le long de l'axe x. */
export function concertina(len: number): THREE.Group {
  const g = new THREE.Group();
  const n = Math.max(3, Math.round(len / 0.22));
  const geo = (_coil ??= new THREE.TorusGeometry(0.24, 0.014, 3, 9));
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

/** Herisson tcheque : trois poutrelles croisees. */
export function hedgehog(color = 0x5d5a55): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = box(0.14, 1.7, 0.14, color, 0, 0.62, 0);
    b.rotation.z = 0.9;
    const h = group(b);
    h.rotation.y = (i * Math.PI * 2) / 3;
    g.add(h);
  }
  return g;
}

/** Pieu taille en pointe, incline. */
export function stake(len: number, color: number = C.woodDark): THREE.Group {
  return group(cyl(0.07, 0.08, len, color, 5, 0, len / 2, 0), cone(0.075, 0.28, C.woodLight, 5, 0, len + 0.14, 0));
}

/** Separateur de chantier en beton, peint de bandes. */
export function jersey(len = 1.8, stripes = false): THREE.Group {
  const g = group(
    box(len, 0.42, 0.62, C.concrete, 0, 0.21, 0),
    box(len, 0.5, 0.3, C.concrete, 0, 0.66, 0),
    box(len, 0.08, 0.36, C.concreteDark, 0, 0.92, 0),
  );
  if (stripes) for (let i = 0; i < 3; i++) g.add(box(0.22, 0.38, 0.32, i % 2 ? C.white : 0xd94c3a, -len / 3 + (i * len) / 3, 0.66, 0));
  return g;
}

/** Projecteur de chantier : pied, tete inclinee, materiau a part pour s'allumer la nuit. */
export function floodlight(height: number, lensMat: THREE.Material): THREE.Group {
  const head = group(rbox(0.5, 0.36, 0.22, 0x3a3d40, 0.04, 0, 0, 0), box(0.42, 0.28, 0.03, lensMat, 0, 0, 0.12));
  head.rotation.x = 0.6;
  head.position.set(0, height, 0.1);
  return group(
    cyl(0.06, 0.08, height, 0x55595c, 6, 0, height / 2, 0),
    box(0.6, 0.06, 0.06, 0x55595c, 0, height - 0.15, 0),
    head,
  );
}

/** Carcasse de voiture brulee ou rouillee. */
export function wreck(color: number, burnt = false): THREE.Group {
  const body = burnt ? 0x4a3f38 : color;
  const g = group(
    rbox(3.6, 0.85, 1.8, body, 0.22, 0, 0.7, 0),
    rbox(2.0, 0.7, 1.62, burnt ? 0x3a322d : shade(color, 0.8), 0.2, -0.3, 1.38, 0),
    rbox(1.8, 0.48, 1.66, 0x2e3439, 0.16, -0.3, 1.38, 0),
    box(0.9, 0.5, 0.05, C.rustDark, 0.9, 0.75, 0.92),
    box(0.6, 0.3, 0.05, C.rustDark, -1.2, 0.85, -0.92),
  );
  for (const [wx, wz] of [[-1.1, 0.85], [1.1, 0.85], [-1.1, -0.85]] as const) {
    const t = tire();
    t.rotation.set(0, 0, 0);
    t.position.set(wx, 0.3, wz);
    g.add(t);
  }
  // Une roue manque : la carcasse penche.
  g.rotation.z = 0.05;
  return g;
}

/** Arbre mort : tronc gris et quelques branches nues. */
/** Panneau de contreplaque peint a la bombe (une fleche, une croix). */
export function paintedBoard(symbol: 'arrow' | 'cross' | 'coin'): THREE.Group {
  const g = group(
    box(0.08, 1.6, 0.08, C.woodDark, -0.45, 0.8, -0.05),
    box(0.08, 1.6, 0.08, C.woodDark, 0.45, 0.8, -0.05),
    box(1.2, 0.8, 0.05, 0xc8a878, 0, 1.35, 0),
  );
  if (symbol === 'cross') g.add(box(0.5, 0.14, 0.03, 0xc9412f, 0, 1.35, 0.03), box(0.14, 0.5, 0.03, 0xc9412f, 0, 1.35, 0.03));
  if (symbol === 'arrow') g.add(box(0.6, 0.12, 0.03, 0x2b2b2b, -0.05, 1.35, 0.03), at(cone(0.16, 0.25, 0x2b2b2b, 3, 0.32, 1.35, 0.03), 0.32, 1.35, 0.03));
  if (symbol === 'coin') g.add(at(cyl(0.24, 0.24, 0.03, 0xe8b84a, 12, 0, 0, 0), 0, 1.35, 0.04));
  const last = g.children[g.children.length - 1]!;
  if (symbol === 'arrow') last.rotation.z = -Math.PI / 2;
  if (symbol === 'coin') last.rotation.x = Math.PI / 2;
  return g;
}

/** Bache tendue entre deux points hauts (abri de fortune). */
export function tarp(w: number, d: number, color: number, tilt: number): THREE.Group {
  const t = box(w, 0.04, d, color, 0, 0, 0);
  t.rotation.x = tilt;
  return group(t);
}
