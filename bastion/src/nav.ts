// Se deplacer dans la vallee : on ne traverse un enclos (camp, ferme, station) que par
// une de ses entrees ouvertes. Un seul point de passage a la fois, recalcule a chaque pas.
//
// Le choix des portes tient compte de tout le trajet (porte de sortie + porte d'entree du
// but), dehors on contourne les enclos par leurs coins, et dans le couloir d'une porte on
// la franchit jusqu'au bout (plus d'aller-retour sur la ligne du mur).

import * as THREE from 'three';
import { CAMP, CAMP_WEST_GATE, FARM, FARM_EAST_GATE, STATION, insideCamp, insideFarm, insideStation } from './layout';

interface Gate { x: number; z: number; nx: number; nz: number; half: number; open: () => boolean }
export interface Region { inside: (x: number, z: number) => boolean; gates: Gate[]; box: () => Box }
interface Box { x0: number; x1: number; z0: number; z1: number }
const boxOf = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) => (): Box => ({ x0: r.minX, x1: r.maxX, z0: r.minZ, z1: r.maxZ });

export interface NavState { northOpen: boolean; westOpen: boolean; eastOpen: boolean }

export function regions(s: NavState): { camp: Region; farm: Region; station: Region } {
  return {
    camp: {
      inside: insideCamp,
      box: boxOf(CAMP),
      gates: [
        { x: 0, get z() { return CAMP.maxZ; }, nx: 0, nz: 1, half: CAMP.gate, open: () => true },
        { x: 0, get z() { return CAMP.minZ; }, nx: 0, nz: -1, half: CAMP.gate, open: () => s.northOpen },
        // Porte ouest, vers la ferme : elle suit le mur quand le camp s'agrandit.
        { get x() { return CAMP.minX; }, z: CAMP_WEST_GATE.z, nx: -1, nz: 0, half: CAMP_WEST_GATE.half, open: () => true },
      ],
    },
    farm: {
      inside: insideFarm,
      box: boxOf(FARM),
      gates: [
        { x: FARM.gateX, z: FARM.maxZ, nx: 0, nz: 1, half: FARM.gate, open: () => s.westOpen },
        // Porte est, cote camp : ouverte avec l'entree de la ferme.
        { x: FARM.maxX, z: (FARM_EAST_GATE.z0 + FARM_EAST_GATE.z1) / 2, nx: 1, nz: 0, half: (FARM_EAST_GATE.z1 - FARM_EAST_GATE.z0) / 2, open: () => s.westOpen },
      ],
    },
    station: {
      inside: insideStation,
      box: boxOf(STATION),
      gates: [{ x: STATION.minX, z: STATION.gateZ, nx: -1, nz: 0, half: STATION.gate, open: () => s.eastOpen }],
    },
  };
}

/** Marge autour des enclos pour les contourner dehors. */
const M = 1.6;

/**
 * Le segment a-b passe-t-il a moins de 0,5 m d'un des enclos de la liste ? (Les zombies n'ont
 * pas le camp dans leur liste : ils foncent dessus et defoncent la palissade.)
 */
function crosses(rs: Box[], ax: number, az: number, bx: number, bz: number): boolean {
  for (const r of rs) {
    // Un bout deja dans la bande de 0,5 m (a une porte) : on ne teste que l'interieur.
    const near = (x: number, z: number) => x > r.x0 - 0.5 && x < r.x1 + 0.5 && z > r.z0 - 0.5 && z < r.z1 + 0.5;
    const m = near(ax, az) || near(bx, bz) ? -0.3 : 0.5;
    const x0 = r.x0 - m;
    const x1 = r.x1 + m;
    const z0 = r.z0 - m;
    const z1 = r.z1 + m;
    // Liang-Barsky
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dz = bz - az;
    const clip = (p: number, q: number) => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
      return true;
    };
    if (clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dz, az - z0) && clip(dz, z1 - az) && t1 > t0 + 1e-6) return true;
  }
  return false;
}

