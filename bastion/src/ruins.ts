// Les ruines : ce qui reste de chaque installation du camp avant qu'on la restaure.
// Elles occupent deja leur emplacement (memes collisions que le batiment restaure).
// Memes pieces que les batiments (rondins, planches, toles), effondrees, gravats arrondis
// et herbes folles ; chaque ruine est fusionnee en un seul maillage.

import * as THREE from 'three';
import { mergeColored } from './bake';
import { logPiece, plankDoor, postPiece, tinRoof, tinSheet } from './buildings';
import { C, at, blob, box, cone, cyl, group, lathe, mixHex, plank, puff, rbox, rcone, rng, type Profile } from './kit';
import { L } from './layout';
import { crate, drum, tireStack, wreck } from './props';
import { BED_D, BED_W } from './resources';

const BURNT = 0x2e2620;
const BURNT2 = 0x3c3027;
const ASH = 0x8c8780;
const WEED = [0x6f7f42, 0x8a8a4e, 0x5d6e38, 0x7d9148];
const BLOOM = [0xf2c94c, 0xf4efe4, 0xd9a0c0];
const LOG = 0x7a5a3a;
const LOG2 = 0x86643f;
const LOG3 = 0x6e5034;
const BRICK = [0xa8553a, 0x8a4a32, 0xb0654a];
const STONES = [C.stone, 0x85837b, 0xa8a59b];

function rot<T extends THREE.Object3D>(o: T, x: number, y = 0, z = 0): T {
  o.rotation.set(x, y, z);
  return o;
}

/** Herbes folles : touffes de brins pointus, petits buissons ronds, quelques fleurs. */
function weeds(g: THREE.Group, r: () => number, n: number, spread: number, y = 0): void {
  for (let i = 0; i < n; i++) {
    const x = (r() - 0.5) * spread;
    const z = (r() - 0.5) * spread * 0.7;
    const tone = WEED[Math.floor(r() * WEED.length)]!;
    if (r() < 0.55) {
      const k = 3 + Math.floor(r() * 3);
      for (let j = 0; j < k; j++) {
        const a = (j / k) * Math.PI * 2 + r();
        const h = 0.28 + r() * 0.3;
        const lean = 0.25 + r() * 0.3;
        const c = cone(0.045, h, j % 2 ? tone : mixHex(tone, 0xd9c27a, 0.25), 5,
          x + Math.cos(a) * (0.04 + Math.sin(lean) * h * 0.5), y + Math.cos(lean) * h * 0.5, z + Math.sin(a) * (0.04 + Math.sin(lean) * h * 0.5));
        c.rotation.set(Math.sin(a) * lean, 0, -Math.cos(a) * lean);
        g.add(c);
      }
    } else {
      const s = 0.16 + r() * 0.16;
      const b = puff(s, tone, x, y + s * 0.45, z, Math.floor(r() * 3));
      b.scale.y = 0.75;
      g.add(b);
      if (r() < 0.4) g.add(blob(0.05, BLOOM[Math.floor(r() * BLOOM.length)]!, x + s * 0.3, y + s * 0.95, z + s * 0.4));
    }
  }
}

/** Gravats arrondis autour de (cx, cz). */
function rubble(g: THREE.Group, r: () => number, n: number, cx: number, cz: number, spread: number, tones: number[], size = 0.18): void {
  for (let i = 0; i < n; i++) {
    const s = size * (0.6 + r() * 0.8);
    const b = blob(s, tones[Math.floor(r() * tones.length)]!, cx + (r() - 0.5) * spread, s * 0.35, cz + (r() - 0.5) * spread * 0.8);
    b.scale.set(1.2, 0.65, 1);
    b.rotation.y = r() * 3;
    g.add(b);
  }
}

/** Planche tombee. */
function board(len: number, color: number, x: number, y: number, z: number, ry: number, rz = 0): THREE.Mesh {
  return rot(plank(len, 0.07, 0.24, color, x, y, z), 0, ry, rz);
}

/** Rondin couche le long de x, oriente de ry. */
function lyingLog(len: number, rad: number, tone: number, x: number, y: number, z: number, ry: number): THREE.Mesh {
  return rot(logPiece(len, rad, tone, x, y, z), 0, ry, Math.PI / 2);
}

/** Fige une ruine : un seul maillage, posee a son emplacement. */
function finish(scene: THREE.Scene, g: THREE.Group, x: number, z: number, ry = 0): THREE.Group {
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  const m = mergeColored(g);
  scene.add(m);
  return m;
}

