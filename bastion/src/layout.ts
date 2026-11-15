// Plan du camp n°1 « La Clairiere » : toutes les positions au meme endroit.

export const CAMP = { minX: -13, maxX: 13, minZ: -11, maxZ: 11, gate: 2.6 };
export const ROAD_Z = 19;

export const L = {
  spawn: { x: 0, z: 3.4 },
  campfire: { x: 0, z: 0.5 },
  /** Etal encastre dans la cloture sud : les clients font la queue dehors. */
  stall: { x: 6.2, z: 11, w: 3.6 },
  shelf: { x: 6.2, z: 9.0 },
  cash: { x: 9.1, z: 9.4 },
  queue: [{ x: 6.2, z: 12.7 }, { x: 6.2, z: 13.9 }, { x: 6.2, z: 15.1 }, { x: 6.2, z: 16.3 }],
  beds: [
    { x: -9.6, z: -6.6 }, { x: -9.6, z: -3.1 }, { x: -6.0, z: -6.6 }, { x: -6.0, z: -3.1 },
  ],
  kitchen: { x: -9.2, z: 4.6 },
  kitchenIn: { x: -6.9, z: 6.7 },
  kitchenOut: { x: -11.3, z: 7.4 },
  sawmill: { x: 6.4, z: -9.2 },
  sawIn: { x: 4.4, z: -7.1 },
  sawOut: { x: 8.4, z: -7.1 },
  bench: { x: 10.6, z: 1.6 },
  benchZone: { x: 8.7, z: 1.6 },
  tower: { x: 10.6, z: 7.6 },
  shelter: { x: 10.2, z: -4.2 },
  northGate: { x: 0, z: -11 },
  bus: { x: -14, z: 19.4 },
  busPad: { x: -14, z: 15.7 },
  forest: { minX: -16, maxX: 16, minZ: -30, maxZ: -13.5 },
  scrap: [
    { x: 13.5, z: 19.6, ry: -0.3, kind: 'car' as const },
    { x: 25, z: 18.2, ry: 2.6, kind: 'car' as const },
    { x: -24, z: 14.4, ry: 0.4, kind: 'heap' as const },
  ],
};

export function insideCamp(x: number, z: number): boolean {
  return x > CAMP.minX && x < CAMP.maxX && z > CAMP.minZ && z < CAMP.maxZ;
}
