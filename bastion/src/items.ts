// Les objets qu'on porte, qu'on vend et qu'on transforme.

import * as THREE from 'three';
import { C, blob, box, cone, cyl, group, rbox, shadow, sphere } from './kit';

export type ItemType = 'carrot' | 'tomato' | 'log' | 'plank' | 'soup' | 'scrap';

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
  scrap: { name: 'Ferraille', icon: '🔩', price: 0, h: 0.22 },
};

export function itemMesh(t: ItemType): THREE.Group {
  let g: THREE.Group;
  switch (t) {
    case 'carrot': {
      const a = cone(0.09, 0.5, 0xff8a2a, 6, 0, 0, 0);
      a.rotation.z = Math.PI / 2;
      const b = cone(0.09, 0.5, 0xf57c1f, 6, 0.05, 0.06, 0.12);
      b.rotation.z = Math.PI / 2 + 0.1;
      const c = cone(0.09, 0.5, 0xff9a40, 6, -0.02, 0.05, -0.12);
      c.rotation.z = Math.PI / 2 - 0.1;
      const tops = group(cone(0.06, 0.22, C.leafLight, 4, 0, 0, 0), cone(0.06, 0.2, C.leaf, 4, 0, 0, 0.06));
      tops.rotation.z = -Math.PI / 2;
      tops.position.set(-0.32, 0.03, 0);
      g = group(a, b, c, tops);
      g.position.y = 0.09;
      break;
    }
    case 'tomato':
      g = group(
        sphere(0.12, 0xe8432f, -0.13, 0.11, 0, 10), sphere(0.12, 0xf0503a, 0.13, 0.11, 0.02, 10), sphere(0.11, 0xe03a28, 0, 0.12, 0.14, 10),
        blob(0.05, C.leaf, -0.13, 0.22, 0), blob(0.05, C.leaf, 0.13, 0.22, 0.02),
      );
      break;
    case 'log': {
      const body = cyl(0.13, 0.13, 0.75, 0xa8693a, 7, 0, 0.13, 0);
      body.rotation.z = Math.PI / 2;
      const capA = cyl(0.105, 0.105, 0.02, 0xf2cf98, 7, 0.375, 0.13, 0);
      capA.rotation.z = Math.PI / 2;
      const capB = capA.clone();
      capB.position.x = -0.375;
      g = group(body, capA, capB);
      break;
    }
    case 'plank':
      g = group(rbox(0.8, 0.12, 0.3, C.woodLight, 0.03, 0, 0.07, 0), box(0.78, 0.01, 0.02, C.wood, 0, 0.135, 0.06));
      break;
    case 'soup':
      g = group(
        cyl(0.2, 0.14, 0.2, 0x4f8fd1, 10, 0, 0.1, 0),
        cyl(0.18, 0.18, 0.02, 0xe08a3a, 10, 0, 0.2, 0),
        blob(0.04, C.leafLight, 0.06, 0.22, 0.03),
      );
      break;
    case 'scrap': {
      const plate = rbox(0.42, 0.08, 0.3, C.metal, 0.02, 0, 0.05, 0);
      plate.rotation.y = 0.3;
      const pipe = cyl(0.05, 0.05, 0.5, 0xa86a3a, 6, 0.02, 0.14, 0);
      pipe.rotation.z = Math.PI / 2;
      const gear = cyl(0.11, 0.11, 0.06, 0x8f969c, 8, -0.1, 0.17, 0.05);
      g = group(plate, pipe, gear);
      break;
    }
  }
  return shadow(g);
}

let coinGeo: THREE.CylinderGeometry | null = null;
const coinMat = new THREE.MeshLambertMaterial({ color: 0xffc83a, emissive: 0x6a4800, flatShading: true });
const coinEdgeMat = new THREE.MeshLambertMaterial({ color: 0xe0a020, flatShading: true });

export function coinMesh(): THREE.Mesh {
  coinGeo ??= new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12);
  const m = new THREE.Mesh(coinGeo, [coinEdgeMat, coinMat, coinMat]);
  m.castShadow = true;
  return m;
}
