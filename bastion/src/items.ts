// Les objets qu'on porte, qu'on vend et qu'on transforme.
// Chaque objet est fusionne une fois en un maillage a couleurs de sommets (merged) puis clone :
// un appel de dessin par objet, geometries et materiaux partages, moins de 250 triangles.

import * as THREE from 'three';
import { C, blob, box, cone, cyl, group, lathe, lookMat, paint, plank, type Profile } from './kit';
import { merged } from './props';

export type ItemType = 'carrot' | 'tomato' | 'log' | 'plank' | 'soup' | 'scrap' | 'wheat' | 'bread' | 'fish' | 'fuel' | 'stone' | 'metal';

export interface ItemDef {
  name: string;
  icon: string;
  /** Prix de vente a l'etal (0 = invendable). */
  price: number;
  /** Hauteur dans une pile. */
  h: number;
}

export const ITEMS: Record<ItemType, ItemDef> = {
  carrot: { name: 'Carottes', icon: '🥕', price: 2, h: 0.2 },
  tomato: { name: 'Tomates', icon: '🍅', price: 4, h: 0.24 },
  log: { name: 'Bois', icon: '🪵', price: 3, h: 0.27 },
  plank: { name: 'Planches', icon: '🪚', price: 7, h: 0.15 },
  soup: { name: 'Soupe', icon: '🍲', price: 12, h: 0.28 },
  // Les survivants de passage la rachetent pour bricoler : elle se vend a l'etal.
  scrap: { name: 'Ferraille', icon: '🔩', price: 5, h: 0.22 },
  wheat: { name: 'Blé', icon: '🌾', price: 3, h: 0.22 },
  bread: { name: 'Pain', icon: '🍞', price: 16, h: 0.2 },
  fish: { name: 'Poisson', icon: '🐟', price: 8, h: 0.16 },
  fuel: { name: 'Carburant', icon: '⛽', price: 10, h: 0.5 },
  stone: { name: 'Pierre', icon: '🧱', price: 3, h: 0.24 },
  metal: { name: 'Métal', icon: '⚙️', price: 18, h: 0.16 },
};

const col = (hex: number): THREE.Color => new THREE.Color(hex);

// ---------------------------------------------------------------- profils (revolution autour de Y)

/** Carotte : pointe en bas, collet arrondi en haut (longueur 0.5). */
const CARROT: Profile = [[0, 0], [0.022, 0.05], [0.05, 0.19], [0.074, 0.35], [0.085, 0.44], [0.068, 0.49], [0, 0.5]];
/** Tomate : boule aplatie, creusee au pedoncule. */
const TOMATO: Profile = [[0, 0], [0.08, 0.012], [0.125, 0.085], [0.112, 0.165], [0.055, 0.2], [0, 0.188]];
/** Buche : ecorce un peu bombee, bouts coupes avec cernes (longueur 0.75, axe Y). */
const LOG: Profile = [
  [0, -0.375], [0.05, -0.375], [0.09, -0.375], [0.115, -0.371], [0.13, -0.35], [0.136, 0],
  [0.13, 0.35], [0.115, 0.371], [0.09, 0.375], [0.05, 0.375], [0, 0.375],
];
/** Bol emaille : pied, panse, levre, puis la surface de la soupe. */
const BOWL: Profile = [
  [0, 0], [0.1, 0], [0.11, 0.02], [0.165, 0.08], [0.195, 0.17], [0.205, 0.2], [0.195, 0.215],
  [0.18, 0.205], [0.175, 0.178], [0.168, 0.17], [0, 0.17],
];
/** Pain : batard allonge (axe Y = longueur 0.5). */
const LOAF: Profile = [[0, -0.25], [0.06, -0.236], [0.1, -0.19], [0.12, -0.1], [0.125, 0], [0.12, 0.1], [0.1, 0.19], [0.06, 0.236], [0, 0.25]];
/** Poisson : queue en bas, museau en haut (axe Y = longueur). */
const FISH: Profile = [[0, -0.2], [0.03, -0.17], [0.065, -0.1], [0.095, -0.01], [0.1, 0.05], [0.085, 0.12], [0.05, 0.17], [0, 0.19]];

/** Lingot : boite biseautee dont le dessus est retreci (en cache). */
let ingotGeo: THREE.BufferGeometry | null = null;
function ingot(color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = box(0.4, 0.075, 0.16, color, x, y, z);
  if (!ingotGeo) {
    const g = m.geometry.clone();
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * 0.86, p.getY(i), p.getZ(i) * 0.72);
    }
    g.computeBoundingSphere();
    ingotGeo = g;
  }
  m.geometry = ingotGeo;
  return m;
}

// ---------------------------------------------------------------- modeles

function carrot(): THREE.Object3D {
  const g = new THREE.Group();
  for (const [z, ry, tone] of [[-0.085, 0.08, 0xf57c1f], [0.09, -0.1, 0xff8a2a]] as const) {
    const root = lathe(CARROT, tone, 0, 0, 0, 8);
    // Couchee : pointe vers +x, collet vers -x.
    root.rotation.z = Math.PI / 2;
    root.scale.setScalar(1.15);
    root.position.set(0.29, 0.098, 0);
    const leaves = blob(0.065, C.leafLight, -0.33, 0.11, 0);
    leaves.scale.set(2, 0.75, 1.15);
    const one = group(root, leaves);
    one.position.z = z;
    one.rotation.y = ry;
    g.add(one);
  }
  return g;
}

