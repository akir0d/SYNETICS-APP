// Les ruines : ce qui reste de chaque installation du camp avant qu'on la restaure.
// Elles occupent deja leur emplacement (memes collisions que le batiment restaure).

import * as THREE from 'three';
import { mergeColored } from './bake';
import { C, at, blob, box, cone, cyl, rbox, rng } from './kit';
import { L } from './layout';
import { crate, drum, roofSheet, sheet, tireStack, wreck } from './props';
import { BED_D, BED_W } from './resources';

const BURNT = 0x2e2620;
const ASH = 0x8c8780;
const WEED = [0x6f7f42, 0x8a8a4e, 0x5d6e38];

function weeds(g: THREE.Group, r: () => number, n: number, spread: number, y = 0): void {
  for (let i = 0; i < n; i++) {
    const b = blob(0.18 + r() * 0.22, WEED[Math.floor(r() * WEED.length)]!, (r() - 0.5) * spread, y + 0.1, (r() - 0.5) * spread * 0.7);
    b.scale.y = 0.7;
    g.add(b);
  }
}

function plank(len: number, color: number, x: number, y: number, z: number, ry: number, rz = 0): THREE.Mesh {
  const p = box(len, 0.08, 0.26, color, x, y, z);
  p.rotation.set(0, ry, rz);
  return p;
}

/** Fige une ruine : un seul maillage, posee a son emplacement. */
function finish(scene: THREE.Scene, g: THREE.Group, x: number, z: number, ry = 0): THREE.Group {
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  const m = mergeColored(g);
  scene.add(m);
  return m;
}

export function bedRuin(scene: THREE.Scene, x: number, z: number, W = BED_W, D = BED_D): THREE.Group {
  const r = rng(Math.round(x * 31 + z * 17));
  const g = new THREE.Group();
  g.add(box(W - 0.2, 0.05, D - 0.2, 0x6a4a2e, 0, 0.03, 0));
  // Cadre eventre : un long cote tient encore, l'autre est tombe.
  g.add(box(W, 0.4, 0.1, C.woodDark, 0, 0.2, -D / 2));
  const fallen = box(W * 0.7, 0.4, 0.1, C.wood, 0.3, 0.1, D / 2 + 0.25);
  fallen.rotation.x = 1.3;
  g.add(fallen);
  const side = box(0.1, 0.4, D, C.woodDark, -W / 2, 0.2, 0);
  side.rotation.z = 0.25;
  g.add(side);
  g.add(plank(1.3, C.wood, W / 2 + 0.2, 0.05, 0.2, 0.8));
  weeds(g, r, Math.round(9 * (W * D) / (BED_W * BED_D)), W);
  g.add(at(cyl(0.18, 0.14, 0.3, 0x5f7a8a, 8, 0, 0, 0), 0.6, 0.15, -0.2));
  return finish(scene, g, x, z);
}

/** Un champ en friche : terre seche, piquets tombes, herbes folles. */
export function fieldRuin(scene: THREE.Scene, x: number, z: number, W: number, D: number): THREE.Group {
  const r = rng(Math.round(x * 7 + z * 29));
  const g = new THREE.Group();
  g.add(box(W, 0.05, D, 0x7a5a3a, 0, 0.03, 0));
  for (let i = 0; i < 4; i++) {
    const p = cyl(0.06, 0.07, 0.7, C.woodDark, 5, (i < 2 ? -1 : 1) * W / 2, 0.35, (i % 2 ? -1 : 1) * D / 2);
    if (i % 2) p.rotation.z = 1.2;
    g.add(p);
  }
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
    const s = sheet(1.0, 1.3, [0xa5603a, 0x8a8f91, 0x9c4a3c][i]!);
    s.position.set(2.0 + i * 0.3, 0, 0.3 - i * 0.25);
    s.rotation.set(-0.2, 0.4 - i * 0.2, (i - 1) * 0.15);
    g.add(s);
  }
  g.add(at(tireStack(3, seed + 1), -2.6, 0, 0.3), at(crate(0.6), 2.6, 0, -0.6, 0.3));
  return finish(scene, g, x, z, ry);
}

/** Le moulin effondre : tour de pierre arrachee, ailes au sol. */
export function millRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const r = rng(14);
  const g = new THREE.Group();
  g.add(cyl(1.5, 1.8, 2.0, C.stone, 9, 0, 1.0, 0));
  for (let i = 0; i < 7; i++) {
    const b = rbox(0.5 + r() * 0.4, 0.4, 0.4, r() < 0.5 ? C.stone : 0x85837b, 0.06, (r() - 0.5) * 4, 0.2, (r() - 0.5) * 4);
    b.rotation.y = r() * 3;
    g.add(b);
  }
  for (let i = 0; i < 2; i++) {
    const wing = box(0.5, 0.06, 3.4, C.woodDark, 2.0 + i * 0.6, 0.06 + i * 0.07, -0.6 + i * 1.2);
    wing.rotation.y = 0.5 + i * 0.9;
    g.add(wing);
  }
  weeds(g, r, 8, 3.6, 2.0);
  return finish(scene, g, x, z);
}