const CAN: Profile = [[0, 0], [0.14, 0], [0.16, 0.03], [0.16, 0.24], [0.12, 0.28], [0, 0.29]];

export function bedRuin(scene: THREE.Scene, x: number, z: number, W = BED_W, D = BED_D): THREE.Group {
  const r = rng(Math.round(x * 31 + z * 17));
  const g = new THREE.Group();
  g.add(box(W - 0.2, 0.05, D - 0.2, 0x6a4a2e, 0, 0.03, 0));
  // Cadre eventre : un long cote tient encore, l'autre est tombe.
  g.add(plank(W, 0.36, 0.1, C.woodDark, 0, 0.18, -D / 2));
  g.add(rot(plank(W * 0.7, 0.36, 0.1, C.wood, 0.3, 0.1, D / 2 + 0.25), 1.3));
  g.add(rot(plank(0.1, 0.36, D, 0x7f5230, -W / 2, 0.18, 0), 0, 0, 0.25));
  g.add(board(1.3, C.wood, W / 2 + 0.2, 0.05, 0.2, 0.8));
  g.add(postPiece(0.3, 0.05, LOG3, W / 2, -D / 2), postPiece(0.22, 0.05, LOG, -W / 2 + 0.05, D / 2));
  weeds(g, r, Math.round(9 * (W * D) / (BED_W * BED_D)), W);
  // Un arrosoir renverse.
  const can = group(lathe(CAN, 0x5f7a8a, 0, 0, 0), rot(cyl(0.025, 0.035, 0.3, 0x55707e, 8, 0.15, 0.22, 0), 0, 0, -0.8));
  can.position.set(0.6, 0.16, -0.2);
  can.rotation.set(0, 0.6, Math.PI / 2 - 0.1);
  g.add(can);
  return finish(scene, g, x, z);
}

/** Un champ en friche : terre seche, sillons effaces, piquets tombes, epouvantail, herbes folles. */
export function fieldRuin(scene: THREE.Scene, x: number, z: number, W: number, D: number): THREE.Group {
  const r = rng(Math.round(x * 7 + z * 29));
  const g = new THREE.Group();
  g.add(box(W, 0.05, D, 0x7a5a3a, 0, 0.03, 0));
  for (let i = 0; i < 4; i++) g.add(plank(W * (0.7 + r() * 0.2), 0.07, 0.3, i % 2 ? 0x6a4a2e : 0x704f30, (r() - 0.5) * 0.4, 0.07, -D * 0.36 + i * D * 0.24));
  for (let i = 0; i < 4; i++) {
    const px = ((i < 2 ? -1 : 1) * W) / 2;
    const pz = ((i % 2 ? -1 : 1) * D) / 2;
    if (i % 2) g.add(lyingLog(0.7, 0.065, LOG3, px + 0.3, 0.07, pz, 0.3));
    else g.add(postPiece(0.7, 0.07, C.woodDark, px, pz));
  }
  // L'epouvantail tombe : croix de bois, tete de toile, chapeau de paille.
  const scare = group(
    logPiece(1.6, 0.05, LOG2, 0, 0.8, 0), rot(logPiece(1.0, 0.045, LOG3, 0, 1.25, 0), 0, 0, Math.PI / 2),
    blob(0.16, C.canvas, 0, 1.72, 0),
    lathe([[0, 0], [0.3, 0], [0.31, 0.02], [0.14, 0.05], [0.13, 0.16], [0, 0.18]], 0xd9b24a, 0, 1.8, 0),
    rot(plank(0.5, 0.45, 0.12, 0x8a5a3a, 0, 1.05, 0), 0, 0, 0),
  );
  scare.position.set(W * 0.22, 0.12, -D * 0.15);
  scare.rotation.set(Math.PI / 2 - 0.05, 0, 0.5);
  g.add(scare);
  weeds(g, r, 16, W);
  return finish(scene, g, x, z);
}