/** Plus court chemin dehors (par les coins des enclos) : premier point a viser, et longueur. */
function outside(rs: Box[], ax: number, az: number, bx: number, bz: number): { x: number; z: number; len: number } {
  if (!crosses(rs, ax, az, bx, bz)) return { x: bx, z: bz, len: Math.hypot(bx - ax, bz - az) };
  const nodes: [number, number][] = [[ax, az], [bx, bz]];
  for (const r of rs) nodes.push([r.x0 - M, r.z0 - M], [r.x1 + M, r.z0 - M], [r.x0 - M, r.z1 + M], [r.x1 + M, r.z1 + M]);
  const n = nodes.length;
  const d: number[] = new Array(n).fill(Infinity);
  const prev: number[] = new Array(n).fill(-1);
  const done: boolean[] = new Array(n).fill(false);
  d[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < n; i++) if (!done[i] && (u < 0 || d[i]! < d[u]!)) u = i;
    if (u < 0 || d[u] === Infinity) break;
    done[u] = true;
    if (u === 1) break;
    const [ux, uz] = nodes[u]!;
    for (let v = 0; v < n; v++) {
      if (done[v]) continue;
      const [vx, vz] = nodes[v]!;
      if (crosses(rs, ux, uz, vx, vz)) continue;
      const w = d[u]! + Math.hypot(ux - vx, uz - vz);
      if (w < d[v]!) {
        d[v] = w;
        prev[v] = u;
      }
    }
  }
  if (d[1] === Infinity) return { x: bx, z: bz, len: Math.hypot(bx - ax, bz - az) };
  let v = 1;
  while (prev[v]! > 0) v = prev[v]!;
  return { x: nodes[v]![0], z: nodes[v]![1], len: d[1]! };
}

/** Vrai si (x, z) est dans le couloir de la porte (on la franchit en ligne droite). */
function inCorridor(g: Gate, x: number, z: number): boolean {
  const dx = x - g.x;
  const dz = z - g.z;
  return Math.abs(dx * g.nz - dz * g.nx) < g.half - 0.5 && Math.abs(dx * g.nx + dz * g.nz) < 1.9;
}

/** Prochain point a viser pour aller de `p` a `dest` en passant par les portes. */
export function route(p: THREE.Vector3, dest: THREE.Vector3, list: Region[]): THREE.Vector3 {
  const rp = list.find((r) => r.inside(p.x, p.z)) ?? null;
  const rd = list.find((r) => r.inside(dest.x, dest.z)) ?? null;
  // Dans le couloir d'une porte : on la franchit d'abord, jusqu'a 1,2 m au-dela.
  if (rp !== rd) {
    for (const r of list) {
      for (const g of r.gates) {
        if (!g.open() || !inCorridor(g, p.x, p.z)) continue;
        const leaving = rd !== r && (rp === r || r.inside(p.x - g.nx * 0.6, p.z - g.nz * 0.6));
        const entering = rd === r && rp !== r;
        const along = (p.x - g.x) * g.nx + (p.z - g.z) * g.nz; // > 0 : dehors
        if (leaving && along < 1.2) return new THREE.Vector3(g.x + g.nx * 1.8, 0, g.z + g.nz * 1.8);
        if (entering && along > -1.2) return new THREE.Vector3(g.x - g.nx * 1.8, 0, g.z - g.nz * 1.8);
      }
    }
  }
  const rs = list.map((r) => r.box());
  if (rp === rd) {
    // Dehors vers dehors : on contourne les enclos au lieu de buter contre leur palissade.
    if (!rp) {
      const o = outside(rs, p.x, p.z, dest.x, dest.z);
      if (o.x !== dest.x || o.z !== dest.z) return new THREE.Vector3(o.x, 0, o.z);
    }
    return dest;
  }
  const exits: (Gate | null)[] = rp ? rp.gates.filter((g) => g.open()) : [null];
  const entries: (Gate | null)[] = rd ? rd.gates.filter((g) => g.open()) : [null];
  if (!exits.length || !entries.length) return dest;
  let best = Infinity;
  let aim = dest;
  for (const e of exits) {
    for (const n of entries) {
      let c = 0;
      let x = p.x;
      let z = p.z;
      let first: THREE.Vector3 | null = null;
      if (e) {
        const ix = e.x - e.nx * 1.8;
        const iz = e.z - e.nz * 1.8;
        c += Math.hypot(ix - x, iz - z) + 3.6;
        first = new THREE.Vector3(ix, 0, iz);
        x = e.x + e.nx * 1.8;
        z = e.z + e.nz * 1.8;
      }
      const tx = n ? n.x + n.nx * 1.8 : dest.x;
      const tz = n ? n.z + n.nz * 1.8 : dest.z;
      const o = outside(rs, x, z, tx, tz);
      c += o.len;
      if (!first) first = new THREE.Vector3(o.x, 0, o.z);
      if (n) c += 3.6 + Math.hypot(dest.x - (n.x - n.nx * 1.8), dest.z - (n.z - n.nz * 1.8));
      if (c < best) {
        best = c;
        aim = first;
      }
    }
  }
  return aim;
}