/** Le ponton : des pieux qui depassent de l'eau, deux planches flottantes. */
export function dockRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) for (const sx of [-0.55, 0.55]) g.add(cyl(0.09, 0.09, 0.5 + (i % 2) * 0.3, 0x5e452c, 5, sx, 0.15, -1.2 + i * 1.3));
  g.add(plank(1.2, C.wood, 0.3, 0.03, 0.4, 0.4), plank(1.0, C.woodDark, -0.4, 0.03, 1.6, 2.2));
  return finish(scene, g, x, z);
}

export function benchRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(3);
  const g = new THREE.Group();
  const top = rbox(2.4, 0.16, 1.1, 0x7d8790, 0.04, 0.2, 0.45, 0);
  top.rotation.z = 0.32;
  g.add(top);
  g.add(box(0.14, 0.9, 0.14, C.woodDark, 1.0, 0.45, -0.42), box(0.14, 0.9, 0.14, C.woodDark, 1.0, 0.45, 0.42));
  g.add(plank(0.9, C.woodDark, -0.9, 0.06, 0.6, 0.5), plank(0.8, C.woodDark, -1.2, 0.06, -0.3, 1.9));
  const board = box(1.8, 1.1, 0.06, 0xc8a878, -0.3, 0.06, -0.85);
  board.rotation.x = -Math.PI / 2;
  g.add(board);
  const d = drum(0x8a3f30);
  d.rotation.z = Math.PI / 2;
  d.position.set(0.9, 0.32, 0.9);
  g.add(d);
  for (let i = 0; i < 4; i++) g.add(plank(0.4, i % 2 ? C.metal : C.woodDark, (r() - 0.5) * 2, 0.04, (r() - 0.5) * 1.6, r() * 3));
  weeds(g, r, 5, 2.4);
  return finish(scene, g, L.bench.x, L.bench.z, -Math.PI / 2);
}

export function sawmillRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(5);
  const g = new THREE.Group();
  g.add(box(0.14, 1.2, 0.14, C.woodDark, -1.55, 0.6, -0.8), box(0.14, 0.7, 0.14, C.woodDark, 1.55, 0.35, 0.8));
  const post = box(0.14, 2.2, 0.14, C.woodDark, 1.4, 0.9, -0.6);
  post.rotation.z = 0.6;
  g.add(post);
  const roof = roofSheet(3.8, 2.3, C.rust);
  roof.position.set(-0.4, 0.75, 0.1);
  roof.rotation.set(0.15, 0, -0.42);
  g.add(roof);
  const table = rbox(2.6, 0.7, 1.3, C.woodDark, 0.06, 0.2, 0.3, 0.3);
  table.rotation.z = -0.12;
  g.add(table);
  const blade = cyl(0.55, 0.55, 0.05, C.rustDark, 14, 1.3, 0.04, 0.9);
  g.add(blade);
  for (let i = 0; i < 5; i++) g.add(plank(1.2 + r() * 0.8, C.wood, (r() - 0.5) * 3, 0.05 + i * 0.03, 0.9 + r() * 0.4, r() * 0.6));
  weeds(g, r, 7, 3.2);
  return finish(scene, g, L.sawmill.x, L.sawmill.z);
}

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
  for (let i = 0; i < 7; i++) g.add(plank(0.8 + r() * 1.2, BURNT, (r() - 0.5) * 2.4, 0.06 + r() * 0.1, (r() - 0.5) * 1.4, r() * 3, (r() - 0.5) * 0.3));
  const pot = cyl(0.45, 0.38, 0.55, 0x3a3a3a, 12, 0.9, 0.3, 0.5);
  pot.rotation.z = 1.4;
  g.add(pot);
  const pipe = cyl(0.12, 0.12, 2.0, 0x4a4a4a, 8, 0.2, 0.12, -0.7);
  pipe.rotation.z = Math.PI / 2;
  g.add(pipe);
  g.add(box(0.06, 1.2, 0.06, BURNT, -1.45, 0.6, 0.95), box(0.06, 0.8, 0.06, BURNT, 1.45, 0.4, -0.95));
  weeds(g, r, 4, 2.6);
  return finish(scene, g, L.kitchen.x, L.kitchen.z);
}