/** Un amas qui bouche un passage : carcasse, toles, pneus, palettes. */
export function junkPile(scene: THREE.Scene, x: number, z: number, ry: number, seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  const car = wreck(r() < 0.5 ? 0x5f7a8a : 0x8a5a3a, r() < 0.4);
  car.rotation.y = 0.15;
  car.position.set(-0.4, 0, 0);
  g.add(car);
  for (let i = 0; i < 3; i++) {
    const s = tinSheet(1.0, 1.3, [0xa5603a, 0x8a8f91, 0x9c4a3c][i]!);
    s.position.set(2.0 + i * 0.3, 0, 0.3 - i * 0.25);
    s.rotation.set(-0.2, 0.4 - i * 0.2, (i - 1) * 0.15);
    g.add(s);
  }
  // Une palette debout contre les toles.
  const pallet = group(plank(1.0, 0.1, 0.8, C.woodDark, 0, 0, 0), plank(1.0, 0.05, 0.2, C.wood, 0, 0.07, -0.28), plank(1.0, 0.05, 0.2, C.woodLight, 0, 0.07, 0.28));
  pallet.position.set(1.6, 0.45, -0.75);
  pallet.rotation.set(-1.25, 0.2, 0);
  g.add(pallet);
  g.add(at(tireStack(3, seed + 1), -2.6, 0, 0.3), at(crate(0.6), 2.6, 0, -0.6, 0.3));
  weeds(g, r, 4, 5.0);
  return finish(scene, g, x, z, ry);
}

/** Le moulin effondre : tour de pierre arrachee, toit et ailes au sol, four eboule. */
const MILL_STUMP: Profile = [
  [0, 0], [1.84, 0], [1.87, 0.04], [1.87, 0.52], [1.84, 0.56], [1.74, 0.58], [1.73, 0.64], [1.66, 1.5], [1.62, 1.92], [1.52, 1.98], [1.44, 1.9], [0, 1.86],
];
export function millRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const r = rng(14);
  const g = new THREE.Group();
  const stump = lathe(MILL_STUMP, 0xd6ccba, 0, 0, 0);
  const base = lathe([[0, 0], [1.88, 0], [1.9, 0.04], [1.9, 0.5], [1.86, 0.56], [0, 0.56]], C.stone, 0, 0, 0);
  g.add(stump, base);
  // Le haut du mur arrache : blocs de pierre irreguliers sur la couronne.
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + r() * 0.3;
    const h = 0.2 + r() * 0.5;
    const b = rbox(0.55, h, 0.38, STONES[i % 3]!, 0.08, Math.sin(a) * 1.55, 1.9 + h / 2 - 0.05, Math.cos(a) * 1.55);
    b.rotation.y = a;
    g.add(b);
  }
  for (let i = 0; i < 7; i++) {
    const b = plank(0.5 + r() * 0.4, 0.36, 0.4, STONES[Math.floor(r() * 3)]!, (r() - 0.5) * 4, 0.18, (r() - 0.5) * 4);
    if (Math.hypot(b.position.x, b.position.z) < 2.0) b.position.x += b.position.x < 0 ? -1.2 : 1.2;
    b.rotation.y = r() * 3;
    g.add(b);
  }
  // Les ailes tombees : longeron, cadre, toile dechiree.
  for (let i = 0; i < 2; i++) {
    const wing = group(
      plank(3.4, 0.1, 0.14, C.woodDark, 0, 0, 0),
      plank(2.4, 0.03, 0.5, i ? 0xe8e0cc : C.canvas, 0.3, 0.04, 0.36),
      plank(2.5, 0.05, 0.05, 0x9c6a3e, 0.3, 0.06, 0.62),
    );
    for (let k = 0; k < 3; k++) wing.add(plank(0.05, 0.05, 0.6, 0x9c6a3e, -0.6 + k * 0.8, 0.07, 0.36));
    wing.position.set(2.0 + i * 0.6, 0.06 + i * 0.07, -0.6 + i * 1.2);
    wing.rotation.y = Math.PI / 2 - 0.5 - i * 0.9;
    g.add(wing);
  }
  // Le toit conique, renverse sur le flanc.
  const cap = rcone(1.15, 1.2, 0x8f4a2a, 0.25, -1.75, 0.95, -1.25);
  cap.rotation.set(0.5, 0, 1.75);
  g.add(cap);
  // Le four : socle de pierre, dome eboule, briques.
  const dome = blob(0.62, BRICK[0]!, 2.0, 0.36, 0.8);
  dome.scale.set(1.15, 0.45, 0.95);
  g.add(plank(1.6, 0.3, 1.3, C.stone, 2.0, 0.15, 0.8), dome);
  rubble(g, r, 6, 2.1, 0.9, 1.8, BRICK, 0.14);
  weeds(g, r, 8, 3.2, 1.86);
  weeds(g, r, 6, 5.0);
  return finish(scene, g, x, z);
}

