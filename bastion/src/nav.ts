// Se deplacer dans la vallee : on ne traverse un enclos (camp, ferme, station) que par
// une de ses entrees ouvertes. Un seul point de passage a la fois, recalcule a chaque pas.

import * as THREE from 'three';
import { CAMP, FARM, STATION, insideCamp, insideFarm, insideStation } from './layout';

interface Gate { x: number; z: number; nx: number; nz: number; half: number; open: () => boolean }
export interface Region { inside: (x: number, z: number) => boolean; gates: Gate[] }

export interface NavState { northOpen: boolean; westOpen: boolean; eastOpen: boolean }

export function regions(s: NavState): { camp: Region; farm: Region; station: Region } {
  return {
    camp: {
      inside: insideCamp,
      gates: [
        { x: 0, z: CAMP.maxZ, nx: 0, nz: 1, half: CAMP.gate, open: () => true },
        { x: 0, z: CAMP.minZ, nx: 0, nz: -1, half: CAMP.gate, open: () => s.northOpen },
      ],
    },
    farm: {
      inside: insideFarm,
      gates: [{ x: FARM.gateX, z: FARM.maxZ, nx: 0, nz: 1, half: FARM.gate, open: () => s.westOpen }],
    },
    station: {
      inside: insideStation,
      gates: [{ x: STATION.minX, z: STATION.gateZ, nx: -1, nz: 0, half: STATION.gate, open: () => s.eastOpen }],
    },
  };
}

function bestGate(r: Region, p: THREE.Vector3, dest: THREE.Vector3): Gate | null {
  let best: Gate | null = null;
  let bd = Infinity;
  for (const g of r.gates) {
    if (!g.open()) continue;
    const d = Math.hypot(p.x - g.x, p.z - g.z) + Math.hypot(dest.x - g.x, dest.z - g.z);
    if (d < bd) { bd = d; best = g; }
  }
  return best;
}

/** Vrai si p est dans le couloir de la porte (on la franchit en ligne droite). */
function inCorridor(g: Gate, p: THREE.Vector3): boolean {
  const dx = p.x - g.x;
  const dz = p.z - g.z;
  const along = Math.abs(dx * g.nz - dz * g.nx);
  const across = Math.abs(dx * g.nx + dz * g.nz);
  return along < g.half - 0.5 && across < 1.9;
}

/** Prochain point a viser pour aller de `p` a `dest` en passant par les portes. */
export function route(p: THREE.Vector3, dest: THREE.Vector3, list: Region[]): THREE.Vector3 {
  // D'abord sortir de l'enclos ou l'on est, ensuite seulement entrer dans celui du but.
  for (const leaving of [true, false]) {
    for (const r of list) {
      const a = r.inside(p.x, p.z);
      const b = r.inside(dest.x, dest.z);
      if (a === b || a !== leaving) continue;
      const g = bestGate(r, p, dest);
      if (!g) continue;
      const out = new THREE.Vector3(g.x + g.nx * 1.8, 0, g.z + g.nz * 1.8);
      const inn = new THREE.Vector3(g.x - g.nx * 1.8, 0, g.z - g.nz * 1.8);
      if (inCorridor(g, p)) return a ? out : inn;
      return a ? inn : out;
    }
  }
  return dest;
}
