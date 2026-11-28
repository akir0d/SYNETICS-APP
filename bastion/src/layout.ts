// Plan de la vallee : le camp fortifie au centre, la ferme a l'ouest, la station-service
// a l'est, l'etang au sud, la foret au nord. Toutes les positions au meme endroit.

export const CAMP = { minX: -13, maxX: 13, minZ: -11, maxZ: 11, gate: 2.6 };
/** Porte ouest du camp (vers la ferme) : au milieu du mur ouest, ou qu'il soit. */
export const CAMP_WEST_GATE = { z: 0, half: 2.75 };
export const ROAD_Z = 19;

/** Enclos de la ferme (ouest) : entree cote route, bouchee tant qu'on ne l'a pas degagee. */
export const FARM = { minX: -48, maxX: -23, minZ: -9, maxZ: 13, gateX: -34, gate: 2.4 };
/** Porte est de la ferme (cote camp) : deux troncons de la palissade de ferme. */
export const FARM_EAST_GATE = { z0: 3.571, z1: 9.857 };
/** Enclos de la station-service (est) : la route le traverse, entree a l'ouest. */
export const STATION = { minX: 24, maxX: 50, minZ: 5, maxZ: 31, gateZ: 19, gate: 3.2 };
/** L'etang au sud de la route ; on y accede par le ponton. */
export const POND = { x: 2, z: 34, rx: 9, rz: 5 };

export const L = {
  spawn: { x: 0, z: 3.4 },
  campfire: { x: 0, z: 0.5 },
  /** Etal encastre dans la palissade sud : un bac par produit, deux files dehors. */
  stall: { x: 7.1, z: 11, w: 7.4 },
  shelf: { x: 7.1, z: 9.0 },
  cash: { x: 3.0, z: 7.9 },
  lanes: [
    [{ x: 5.6, z: 12.7 }, { x: 5.6, z: 13.9 }, { x: 5.6, z: 15.1 }, { x: 5.6, z: 16.3 }],
    [{ x: 8.6, z: 12.7 }, { x: 8.6, z: 13.9 }, { x: 8.6, z: 15.1 }, { x: 8.6, z: 16.3 }],
  ],
  // Ecartes pour laisser de vraies allees (plus de 1 m libre) entre carottes et tomates.
  beds: [
    { x: -10.3, z: -7.0 }, { x: -10.3, z: -2.8 }, { x: -5.4, z: -7.0 }, { x: -5.4, z: -2.8 },
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
  /** La reserve : les survivants y deposent tout, le joueur s'y sert. */
  chest: { x: 3.4, z: -3.2 },
  northGate: { x: 0, z: -11 },

  // ---- la ferme (ouest)
  fields: [{ x: -29, z: -4.5 }, { x: -29, z: 1.5 }, { x: -29, z: 7.5 }],
  mill: { x: -41, z: -3 },
  millIn: { x: -37.4, z: 1.6 },
  millOut: { x: -42.6, z: 2.2 },
  farmhouse: { x: -42, z: 8.5 },
  farmGate: { x: FARM.gateX, z: FARM.maxZ },

  // ---- la station-service (est)
  stationGate: { x: STATION.minX, z: STATION.gateZ },
  pumps: [{ x: 33, z: 12.6 }, { x: 36.4, z: 12.6 }],
  canopy: { x: 34.7, z: 12.6 },
  shop: { x: 41, z: 9.5 },

  // ---- la carriere (nord-est) et la fonderie (station)
  quarry: { x: 31, z: -24 },
  quarryShed: { x: 25.5, z: -17 },
  rocks: [{ x: 27, z: -21 }, { x: 31.5, z: -26.5 }, { x: 35.5, z: -21.5 }, { x: 29, z: -31 }, { x: 36.5, z: -29 }],
  foundry: { x: 36.5, z: 27 },
  // La fonderie de pierre, dans l'angle de l'immeuble effondre sous la carriere.
  brickworks: { x: 25.2, z: -5.0 },
  brickIn: { x: 24.0, z: -1.8 },
  brickOut: { x: 27.6, z: -1.8 },
  foundryIn: { x: 33.2, z: 24.6 },
  foundryOut: { x: 39.8, z: 24.6 },

  // ---- l'etang (sud)
  dock: { x: 2, z: 29.2 },
  fishSpot: { x: 2, z: 30.5 },

  /**
   * Zones de paiement : a cote de chaque ruine, jamais dessus. Le joueur paie
   * en se tenant devant le chantier, puis le batiment se restaure sous ses yeux.
   */
  pads: {
    bed2: { x: -10.3, z: -0.2 },
    bed3: { x: -2.5, z: -7.0 },
    bed4: { x: -5.4, z: -0.2 },
    gate: { x: 0, z: -8.3 },
    bench: { x: 8.6, z: 1.6 },
    sawmill: { x: 6.4, z: -6.4 },
    tower: { x: 7.9, z: 6.5 },
    kitchen: { x: -6.3, z: 4.3 },
    shelter: { x: 7.3, z: -3.9 },
    farmer: { x: 6.6, z: -1.6 },
    lumber: { x: 6.6, z: -6.0 },
    westRoad: { x: -34, z: 15.6 },
    field1: { x: -24.8, z: -4.5 },
    field2: { x: -24.8, z: 1.5 },
    field3: { x: -24.8, z: 7.5 },
    mill: { x: -36.4, z: -3.2 },
    dock: { x: 5.6, z: 26.4 },
    fisher: { x: -1.8, z: 26.4 },
    eastRoad: { x: 20.8, z: 19 },
    scav: { x: 29, z: 9 },
    quarry: { x: 23, z: -14.6 },
    foundry: { x: 36.5, z: 22.4 },
    brickworks: { x: 29.8, z: -3.4 },
  },
  bus: { x: -14, z: 19.4 },
  busPad: { x: -14, z: 15.7 },
  forest: { minX: -21, maxX: 21, minZ: -44, maxZ: -13.5 },
  scrap: [
    { x: 13.5, z: 19.6, ry: -0.3, kind: 'car' as const },
    { x: -21, z: 24.5, ry: 0.4, kind: 'heap' as const },
    { x: 29.5, z: 25, ry: 2.6, kind: 'car' as const },
    { x: 42, z: 25.5, ry: 0.9, kind: 'car' as const },
    { x: 45, z: 14, ry: 0.2, kind: 'heap' as const },
  ],
};

export function insideCamp(x: number, z: number): boolean {
  return x > CAMP.minX && x < CAMP.maxX && z > CAMP.minZ && z < CAMP.maxZ;
}

export function insideFarm(x: number, z: number): boolean {
  return x > FARM.minX && x < FARM.maxX && z > FARM.minZ && z < FARM.maxZ;
}

export function insideStation(x: number, z: number): boolean {
  return x > STATION.minX && x < STATION.maxX && z > STATION.minZ && z < STATION.maxZ;
}
