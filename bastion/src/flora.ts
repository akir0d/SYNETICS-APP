// La vegetation : arbres (decor et arbres a couper), arbres morts, buissons, rochers.
// Les plantes des potagers et des champs sont dans resources.ts.

import * as THREE from 'three';
import { C, blob, cone, cyl, group, shadow } from './kit';

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

export function deadTree(r: () => number): THREE.Group {
  const wood = 0x6e6259;
  const g = group(cyl(0.12, 0.2, 2.6, wood, 5, 0, 1.3, 0));
  for (let i = 0; i < 4; i++) {
    const b = cyl(0.04, 0.07, 1.0 + r() * 0.6, wood, 4, 0, 0, 0);
    b.position.y = 0.45;
    const h = group(b);
    h.position.y = 1.2 + i * 0.4;
    h.rotation.set(0.7 + r() * 0.4, i * 2.1 + r(), 0);
    g.add(h);
  }
  return g;
}

/** Un buisson du decor (pose au sol, a la position donnee). */
export function bush(r: () => number, size: number, x: number, z: number): THREE.Object3D {
  const b = blob(size, r() < 0.5 ? C.leaf : C.leafDark, x, size * 0.7, z);
  b.scale.y = 0.75;
  return b;
}

/** Un rocher du decor (pose au sol, a la position donnee). */
export function boulder(r: () => number, size: number, x: number, z: number): THREE.Object3D {
  const b = blob(size, r() < 0.5 ? C.stone : 0xa8a59b, x, size * 0.5, z);
  b.scale.y = 0.75;
  return b;
}