/** Le ponton : des pieux qui depassent de l'eau, deux planches flottantes. */
export function dockRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) for (const sx of [-0.55, 0.55]) g.add(postPiece(0.5 + ((i + (sx > 0 ? 1 : 0)) % 2) * 0.3, 0.09, i % 2 ? 0x5e452c : 0x6a4e32, sx, -1.2 + i * 1.3, -0.1));
  g.add(board(1.2, C.wood, 0.3, 0.03, 0.4, 0.4), board(1.0, C.woodDark, -0.4, 0.03, 1.6, 2.2));
  g.add(rot(plank(1.4, 0.06, 0.28, 0xb98450, 0.1, 0.2, -1.45), 0, 0.08, 0.22), rot(plank(0.9, 0.06, 0.28, C.wood, -0.2, 0.02, -0.4), 0, 1.2, 0.05));
  g.add(rot(plank(0.12, 0.1, 2.0, C.woodDark, -0.5, 0.05, -0.6), 0.08, 0.05, 0));
  return finish(scene, g, x, z);
}

export function benchRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(3);
  const g = new THREE.Group();
  // Le plateau a bascule sur deux pieds restes debout.
  const top = group(plank(2.4, 0.13, 0.36, 0xb07a48, 0, 0, -0.37), plank(2.4, 0.13, 0.36, 0xc28c58, 0, 0, 0), plank(2.4, 0.13, 0.36, 0x9c6a3e, 0, 0, 0.37));
  top.position.set(0.2, 0.45, 0);
  top.rotation.z = 0.32;
  g.add(top);
  g.add(plank(0.16, 0.88, 0.16, C.woodDark, 1.0, 0.44, -0.42), plank(0.16, 0.88, 0.16, 0x7f5230, 1.0, 0.44, 0.42));
  g.add(board(0.9, C.woodDark, -0.9, 0.06, 0.6, 0.5), board(0.8, C.woodDark, -1.2, 0.06, -0.3, 1.9));
  // Le panneau a outils a plat, l'etau tombe, un fut couche.
  g.add(rot(plank(1.8, 1.1, 0.06, 0xc8a878, -0.3, 0.06, -0.85), -Math.PI / 2, 0, 0.1));
  g.add(rot(rbox(0.34, 0.2, 0.26, 0x3a5a7a, 0.05, -0.9, 0.12, 0.95), 0, 0.7, 0.3));
  const d = drum(0x8a3f30);
  d.rotation.z = Math.PI / 2;
  d.position.set(0.9, 0.32, 0.9);
  g.add(d);
  for (let i = 0; i < 4; i++) g.add(board(0.4, i % 2 ? C.metal : C.woodDark, (r() - 0.5) * 2, 0.04, (r() - 0.5) * 1.6, r() * 3));
  weeds(g, r, 5, 2.4);
  return finish(scene, g, L.bench.x, L.bench.z, -Math.PI / 2);
}

export function sawmillRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(5);
  const g = new THREE.Group();
  g.add(postPiece(1.2, 0.13, LOG, -1.55, -0.8), postPiece(0.7, 0.13, LOG2, 1.55, 0.8));
  g.add(rot(logPiece(2.2, 0.13, LOG2, 1.4, 0.9, -0.6), 0, 0, 0.6));
  // Le toit tombe d'un cote, en travers du banc.
  const roof = tinRoof(4.0, 2.5, C.rust, 0x9c4a3c);
  roof.position.set(-0.4, 0.75, 0.1);
  roof.rotation.set(0.15, 0, -0.42);
  g.add(roof);
  const table = group(plank(2.6, 0.62, 1.16, C.woodDark, 0, 0, 0), plank(2.9, 0.08, 1.4, 0xd2a066, 0, 0.35, 0));
  table.position.set(0.2, 0.3, 0.3);
  table.rotation.z = -0.12;
  g.add(table);
  g.add(cyl(0.55, 0.55, 0.04, C.rustDark, 8, 1.3, 0.04, 0.9), cyl(0.12, 0.12, 0.06, 0x555555, 8, 1.3, 0.06, 0.9));
  for (let i = 0; i < 5; i++) g.add(board(1.2 + r() * 0.8, i % 2 ? C.wood : 0xd9b07a, (r() - 0.5) * 3, 0.05 + i * 0.03, 0.9 + r() * 0.4, r() * 0.6));
  g.add(lyingLog(2.2, 0.14, LOG, 0.1, 0.14, -0.95, 0.1), lyingLog(1.6, 0.13, LOG3, -0.4, 0.13, -1.08, -0.15));
  weeds(g, r, 7, 3.2);
  return finish(scene, g, L.sawmill.x, L.sawmill.z);
}

