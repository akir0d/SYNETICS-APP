// Collisions simples : cercles contre cercles (arbres, objets) et contre segments (clotures, murs).

import type * as THREE from 'three';

export interface Segment { x1: number; z1: number; x2: number; z2: number; off?: boolean }
export interface Circle { x: number; z: number; r: number; off?: boolean }

export function collide(p: THREE.Vector3, R: number, walls: Segment[], solids: Circle[], bounds: number): void {
  for (const s of solids) {
    if (s.off) continue;
    const dx = p.x - s.x;
    const dz = p.z - s.z;
    const d = Math.hypot(dx, dz);
    const min = s.r + R;
    if (d < min && d > 1e-5) {
      p.x = s.x + (dx / d) * min;
      p.z = s.z + (dz / d) * min;
    }
  }
  for (const w of walls) {
    if (w.off) continue;
    const vx = w.x2 - w.x1;
    const vz = w.z2 - w.z1;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - w.x1) * vx + (p.z - w.z1) * vz) / l2));
    const cx = w.x1 + vx * t;
    const cz = w.z1 + vz * t;
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    const min = R + 0.12;
    if (d < min && d > 1e-5) {
      p.x = cx + (dx / d) * min;
      p.z = cz + (dz / d) * min;
    }
  }
  p.x = Math.max(-bounds, Math.min(bounds, p.x));
  p.z = Math.max(-bounds, Math.min(bounds, p.z));
}

/**
 * Glissement : apres collide, si l'on a presque cale contre un obstacle rond pris de face (moins
 * de 40 % du pas voulu), on avance le long de sa tangente, du cote ou l'on voulait aller. Plus
 * d'arret net devant un poteau, un baril, un arbre ou un coin de batiment.
 * (fromX, fromZ) : position avant le pas ; (dx, dz) : direction voulue ; want : longueur voulue.
 */
export function slide(p: THREE.Vector3, fromX: number, fromZ: number, dx: number, dz: number, want: number,
  R: number, walls: Segment[], solids: Circle[], bounds: number): void {
  if (want < 1e-4 || Math.hypot(p.x - fromX, p.z - fromZ) > 0.4 * want) return;
  let nx = 0;
  let nz = 0;
  for (const s of solids) {
    if (s.off) continue;
    const ox = p.x - s.x;
    const oz = p.z - s.z;
    const d = Math.hypot(ox, oz);
    if (d > 1e-5 && d < s.r + R + 0.03) { nx += ox / d; nz += oz / d; }
  }
  // Contre un mur, collide fait deja glisser (seule la composante normale est retiree) ;
  // pousse de face, on s'arrete net, sans trembler d'un bout a l'autre du mur.
  for (const w of walls) {
    if (w.off) continue;
    const vx = w.x2 - w.x1;
    const vz = w.z2 - w.z1;
    const l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - w.x1) * vx + (p.z - w.z1) * vz) / l2));
    const ox = p.x - (w.x1 + vx * t);
    const oz = p.z - (w.z1 + vz * t);
    const d = Math.hypot(ox, oz);
    if (d > 1e-5 && d < R + 0.15) {
      // Le long du mur : pas d'aide. Sur son bout (un coin), on le contourne comme un poteau.
      if (t > 0 && t < 1) return;
      nx += ox / d;
      nz += oz / d;
    }
  }
  const nl = Math.hypot(nx, nz);
  // Coince dans un creux (normales opposees) : rien a faire, on ne force pas.
  if (nl < 0.3) return;
  nx /= nl;
  nz /= nl;
  let tx = -nz;
  let tz = nx;
  if (tx * dx + tz * dz < 0) { tx = -tx; tz = -tz; }
  p.x += tx * want * 0.8;
  p.z += tz * want * 0.8;
  collide(p, R, walls, solids, bounds);
}
