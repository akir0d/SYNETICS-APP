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