const POT: Profile = [[0, 0], [0.32, 0], [0.38, 0.04], [0.42, 0.3], [0.44, 0.5], [0.47, 0.53], [0.46, 0.56], [0.42, 0.55], [0.38, 0.12], [0, 0.1]];

export function kitchenRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(6);
  const g = new THREE.Group();
  const d = drum(BURNT, false);
  d.rotation.z = Math.PI / 2 - 0.1;
  d.position.set(-0.6, 0.32, 0.1);
  g.add(d);
  const ash = blob(0.9, ASH, 0.3, 0.02, 0);
  ash.scale.set(1.2, 0.18, 0.9);
  g.add(ash);
  for (let i = 0; i < 7; i++) g.add(board(0.8 + r() * 1.2, i % 2 ? BURNT : BURNT2, (r() - 0.5) * 2.4, 0.06 + r() * 0.1, (r() - 0.5) * 1.4, r() * 3, (r() - 0.5) * 0.3));
  // La marmite renversee, le tuyau tombe, deux poteaux calcines, le foyer de pierres.
  const pot = lathe(POT, 0x3a3a3a, 0.9, 0.42, 0.5);
  pot.rotation.z = 1.4;
  g.add(pot);
  g.add(rot(cyl(0.1, 0.1, 2.0, 0x4a4a4a, 8, 0.2, 0.1, -0.7), 0, 0, Math.PI / 2), rcone(0.2, 0.14, 0x2c2e30, 0.3, 1.25, 0.12, -0.75));
  g.add(cyl(0.08, 0.1, 1.2, BURNT, 8, -1.45, 0.6, 0.95), cyl(0.08, 0.1, 0.8, BURNT2, 8, 1.45, 0.4, -0.95));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.add(blob(0.12, STONES[i % 3]!, 0.3 + Math.cos(a) * 0.62, 0.06, Math.sin(a) * 0.5));
  }
  // La tole de l'auvent, tombee a plat.
  const roof = tinRoof(1.6, 1.1, 0x5f8a85);
  roof.position.set(-0.8, 0.12, -0.5);
  roof.rotation.set(0.05, 0.5, 0.08);
  g.add(roof);
  weeds(g, r, 4, 2.6);
  return finish(scene, g, L.kitchen.x, L.kitchen.z);
}

export function towerRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(8);
  const g = new THREE.Group();
  const legs: [number, number, number][] = [[-0.9, -0.9, 1.6], [0.9, -0.9, 0.7], [-0.9, 0.9, 1.1], [0.9, 0.9, 0.5]];
  for (const [x, z, h] of legs) g.add(postPiece(h, 0.15, 0x6e5034, x, z));
  // Le plancher a glisse et repose de travers.
  const deck = group(plank(2.6, 0.18, 2.6, LOG3, 0, 0, 0));
  for (let i = 0; i < 5; i++) deck.add(plank(2.4, 0.05, 0.44, [C.wood, 0xb07a48, 0xc28c58][i % 3]!, 0, 0.11, -0.9 + i * 0.45));
  deck.position.set(0.5, 0.6, 0.7);
  deck.rotation.set(0.35, 0.3, -0.2);
  g.add(deck);
  for (let i = 0; i < 6; i++) g.add(lyingLog(1.0 + r() * 0.5, 0.1, i % 2 ? LOG : LOG2, (r() - 0.5) * 2.6, 0.1, (r() - 0.5) * 2.6, r() * 3));
  const roof = tinRoof(2.6, 2.4, 0x6f7a4a, 0x8a8f91);
  roof.position.set(-1.0, 0.3, -0.6);
  roof.rotation.set(0.2, 0.6, 0.25);
  g.add(roof);
  // L'echelle couchee.
  const ladder = group(plank(2.2, 0.07, 0.07, C.woodDark, 0, 0, -0.32), plank(2.2, 0.07, 0.07, C.woodDark, 0, 0, 0.32));
  for (let i = 0; i < 4; i++) ladder.add(plank(0.07, 0.06, 0.7, C.woodLight, -0.9 + i * 0.6, 0.03, 0));
  ladder.position.set(0.9, 0.05, 1.45);
  ladder.rotation.y = 0.5;
  g.add(ladder);
  weeds(g, r, 6, 2.8);
  return finish(scene, g, L.tower.x, L.tower.z);
}