export function towerRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(8);
  const g = new THREE.Group();
  const legs: [number, number, number][] = [[-0.9, -0.9, 1.6], [0.9, -0.9, 0.7], [-0.9, 0.9, 1.1], [0.9, 0.9, 0.5]];
  for (const [x, z, h] of legs) g.add(cyl(0.13, 0.15, h, 0x6e5034, 6, x, h / 2, z), cyl(0.12, 0.12, 0.05, 0xd9b07a, 6, x, h + 0.02, z));
  const deck = rbox(2.6, 0.2, 2.6, C.wood, 0.04, 0.5, 0.6, 0.7);
  deck.rotation.set(0.35, 0.3, -0.2);
  g.add(deck);
  for (let i = 0; i < 6; i++) {
    const p = cyl(0.12, 0.12, 1.2 + r() * 0.5, 0x7a5a3a, 6, (r() - 0.5) * 2.6, 0.12, (r() - 0.5) * 2.6);
    p.rotation.set(Math.PI / 2, 0, r() * 3);
    g.add(p);
  }
  const roof = roofSheet(2.4, 2.2, 0x6f7a4a);
  roof.position.set(-1.0, 0.3, -0.6);
  roof.rotation.set(0.2, 0.6, 0.25);
  g.add(roof);
  weeds(g, r, 6, 2.8);
  return finish(scene, g, L.tower.x, L.tower.z);
}

export function shelterRuin(scene: THREE.Scene): THREE.Group {
  const r = rng(10);
  const g = new THREE.Group();
  // Un conteneur rouille, porte arrachee, a moitie mange par la vegetation.
  const box0 = box(4.2, 2.3, 2.2, 0x8a4526, 0, 1.15, 0);
  g.add(box0);
  for (let i = 0; i < 12; i++) g.add(box(0.06, 2.2, 0.06, 0x6f3820, -2 + i * 0.36, 1.15, 1.12));
  g.add(box(1.2, 1.9, 0.05, 0x1c1714, 0.6, 1.0, 1.13));
  g.add(box(1.4, 0.6, 0.05, 0xa5603a, -1.1, 1.8, 1.14));
  const door = box(1.2, 1.9, 0.08, 0x6f3820, 1.4, 0.06, 1.9);
  door.rotation.x = -Math.PI / 2;
  door.rotation.z = 0.3;
  g.add(door);
  weeds(g, r, 6, 3.6, 2.3);
  weeds(g, r, 6, 4.4);
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
    const s = sheet(1.0, 1.4, [0xa5603a, 0x8a8f91, 0x9c4a3c][i]!);
    s.position.set(1.6 + i * 0.35, 0, 0.3 - i * 0.2);
    s.rotation.set(-0.25, 0.4 - i * 0.2, (i - 1) * 0.15);
    g.add(s);
  }
  g.add(at(tireStack(3, 13), 2.2, 0, -0.5), at(crate(0.6), -2.4, 0, 0.4, 0.3));
  for (let i = 0; i < 3; i++) {
    const l = cyl(0.17, 0.17, 2.6, 0x7a5a3a, 6, (r() - 0.5) * 2, 0.17 + i * 0.05, 0.9 + r() * 0.3);
    l.rotation.set(0, r() * 0.6, Math.PI / 2);
    g.add(l);
  }
  g.add(cone(0.17, 0.4, 0xd9b07a, 6, -2.2, 0.2, 1.0));
  return finish(scene, g, L.northGate.x, L.northGate.z);
}

/** La cabane de carrier effondree, son treuil au sol. */
export function quarryRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const r = rng(31);
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) g.add(plank(1.2 + r() * 1.0, C.woodDark, -2.4 + (r() - 0.5) * 2, 0.06 + i * 0.03, 0.6 + (r() - 0.5) * 1.4, r() * 3));
  const leg = cyl(0.1, 0.12, 3.4, 0x7a5a3a, 6, 0.4, 0.15, 0);
  leg.rotation.z = Math.PI / 2 - 0.1;
  g.add(leg);
  const roof = roofSheet(2.6, 2.0, C.rust);
  roof.position.set(-2.2, 0.4, 0.8);
  roof.rotation.set(0.3, 0.2, 0.4);
  g.add(roof);
  weeds(g, r, 6, 3.0);
  return finish(scene, g, x, z, 0.4);
}

/** Le four de la fonderie, ecroule. */
export function foundryRuin(scene: THREE.Scene, x: number, z: number): THREE.Group {
  const r = rng(37);
  const g = new THREE.Group();
  g.add(cyl(0.95, 1.15, 0.8, 0x8a4a32, 10, -0.6, 0.4, 0));
  for (let i = 0; i < 9; i++) {
    const b = box(0.35, 0.2, 0.2, r() < 0.5 ? 0xa8553a : 0x8a4a32, -0.6 + (r() - 0.5) * 3, 0.1, (r() - 0.5) * 2.4);
    b.rotation.y = r() * 3;
    g.add(b);
  }
  const chimney = cyl(0.3, 0.38, 2.6, 0x6a3a2a, 8, 0.8, 0.35, 0.8);
  chimney.rotation.z = Math.PI / 2 - 0.15;
  g.add(chimney);
  weeds(g, r, 5, 3.4);
  return finish(scene, g, x, z);
}