function tomato(): THREE.Object3D {
  const g = new THREE.Group();
  for (const [x, z, tone] of [[-0.12, -0.04, 0xe8432f], [0.12, -0.02, 0xf0503a], [0, 0.13, 0xdc3a26]] as const) {
    const t = lathe(TOMATO, tone, x, 0, z, 8);
    const star = cone(0.055, 0.03, C.leaf, -5, x, 0.2, z);
    g.add(t, star);
  }
  return g;
}

function log(): THREE.Object3D {
  const bark = col(0xa8693a);
  const barkDark = col(0x8a5530);
  const cut = col(0xf2cf98);
  const ring = col(0xd9a56a);
  const body = paint(lathe(LOG, 0xa8693a, 0, 0, 0, 12), 'item-log', (x, y, z, out) => {
    const r = Math.hypot(x, z);
    if (Math.abs(y) > 0.369 && r < 0.12) out.copy(r > 0.03 && r < 0.07 ? ring : cut);
    else out.copy(Math.sin(Math.atan2(x, z) * 3) > 0.3 ? barkDark : bark);
  });
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.135;
  return group(body, blob(0.045, 0x8a5530, 0.1, 0.25, 0.03));
}

function planks(): THREE.Object3D {
  const a = plank(0.8, 0.05, 0.28, C.woodLight, 0, 0.025, 0);
  const b = plank(0.78, 0.05, 0.27, 0xd6a46a, 0.02, 0.075, 0.01);
  b.rotation.y = 0.06;
  const c = plank(0.76, 0.05, 0.26, 0xe8bd85, -0.02, 0.125, -0.01);
  c.rotation.y = -0.05;
  return group(a, b, c);
}

function soup(): THREE.Object3D {
  const blue = col(0x4f8fd1);
  const rim = col(C.white);
  const broth = col(0xe08a3a);
  const bowl = paint(lathe(BOWL, 0x4f8fd1, 0, 0, 0, 12), 'item-soup', (x, y, z, out) => {
    const r = Math.hypot(x, z);
    if (y < 0.172 && y > 0.168 && r < 0.17) out.copy(broth);
    else if (y > 0.196) out.copy(rim);
    else out.copy(blue);
  });
  return group(bowl, blob(0.035, C.leafLight, 0.06, 0.175, 0.03), blob(0.03, 0xf2d27a, -0.06, 0.172, -0.04));
}

function scrap(): THREE.Object3D {
  const plate = box(0.42, 0.05, 0.3, C.metal, 0, 0.03, 0);
  plate.rotation.y = 0.3;
  const bent = box(0.3, 0.04, 0.2, 0xa5603a, 0.06, 0.08, -0.04);
  bent.rotation.set(0.15, -0.4, 0.2);
  const pipe = cyl(0.05, 0.05, 0.5, 0xb8653a, 8, 0.02, 0.12, 0.04);
  pipe.rotation.z = Math.PI / 2;
  const nut = cyl(0.1, 0.1, 0.06, 0x9aa3ab, -6, -0.12, 0.17, 0.06);
  const bolt = cyl(0.03, 0.03, 0.1, 0x6f777e, 8, -0.12, 0.17, 0.06);
  return group(plate, bent, pipe, nut, bolt);
}

function wheat(): THREE.Object3D {
  // Une gerbe liee : tiges dorees, lien de ficelle, epis gonfles d'un cote.
  const stems = cyl(0.06, 0.07, 0.56, 0xd9b24a, 8, -0.1, 0.075, 0);
  stems.rotation.z = Math.PI / 2;
  const tie = cyl(0.075, 0.075, 0.05, 0x8a5a30, 8, -0.04, 0.075, 0);
  tie.rotation.z = Math.PI / 2;
  const g = group(stems, tie);
  for (const [y, z, a] of [[0.06, -0.055, -0.25], [0.12, 0.0, 0], [0.06, 0.06, 0.25], [0.1, 0.03, 0.1]] as const) {
    const ear = blob(0.055, 0xe8c25a, 0.27, y, z);
    ear.scale.set(2.1, 0.85, 0.85);
    ear.rotation.y = a;
    g.add(ear);
  }
  return g;
}

function bread(): THREE.Object3D {
  const pale = col(0xe0a85a);
  const crust = col(0xb06a28);
  const loaf = paint(lathe(LOAF, 0xc98a42, 0, 0, 0, 12), 'item-bread', (x, _y, _z, out) => {
    // Couche sur le flanc : x local devient la hauteur.
    out.lerpColors(pale, crust, THREE.MathUtils.smoothstep(x / 0.125, -0.3, 0.8));
  });
  loaf.rotation.z = Math.PI / 2;
  loaf.scale.set(0.8, 1, 1.04);
  loaf.position.y = 0.1;
  const g = group(loaf);
  for (const x of [-0.12, 0, 0.12]) {
    const cut = box(0.04, 0.015, 0.15, 0xf0cf8a, x, 0.197, 0);
    cut.rotation.y = 0.55;
    g.add(cut);
  }
  return g;
}