export function shelterRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(10);
  const g = new THREE.Group();
  // Un conteneur rouille, porte arrachee, a moitie mange par la vegetation.
  g.add(box(4.2, 2.3, 2.2, 0x8a4526, 0, 1.15, 0));
  const front = tinSheet(3.96, 2.1, 0x9a5232);
  front.position.set(0, 0.1, 1.135);
  g.add(front);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.16, 2.36, 0.16, 0x6f3820, sx * 2.1, 1.18, sz * 1.1));
  g.add(box(4.36, 0.16, 0.16, 0x6f3820, 0, 2.28, 1.1), box(4.3, 0.1, 2.3, 0x6f3820, 0, 2.36, 0));
  g.add(box(1.2, 1.9, 0.05, 0x1c1714, 0.6, 1.0, 1.19));
  g.add(box(1.4, 0.6, 0.05, 0xa5603a, -1.1, 1.8, 1.19), rot(plank(1.3, 0.14, 0.05, 0x9c6a3e, -1.1, 1.8, 1.23), 0, 0, 0.3));
  g.add(box(0.9, 0.5, 0.04, 0x6f3820, -1.4, 0.7, 1.2), box(0.5, 1.1, 0.04, 0xa5603a, 1.6, 1.3, 1.2));
  const door = plankDoor(1.2, 1.9, 0, 0, 0, 0x6f3820);
  door.position.set(1.4, 0.1, 1.9);
  door.rotation.set(-Math.PI / 2, 0, 0.3);
  g.add(door);
  // Mousse et buissons sur le toit, herbes au pied.
  for (const [mx, mz, s] of [[-1.4, 0.6, 0.45], [0.9, -0.5, 0.38], [1.8, 0.7, 0.3]] as const) {
    const m = puff(s, WEED[(mx > 0 ? 1 : 0) + 1]!, mx, 2.42, mz, 2);
    m.scale.y = 0.6;
    g.add(m);
  }
  weeds(g, r, 4, 3.6, 2.41);
  weeds(g, r, 7, 4.4);
  g.add(at(tireStack(2, 6), -2.6, 0, 1.2));
  return finish(scene, g, L.shelter.x, L.shelter.z, -0.5);
}

/** La porte nord bouchee : une carcasse, des palettes, des pneus, des rondins tombes. */
export function gateJunk(scene: THREE.Scene): THREE.Group {
  const r = rng(12);
  const g = new THREE.Group();
  const car = wreck(0x5f7a8a, false);
  car.rotation.y = 0.12;
  car.position.set(-0.6, 0, -0.75);
  g.add(car);
  for (let i = 0; i < 3; i++) {
    const s = tinSheet(1.0, 1.4, [0xa5603a, 0x8a8f91, 0x9c4a3c][i]!);
    s.position.set(1.6 + i * 0.35, 0, 0.3 - i * 0.2);
    s.rotation.set(-0.25, 0.4 - i * 0.2, (i - 1) * 0.15);
    g.add(s);
  }
  g.add(at(tireStack(3, 13), 2.2, 0, -0.5), at(crate(0.6), -2.4, 0, 0.4, 0.3));
  for (let i = 0; i < 3; i++) g.add(lyingLog(2.6, 0.17, [LOG, LOG2, LOG3][i]!, (r() - 0.5) * 2, 0.17 + i * 0.05, 0.9 + r() * 0.3, r() * 0.6));
  g.add(rot(cone(0.17, 0.4, 0xd9b07a, 6, -2.2, 0.2, 1.0), 0, 0, Math.PI / 2));
  weeds(g, r, 4, 5.0);
  return finish(scene, g, L.northGate.x, L.northGate.z);
}

/** La cabane de carrier effondree, son treuil au sol. */
export function quarryRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const r = rng(31);
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) g.add(board(1.2 + r() * 1.0, i % 2 ? C.woodDark : 0x9c6a3e, -2.4 + (r() - 0.5) * 2, 0.06 + i * 0.03, 0.6 + (r() - 0.5) * 1.4, r() * 3));
  // Ce qui tient encore du bardage : quelques planches debout, cassees.
  for (let i = 0; i < 4; i++) g.add(plank(0.3, 0.5 + r() * 0.7, 0.05, [0xb07a48, 0x9c6a3e, 0xc28c58][i % 3]!, -3.3 + i * 0.32, 0.4, 1.4));
  g.add(rot(logPiece(3.4, 0.11, LOG, 0.4, 0.15, 0), 0, 0, Math.PI / 2 - 0.1));
  g.add(rot(logPiece(1.3, 0.11, LOG2, 1.2, 0.12, 0.9), 0, 0.9, Math.PI / 2));
  const roof = tinRoof(2.7, 2.1, C.rust, 0x8a8f91);
  roof.position.set(-2.2, 0.4, 0.8);
  roof.rotation.set(0.3, 0.2, 0.4);
  g.add(roof);
  g.add(rot(rbox(0.45, 0.36, 0.45, C.stone, 0.08, 0.6, 0.18, -0.2), 0, 0.5));
  rubble(g, r, 5, 1.0, 0.8, 1.2, STONES, 0.17);
  weeds(g, r, 6, 3.0);
  return finish(scene, g, x, z, 0.4);
}

/** Le four de la fonderie, ecroule. */
export function foundryRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const r = rng(37);
  const g = new THREE.Group();
  g.add(lathe([[0, 0], [1.15, 0], [1.18, 0.04], [1.18, 0.3], [1.13, 0.36], [1.11, 0.78], [1.0, 0.84], [0.9, 0.76], [0, 0.72]], 0x8a4a32, -0.6, 0, 0));
  for (let i = 0; i < 9; i++) {
    const b = plank(0.35, 0.2, 0.2, BRICK[Math.floor(r() * 3)]!, -0.6 + (r() - 0.5) * 3, 0.1, (r() - 0.5) * 2.4);
    b.rotation.y = r() * 3;
    g.add(b);
  }
  g.add(rot(cyl(0.3, 0.38, 2.6, 0x6a3a2a, 8, 0.8, 0.35, 0.8), 0, 0, Math.PI / 2 - 0.15));
  g.add(rot(cyl(0.25, 0.27, 1.4, 0x5e646a, 8, 1.2, 0.26, -0.9), 0, 0.6, Math.PI / 2));
  const roof = tinRoof(2.2, 1.6, 0x5e646a, C.rust);
  roof.position.set(-1.4, 0.2, -1.0);
  roof.rotation.set(0.12, -0.4, 0.15);
  g.add(roof);
  weeds(g, r, 5, 3.4);
  return finish(scene, g, x, z);
}

/**
 * Un chantier de l'agrandissement du camp : dalle de terre battue, piquets et cordeau,
 * planches empilees, quelques pierres et herbes. Il attend qu'on paie pour batir.
 */
export function buildSite(scene: THREE.Scene, x: number, z: number, rad: number, seed: number): THREE.Group {
  const r = rng(seed);
  const g = new THREE.Group();
  g.add(cyl(rad * 0.92, rad, 0.08, 0xa0805a, 24, 0, 0.04, 0));
  const k = rad * 0.72;
  const corners: [number, number][] = [[-k, -k], [k, -k], [k, k], [-k, k]];
  for (const [sx, sz] of corners) g.add(cyl(0.05, 0.065, 0.75, C.woodLight, 8, sx, 0.37, sz));
  // Cordeau tendu entre les piquets.
  const cord = 0xf0e6c8;
  g.add(box(2 * k, 0.025, 0.025, cord, 0, 0.62, -k), box(2 * k, 0.025, 0.025, cord, 0, 0.62, k));
  g.add(box(0.025, 0.025, 2 * k, cord, -k, 0.62, 0), box(0.025, 0.025, 2 * k, cord, k, 0.62, 0));
  // Planches empilees, pretes a monter.
  const tones = [C.wood, C.woodLight, C.woodDark, C.wood];
  for (let i = 0; i < 4; i++) g.add(board(1.5, tones[i]!, -0.15 + (r() - 0.5) * 0.08, 0.12 + i * 0.075, -0.25 + i * 0.03, 0.05 * (i % 2 ? 1 : -1)));
  g.add(at(crate(0.45), rad * 0.45, 0, rad * 0.35, 0.4));
  rubble(g, r, 5, -rad * 0.4, rad * 0.35, rad * 0.6, STONES, 0.16);
  weeds(g, r, 5, rad * 2.2);
  return finish(scene, g, x, z, r() * 0.6 - 0.3);
}