function fish(): THREE.Object3D {
  const back = col(0x557a92);
  const stripe = col(0xd98a7a);
  const belly = col(0xdfe7ea);
  const body = paint(lathe(FISH, 0x7a9ab0, 0, 0, 0, 10), 'item-fish', (x, _y, _z, out) => {
    // Couche le dos en haut : -x local devient la hauteur.
    const t = (-x / 0.1 + 1) / 2;
    if (t > 0.62) out.lerpColors(stripe, back, THREE.MathUtils.smoothstep(t, 0.62, 0.8));
    else out.lerpColors(belly, stripe, THREE.MathUtils.smoothstep(t, 0.3, 0.55));
  });
  body.rotation.z = -Math.PI / 2;
  body.scale.set(0.75, 1, 0.85);
  body.position.y = 0.08;
  const tail = cone(0.09, 0.15, 0x6f8fa4, -4, -0.25, 0.085, 0);
  tail.rotation.z = -Math.PI / 2;
  tail.scale.z = 0.25;
  const fin = cone(0.06, 0.07, 0x6f8fa4, -3, 0.0, 0.135, 0);
  fin.scale.z = 0.3;
  const g = group(body, tail, fin, blob(0.022, 0x1a1a1a, 0.13, 0.1, 0.06), blob(0.022, 0x1a1a1a, 0.13, 0.1, -0.06));
  // Plus long et un peu plus large : il se lit de loin.
  g.scale.set(1.3, 1, 1.15);
  return group(g);
}

function fuel(): THREE.Object3D {
  const red = 0xc9412f;
  const dark = 0x8a2a20;
  const g = group(
    plank(0.34, 0.44, 0.18, red, 0, 0.22, 0),
    box(0.22, 0.05, 0.07, dark, -0.04, 0.465, 0),
  );
  const spout = cyl(0.035, 0.04, 0.08, dark, 8, 0.11, 0.47, 0);
  spout.rotation.z = -0.45;
  g.add(spout);
  for (const sz of [-1, 1]) {
    for (const a of [-0.91, 0.91]) {
      const x = box(0.4, 0.035, 0.012, 0xe0604a, 0, 0.22, sz * 0.092);
      x.rotation.z = a;
      g.add(x);
    }
  }
  return g;
}

function stone(): THREE.Object3D {
  const a = blob(0.145, 0x9a9890, -0.08, 0.1, 0);
  a.scale.set(1.15, 0.72, 1.05);
  const b = blob(0.13, 0x85837b, 0.12, 0.09, 0.06);
  b.scale.set(1.1, 0.72, 1);
  const c = blob(0.11, 0xb0aea6, 0.02, 0.17, -0.05);
  c.scale.set(1.1, 0.75, 1);
  return group(a, b, c);
}

function metal(): THREE.Object3D {
  const top = ingot(0xc9d1d8, 0, 0.1125, 0);
  top.rotation.y = Math.PI / 2;
  return group(ingot(0x9aa3ab, 0, 0.0375, -0.085), ingot(0xa8b0b8, 0, 0.0375, 0.085), top);
}

const BUILD: Record<ItemType, () => THREE.Object3D> = {
  carrot, tomato, log, plank: planks, soup, scrap, wheat, bread, fish, fuel, stone, metal,
};

export function itemMesh(t: ItemType): THREE.Group {
  return merged(`item-${t}`, BUILD[t], 0.04);
}

// ---------------------------------------------------------------- piece

/** Piece : rebord en relief, face legerement creusee, bossage central (symetrique). */
const COIN: Profile = [
  [0, -0.02], [0.105, -0.02], [0.12, -0.03], [0.155, -0.03], [0.17, -0.012], [0.17, 0.012],
  [0.155, 0.03], [0.12, 0.03], [0.105, 0.02], [0, 0.02],
];
let coinGeo: THREE.BufferGeometry | null = null;
const coinMat = lookMat({ color: 0xffffff, vertexColors: true, emissive: 0x5a3c00 });

export function coinMesh(): THREE.Mesh {
  if (!coinGeo) {
    const g = lathe(COIN, 0xffc83a, 0, 0, 0, 12).geometry.clone();
    const p = g.getAttribute('position');
    const c = new Float32Array(p.count * 3);
    const face = col(0xffc83a);
    const edge = col(0xe0a020);
    const tmp = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i), p.getZ(i));
      tmp.copy(r > 0.165 ? edge : face);
      if (r < 0.11 && Math.abs(p.getY(i)) < 0.025) tmp.lerp(edge, 0.25);
      c[i * 3] = tmp.r;
      c[i * 3 + 1] = tmp.g;
      c[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    coinGeo = g;
  }
  const m = new THREE.Mesh(coinGeo, coinMat);
  m.castShadow = true;
  return m;
}
