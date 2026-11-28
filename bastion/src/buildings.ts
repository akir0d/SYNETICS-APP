// Les installations restaurees. Elles existent cachees ; la restauration (restore.ts)
// les fait apparaitre piece par piece a la place de leur ruine (ruins.ts).
// Style « figurine » : rondins aux bouts arrondis, planches de teintes voisines, toles
// ondulees aux bords roules, fenetres chaudes. Chaque enfant direct du groupe est un
// morceau logique (charpente, toit, etabli...) : la restauration les fait tomber un a un,
// puis consolidate (bake.ts) fusionne tout ce qui ne bouge pas.

import * as THREE from 'three';
import { mergeColored } from './bake';
import {
  C, at, blob, box, cone, corrugated, cyl, glow, group, lathe, mat, mixHex, paint, pill, plank, puff, rbox, rcone, rcyl, rng, shadow, sphere,
  torus, uniqueMat, type Profile,
} from './kit';
import { L } from './layout';
import { concertina, crate, drum, gasBottle, paintedBoard, sandbags, sheet, tarp } from './props';

export interface Building {
  group: THREE.Group;
  /** Ce qui s'anime une fois restaure (lame de scie, vapeur, etc.). */
  anim?: (dt: number, time: number, busy: boolean) => void;
  glowMats?: THREE.MeshLambertMaterial[];
  /** Pieces qui bougent ou s'allument : jamais fusionnees avec le reste. */
  live?: THREE.Object3D[];
}

function hidden(g: THREE.Group, x: number, z: number, ry = 0): THREE.Group {
  shadow(g);
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  g.visible = false;
  return g;
}

// ---------------------------------------------------------------- teintes

const LOG = 0x7a5a3a;
const LOG2 = 0x86643f;
const LOG3 = 0x6e5034;
const CUT = 0xd9b07a;
/** Planches : trois teintes voisines, jamais un aplat. */
const BOARD = 0xb07a48;
const BOARD2 = 0x9c6a3e;
const BOARD3 = 0xc28c58;
const IRON = 0x3d4044;
const STEEL = 0x5e646a;
const RED = 0xc9412f;
const CREAM = 0xeee2c6;
const WIN_DAY = 0xfff0c0;
const WIN_GLOW = 0xffc870;

// ---------------------------------------------------------------- petites pieces (partagees avec ruins.ts)

function rot<T extends THREE.Object3D>(o: T, x: number, y = 0, z = 0): T {
  o.rotation.set(x, y, z);
  return o;
}

/** Couche une piece verticale du kit le long de x ou de z. */
function along<T extends THREE.Object3D>(o: T, axis: 'x' | 'z'): T {
  if (axis === 'x') o.rotation.z = Math.PI / 2;
  else o.rotation.x = Math.PI / 2;
  return o;
}

/**
 * Regroupe des pieces placees en coordonnees du batiment ; l'origine du groupe est mise a
 * la hauteur y (la restauration remonte les morceaux du bas vers le haut, selon cette hauteur).
 */
function part(y: number, ...kids: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  g.position.y = y;
  for (const k of kids) {
    k.position.y -= y;
    g.add(k);
  }
  return g;
}

/**
 * Rondin vertical centre (a coucher avec along) : bouts bien arrondis, bois de coupe clair
 * aux extremites. Une geometrie peinte par teinte et par taille, en cache.
 */
export function logPiece(len: number, r: number, tone: number, x = 0, y = 0, z = 0): THREE.Mesh {
  const e = 0.45 * Math.min(r, len / 2);
  const prof: [number, number][] = [[0, -len / 2]];
  for (let i = 0; i <= 3; i++) {
    const t = (i / 3) * (Math.PI / 2);
    prof.push([r - e + Math.sin(t) * e, -len / 2 + e - Math.cos(t) * e]);
  }
  for (let i = 0; i <= 3; i++) {
    const t = (i / 3) * (Math.PI / 2);
    prof.push([r - e + Math.cos(t) * e, len / 2 - e + Math.sin(t) * e]);
  }
  prof.push([0, len / 2]);
  const a = new THREE.Color(tone);
  const b = new THREE.Color(CUT);
  // Dix cotes suffisent pour un rondin lisse (huit pour les fins) : beaucoup de rondins par batiment.
  return paint(lathe(prof, C.white, x, y, z, r < 0.1 ? 8 : 10), `lg${tone}`, (_x, py, _z, out) => {
    const t = ((Math.abs(py) - (len / 2 - e)) / e) * 1.4;
    out.copy(a).lerp(b, Math.max(0, Math.min(1, t)));
  });
}

/** Poteau de rondin plante (base a y0), bords biseautes, dessus en bois de coupe. */
export function postPiece(h: number, r: number, tone: number, x: number, z: number, y0 = 0): THREE.Mesh {
  const top = h / 2 - 1e-3;
  return paint(cyl(r * 0.94, r, h, C.white, 8, x, y0 + h / 2, z), `pt${tone}`, (_x, y, _z, out) => {
    out.setHex(y > top ? CUT : tone);
  });
}

const wavesFor = (w: number): number => Math.max(3, Math.round(w / 0.22));

/**
 * Toit de tole ondulee pose a plat, centre (w en x, d en z, ondes dans le sens de la pente
 * z), bords roules devant et derriere. patch : une tole rapportee d'une autre couleur.
 */
export function tinRoof(w: number, d: number, color: number, patch = 0): THREE.Group {
  const n = wavesFor(w);
  const sheet = corrugated(w, d, color, 0, 0, 0, n);
  sheet.rotation.x = -Math.PI / 2;
  const g = group(sheet);
  const edge = mixHex(color, 0x000000, 0.2);
  for (const s of [-1, 1]) g.add(along(cyl(0.04, 0.04, w + 0.03, edge, 8, 0, 0.004, (s * d) / 2), 'x'));
  if (patch) {
    // Ondes alignees sur la tole du dessous : la piece s'y emboite sans la traverser.
    const sp = w / n;
    const m = Math.max(2, Math.round(n * 0.3));
    const pw = m * sp;
    const px = -w / 2 + Math.round(n * 0.12) * sp + pw / 2;
    const p = corrugated(pw, d * 0.45, patch, 0, 0, 0, m);
    p.rotation.x = -Math.PI / 2;
    p.position.set(px, 0.04, -d * 0.12);
    g.add(p);
  }
  return g;
}

/** Plaque de tole ondulee debout, base a y = 0, bord haut roule. */
export function tinSheet(w: number, h: number, color: number): THREE.Group {
  return group(
    corrugated(w, h, color, 0, h / 2, 0, wavesFor(w)),
    along(cyl(0.035, 0.035, w + 0.02, mixHex(color, 0x000000, 0.2), 8, 0, h, 0), 'x'),
  );
}

/** Cadre de fenetre en planches (face vers +z), appui saillant, croisillon. La vitre est a part. */
function windowFrame(w: number, h: number, x: number, y: number, z: number, tone: number = C.woodDark): THREE.Group {
  const f = 0.08;
  return group(
    plank(w + 2 * f + 0.04, f, 0.09, tone, x, y + h / 2 + f / 2, z),
    plank(w + 2 * f + 0.12, 0.07, 0.17, tone, x, y - h / 2 - 0.035, z + 0.04),
    plank(f, h, 0.08, tone, x - w / 2 - f / 2, y, z),
    plank(f, h, 0.08, tone, x + w / 2 + f / 2, y, z),
    box(0.04, h, 0.03, tone, x, y, z + 0.03),
    box(w, 0.04, 0.03, tone, x, y, z + 0.03),
  );
}

/** Jardiniere sous une fenetre : caisse de planches et quelques fleurs. */
function flowerBox(w: number, x: number, y: number, z: number): THREE.Group {
  const g = group(plank(w, 0.15, 0.17, BOARD, x, y, z));
  const tones = [0xd9584a, 0xf2c94c, 0xf4efe4, 0xd9584a];
  const n = Math.max(2, Math.round(w / 0.22));
  for (let i = 0; i < n; i++) {
    const fx = x - w / 2 + (i + 0.5) * (w / n);
    g.add(blob(0.075, C.leaf, fx, y + 0.1, z), blob(0.055, tones[i % tones.length]!, fx + 0.03, y + 0.17, z + 0.04));
  }
  return g;
}

/** Porte de planches (partagee avec ruins.ts) : trois lames, deux traverses, une echarpe, une poignee. */
export function plankDoor(w: number, h: number, x: number, y0: number, z: number, tone: number = BOARD2): THREE.Group {
  const g = new THREE.Group();
  const tones = [tone, mixHex(tone, 0xffffff, 0.1), mixHex(tone, 0x000000, 0.1)];
  for (let i = 0; i < 3; i++) g.add(plank(w / 3 - 0.01, h, 0.07, tones[i]!, x - w / 3 + (i * w) / 3, y0 + h / 2, z));
  const dark = mixHex(tone, 0x000000, 0.25);
  g.add(plank(w - 0.06, 0.12, 0.05, dark, x, y0 + h * 0.2, z + 0.05), plank(w - 0.06, 0.12, 0.05, dark, x, y0 + h * 0.8, z + 0.05));
  g.add(rot(plank(0.1, Math.hypot(w * 0.75, h * 0.6), 0.04, dark, x, y0 + h / 2, z + 0.05), 0, 0, Math.atan2(w * 0.75, h * 0.6)));
  g.add(sphere(0.045, 0xd9b44a, x + w * 0.36, y0 + h * 0.5, z + 0.08, 6));
  return g;
}

/** Fenetre allumee la nuit : materiau propre au batiment (glowMats). */
function winMat(): THREE.MeshLambertMaterial {
  const m = uniqueMat(WIN_DAY, WIN_GLOW);
  m.emissiveIntensity = 0;
  return m;
}

// ---------------------------------------------------------------- l'etabli

export function workbench(): Building {
  const g = new THREE.Group();
  // Pietement : quatre pieds epais, entretoises, etagere basse et ce qu'on y range.
  const legs = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.add(plank(0.16, 0.88, 0.16, sx * sz > 0 ? C.woodDark : 0x7f5230, sx * 1.05, 0.44, sz * 0.42));
  for (const sx of [-1, 1]) legs.add(plank(0.1, 0.1, 0.7, LOG3, sx * 1.05, 0.2, 0));
  legs.add(plank(2.2, 0.07, 0.86, BOARD2, 0, 0.3, 0));
  legs.add(rbox(0.52, 0.26, 0.3, RED, 0.05, -0.5, 0.465, 0.02), box(0.34, 0.05, 0.05, IRON, -0.5, 0.62, 0.02));
  legs.add(rot(plank(1.1, 0.05, 0.22, CUT, 0.45, 0.36, 0.12), 0, 0.08), rot(plank(0.95, 0.05, 0.2, BOARD3, 0.5, 0.41, 0.1), 0, -0.1));
  g.add(legs);
  // Plateau : trois grosses planches, l'etau, ce qui traine.
  const top = new THREE.Group();
  top.position.y = 0.95;
  [BOARD, BOARD3, BOARD2].forEach((c, i) => top.add(plank(2.4, 0.13, 0.36, c, 0, 0, -0.37 + i * 0.37)));
  top.add(
    rbox(0.34, 0.2, 0.26, 0x3a5a7a, 0.05, 0.75, 0.165, 0.38),
    box(0.36, 0.12, 0.06, 0x2f4a66, 0.75, 0.18, 0.54),
    along(cyl(0.02, 0.02, 0.3, C.metal, 8, 0.75, 0.17, 0.66), 'z'),
    along(cyl(0.018, 0.018, 0.3, C.metal, 8, 0.75, 0.17, 0.8), 'x'),
    rot(plank(0.7, 0.06, 0.18, CUT, -0.4, 0.095, 0.15), 0, 0.2),
    cyl(0.08, 0.08, 0.16, 0x7fa6a0, 8, -0.95, 0.145, -0.25),
    along(rcyl(0.07, 0.07, 0.2, BOARD3, 0.3, 0.1, 0.135, -0.2), 'z'),
    rot(cyl(0.022, 0.022, 0.36, CUT, 8, 0.24, 0.09, -0.2), 0, 0, Math.PI / 2),
  );
  g.add(top);
  // Panneau a outils : scie, marteau, cles, rouleau de corde, petite lampe.
  const panel = part(1.3,
    plank(0.12, 1.75, 0.12, C.woodDark, -1.0, 1.37, -0.58), plank(0.12, 1.75, 0.12, C.woodDark, 1.0, 1.37, -0.58),
    plank(1.9, 1.2, 0.06, 0xc8a878, 0, 1.65, -0.55),
    plank(2.2, 0.1, 0.22, C.woodDark, 0, 2.29, -0.54),
    box(0.55, 0.15, 0.02, C.tin, -0.45, 1.88, -0.505), plank(0.16, 0.16, 0.05, BOARD2, -0.8, 1.88, -0.5),
    box(0.05, 0.45, 0.04, CUT, 0.1, 1.68, -0.5), box(0.2, 0.08, 0.07, IRON, 0.1, 1.92, -0.49),
    torus(0.13, 0.035, C.rope, -0.5, 1.45, -0.49),
    box(0.05, 0.05, 0.3, IRON, 0.45, 2.22, -0.42),
    rcone(0.15, 0.12, 0x4f7f7a, 0.3, 0.45, 2.15, -0.3),
  );
  for (let i = 0; i < 3; i++) panel.add(box(0.05, 0.36, 0.03, i === 1 ? RED : C.metal, 0.45 + i * 0.13, 1.65 - 1.3, -0.5));
  g.add(panel);
  const lampMat = uniqueMat(0xffe7b0, WIN_GLOW);
  lampMat.emissiveIntensity = 0;
  const bulb = sphere(0.065, lampMat, 0.45, 2.06, -0.3, 8);
  g.add(bulb);
  g.add(at(drum(0x8a3f30), 1.6, 0, 0.1), at(crate(0.5, 0x6f7a4a), -1.6, 0, 0.2));
  return { group: hidden(g, L.bench.x, L.bench.z, -Math.PI / 2), glowMats: [lampMat], live: [bulb] };
}

// ---------------------------------------------------------------- la scierie

/**
 * La scierie, en cinq aspects (un tous les deux niveaux) : chevalet de fortune, scie sous
 * bache, scierie a moteur, atelier en dur, scierie industrielle. Meme emprise au sol.
 */
export function sawmill(stage = 3): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  // Sol : dalles de pierre (atelier en dur), chape de beton (industrielle).
  if (st === 4) {
    const r = rng(61);
    const floor = new THREE.Group();
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      floor.add(box(0.86, 0.06, 0.74, mixHex(0x9a9890, 0x7f7d76, r()), -1.35 + i * 0.9, 0.03, -0.78 + j * 0.78));
    }
    g.add(floor);
  } else if (st === 5) {
    g.add(group(rbox(3.8, 0.07, 2.4, 0x8d8f8c, 0.03, 0, 0.035, 0), box(3.6, 0.075, 0.12, 0xe8b84a, 0, 0.04, 1.05)));
  }
  if (st >= 2) {
    // Charpente : branches (bache), rondins (moteur, en dur), acier (industrielle).
    const frame = new THREE.Group();
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const h = t < 0 ? 2.4 : 2.2;
      if (st === 5) frame.add(box(0.15, h, 0.15, STEEL, s * 1.55, h / 2, t * 0.8));
      else frame.add(postPiece(h, st === 2 ? 0.09 : 0.13, t < 0 ? LOG : LOG2, s * 1.55, t * 0.8));
    }
    if (st === 5) {
      frame.add(box(3.4, 0.12, 0.12, IRON, 0, 2.14, 0.8), box(3.4, 0.12, 0.12, IRON, 0, 2.32, -0.8));
      for (const s of [-1, 1]) frame.add(rot(box(0.08, 0.9, 0.08, IRON, s * 1.2, 1.85, -0.8), 0, 0, s * 0.8));
    } else if (st >= 3) {
      frame.add(along(logPiece(3.5, 0.11, LOG3, 0, 2.1, 0.8), 'x'), along(logPiece(3.5, 0.11, LOG3, 0, 2.28, -0.8), 'x'));
      for (const s of [-1, 1]) for (const t of [-1, 1]) frame.add(rot(plank(0.08, 0.7, 0.1, BOARD2, s * 1.3, t < 0 ? 2.0 : 1.82, t * 0.8), 0, 0, s * 0.8));
    } else {
      // Bache tendue : deux perches, cordes jusqu'aux piquets.
      frame.add(along(cyl(0.05, 0.05, 3.3, LOG3, 8, 0, 2.2, 0.8), 'x'), along(cyl(0.05, 0.05, 3.3, LOG3, 8, 0, 2.38, -0.8), 'x'));
      for (const s of [-1, 1]) frame.add(rot(cyl(0.012, 0.012, 1.5, 0xd8c8a0, 6, s * 2.0, 1.55, 1.05), 0.35, 0, s * 0.55));
    }
    g.add(frame);
    const roof = st === 2 ? tarp(3.9, 2.4, 0x4f7a8f, 0) : tinRoof(4.0, 2.5, st === 5 ? 0x8a949c : C.rust, st === 5 ? 0x6f8a3a : 0x9c4a3c);
    roof.position.y = st === 2 ? 2.32 : 2.33;
    roof.rotation.x = 0.12;
    g.add(roof);
  }
  // Murs : demi-mur de planches (en dur), toles pleine hauteur (industrielle).
  if (st === 4) {
    const wall = new THREE.Group();
    for (let i = 0; i < 4; i++) wall.add(plank(3.3, 0.28, 0.08, [BOARD, BOARD2, BOARD3][i % 3]!, 0, 0.16 + i * 0.29, -1.3));
    wall.add(plank(0.1, 1.25, 0.12, LOG3, -1.62, 0.62, -1.3), plank(0.1, 1.25, 0.12, LOG3, 1.62, 0.62, -1.3));
    for (let i = 0; i < 3; i++) wall.add(plank(0.08, 0.28, 1.9, [BOARD2, BOARD, BOARD3][i]!, -1.72, 0.16 + i * 0.29, -0.3));
    g.add(wall);
  } else if (st === 5) {
    const back = tinSheet(3.3, 2.1, 0x7a8288);
    back.position.set(0, 0, -1.3);
    const side = tinSheet(2.0, 1.9, 0x6f777e);
    side.position.set(-1.72, 0, -0.25);
    side.rotation.y = Math.PI / 2;
    g.add(group(back, side));
  }
  // Le banc de sciage : chevalet et caisses (fortune), caisson cloue sinon.
  const bladeY = st === 1 ? 1.02 : 1.15;
  if (st === 1) {
    g.add(group(
      at(crate(0.62, C.wood), -0.9, 0, 0), at(crate(0.62, C.woodLight), 0.9, 0, 0, 0.2),
      ...[-1, 1].map((s) => rot(plank(0.08, 0.95, 0.08, LOG3, s * 0.35, 0.45, 0.32), 0, 0, s * 0.45)),
    ));
    g.add(part(0.66,
      plank(2.6, 0.08, 0.55, C.woodLight, 0, 0.68, -0.15), plank(2.6, 0.08, 0.5, 0xd2a066, 0, 0.68, 0.36),
      along(logPiece(0.9, 0.14, LOG2, -0.85, 0.86, 0), 'x'),
    ));
    // Manivelle a la main : volant, poignee.
    g.add(part(1.0,
      rot(torus(0.24, 0.035, IRON, -0.7, 1.0, -0.55), 0, 0, 0), box(0.04, 0.04, 0.3, IRON, -0.7, 1.0, -0.42),
      rot(cyl(0.03, 0.03, 0.2, BOARD2, 8, -0.5, 1.0, -0.55), 0, 0, Math.PI / 2),
    ));
  } else {
    g.add(group(
      plank(2.8, 0.66, 1.16, C.woodDark, 0, 0.4, 0),
      ...[-1, 1].flatMap((s) => [-1, 1].map((t) => plank(0.16, 0.86, 0.16, st === 5 ? STEEL : LOG3, s * 1.38, 0.43, t * 0.56))),
      plank(2.9, 0.16, 0.08, st === 5 ? 0xe8b84a : BOARD2, 0, 0.72, 0.6),
    ));
    g.add(part(0.9,
      plank(3.2, 0.08, 0.5, C.woodLight, 0, 0.9, -0.5), plank(3.2, 0.08, 0.5, 0xd2a066, 0, 0.9, 0), plank(3.2, 0.08, 0.5, 0xe6b880, 0, 0.9, 0.5),
      along(logPiece(1.0, 0.15, LOG2, -0.95, 1.09, 0), 'x'),
      plank(0.9, 0.06, 0.3, CUT, 0.95, 0.97, 0),
    ));
    // Le moteur : petit (bache), bloc vert (moteur, en dur), groupe electrogene (industrielle).
    if (st === 2) {
      g.add(part(1.0, rbox(0.5, 0.36, 0.38, 0x6f8a3a, 0.06, -0.9, 1.12, -0.45), along(cyl(0.15, 0.15, 0.06, IRON, 8, -0.9, 1.12, -0.24), 'z')));
    } else if (st <= 4) {
      g.add(part(1.0,
        rbox(0.7, 0.5, 0.5, 0x6f8a3a, 0.08, -0.9, 1.19, -0.45),
        along(cyl(0.2, 0.2, 0.08, IRON, 8, -0.9, 1.19, -0.17), 'z'),
        rbox(0.3, 0.18, 0.22, RED, 0.05, -0.75, 1.53, -0.5),
        cyl(0.05, 0.05, 0.45, IRON, 8, -1.12, 1.62, -0.55), rcone(0.08, 0.08, IRON, 0.3, -1.12, 1.88, -0.55),
      ));
      // Courroie du volant jusqu'a l'axe de la lame (atelier en dur).
      if (st === 4) g.add(part(1.1, rot(box(0.9, 0.035, 0.07, 0x2b2b2b, -0.45, 1.17, -0.14), 0, 0, -0.03)));
    } else {
      g.add(part(1.0,
        rbox(0.85, 0.6, 0.6, 0xe8b84a, 0.08, -0.95, 1.24, -0.5),
        box(0.87, 0.08, 0.62, 0x2b2b2b, -0.95, 1.1, -0.5),
        along(cyl(0.22, 0.22, 0.08, IRON, 8, -0.95, 1.22, -0.17), 'z'),
        rbox(0.36, 0.2, 0.26, RED, 0.05, -0.75, 1.64, -0.55),
        cyl(0.06, 0.06, 1.3, IRON, 8, -1.3, 2.0, -0.7), rcone(0.1, 0.1, IRON, 0.3, -1.3, 2.7, -0.7),
      ));
      // Palan : poutre, chariot, chaine, crochet.
      g.add(part(2.0,
        box(0.18, 0.14, 0.3, 0xe8b84a, 0.9, 2.0, 0), cyl(0.012, 0.012, 0.7, C.metal, 6, 0.9, 1.6, 0),
        torus(0.06, 0.015, C.metal, 0.9, 1.22, 0),
      ));
    }
  }
  const blade = mergeColored(group(
    cyl(0.55, 0.55, 0.04, 0xc9d1d8, 8, 0, 0, 0),
    cyl(0.38, 0.38, 0.05, 0xaab3ba, 8, 0, 0, 0),
    cyl(0.12, 0.12, 0.09, 0x555555, 8, 0, 0, 0),
    ...Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return rot(box(0.1, 0.035, 0.06, 0xb7c0c8, Math.sin(a) * 0.56, 0, Math.cos(a) * 0.56), 0, a + 0.5);
    }),
  ));
  blade.rotation.x = Math.PI / 2;
  blade.position.set(0, bladeY, 0);
  if (st === 1) blade.scale.setScalar(0.75);
  g.add(blade);
  // Rondins a debiter derriere, planches debitees devant : la reserve grossit avec l'atelier.
  const pile = group(
    along(logPiece(2.4, 0.14, LOG, 0.05, 0.14, -0.85), 'x'),
    rot(plank(1.3, 0.06, 0.26, CUT, -1.1, 0.03, 0.98), 0, 0.05),
  );
  if (st >= 2) pile.add(along(logPiece(2.2, 0.14, LOG2, -0.1, 0.14, -1.13), 'x'), rot(plank(1.2, 0.06, 0.26, BOARD3, -1.05, 0.09, 0.97), 0, -0.08));
  if (st >= 3) pile.add(along(logPiece(2.3, 0.14, LOG3, 0, 0.38, -0.99), 'x'), rot(plank(1.25, 0.06, 0.26, CUT, -1.12, 0.15, 0.99), 0, 0.12));
  if (st >= 4) {
    // Cales et planches en paquet, cerclees.
    pile.add(box(0.12, 0.2, 0.5, LOG3, -1.3, 0.1, -1.0), box(0.12, 0.2, 0.5, LOG3, 1.3, 0.1, -1.0));
    for (let i = 0; i < 4; i++) pile.add(plank(1.1, 0.07, 0.6, [CUT, BOARD3, 0xe6b880][i % 3]!, 1.05, 0.04 + i * 0.075, 1.0));
    pile.add(box(0.04, 0.32, 0.62, st === 5 ? 0x3a6ab0 : 0x8a6a4a, 1.05, 0.16, 1.0));
  }
  if (st === 5) pile.add(along(logPiece(2.0, 0.13, LOG2, 0.2, 0.6, -1.08), 'x'));
  g.add(pile);
  const dust = blob(0.5, 0xe0c08a, 1.6, 0.05, 0.9);
  dust.scale.set(1.2, 0.3, 0.8);
  const dust2 = blob(0.26, 0xd6b47c, 1.05, 0.04, 1.0);
  dust2.scale.set(1, 0.35, 1);
  g.add(group(dust, dust2));
  return {
    group: hidden(g, L.sawmill.x, L.sawmill.z),
    live: [blade],
    anim: (dt, _t, busy) => { blade.rotation.y += dt * (busy ? (st === 1 ? 9 : 18 + 3 * (st - 2)) : 1.5); },
  };
}

// ---------------------------------------------------------------- la cuisine

const POT: Profile = [[0, 0], [0.32, 0], [0.38, 0.04], [0.42, 0.3], [0.44, 0.5], [0.47, 0.53], [0.46, 0.56], [0.42, 0.55], [0.41, 0.5], [0, 0.5]];

/**
 * La cuisine, en cinq aspects : feu de camp, poele sous bache, cuisine couverte, cuisine en
 * dur (four de briques, etageres), cantine equipee (murs, hotte, deux marmites).
 */
export function kitchen(stage = 3): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  if (st >= 4) {
    const r = rng(73);
    const floor = new THREE.Group();
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      floor.add(box(0.8, 0.06, 0.72, mixHex(st === 5 ? 0xb8a890 : 0x9a9890, 0x7f7d76, r()), -1.2 + i * 0.8, 0.03, -0.74 + j * 0.74));
    }
    g.add(floor);
  }
  if (st >= 2) {
    // Auvent : poteaux, sablieres suivant la pente, bache puis tole verte, fanions.
    const frame = new THREE.Group();
    for (const s of [-1, 1]) for (const t of [-1, 1]) frame.add(postPiece(s < 0 ? 2.36 : 2.58, st === 2 ? 0.07 : 0.1, t < 0 ? LOG : LOG2, s * 1.45, t * 0.95));
    for (const t of [-1, 1]) {
      const b = logPiece(3.2, st === 2 ? 0.055 : 0.08, LOG3, 0, 2.48, t * 0.95);
      b.rotation.z = Math.PI / 2 + 0.08;
      frame.add(b);
    }
    g.add(frame);
    const roof = st === 2 ? tarp(3.3, 2.3, 0xb0905a, 0) : tinRoof(3.5, 2.4, st === 5 ? 0x9c4a3c : 0x5f8a85, st === 5 ? 0xb85a48 : 0x7f9a6a);
    roof.position.y = 2.6;
    roof.rotation.z = 0.08;
    g.add(roof);
    if (st >= 3) {
      const flags = [0xd9584a, 0xf2c94c, 0x5f9ad0, 0x8cae4f];
      const bunting = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const x = -1.2 + i * 0.4;
        const sag = 0.1 * (1 - (x / 1.45) ** 2);
        bunting.add(rot(plank(0.17, 0.19, 0.025, flags[i % flags.length]!, x, 2.48 + x * 0.08 - 0.2 - sag, 1.06), 0, 0, (i % 2 ? 0.08 : -0.08)));
      }
      g.add(part(2.2, ...bunting.children.slice()));
    }
  }
  // Murs (cantine) : fond de planches, cote avec une fenetre.
  if (st === 5) {
    const wall = new THREE.Group();
    for (let i = 0; i < 7; i++) wall.add(plank(3.0, 0.32, 0.08, [BOARD, BOARD2, BOARD3][i % 3]!, 0, 0.17 + i * 0.33, -1.15));
    for (let i = 0; i < 7; i++) {
      if (i === 3 || i === 4) {
        wall.add(plank(0.08, 0.32, 0.5, [BOARD2, BOARD][i % 2]!, 1.6, 0.17 + i * 0.33, -0.75), plank(0.08, 0.32, 0.5, [BOARD2, BOARD][i % 2]!, 1.6, 0.17 + i * 0.33, 0.75));
      } else wall.add(plank(0.08, 0.32, 2.0, [BOARD3, BOARD2, BOARD][i % 3]!, 1.6, 0.17 + i * 0.33, 0));
    }
    wall.add(box(0.1, 0.06, 1.1, C.woodDark, 1.62, 1.14, 0), box(0.1, 0.06, 1.1, C.woodDark, 1.62, 1.82, 0), box(0.05, 0.62, 0.05, C.woodDark, 1.62, 1.48, 0));
    g.add(wall);
  }
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  let fire: THREE.Mesh;
  // Ou fume la marmite principale.
  let potY = 0.98;
  if (st === 1) {
    // Feu de camp : cercle de pierres, buches, trepied.
    const r = rng(29);
    const ring = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const s = blob(0.11 + r() * 0.04, mixHex(0x8a8780, 0x6a6862, r()), -0.5 + Math.cos(a) * 0.42, 0.07, Math.sin(a) * 0.42);
      s.scale.set(1.2, 0.7, 1);
      ring.add(s);
    }
    ring.add(rot(logPiece(0.6, 0.06, LOG, -0.5, 0.08, 0), 0, 0.5, Math.PI / 2), rot(logPiece(0.6, 0.06, LOG2, -0.5, 0.1, 0), 0, -0.6, Math.PI / 2));
    g.add(ring);
    fire = cone(0.2, 0.42, fireMat, 6, -0.5, 0.3, 0);
    potY = 0.62;
    g.add(part(1.0, ...[0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2 + 0.3;
      return rot(cyl(0.025, 0.025, 1.5, LOG3, 6, -0.5 + Math.cos(a) * 0.32, 0.7, Math.sin(a) * 0.32), Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22);
    }), cyl(0.008, 0.008, 0.35, C.metal, 6, -0.5, 1.2, 0)));
  } else {
    // Le poele : fut de fonte sur pieds, plaque, tuyau qui monte au travers du toit.
    g.add(group(
      cyl(0.34, 0.34, 0.82, 0x3d3f42, 8, -0.5, 0.53, 0),
      cyl(0.37, 0.37, 0.06, 0x2c2e30, 8, -0.5, 0.95, 0),
      cyl(0.36, 0.36, 0.06, 0x2c2e30, 8, -0.5, 0.17, 0),
      ...[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        return box(0.07, 0.16, 0.07, 0x2c2e30, -0.5 + Math.sin(a) * 0.26, 0.07, Math.cos(a) * 0.26);
      }),
      box(0.06, 0.08, 0.04, 0x2c2e30, -0.3, 0.45, 0.36),
    ));
    fire = box(0.3, 0.22, 0.06, fireMat, -0.5, 0.45, 0.33);
    g.add(part(1.0,
      along(cyl(0.07, 0.07, 0.32, 0x4a4a4a, 8, -0.86, 0.8, -0.2), 'x'),
      cyl(0.1, 0.1, 2.2, 0x4a4a4a, 8, -0.98, 1.85, -0.2),
      cyl(0.115, 0.115, 0.05, 0x2c2e30, 8, -0.98, 1.6, -0.2), cyl(0.115, 0.115, 0.05, 0x2c2e30, 8, -0.98, 2.3, -0.2),
      rcone(0.2, 0.14, 0x2c2e30, 0.3, -0.98, 3.02, -0.2),
    ));
    // Hotte d'inox au-dessus du poele (cantine).
    if (st === 5) g.add(part(1.8, rcone(0.55, 0.3, 0xaab3ba, 0.35, -0.5, 1.95, -0.1), cyl(0.12, 0.12, 0.4, 0xaab3ba, 8, -0.5, 2.25, -0.1)));
  }
  g.add(fire);
  // La marmite : soupe orange, anses, louche.
  const soup = new THREE.Color(0xe08a3a);
  const iron = new THREE.Color(0x2f2f2f);
  const potOf = () => group(
    paint(lathe(POT, C.white), 'pot', (x, y, z, out) => { out.copy(y < 0.505 && Math.hypot(x, z) < 0.415 && y > 0.45 ? soup : iron); }),
    plank(0.12, 0.05, 0.14, IRON, -0.5, 0.42, 0), plank(0.12, 0.05, 0.14, IRON, 0.5, 0.42, 0),
    rot(cyl(0.02, 0.02, 0.6, C.metal, 8, 0.15, 0.72, 0.12), 0, 0, 0.5),
  );
  const pot = potOf();
  pot.position.set(-0.5, potY, 0);
  if (st === 1) pot.scale.setScalar(0.8);
  g.add(pot);
  if (st >= 4) {
    // Four de briques au fond a droite : voute sombre, braises.
    const oven = new THREE.Group();
    const r = rng(91);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      oven.add(box(0.26, 0.15, 0.6, mixHex(0xa8553a, 0x8a4430, r()), 0.55 + j * 0.27 + (i % 2) * 0.06, 0.08 + i * 0.16, -0.62));
    }
    oven.add(rbox(0.86, 0.3, 0.62, 0x9a4a34, 0.12, 0.84, 0.78, -0.62), box(0.32, 0.26, 0.04, 0x2a1a14, 0.84, 0.45, -0.31));
    g.add(oven);
    // Etagere de bocaux.
    g.add(part(1.5,
      plank(1.1, 0.05, 0.24, BOARD2, -0.1, 1.55, -0.95), plank(1.1, 0.05, 0.24, BOARD3, -0.1, 1.9, -0.95),
      ...[0, 1, 2, 3].map((i) => rcyl(0.07, 0.07, 0.18, [0xd9584a, 0xe8b84a, 0x8cae4f, 0xe08a3a][i]!, 0.03, -0.5 + i * 0.26, 1.67, -0.95)),
      ...[0, 1, 2].map((i) => rcyl(0.06, 0.06, 0.16, [0x8cae4f, 0xd9584a, 0xe8b84a][i]!, 0.03, -0.4 + i * 0.3, 2.01, -0.95)),
    ));
  }
  if (st === 5) {
    const pot2 = potOf();
    pot2.position.set(-0.5, 0.98, 0);
    pot2.scale.setScalar(0.62);
    pot2.position.x = 0.02;
    g.add(group(cyl(0.24, 0.24, 0.9, 0x3d3f42, 8, 0.02, 0.45, -0.55)));
    pot2.position.z = -0.55;
    g.add(pot2);
  }
  // Le comptoir : une caisse (feu de camp), caisson cloue sinon, plus long a la fin.
  if (st === 1) {
    g.add(group(at(crate(0.6, C.woodLight), 0.8, 0, 0.1), rot(plank(0.5, 0.05, 0.3, CUT, 0.8, 0.63, 0.1), 0, 0.2)));
    g.add(part(0.66, rot(pill(0.05, 0.05, 0.22, 0xe07a2a, 0.72, 0.7, 0.05), 0, 0, Math.PI / 2), blob(0.1, 0xd9584a, 0.92, 0.7, 0.2)));
  } else {
    const cw = st === 5 ? 1.7 : 1.3;
    const cx = st === 5 ? 0.62 : 0.8;
    g.add(group(
      plank(cw, 0.82, 0.8, C.woodDark, cx, 0.41, 0),
      plank(0.42, 0.74, 0.04, BOARD, cx - 0.42, 0.41, 0.41), plank(0.42, 0.74, 0.04, BOARD3, cx + 0.01, 0.41, 0.41), plank(0.42, 0.74, 0.04, BOARD2, cx + 0.44, 0.41, 0.41),
    ));
    const bread = rcyl(0.11, 0.11, 0.3, 0xd49a52, 0.6, 0.45, 1.01, 0.1);
    bread.rotation.set(Math.PI / 2, 0, 0.3);
    bread.scale.set(1, 1, 0.75);
    g.add(part(0.86,
      plank(cw + 0.1, 0.07, 0.9, st >= 4 ? 0xb8b0a0 : 0xc8a878, cx, 0.86, 0),
      plank(0.42, 0.04, 0.28, CUT, 0.5, 0.915, 0.1),
      bread,
      rot(pill(0.05, 0.05, 0.22, 0xe07a2a, 0.75, 0.95, 0.3), 0, 0, Math.PI / 2), rot(pill(0.05, 0.05, 0.22, 0xe8862e, 0.85, 0.95, 0.27), 0, 0.4, Math.PI / 2),
    ));
  }
  if (st >= 2) g.add(at(gasBottle(), 1.7, 0, -0.6));
  if (st >= 3) {
    g.add(at(crate(0.45, C.woodLight), 1.2, 0.9, 0.05, 0.3));
    g.add(part(1.36,
      blob(0.11, 0x8fb35a, 1.12, 1.44, 0.05), blob(0.1, 0x7ea04e, 1.3, 1.43, -0.05),
      rot(cone(0.05, 0.24, 0xff8a2a, 5, 1.2, 1.41, 0.17), 0, 0, 1.4), puff(0.06, C.leafLight, 1.08, 1.43, 0.17),
    ));
    // Poeles et casseroles pendues a une barre, au fond.
    g.add(part(1.7,
      along(cyl(0.025, 0.025, 2.9, C.metal, 8, 0, 2.05, -0.92), 'x'),
      along(cyl(0.15, 0.15, 0.03, 0x34373a, 8, 0.35, 1.78, -0.9), 'z'), box(0.04, 0.3, 0.03, 0x34373a, 0.35, 2.0, -0.9),
      along(cyl(0.12, 0.12, 0.03, 0xb87a4a, 8, 0.8, 1.8, -0.9), 'z'), box(0.04, 0.25, 0.03, 0xb87a4a, 0.8, 1.98, -0.9),
      box(0.06, 0.32, 0.03, C.metal, 1.15, 1.85, -0.9),
    ));
  }
  // Guirlande d'ampoules sous l'auvent (en dur et cantine).
  if (st >= 4) {
    const bulbs: THREE.Object3D[] = [];
    for (let i = 0; i < 6; i++) {
      const x = -1.25 + i * 0.5;
      bulbs.push(sphere(0.045, 0xfff0c0, x, 2.32 + x * 0.08 - 0.12 * (1 - (x / 1.45) ** 2), 0.9, 6));
    }
    g.add(part(2.2, ...bulbs));
  }
  // Tabouret-souche.
  g.add(group(rcyl(0.2, 0.22, 0.44, LOG, 0.25, 0.25, 0.22, 0.72), cyl(0.17, 0.17, 0.02, CUT, 8, 0.25, 0.445, 0.72)));
  const steam: THREE.Mesh[] = [];
  const sy = potY + 0.62;
  for (let i = 0; i < 4; i++) {
    const p = blob(0.16, mat(0xffffff, { opacity: 0.55 }), -0.5, sy + i * 0.3, 0);
    g.add(p);
    steam.push(p);
  }
  const out = hidden(g, L.kitchen.x, L.kitchen.z);
  for (const p of steam) p.castShadow = false;
  return {
    group: out,
    glowMats: [fireMat],
    live: [fire, ...steam],
    anim: (dt, t, busy) => {
      steam.forEach((p, i) => {
        const k = ((t * 0.6 + i / 4) % 1);
        p.position.y = sy - 0.05 + k * 1.3;
        p.position.x = -0.5 + Math.sin(t * 2 + i) * 0.15;
        p.scale.setScalar(busy ? 0.6 + k * 1.2 : 0.001);
      });
      fireMat.emissiveIntensity = busy ? 1 + Math.sin(t * 20) * 0.3 : 0.3;
      if (st === 1) fire.scale.set(1, busy ? 1 + Math.sin(t * 17) * 0.15 : 0.6, 1);
      void dt;
    },
  };
}

// ---------------------------------------------------------------- les tours de guet

export interface Tower extends Building { light: THREE.SpotLight; muzzle: THREE.Vector3 }

/** Pieu du parapet : un fut et sa pointe taillee, d'une seule piece (geometrie partagee). */
const PIKE: Profile = [[0, 0], [0.085, 0], [0.095, 0.02], [0.095, 0.9], [0.088, 0.94], [0.02, 1.13], [0, 1.15]];
function pike(tone: number, x: number, y: number, z: number): THREE.Mesh {
  return paint(lathe(PIKE, C.white, x, y, z, 10), `pk${tone}`, (_x, py, _z, out) => { out.setHex(py > 0.92 ? CUT : tone); });
}

/** Tour de guet : la grande du camp (avec projecteur), ou une tour d'angle. */
export function watchTower(scene: THREE.Scene, x: number = L.tower.x, z: number = L.tower.z, withLight = true): Tower {
  const g = new THREE.Group();
  const legH = 4.2;
  // Pieds de rondins legerement evases, croix de saint Andre sur les quatre faces.
  const legs = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = postPiece(legH, 0.16, sx * sz > 0 ? LOG : LOG2, sx * 0.9, sz * 0.9);
    leg.rotation.z = sx * -0.05;
    leg.rotation.x = sz * 0.05;
    legs.add(leg);
  }
  for (const [i, y] of [1.3, 2.7].entries()) {
    for (const s of [-1, 1]) {
      const tilt = (Math.PI / 2 - 0.55) * (i % 2 ? -1 : 1) * s;
      legs.add(rot(plank(0.1, 2.15, 0.12, i % 2 ? BOARD2 : LOG3, 0, y, s * 1.02), 0, 0, tilt));
      legs.add(rot(plank(0.12, 2.15, 0.1, i % 2 ? LOG3 : BOARD2, s * 1.02, y, 0), tilt, 0, 0));
    }
  }
  g.add(legs);
  // L'echelle : deux montants, huit barreaux.
  const ladder = group(plank(0.07, legH + 0.2, 0.07, C.woodDark, -0.32, (legH + 0.2) / 2, 1.17), plank(0.07, legH + 0.2, 0.07, C.woodDark, 0.32, (legH + 0.2) / 2, 1.17));
  for (let i = 0; i < 8; i++) ladder.add(plank(0.7, 0.06, 0.07, C.woodLight, 0, 0.4 + i * 0.5, 1.17));
  g.add(ladder);
  // Plancher : plateau epais et lames de teintes voisines.
  const deck = part(legH, plank(2.8, 0.18, 2.8, LOG3, 0, legH, 0));
  for (let i = 0; i < 6; i++) deck.add(plank(2.6, 0.05, 0.42, [C.wood, BOARD, BOARD3][i % 3]!, 0, 0.115, -1.08 + i * 0.432));
  g.add(deck);
  // Parapet en pieux, comme la palissade, et sacs de sable.
  const parapet = new THREE.Group();
  parapet.position.y = legH;
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const o = -1.2 + i * 0.4;
      parapet.add(pike(i % 2 ? LOG : LOG2, o, 0.1, s * 1.25), pike(i % 2 ? LOG2 : LOG, s * 1.25, 0.1, o));
    }
  }
  g.add(parapet);
  g.add(at(sandbags(1.2, 2, 21), 0.4, legH + 0.1, 1.0));
  // Poteaux du toit, a la pente du toit ; tole kaki avec une piece grise ; fanion.
  const roofY = legH + 1.82;
  const posts = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const h = 1.82 + sz * 1.2 * 0.149 - 0.035 - 0.1;
    posts.add(plank(0.13, h, 0.13, C.woodDark, sx * 1.2, legH + 0.1 + h / 2, sz * 1.2));
  }
  g.add(part(legH + 0.1, ...posts.children.slice()));
  const roof = tinRoof(3.2, 3.2, 0x6f7a4a, 0x8a8f91);
  roof.position.y = roofY;
  roof.rotation.x = -0.15;
  g.add(roof);
  g.add(part(roofY,
    cyl(0.03, 0.03, 0.95, C.metal, 8, -1.2, legH + 2.06, -1.2),
    plank(0.5, 0.3, 0.025, 0xd9584a, -0.94, legH + 2.37, -1.2),
  ));
  // Le garde, fusil a l'epaule.
  const gun = group(box(0.06, 0.06, 0.62, 0x2b2b2b, 0, 0, 0.16), plank(0.08, 0.12, 0.3, BOARD2, 0, -0.03, -0.25));
  gun.position.set(0.28, legH + 0.98, 0.15);
  gun.rotation.x = -0.5;
  g.add(part(legH,
    pill(0.19, 0.23, 0.78, 0x6b7f4a, 0, legH + 0.64, 0),
    pill(0.07, 0.07, 0.5, 0x5d6f40, -0.24, legH + 0.78, 0.04), pill(0.07, 0.07, 0.5, 0x5d6f40, 0.24, legH + 0.82, 0.08),
    sphere(0.21, C.skin, 0, legH + 1.2, 0, 12),
    lathe([[0, 0], [0.27, 0], [0.28, 0.03], [0.24, 0.06], [0.22, 0.14], [0.14, 0.22], [0, 0.24]], 0x4a5a3a, 0, legH + 1.26, 0),
    gun,
  ));
  const lampMat = uniqueMat(0xfff7d6, 0xfff2cc);
  lampMat.emissiveIntensity = 0;
  // Projecteur : boitier fusionne, verre a part (il s'allume).
  const lamp = mergeColored(group(
    cyl(0.22, 0.3, 0.4, 0x3a3a3a, 8, 0, 0, 0),
    cyl(0.32, 0.32, 0.05, 0x2c2e30, 8, 0, -0.19, 0),
    cyl(0.25, 0.25, 0.02, lampMat, 8, 0, -0.21, 0),
  ));
  lamp.rotation.x = -0.9;
  lamp.position.set(-0.9, legH + 1.0, 1.2);
  g.add(lamp);
  const light = new THREE.SpotLight(0xfff2cc, 0, 30, 0.45, 0.5, 1.2);
  light.position.set(-0.9, legH + 1.0, 1.3);
  light.target.position.set(-6, 0, 6);
  g.add(light, light.target);
  if (!withLight) {
    g.remove(light, light.target, lamp);
  }
  const t = hidden(g, x, z);
  scene.add(t);
  if (withLight) {
    // Le projecteur vit dans la scene des le depart (eteint tant que la tour est en ruine) :
    // le nombre de lumieres visibles ne change jamais, donc aucun shader n'est recompile
    // d'un coup au moment ou l'on releve la tour.
    t.updateMatrixWorld(true);
    scene.attach(light);
    scene.attach(light.target);
  }
  return { group: t, light, glowMats: withLight ? [lampMat] : [], live: withLight ? [lamp] : [], muzzle: new THREE.Vector3(x + 0.3, legH + 1.0, z + 0.4) };
}

// ---------------------------------------------------------------- l'abri (conteneur)

const TEAL = 0x4f7f7a;
const TEAL2 = 0x3f6662;

/** Tente igloo de survie (profil de revolution). */
const TENT_DOME: Profile = [[0, 0], [1.0, 0], [1.02, 0.05], [0.98, 0.4], [0.86, 0.75], [0.62, 1.05], [0.32, 1.25], [0, 1.3]];

/**
 * L'abri des survivants, en cinq aspects : tente de survie, cabane de bric et de broc,
 * conteneur, conteneur amenage (auvent, panneau solaire), conteneurs empiles.
 */
export function shelter(stage = 4): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  const wm = winMat();
  let win: THREE.Mesh | null = null;
  let win2: THREE.Mesh | null = null;
  if (st === 1) {
    // Deux tentes, une bache tendue entre elles, des couchages et un feu de camp eteint.
    const tent = paint(lathe(TENT_DOME, C.white), 'tentdome', (_x, y, _z, out) => { out.setHex(y > 1.15 ? 0x5f6a3e : 0x7a8450); });
    tent.scale.set(1.15, 1, 0.95);
    tent.position.x = -0.9;
    const tent2 = paint(lathe(TENT_DOME, C.white), 'tentdome2', (_x, y, _z, out) => { out.setHex(y > 1.15 ? 0x8a5a3a : 0xb07a48); });
    tent2.scale.set(0.85, 0.85, 0.8);
    tent2.position.set(1.3, 0, 0.1);
    g.add(group(tent, tent2, box(0.5, 0.6, 0.05, 0x2b2b2b, -0.9, 0.3, 0.92), box(0.38, 0.45, 0.05, 0x2b2b2b, 1.3, 0.23, 0.75)));
    const fly = tarp(2.2, 1.6, 0x4f7a8f, 0);
    fly.position.set(0.2, 1.45, 0.6);
    fly.rotation.x = 0.25;
    g.add(fly, group(postPiece(1.5, 0.04, LOG3, -0.8, 1.3), postPiece(1.5, 0.04, LOG3, 1.2, 1.3)));
    g.add(group(rot(rcyl(0.14, 0.14, 0.7, 0x5f9ad0, 0.06, -0.1, 0.14, 1.4), 0, 0, Math.PI / 2), rot(rcyl(0.14, 0.14, 0.7, 0xc9573a, 0.06, 0.6, 0.14, 1.6), 0, 0.4, Math.PI / 2)));
    g.add(at(sandbags(1.4, 1, 31), -1.4, 0, -1.2));
  } else if (st === 2) {
    // Cabane de planches clouees, toit de toles rapiecees, une fenetre de fortune.
    const walls = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      walls.add(plank(3.8, 0.34, 0.1, [BOARD, BOARD2, BOARD3][i % 3]!, 0, 0.18 + i * 0.35, -1.0));
      for (const s of [-1, 1]) walls.add(plank(0.1, 0.34, 2.0, [BOARD2, BOARD3, BOARD][i % 3]!, s * 1.85, 0.18 + i * 0.35, 0));
      if (i < 2 || i > 3) walls.add(plank(3.8, 0.34, 0.1, [BOARD3, BOARD, BOARD2][i % 3]!, 0, 0.18 + i * 0.35, 1.0));
      else walls.add(plank(1.6, 0.34, 0.1, BOARD3, -1.1, 0.18 + i * 0.35, 1.0), plank(1.2, 0.34, 0.1, BOARD2, 1.3, 0.18 + i * 0.35, 1.0));
    }
    g.add(walls);
    win = box(0.8, 0.66, 0.04, wm, 0.1, 1.4, 1.0);
    g.add(win);
    const roof = tinRoof(4.2, 2.5, C.rust, 0x6a737b);
    roof.position.y = 2.15;
    roof.rotation.x = 0.1;
    g.add(roof);
    g.add(plankDoor(0.8, 1.6, -1.2, 0, 1.06, 0x5a4636));
    g.add(at(crate(0.5), 2.3, 0, 0.8), at(drum(0x3f6a8a), 2.3, 0, -0.4));
  } else {
    // Le conteneur repeint : caisson, toles ondulees, cadre d'acier.
    g.add(group(
      box(4.2, 2.3, 2.2, TEAL, 0, 1.15, 0),
      corrugated(3.96, 2.1, 0x568883, 0, 1.15, 1.135, 18),
      rot(corrugated(1.96, 2.1, TEAL, 2.135, 1.15, 0, 9), 0, Math.PI / 2), rot(corrugated(1.96, 2.1, TEAL, -2.135, 1.15, 0, 9), 0, Math.PI / 2),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.16, 2.36, 0.16, TEAL2, sx * 2.1, 1.18, sz * 1.1))),
      box(4.36, 0.14, 0.16, TEAL2, 0, 0.07, 1.1), box(4.36, 0.16, 0.16, TEAL2, 0, 2.28, 1.1),
      box(0.16, 0.16, 2.36, TEAL2, 2.1, 2.28, 0), box(0.16, 0.16, 2.36, TEAL2, -2.1, 2.28, 0),
    ));
    g.add(part(2.3, box(4.3, 0.1, 2.3, TEAL2, 0, 2.36, 0)));
    g.add(plankDoor(1.0, 1.9, 0.9, 0.02, 1.2, C.wood));
    win = box(0.9, 0.6, 0.04, wm, -1.0, 1.5, 1.17);
    g.add(win);
    g.add(part(1.1,
      windowFrame(0.9, 0.6, -1.0, 1.5, 1.19),
      rot(plank(0.42, 0.66, 0.04, 0xb9874a, -1.75, 1.5, 1.3), 0, 0.5), rot(plank(0.42, 0.66, 0.04, 0xa8783e, -0.25, 1.5, 1.3), 0, -0.5),
      ...(st >= 4 ? [flowerBox(0.9, -1.0, 1.04, 1.27)] : []),
    ));
    g.add(at(sandbags(1.4, 2, 31), -1.4, 0, 2.0));
    if (st >= 4) {
      // L'auvent raye sur deux poteaux.
      const awning = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const c = i % 2 ? CREAM : 0xc9573a;
        awning.add(plank(0.52, 0.05, 1.35, c, -1.04 + i * 0.52, 0, 0), plank(0.52, 0.16, 0.04, c, -1.04 + i * 0.52, -0.09, 0.66));
      }
      awning.position.set(-0.3, 2.1, 1.82);
      awning.rotation.x = 0.22;
      g.add(awning);
      g.add(group(postPiece(1.96, 0.07, LOG, -1.5, 2.3), postPiece(1.96, 0.07, LOG2, 0.9, 2.3)));
      g.add(at(crate(0.55), 2.5, 0, 0.9), at(crate(0.45, C.woodLight), 2.5, 0.55, 0.9, 0.4));
    }
    // Sur le toit (ou sur le conteneur du dessus) : panneau solaire, citerne, antenne.
    const top = st === 5 ? 4.62 : 2.42;
    if (st === 5) {
      // Le deuxieme conteneur, couleur rouille, decale ; garde-corps et escalier.
      g.add(part(2.42,
        box(3.0, 2.1, 2.1, 0xb8673a, -0.55, 3.47, 0), corrugated(2.8, 1.9, 0xa85a30, -0.55, 3.47, 1.06, 13),
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.14, 2.14, 0.14, 0x8a4a2a, -0.55 + sx * 1.45, 3.47, sz * 1.0))),
        box(3.1, 0.1, 2.2, 0x8a4a2a, -0.55, 4.56, 0),
      ));
      win2 = box(0.8, 0.55, 0.04, wm, -1.1, 3.6, 1.08);
      g.add(win2);
      g.add(part(2.4, plankDoor(0.8, 1.7, 0.3, 2.42, 1.08, 0x5a4636)));
      g.add(part(2.5,
        ...[0, 1, 2, 3].map((i) => box(0.05, 0.8, 0.05, C.metal, 1.0 + i * 0.36, 2.82, 1.05)), box(1.15, 0.05, 0.05, C.metal, 1.55, 3.2, 1.05),
        ...[0, 1, 2].map((i) => box(0.05, 0.8, 0.05, C.metal, 2.08, 2.82, -0.75 + i * 0.6)), box(0.05, 0.05, 2.0, C.metal, 2.08, 3.2, 0),
      ));
      // Escalier contre le mur arriere (rien ne depasse sur les cotes).
      g.add(group(...Array.from({ length: 6 }, (_, i) => plank(0.32, 0.06, 0.55, BOARD2, 1.6 - i * 0.32, 0.35 + i * 0.4, -1.42)),
        rot(box(0.06, 2.9, 0.06, IRON, 0.8, 1.25, -1.7), 0, 0, 0.66)));
      // Guirlande d'ampoules du toit jusqu'a l'antenne.
      g.add(part(2.4, ...Array.from({ length: 7 }, (_, i) => sphere(0.05, 0xfff0c0, -2.0 + i * 0.6, 2.55 + 0.12 * Math.sin(i * 0.9), 1.15, 6))));
    }
    if (st >= 4) {
      const solar = group(box(1.1, 0.06, 0.8, IRON, 0, 0, 0), plank(1.0, 0.04, 0.7, 0x2d4a6e, 0, 0.04, 0), box(0.04, 0.045, 0.7, 0x5a7aa0, 0, 0.05, 0));
      solar.position.set(-0.9, top + 0.24, -0.25);
      solar.rotation.x = 0.35;
      g.add(solar);
      g.add(part(top,
        box(0.08, 0.3, 0.08, IRON, -0.9, top + 0.13, -0.55),
        rcyl(0.35, 0.35, 0.6, 0x3f6a8a, 0.3, st === 5 ? -0.1 : 0.75, top + 0.29, -0.5), cyl(0.36, 0.36, 0.05, 0x2f5470, 8, st === 5 ? -0.1 : 0.75, top + 0.29, -0.5),
        cyl(0.04, 0.04, 1.4, C.metal, 8, st === 5 ? 0.6 : 1.8, top + 0.58, -0.6), plank(0.6, 0.35, 0.04, 0xe8b84a, st === 5 ? 0.9 : 2.1, top + 1.08, -0.6),
      ));
      if (st === 5) g.add(part(top, rot(cyl(0.34, 0.08, 0.12, 0xd8d8d0, 10, -1.6, top + 0.4, 0.4), 0.9, 0, 0.3), cyl(0.03, 0.03, 0.4, C.metal, 6, -1.6, top + 0.2, 0.4)));
    }
  }
  const out = hidden(g, L.shelter.x, L.shelter.z, -0.5);
  const lit = [win, win2].filter((x): x is THREE.Mesh => !!x);
  return { group: out, glowMats: lit.length ? [wm] : [], live: lit };
}

// ---------------------------------------------------------------- le moulin

/** Tour du moulin : soubassement de pierre, mur enduit qui s'affine, couronne de bois. */
const MILL: Profile = [
  [0, 0], [1.84, 0], [1.87, 0.04], [1.87, 0.52], [1.84, 0.56], [1.74, 0.58], [1.73, 0.64], [1.66, 1.5], [1.57, 2.5], [1.47, 3.4],
  [1.39, 4.08], [1.46, 4.1], [1.47, 4.24], [0, 4.26],
];
/** Toit conique en trois rangs de bardeaux. */
const MILL_CAP: Profile = [[0, 0], [1.72, 0], [1.74, 0.06], [1.26, 0.52], [1.32, 0.55], [0.86, 0.98], [0.92, 1.01], [0.42, 1.42], [0.16, 1.62], [0, 1.66]];
const DOME: Profile = [[0, 0], [0.7, 0], [0.72, 0.04], [0.7, 0.28], [0.6, 0.52], [0.42, 0.7], [0.2, 0.8], [0, 0.83]];
const SACK: Profile = [[0, 0], [0.26, 0], [0.33, 0.06], [0.35, 0.3], [0.3, 0.5], [0.16, 0.6], [0.09, 0.63], [0.11, 0.7], [0, 0.72]];

/** Rayon du mur du moulin a la hauteur y. */
function millR(y: number): number {
  for (let i = 6; i < 10; i++) {
    const a = MILL[i]!;
    const b = MILL[i + 1]!;
    if (y <= b[1]) return a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]);
  }
  return 1.39;
}

/**
 * Le moulin de la ferme, en cinq aspects : meule a bras, petit moulin de bois, moulin a vent,
 * moulin de pierre a galerie, minoterie (ailes d'acier, silo a grain). Le four fait le pain.
 */
export function windmill(stage = 3): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  const wm = winMat();
  const live: THREE.Object3D[] = [];
  let spin: (dt: number, busy: boolean) => void;
  let fire: THREE.Mesh;
  if (st === 1) {
    // Meule a bras sous un appentis : souche, deux meules, manivelle ; four de pierres seches.
    g.add(group(postPiece(1.9, 0.06, LOG3, -0.9, 0.9), postPiece(1.9, 0.06, LOG3, 0.9, 0.9), postPiece(1.3, 0.06, LOG3, -0.9, -0.9), postPiece(1.3, 0.06, LOG3, 0.9, -0.9)));
    const t = tarp(2.3, 2.2, 0xb0905a, 0);
    t.position.y = 1.62;
    t.rotation.x = -0.28;
    g.add(t);
    g.add(group(rcyl(0.42, 0.48, 0.6, LOG, 0.06, 0, 0.3, 0), cyl(0.5, 0.5, 0.14, 0x8a8780, 12, 0, 0.67, 0)));
    const quern = group(cyl(0.48, 0.48, 0.14, 0x9a9890, 12, 0, 0, 0), cyl(0.08, 0.08, 0.16, 0x3a3a3a, 8, 0, 0.02, 0), cyl(0.03, 0.03, 0.4, C.woodDark, 6, 0.34, 0.24, 0));
    quern.position.y = 0.82;
    g.add(quern);
    live.push(quern);
    spin = (dt, busy) => { quern.rotation.y += dt * (busy ? 2.4 : 0); };
    const ov = new THREE.Group();
    const r = rng(19);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const b = blob(0.16, mixHex(0x8a8780, 0x6a6862, r()), 2.0 + Math.cos(a) * 0.45, 0.12 + (i % 2) * 0.16, 0.8 + Math.sin(a) * 0.4);
      ov.add(b);
    }
    g.add(ov);
    fire = cone(0.2, 0.36, fireMat, 6, 2.0, 0.26, 0.8);
  } else {
    // La tour : bois (petit moulin), enduit, pierre (galerie), pierre et acier (minoterie).
    const k = st === 2 ? 0.62 : 1;
    const stone = new THREE.Color(C.stone);
    const stone2 = new THREE.Color(0x85837b);
    const plaster = new THREE.Color(0xe6dccb);
    const crown = new THREE.Color(C.woodDark);
    const wood = new THREE.Color(BOARD2);
    const wood2 = new THREE.Color(BOARD3);
    const tower = paint(lathe(MILL, C.white), `mill${st}`, (_x, y, _z, out) => {
      if (y > 4.09) out.copy(crown);
      else if (st === 2) out.copy(Math.floor(y / 0.42) % 2 ? wood : wood2);
      else if (st >= 4) out.copy(Math.floor(y / 0.38) % 2 ? stone : stone2);
      else out.copy(y < 0.6 ? stone : plaster);
    });
    const body = group(tower);
    if (st === 3) {
      for (const [a, y, rr] of [[-0.5, 1.3, 0.2], [0.6, 2.2, 0.16], [-0.2, 3.3, 0.14], [1.2, 0.95, 0.18], [-1.1, 2.6, 0.15]] as const) {
        const R = millR(y);
        const b = blob(rr, a > 0 ? C.stone : 0x85837b, Math.sin(a) * R, y, Math.cos(a) * R);
        b.rotation.y = a;
        b.scale.set(1.2, 0.8, 0.45);
        body.add(b);
      }
    }
    body.scale.setScalar(k);
    g.add(body);
    const capC = st >= 4 ? [0xb8452f, 0xa03a28] : [0xa0573a, 0x8f4a2a];
    const cap = part(4.24 * k,
      paint(lathe(MILL_CAP, C.white, 0, 4.24 * k, 0), `millcap${st >= 4 ? 'r' : ''}`, (_x, y, _z, out) => { out.setHex(y > 0.535 && y < 1.0 ? capC[0]! : capC[1]!); }),
      cyl(0.04, 0.04, 0.4, IRON, 8, 0, 4.24 * k + 1.81, 0), sphere(0.08, 0xd9b44a, 0, 4.24 * k + 2.03, 0, 8),
    );
    cap.scale.setScalar(k);
    cap.position.y = 4.24 * k;
    g.add(cap);
    // Porte et fenetre allumee.
    if (st === 2) {
      g.add(plankDoor(0.62, 1.1, 0, 0.02, millR(0.6) * k + 0.05, C.woodDark));
    } else {
      g.add(group(
        plank(0.18, 1.55, 0.3, C.stone, -0.5, 0.775, 1.76), plank(0.18, 1.55, 0.3, 0x85837b, 0.5, 0.775, 1.76),
        plank(1.18, 0.2, 0.32, C.stone, 0, 1.55, 1.75),
        plankDoor(0.82, 1.43, 0, 0.02, 1.9, C.woodDark),
      ));
    }
    const wz = millR(2.8) * k + 0.02;
    const win = box(0.42 * k, 0.5 * k, 0.05, wm, 0, 2.8 * k, wz);
    g.add(win);
    live.push(win);
    g.add(part(2.5 * k, windowFrame(0.42 * k, 0.5 * k, 0, 2.8 * k, wz + 0.02)));
    // Galerie de bois autour de la tour (pierre et minoterie).
    if (st >= 4) {
      const R = millR(2.3) + 0.55;
      const gal = new THREE.Group();
      gal.add(paint(lathe([[R - 0.6, 0], [R, 0], [R, 0.08], [R - 0.6, 0.08]], C.white, 0, 2.3, 0), 'gallery', (_x, _y, _z, out) => { out.setHex(BOARD2); }));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        if (Math.abs(Math.sin(a)) < 0.25 && Math.cos(a) > 0) continue;
        gal.add(box(0.06, 0.6, 0.06, C.woodDark, Math.sin(a) * R, 2.68, Math.cos(a) * R));
      }
      gal.add(paint(lathe([[R - 0.04, 0], [R + 0.04, 0], [R + 0.04, 0.06], [R - 0.04, 0.06]], C.white, 0, 2.96, 0), 'galrail', (_x, _y, _z, out) => { out.setHex(C.woodDark); }));
      g.add(part(2.3, ...gal.children.slice()));
    }
    // Les ailes : toile (bois, enduit, pierre), panneaux d'acier (minoterie).
    const sail = st === 5 ? 1.12 : st === 4 ? 1.1 : st === 2 ? 0.6 : 1;
    const arms = group(along(cyl(0.2, 0.2, 0.3, 0x3a3a3a, 8, 0, 0, 0), 'z'), sphere(0.13, 0x2c2e30, 0, 0, 0.17, 8));
    for (let i = 0; i < 4; i++) {
      const cloth = st === 5 ? (i % 2 ? 0xaab3ba : 0x9aa3aa) : i % 2 ? 0xe8e0cc : C.canvas;
      const spar = st === 5 ? STEEL : C.woodDark;
      const arm = group(
        plank(0.14, 3.2, 0.1, spar, 0, 1.7, 0),
        plank(0.5, 2.5, 0.025, cloth, 0.36, 1.95, 0.04),
        plank(0.045, 2.6, 0.05, st === 5 ? IRON : BOARD2, 0.1, 1.95, 0.06), plank(0.045, 2.6, 0.05, st === 5 ? IRON : BOARD2, 0.62, 1.95, 0.06),
      );
      for (let j = 0; j < 4; j++) arm.add(plank(0.6, 0.045, 0.05, st === 5 ? IRON : BOARD2, 0.36, 0.75 + j * 0.8, 0.08));
      if (i === 1) arm.add(plank(0.22, 0.3, 0.03, st >= 4 ? 0xe8b84a : 0xc9573a, 0.42, 2.4, 0.06));
      arm.rotation.z = (i * Math.PI) / 2;
      arms.add(arm);
    }
    // Avec la galerie, l'arbre est plus long : les ailes passent devant elle.
    const hz = st >= 4 ? 2.5 : 2.05;
    g.add(part(3.8 * k, along(cyl(0.17 * k, 0.17 * k, (hz - 1.3) * k, IRON, 8, 0, 4.0 * k, ((hz + 1.25) / 2) * k), 'z')));
    const hub = new THREE.Group();
    hub.position.set(0, 4.0 * k, hz * k);
    const m = mergeColored(arms);
    m.scale.setScalar(sail);
    hub.add(m);
    g.add(hub);
    live.push(hub);
    spin = (dt, busy) => { hub.rotation.z -= dt * (busy ? 1.6 : 0.25); };
    // Le four de brique en dome, sur un socle de pierre ; bois de chauffe, cheminee.
    const dome = lathe(DOME, C.brick, 2.0, 0.34, 0.8);
    dome.scale.set(1.1, 1, 0.92);
    g.add(group(
      plank(1.6, 0.36, 1.3, C.stone, 2.0, 0.18, 0.8),
      dome,
      plank(0.6, 0.1, 0.12, 0x8a4a32, 2.0, 0.72, 1.42), plank(0.1, 0.32, 0.12, 0x8a4a32, 1.74, 0.52, 1.42), plank(0.1, 0.32, 0.12, 0x8a4a32, 2.26, 0.52, 1.42),
    ));
    g.add(part(0.8, plank(0.3, 0.9, 0.3, 0x8a4a32, 2.35, 1.25, 0.5), plank(0.38, 0.08, 0.38, IRON, 2.35, 1.72, 0.5)));
    fire = box(0.42, 0.3, 0.06, fireMat, 2.0, 0.52, 1.43);
    g.add(group(
      along(logPiece(0.5, 0.07, LOG, 2.55, 0.07, 1.6), 'x'), along(logPiece(0.5, 0.07, LOG2, 2.58, 0.07, 1.75), 'x'),
      along(logPiece(0.5, 0.07, LOG3, 2.56, 0.2, 1.67), 'x'),
    ));
    if (st === 5) {
      // Silo a grain d'acier, echelle, goulotte jusqu'a la tour ; fanion au sommet.
      g.add(group(
        rcyl(0.72, 0.72, 3.2, 0xb8c0c6, 0.08, -2.9, 1.6, -1.6),
        ...[0.5, 1.3, 2.1, 2.9].map((y) => cyl(0.74, 0.74, 0.05, 0x8a939a, 14, -2.9, y, -1.6)),
        cone(0.8, 0.6, 0x8a939a, 12, -2.9, 3.5, -1.6),
        box(0.05, 3.3, 0.05, IRON, -2.14, 1.65, -1.48), box(0.05, 3.3, 0.05, IRON, -2.14, 1.65, -1.72),
        rot(along(cyl(0.09, 0.09, 1.4, 0x8a939a, 8, -1.85, 3.15, -1.15), 'x'), 0, 0.5, 0.25),
      ));
      g.add(part(5.8, cyl(0.03, 0.03, 1.2, C.metal, 6, 0, 6.85, 0), plank(0.5, 0.3, 0.03, 0xc9412f, 0.26, 7.25, 0)));
    }
  }
  g.add(fire);
  live.push(fire);
  // Sacs de farine, gerbe de ble, caisse : la reserve grossit avec le moulin.
  const lying = lathe(SACK, 0xc9b48a, -1.9, 0.33, 0.3);
  lying.rotation.set(0, 0.4, Math.PI / 2);
  const sacks = group(lathe(SACK, C.canvas, -2.2, 0, -0.4), rcyl(0.15, 0.2, 0.7, 0xd9b24a, 0.3, -2.4, 0.35, 0.75), cyl(0.16, 0.16, 0.06, 0xb08a3a, 8, -2.4, 0.4, 0.75));
  if (st >= 2) sacks.add(lying);
  if (st >= 4) sacks.add(lathe(SACK, 0xd8c8a0, -2.75, 0, 0.1), lathe(SACK, C.canvas, -2.45, 0.6, -0.2), at(crate(0.5), -1.6, 0, -1.6));
  g.add(sacks);
  g.add(at(crate(0.5, C.woodLight), -1.9, 0, 1.2));
  return {
    group: hidden(g, L.mill.x, L.mill.z),
    glowMats: [fireMat, wm],
    live,
    anim: (dt, t, busy) => {
      spin(dt, busy);
      fireMat.emissiveIntensity = busy ? 1 + Math.sin(t * 18) * 0.3 : 0.2;
    },
  };
}

// ---------------------------------------------------------------- le ponton

const BUCKET: Profile = [[0, 0], [0.15, 0], [0.17, 0.02], [0.2, 0.3], [0.21, 0.32], [0.19, 0.32], [0.18, 0.28], [0, 0.28]];

/** Le ponton de l'etang : on y peche. */
/** Une barque (coque, bancs, rames) ; avec un moteur hors-bord pour la peche en grand. */
function rowboat(motor: boolean, tone: number): THREE.Group {
  const b = group(
    rbox(0.8, 0.32, 2.2, tone, 0.14, 0, 0.0, 0), rbox(0.66, 0.1, 2.0, 0x6a4e32, 0.06, 0, 0.12, 0),
    cone(0.4, 0.5, tone, 6, 0, 0.0, 1.25), plank(0.7, 0.05, 0.22, BOARD3, 0, 0.18, -0.3), plank(0.7, 0.05, 0.22, BOARD2, 0, 0.18, 0.4),
    rot(cyl(0.02, 0.02, 1.6, BOARD2, 6, 0.32, 0.25, 0.1), Math.PI / 2 - 0.1, 0, 0.3),
  );
  b.children[2]!.rotation.x = Math.PI / 2;
  if (motor) b.add(rbox(0.26, 0.36, 0.3, 0x2b2b2b, 0.05, 0, 0.3, -1.2), box(0.06, 0.4, 0.06, 0x3a3d40, 0, 0.0, -1.25), box(0.3, 0.06, 0.06, 0xc9412f, 0, 0.5, -1.2));
  return b;
}

/**
 * Le ponton de l'etang, en cinq aspects : planches de fortune, ponton, ponton et barque,
 * ponton a garde-corps (lanternes, sechoir a poissons), port de peche (cabane sur pilotis,
 * bateau a moteur, nasses, bouees). Le platelage ne change pas : on y marche pareil.
 */
export function dock(stage = 2): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  const posts = new THREE.Group();
  for (let i = 0; i < 3; i++) for (const sx of [-0.6, 0.6]) posts.add(postPiece(st >= 4 ? 0.9 : 0.6, 0.1, i % 2 ? 0x5e452c : 0x6a4e32, sx, -1.2 + i * 1.3, st >= 4 ? -0.4 : -0.1));
  posts.add(plank(0.12, 0.1, 3.7, C.woodDark, -0.5, 0.0, 0.1), plank(0.12, 0.1, 3.7, C.woodDark, 0.5, 0.0, 0.1));
  g.add(posts);
  const deck = new THREE.Group();
  const tones = st === 1 ? [0x8a6a48, 0x9c7a52, 0x6e5034] : [C.wood, C.woodLight, 0xb98450];
  const r = rng(53);
  for (let i = 0; i < 11; i++) {
    // Planches de fortune : de travers, plus courtes, de toutes les teintes.
    const p = plank((st === 1 ? 1.3 - r() * 0.3 : 1.5 - (i % 3) * 0.04), 0.06, st === 1 ? 0.26 : 0.3, tones[i % 3]!, ((i * 7) % 3 - 1) * (st === 1 ? 0.08 : 0.02), 0.07, -1.6 + i * 0.34);
    p.rotation.y = ((i * 5) % 3 - 1) * (st === 1 ? 0.08 : 0.015);
    deck.add(p);
  }
  g.add(deck);
  // Cordage, seau, canne a peche appuyee.
  g.add(part(0.1,
    rot(torus(0.14, 0.04, C.rope, -0.35, 0.13, 1.35), Math.PI / 2),
    lathe(BUCKET, 0x5f7a8a, -0.5, 0.1, -1.3),
    rot(cyl(0.015, 0.02, 1.8, BOARD2, 8, 0.62, 0.7, 0.0), 0.35, 0, -0.22),
    ...(st >= 2 ? [rot(torus(0.1, 0.03, C.rope, 0.6, 0.38, 1.4), Math.PI / 2)] : []),
  ));
  if (st >= 2) g.add(at(crate(0.45), 0.45, 0.1, -1.4, 0.3));
  if (st >= 3) {
    // Barque amarree a un pieu, a gauche du ponton.
    const boat = rowboat(st === 5, st === 5 ? 0xd8d8d0 : 0x5f8a85);
    boat.position.set(-1.45, -0.02, 0.6);
    boat.rotation.y = 0.08;
    g.add(boat, group(postPiece(0.9, 0.08, LOG3, -0.95, 1.6, -0.3), rot(cyl(0.012, 0.012, 0.8, C.rope, 4, -1.2, 0.35, 1.25), 0, 0.5, 1.2)));
  }
  if (st >= 4) {
    // Garde-corps, deux lanternes, sechoir a poissons.
    const rail = new THREE.Group();
    for (const sx of [-0.72, 0.72]) {
      for (let i = 0; i < 5; i++) rail.add(box(0.06, 0.6, 0.06, C.woodDark, sx, 0.4, -1.5 + i * 0.8));
      rail.add(box(0.06, 0.06, 3.3, BOARD2, sx, 0.72, -0.1));
    }
    for (const sx of [-0.72, 0.72]) rail.add(cyl(0.035, 0.035, 1.4, IRON, 6, sx, 0.8, 1.75), rcyl(0.09, 0.09, 0.2, 0xffd27a, 0.03, sx, 1.55, 1.75));
    g.add(rail);
    const rack = group(
      postPiece(1.3, 0.05, LOG3, 1.25, -1.6), postPiece(1.3, 0.05, LOG3, 2.25, -1.6), along(cyl(0.03, 0.03, 1.1, LOG3, 6, 1.75, 1.25, -1.6), 'x'),
    );
    for (let i = 0; i < 4; i++) rack.add(rot(rbox(0.1, 0.32, 0.05, 0x8aa0a8, 0.03, 1.4 + i * 0.24, 1.0, -1.6), 0, 0, 0.1));
    g.add(rack);
  }
  if (st === 5) {
    // Cabane de pecheur sur pilotis, a droite ; nasses, bouees, filet.
    const hut = new THREE.Group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) hut.add(postPiece(1.0, 0.07, LOG, 2.2 + sx * 0.75, 0.7 + sz * 0.6, -0.5));
    hut.add(plank(1.8, 0.08, 1.5, C.wood, 2.2, 0.52, 0.7));
    for (let i = 0; i < 4; i++) hut.add(plank(1.6, 0.3, 0.06, [BOARD, BOARD2, BOARD3][i % 3]!, 2.2, 0.72 + i * 0.31, 0.05), plank(0.06, 0.3, 1.3, [BOARD2, BOARD3, BOARD][i % 3]!, 2.98, 0.72 + i * 0.31, 0.7));
    hut.add(box(0.06, 1.24, 1.3, BOARD, 1.42, 1.18, 0.7));
    const roof = tinRoof(2.1, 1.8, 0x3f6a8a, 0x5f8a85);
    roof.position.set(2.2, 1.9, 0.7);
    roof.rotation.x = 0.15;
    hut.add(roof);
    hut.add(box(0.5, 0.4, 0.04, 0x2e3439, 2.2, 1.25, 1.36), plank(0.12, 0.06, 1.0, BOARD2, 1.15, 0.5, 0.7));
    g.add(hut);
    // Nasses empilees au bout du ponton, bouees rouges et blanches dans l'eau.
    g.add(group(
      rbox(0.4, 0.3, 0.3, 0x8a7a5a, 0.05, -0.45, 0.25, -0.6), rbox(0.36, 0.28, 0.3, 0x7a6a4a, 0.05, -0.45, 0.55, -0.6),
      sphere(0.14, 0xc9412f, -1.6, 0.02, 2.4, 8), sphere(0.13, 0xeeeee6, 0.9, 0.02, 2.8, 8), sphere(0.13, 0xc9412f, 2.4, 0.02, 2.2, 8),
    ));
  }
  return { group: hidden(g, L.dock.x, L.dock.z) };
}

// ---------------------------------------------------------------- la carriere

/**
 * La carriere, en cinq aspects : pioche et brouette, appentis a outils, cabane et treuil,
 * concasseur et blocs tailles, grue de levage et wagonnet sur rails.
 */
export function quarryShed(stage = 3): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  if (st >= 3) {
    // Le treuil : chevalet de rondins, poulie, corde, bloc de pierre suspendu.
    const winch = new THREE.Group();
    for (const s of [-1, 1]) {
      const leg = logPiece(3.6, 0.11, s < 0 ? LOG : LOG2, s * 0.9, 1.7, 0);
      leg.rotation.z = s * 0.25;
      winch.add(leg);
    }
    const strut = logPiece(3.46, 0.09, LOG3, 0, 1.71, -0.25);
    strut.rotation.x = 0.145;
    winch.add(strut, along(logPiece(1.3, 0.11, LOG2, 0, 3.42, 0), 'x'));
    winch.add(along(cyl(0.13, 0.13, 0.08, IRON, 8, 0, 3.2, 0), 'z'), cyl(0.02, 0.02, 2.07, C.rope, 8, 0, 2.165, 0));
    winch.add(along(rcyl(0.14, 0.14, 0.55, C.rope, 0.2, 0.62, 0.55, -0.3), 'x'), plank(0.08, 0.6, 0.3, BOARD2, 0.3, 0.3, -0.3), plank(0.08, 0.6, 0.3, BOARD2, 0.94, 0.3, -0.3));
    winch.add(box(0.05, 0.3, 0.05, IRON, 1.0, 0.68, -0.3));
    g.add(winch);
    g.add(part(0.8, rbox(0.45, 0.36, 0.45, C.stone, 0.08, 0, 0.95, 0), torus(0.06, 0.02, IRON, 0, 1.17, 0)));
    // La cabane : bardage de planches, porte, fenetre, toit de tole.
    const shed = group(box(2.2, 1.8, 1.6, C.woodDark, -2.4, 0.9, 0.6));
    for (let i = 0; i < 7; i++) shed.add(plank(0.3, 1.8, 0.05, [BOARD, BOARD2, BOARD3][i % 3]!, -3.3 + i * 0.3, 0.9, 1.425));
    for (let i = 0; i < 5; i++) shed.add(plank(0.05, 1.8, 0.32, [BOARD2, BOARD3, BOARD][i % 3]!, -1.275, 0.9, -0.04 + i * 0.32));
    shed.add(plankDoor(0.62, 1.4, -1.9, 0.02, 1.48, LOG3));
    shed.add(box(0.46, 0.36, 0.04, 0x2e3439, -2.95, 1.2, 1.45), windowFrame(0.46, 0.36, -2.95, 1.2, 1.47));
    g.add(shed);
    const roof = tinRoof(2.7, 2.1, st === 5 ? 0x8a949c : C.rust, 0x8a8f91);
    roof.position.set(-2.4, 1.88, 0.6);
    roof.rotation.x = -0.06;
    g.add(roof);
  } else if (st === 2) {
    // Appentis : trois poteaux, toit de tole, ratelier d'outils, etabli de pierre.
    g.add(group(postPiece(1.9, 0.07, LOG, -3.3, 1.3), postPiece(1.9, 0.07, LOG2, -1.4, 1.3), postPiece(1.5, 0.07, LOG3, -3.3, -0.1), postPiece(1.5, 0.07, LOG, -1.4, -0.1)));
    const roof = tinRoof(2.4, 1.8, C.rust, 0x8a8f91);
    roof.position.set(-2.35, 1.75, 0.6);
    roof.rotation.x = -0.25;
    g.add(roof);
    g.add(group(plank(1.6, 0.08, 0.6, BOARD2, -2.35, 0.75, 0.2), plank(0.1, 0.75, 0.5, LOG3, -3.0, 0.37, 0.2), plank(0.1, 0.75, 0.5, LOG3, -1.7, 0.37, 0.2),
      rbox(0.4, 0.3, 0.3, C.stone, 0.06, -2.5, 0.94, 0.2), box(0.3, 0.05, 0.05, IRON, -2.0, 0.82, 0.25)));
  } else {
    // Bache tendue sur deux perches, une pioche plantee dans un bloc.
    const t = tarp(1.8, 1.4, 0x6f7a4a, 0);
    t.position.set(-2.4, 1.25, 0.5);
    t.rotation.x = -0.3;
    g.add(t, group(postPiece(1.4, 0.05, LOG3, -3.2, 1.1), postPiece(1.4, 0.05, LOG3, -1.6, 1.1)));
    g.add(group(rbox(0.6, 0.45, 0.5, C.stone, 0.1, -0.4, 0.22, 0.3), rot(cyl(0.025, 0.025, 0.9, CUT, 8, -0.4, 0.8, 0.3), 0, 0, 0.4), rot(box(0.5, 0.06, 0.06, IRON, -0.6, 1.2, 0.3), 0, 0, 0.5)));
  }
  // Outils appuyes, brouette chargee de pierres, tas de cailloux.
  if (st >= 2) {
    const pick = group(cyl(0.025, 0.025, 1.0, CUT, 8, 0, 0.5, 0), rot(box(0.5, 0.06, 0.06, IRON, 0, 0.98, 0), 0, 0, 0.12));
    pick.position.set(-1.16, 0, 0.15);
    pick.rotation.z = 0.2;
    const shovel = group(cyl(0.025, 0.025, 1.0, BOARD3, 8, 0, 0.62, 0), plank(0.03, 0.28, 0.2, C.metal, 0, 0.1, 0));
    shovel.position.set(-1.18, 0, -0.1);
    shovel.rotation.z = 0.18;
    g.add(group(pick, shovel));
  }
  const barrow = group(
    rbox(0.9, 0.32, 0.6, 0x5a6e3a, 0.08, 1.75, 0.5, 1.2),
    torus(0.17, 0.05, 0x2b2b2b, 2.3, 0.22, 1.2),
    blob(0.12, C.stone, 1.6, 0.7, 1.15), blob(0.11, 0x85837b, 1.85, 0.69, 1.28), blob(0.1, 0xa8a59b, 1.9, 0.7, 1.08),
    plank(0.04, 0.3, 0.04, IRON, 1.45, 0.17, 1.0), plank(0.04, 0.3, 0.04, IRON, 1.45, 0.17, 1.4),
  );
  for (const s of [-1, 1]) barrow.add(rot(cyl(0.025, 0.025, 0.85, BOARD2, 8, 1.3, 0.48, 1.2 + s * 0.21), 0, 0, Math.PI / 2 - 0.25));
  g.add(barrow);
  g.add(group(
    blob(0.22, C.stone, 0.9, 0.12, 0.9), blob(0.18, 0x85837b, 1.2, 0.1, 0.7), blob(0.15, 0xa8a59b, 0.7, 0.1, 1.15),
    blob(0.13, C.stone, 1.05, 0.3, 0.85),
  ));
  if (st >= 4) {
    // Concasseur : tremie sur pieds, caisson, volant ; blocs tailles empiles et cercles.
    g.add(group(
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.1, 1.3, 0.1, STEEL, 2.0 + sx * 0.45, 0.65, -1.0 + sz * 0.4))),
      rbox(1.1, 0.6, 0.95, 0xe8b84a, 0.06, 2.0, 1.4, -1.0), rcone(0.75, 0.6, 0x9aa3aa, 0.12, 2.0, 2.0, -1.0),
      rot(cyl(0.32, 0.32, 0.1, IRON, 12, 2.6, 1.4, -1.0), 0, 0, Math.PI / 2), box(0.5, 0.05, 0.5, 0x85837b, 2.0, 0.1, -1.0),
    ));
    const blocks = new THREE.Group();
    for (let i = 0; i < 6; i++) blocks.add(box(0.5, 0.36, 0.4, [C.stone, 0xa8a59b, 0x9a9890][i % 3]!, 0.2 + (i % 3) * 0.52, 0.18 + Math.floor(i / 3) * 0.37, -1.6));
    blocks.add(box(1.62, 0.04, 0.04, 0x8a6a48, 0.72, 0.6, -1.39));
    g.add(blocks);
  }
  if (st === 5) {
    // Grue de levage : mat d'acier, fleche, cable et crochet ; rails et wagonnet de pierres.
    g.add(group(
      box(0.24, 5.2, 0.24, 0xe8b84a, 3.4, 2.6, 0.6), box(0.5, 0.2, 0.5, 0x55595c, 3.4, 0.1, 0.6),
      rot(box(0.18, 0.18, 4.2, 0xe8b84a, 3.4, 5.0, -1.0), -0.35, 0, 0), rot(box(0.05, 0.05, 2.6, IRON, 3.4, 5.3, 0.3), 0.6, 0, 0),
      cyl(0.015, 0.015, 3.0, C.metal, 4, 3.4, 4.0, -2.9), rbox(0.5, 0.36, 0.4, C.stone, 0.06, 3.4, 2.35, -2.9), torus(0.08, 0.02, IRON, 3.4, 2.6, -2.9),
    ));
    const rails = new THREE.Group();
    for (const sz of [-0.3, 0.3]) rails.add(box(4.0, 0.05, 0.06, 0x6a7076, 0.6, 0.06, 2.4 + sz));
    for (let i = 0; i < 9; i++) rails.add(box(0.12, 0.04, 0.9, LOG3, -1.4 + i * 0.5, 0.02, 2.4));
    rails.add(rbox(0.8, 0.5, 0.6, 0x5a6066, 0.06, 1.2, 0.42, 2.4), blob(0.18, C.stone, 1.1, 0.72, 2.35), blob(0.15, 0xa8a59b, 1.35, 0.7, 2.45));
    for (const sx of [-0.25, 0.25]) for (const sz of [-0.3, 0.3]) rails.add(rot(cyl(0.1, 0.1, 0.05, 0x2b2b2b, 10, 1.2 + sx, 0.14, 2.4 + sz), Math.PI / 2, 0, 0));
    g.add(rails);
  }
  return { group: hidden(g, L.quarryShed.x, L.quarryShed.z, 0.4) };
}

// ---------------------------------------------------------------- la fonderie

const KILN: Profile = [[0, 0], [1.15, 0], [1.18, 0.04], [1.18, 0.3], [1.13, 0.36], [1.1, 1.15], [1.0, 1.55], [0.78, 1.8], [0.46, 1.93], [0, 1.96]];
const BARREL: Profile = [[0, 0], [0.28, 0], [0.3, 0.03], [0.3, 0.68], [0.28, 0.7], [0.26, 0.66], [0, 0.66]];

/**
 * La fonderie, en cinq aspects : bas fourneau d'argile et soufflet, four de briques en plein
 * air, halle d'acier, creuset au palan et lingotieres, usine (murs de tole, haute cheminee,
 * pont roulant jaune).
 */
export function foundry(stage = 3): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  let mouth: THREE.Mesh;
  if (st >= 3) {
    // Halle d'acier : poteaux, poutres, jambes de force, toit de tole grise rapiecee.
    const frame = new THREE.Group();
    for (const s of [-1, 1]) for (const t of [-1, 1]) {
      const h = t > 0 ? 2.785 : 3.045;
      frame.add(box(0.16, h, 0.16, st === 5 ? 0xe8b84a : t > 0 ? STEEL : 0x55595c, s * 1.9, h / 2, t * 1.3));
      frame.add(rot(box(0.08, 0.6, 0.08, STEEL, s * 1.68, h - 0.3, t * 1.3), 0, 0, s * 0.8));
    }
    frame.add(box(4.0, 0.14, 0.14, 0x55595c, 0, 2.715, 1.3), box(4.0, 0.14, 0.14, 0x55595c, 0, 2.975, -1.3));
    g.add(frame);
    const roof = tinRoof(4.6, 3.4, STEEL, C.rust);
    roof.position.y = 2.95;
    roof.rotation.x = 0.1;
    g.add(roof);
  }
  if (st === 1) {
    // Bas fourneau d'argile, soufflet de cuir, ferraille en tas.
    const clay = new THREE.Color(0xb07a52);
    const soot = new THREE.Color(0x5e3426);
    const k = paint(lathe(KILN, C.white, -0.6, 0, 0), 'kilnclay', (_x, y, _z, out) => { out.copy(clay).lerp(soot, Math.max(0, Math.min(1, (y - 1.2) / 0.7))); });
    k.scale.set(0.55, 0.75, 0.55);
    g.add(group(k, cyl(0.16, 0.2, 0.3, 0x8a5a3a, 8, -0.6, 1.55, 0)));
    g.add(group(rbox(0.5, 0.16, 0.34, 0x6a4a30, 0.05, 0.3, 0.12, 0.5), rot(rbox(0.5, 0.05, 0.34, 0x8a6a48, 0.02, 0.3, 0.26, 0.5), 0, 0, 0.2),
      rot(cyl(0.04, 0.04, 0.6, 0x3a3d40, 6, -0.05, 0.2, 0.4), 0, 0, Math.PI / 2 - 0.3)));
    mouth = box(0.3, 0.24, 0.06, fireMat, -0.6, 0.3, 0.62);
  } else {
    // Le four : briques, soubassement de pierre, suie vers le haut, cerclages de fer.
    const brick = new THREE.Color(0xa8553a);
    const soot = new THREE.Color(0x5e3426);
    const base = new THREE.Color(C.concreteDark);
    g.add(group(
      paint(lathe(KILN, C.white, -0.6, 0, 0), 'kiln', (_x, y, _z, out) => {
        if (y < 0.33) out.copy(base);
        else out.copy(brick).lerp(soot, Math.max(0, Math.min(1, (y - 1.25) / 0.7)));
      }),
      cyl(1.14, 1.14, 0.07, IRON, 8, -0.6, 0.62, 0), cyl(1.13, 1.13, 0.07, IRON, 8, -0.6, 1.0, 0),
      box(0.76, 0.08, 0.1, IRON, -0.6, 0.88, 1.19), box(0.08, 0.5, 0.1, IRON, -0.94, 0.6, 1.17), box(0.08, 0.5, 0.1, IRON, -0.26, 0.6, 1.17),
      rot(plank(0.5, 0.42, 0.04, IRON, -0.02, 0.6, 1.3), 0, -1.1),
    ));
    // La cheminee : brique, puis tuyau d'acier coiffe (tres haute a l'usine).
    if (st === 5) {
      g.add(part(1.6,
        cyl(0.5, 0.62, 6.2, 0x9a4a32, 10, -0.6, 4.7, -0.3),
        ...[2.6, 4.2, 5.8, 7.5].map((y) => cyl(y > 7 ? 0.52 : 0.6 - (y - 2.6) * 0.02, y > 7 ? 0.52 : 0.6 - (y - 2.6) * 0.02, 0.12, 0xeeeee6, 10, -0.6, y, -0.3)),
        cyl(0.55, 0.55, 0.2, IRON, 10, -0.6, 7.85, -0.3),
      ));
    } else {
      g.add(part(1.6,
        cyl(0.36, 0.4, 1.4, 0x8a4a32, 8, -0.6, 2.3, -0.3),
        ...(st >= 3 ? [cyl(0.25, 0.27, 1.5, STEEL, 8, -0.6, 3.7, -0.3), cyl(0.28, 0.28, 0.06, IRON, 8, -0.6, 3.3, -0.3), rcone(0.36, 0.2, IRON, 0.3, -0.6, 4.55, -0.3)]
          : [rcone(0.42, 0.2, IRON, 0.3, -0.6, 3.1, -0.3)]),
      ));
    }
    mouth = box(0.6, 0.45, 0.06, fireMat, -0.6, 0.6, 1.16);
  }
  g.add(mouth);
  // L'enclume sur sa souche, le bac de trempe.
  g.add(group(
    rcyl(0.24, 0.28, 0.6, LOG, 0.3, 1.2, 0.3, 0.2), cyl(0.21, 0.21, 0.02, CUT, 8, 1.2, 0.6, 0.2),
    box(0.22, 0.12, 0.16, IRON, 1.2, 0.66, 0.2), box(0.5, 0.14, 0.22, 0x46494d, 1.2, 0.79, 0.2),
    rot(cone(0.07, 0.24, IRON, 7, 1.56, 0.8, 0.2), 0, 0, -Math.PI / 2),
  ));
  if (st >= 2) {
    const water = new THREE.Color(0x3f6a8a);
    const metal = new THREE.Color(0x55595c);
    g.add(group(
      paint(lathe(BARREL, C.white, 1.75, 0, 0.95), 'quench', (x, y, z, out) => {
        out.copy(y < 0.665 && y > 0.6 && Math.hypot(x, z) < 0.265 ? water : metal);
      }),
      cyl(0.31, 0.31, 0.05, IRON, 8, 1.75, 0.18, 0.95), cyl(0.31, 0.31, 0.05, IRON, 8, 1.75, 0.55, 0.95),
    ));
  }
  // Les lingots : de plus en plus nombreux.
  const ingots = group(plank(0.8, 0.1, 0.6, BOARD2, 0.5, 0.05, 1.15));
  const n = st === 1 ? 1 : st === 2 ? 2 : st === 3 ? 5 : 9;
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / 4);
    const b = box(0.32, 0.1, 0.14, i % 3 ? 0xb8bec4 : 0xc9cfd4, 0.32 + (i % 2) * 0.36, 0.15 + layer * 0.1, 1.0 + (Math.floor(i / 2) % 2) * 0.3);
    if (layer % 2) b.rotation.y = Math.PI / 2;
    ingots.add(b);
  }
  g.add(ingots);
  const coal = blob(st === 1 ? 0.35 : 0.6, 0x34312e, 1.4, 0.15, -0.9);
  coal.scale.y = 0.4;
  g.add(group(coal, blob(0.14, 0x2b2b2b, 0.85, 0.08, -0.6), blob(0.12, 0x3a3632, 1.95, 0.07, -0.55), blob(0.1, 0x2b2b2b, 1.6, 0.28, -0.75)));
  if (st >= 4) {
    // Creuset rougeoyant au palan, lingotieres alignees.
    g.add(part(1.2,
      box(0.12, 0.12, 2.6, 0x55595c, 0.6, 2.62, 0), box(0.3, 0.2, 0.3, 0xe8b84a, 0.6, 2.45, 0.2),
      cyl(0.012, 0.012, 1.0, C.metal, 4, 0.6, 1.85, 0.2),
      rcyl(0.28, 0.22, 0.42, 0x3a3d40, 0.06, 0.6, 1.2, 0.2), cyl(0.24, 0.24, 0.03, 0xff8a2a, 10, 0.6, 1.42, 0.2),
    ));
    for (let i = 0; i < 4; i++) g.add(group(rbox(0.36, 0.12, 0.2, 0x46494d, 0.03, -1.4 + i * 0.42, 0.06, 1.75), box(0.28, 0.02, 0.12, 0xb8bec4, -1.4 + i * 0.42, 0.125, 1.75)));
  }
  if (st === 5) {
    // Murs de tole au fond et sur un cote, pont roulant, bandes de danger.
    const back = tinSheet(3.8, 2.6, 0x7a8288);
    back.position.set(0, 0, -1.32);
    const side = tinSheet(2.5, 2.4, 0x6f777e);
    side.position.set(1.92, 0, 0);
    side.rotation.y = Math.PI / 2;
    g.add(group(back, side));
    g.add(part(2.5, box(4.2, 0.2, 0.2, 0xe8b84a, 0, 2.5, -0.6), ...Array.from({ length: 7 }, (_, i) => box(0.3, 0.205, 0.205, i % 2 ? 0x2b2b2b : 0xe8b84a, -1.8 + i * 0.6, 2.5, -0.6))));
    g.add(at(drum(0x3f6a8a), -1.6, 0, -0.7), at(drum(0xc9412f), -1.9, 0, 0.0));
  }
  return {
    group: hidden(g, L.foundry.x, L.foundry.z),
    glowMats: [fireMat],
    live: [mouth],
    anim: (_dt, t, busy) => { fireMat.emissiveIntensity = busy ? 1.2 + Math.sin(t * 16) * 0.3 : 0.25; },
  };
}

// ---------------------------------------------------------------- la fonderie de pierre (briqueterie)

/** Rangees de briques crues qui sechent au sol, ou empilees sur palette. */
function brickPile(x: number, z: number, layers: number, raw: boolean): THREE.Group {
  const g = new THREE.Group();
  const tones = raw ? [0xb08a62, 0xa07a54, 0xbc966c] : [0xa8553a, 0x9a4a32, 0xb8623f];
  if (!raw) g.add(plank(1.0, 0.12, 0.8, BOARD2, x, 0.06, z));
  for (let l = 0; l < layers; l++) for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const b = box(0.3, 0.1, 0.15, tones[(i + j + l) % 3]!, x - 0.32 + i * 0.32, (raw ? 0.05 : 0.17) + l * 0.11, z - 0.2 + j * 0.4);
    if (l % 2) b.rotation.y = Math.PI / 2;
    g.add(b);
  }
  return g;
}

/**
 * La fonderie de pierre, bâtie dans l'angle de l'immeuble effondre (ses deux murs gardent leur
 * place : z = -2 au fond, x = -2.7 a gauche, en coordonnees locales). Cinq aspects : fosse et
 * moules, four de briques, briqueterie, fours jumeaux, fonderie industrielle.
 */
export function brickworks(stage = 1): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  const BR = [0xa8553a, 0x9a4a32, 0xb8623f];
  const CON = [0xb8b4aa, 0xa8a49a, 0xc4c0b6];
  // Les deux murs de l'angle : beton casse et nettoye, rapieces de briques, puis tout en briques.
  const wallH = st === 1 ? 1.0 : st === 2 ? 1.6 : st === 5 ? 3.0 : 2.2;
  const walls = new THREE.Group();
  const r = rng(77);
  const run = (x0: number, z0: number, len: number, axis: 'x' | 'z') => {
    const n = Math.round(len / 0.8);
    for (let i = 0; i < n; i++) {
      const h = st === 1 ? wallH * (0.6 + r() * 0.6) : wallH;
      const brick = st >= 3 || (st === 2 && r() < 0.5);
      const c = brick ? BR[i % 3]! : CON[i % 3]!;
      const px = axis === 'x' ? x0 + (i + 0.5) * (len / n) : x0;
      const pz = axis === 'z' ? z0 + (i + 0.5) * (len / n) : z0;
      walls.add(box(axis === 'x' ? len / n + 0.01 : 0.45, h, axis === 'z' ? len / n + 0.01 : 0.45, c, px, h / 2, pz));
      // Joints clairs des briques (deux bandes de mortier par segment).
      if (brick) for (const y of [h * 0.33, h * 0.66]) walls.add(box(axis === 'x' ? len / n + 0.02 : 0.47, 0.04, axis === 'z' ? len / n + 0.02 : 0.47, 0xd8ccb8, px, y, pz));
      // Fenetres de l'usine.
      if (st === 5 && i % 3 === 1) walls.add(box(axis === 'x' ? 0.5 : 0.48, 0.6, axis === 'z' ? 0.5 : 0.48, 0x2e3439, px, 1.8, pz));
    }
  };
  run(-2.7, -2.0, 8.0, 'x');
  run(-2.7, -2.0, 7.0, 'z');
  if (st >= 3) walls.add(box(8.1, 0.12, 0.55, 0xb8b0a0, 1.35, wallH + 0.06, -2.0), box(0.55, 0.12, 7.1, 0xb8b0a0, -2.7, wallH + 0.06, 1.5));
  g.add(walls);
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  const live: THREE.Object3D[] = [];
  // Le four : tas de briques cuit en meule (fosse), dome de briques (ensuite), deux domes (fours jumeaux).
  const kiln = (x: number, z: number, s: number) => {
    const dome = paint(lathe(KILN, C.white, x, 0, z), 'brickkiln', (_x, y, _z, out) => {
      out.setHex(y < 0.33 ? 0x8a8780 : y > 1.5 ? 0x5e3426 : 0xa8553a);
    });
    dome.scale.set(s, s, s);
    g.add(group(dome));
    const mouth = box(0.5 * s, 0.4 * s, 0.06, fireMat, x, 0.45 * s, z + 1.13 * s);
    g.add(mouth);
    live.push(mouth);
  };
  if (st === 1) {
    // Fosse a argile, moules de bois, briques crues qui sechent, meule de cuisson fumante.
    const pit = blob(0.9, 0x6a4a30, -0.6, 0.02, 0.4);
    pit.scale.set(1.2, 0.12, 0.9);
    g.add(group(pit, ...[0, 1, 2].map((i) => box(0.5, 0.08, 0.3, BOARD2, 0.8 + i * 0.55, 0.04, -0.6))));
    g.add(brickPile(1.2, 0.6, 1, true), brickPile(2.4, 0.6, 1, true));
    const mound = new THREE.Group();
    for (let l = 0; l < 4; l++) for (let i = 0; i < 6 - l; i++) mound.add(box(0.3, 0.12, 0.6, BR[(i + l) % 3]!, -1.6 + l * 0.15 + i * 0.32, 0.06 + l * 0.13, -1.0));
    g.add(mound);
    const fire = box(0.5, 0.25, 0.06, fireMat, -0.85, 0.15, -0.68);
    g.add(fire);
    live.push(fire);
  } else {
    kiln(-1.2, -0.6, st === 2 ? 0.75 : 0.9);
    if (st >= 4) kiln(1.4, -0.7, 0.85);
    // Cheminee : de plus en plus haute.
    const ch = st === 2 ? 2.2 : st === 3 ? 3.6 : st === 4 ? 5.0 : 7.5;
    g.add(part(1.2, cyl(0.32, 0.4, ch, 0x9a4a32, 10, -1.9, ch / 2, -1.4), ...(st === 5 ? [3.0, 5.0, 7.0].map((y) => cyl(0.36 - y * 0.008, 0.36 - y * 0.008, 0.14, 0xeeeee6, 10, -1.9, y, -1.4)) : [])));
    // Etagere de sechage et palettes de briques cuites.
    g.add(group(
      ...[-1, 1].flatMap((s) => [box(0.06, 1.3, 0.06, C.woodDark, 2.2 + s * 0.6, 0.65, 0.6), box(0.06, 1.3, 0.06, C.woodDark, 2.2 + s * 0.6, 0.65, 1.0)]),
      plank(1.3, 0.05, 0.5, BOARD2, 2.2, 0.5, 0.8), plank(1.3, 0.05, 0.5, BOARD3, 2.2, 1.0, 0.8),
      ...[0, 1, 2].map((i) => box(0.3, 0.1, 0.15, 0xb08a62, 1.8 + i * 0.4, 0.58, 0.8)), ...[0, 1, 2].map((i) => box(0.3, 0.1, 0.15, 0xa07a54, 1.8 + i * 0.4, 1.08, 0.8)),
    ));
    g.add(brickPile(3.8, -0.9, st >= 4 ? 4 : 2, false));
    if (st >= 3) g.add(brickPile(3.8, 0.4, st >= 4 ? 3 : 1, false));
  }
  if (st >= 3) {
    // Appentis de tole au fond (toit complet pour l'usine).
    const roof = tinRoof(st === 5 ? 7.6 : 4.4, 2.6, st === 5 ? 0x8a949c : C.rust, 0x8a8f91);
    roof.position.set(st === 5 ? 1.2 : -0.6, wallH + 0.1, -0.85);
    roof.rotation.x = -0.12;
    g.add(roof, group(postPiece(wallH, 0.07, LOG2, st === 5 ? 4.9 : 1.6, 0.4), postPiece(wallH, 0.07, LOG, -2.2, 0.4)));
  }
  if (st >= 4) {
    // Presse a briques : bati d'acier, levier, bac d'argile ; lampes au mur.
    g.add(group(
      box(0.9, 0.8, 0.6, 0x5a6066, 0.3, 0.4, 0.8), box(0.08, 1.0, 0.08, IRON, 0.65, 1.2, 0.8), rot(box(0.06, 0.9, 0.06, 0xc9412f, 0.4, 1.6, 0.8), 0, 0, 0.9),
      rbox(0.7, 0.3, 0.5, 0x6a4a30, 0.05, -0.4, 0.15, 1.1),
    ));
    g.add(part(1.8, ...[-0.5, 2.5].map((x) => sphere(0.08, 0xfff0c0, x, 1.95, -1.72, 6))));
  }
  if (st === 5) {
    // Chariot elevateur jaune et sa palette, rampe de convoyeur jusqu'au four.
    g.add(group(
      rbox(0.8, 0.6, 1.2, 0xe8b84a, 0.08, 2.8, 0.5, 2.6), box(0.6, 0.5, 0.5, 0x2e3439, 2.8, 1.0, 2.4),
      box(0.06, 1.6, 0.06, 0x3a3d40, 2.55, 0.8, 1.95), box(0.06, 1.6, 0.06, 0x3a3d40, 3.05, 0.8, 1.95),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => rot(cyl(0.16, 0.16, 0.12, 0x2b2b2b, 10, 2.8 + sx * 0.38, 0.16, 2.6 + sz * 0.4), 0, 0, Math.PI / 2))),
    ));
    g.add(brickPile(2.8, 1.55, 2, false));
    g.add(rot(box(2.6, 0.08, 0.5, 0x55595c, -0.1, 0.9, 0.9), 0, 0.2, 0.3));
  }
  return {
    group: hidden(g, L.brickworks.x, L.brickworks.z),
    glowMats: [fireMat],
    live,
    anim: (_dt, t, busy) => { fireMat.emissiveIntensity = busy ? 1.2 + Math.sin(t * 14) * 0.3 : 0.25; },
  };
}

// ---------------------------------------------------------------- batiments des extensions du camp

/**
 * Une maison d'artisan, en cinq aspects : cabane de planches sous bache, cabane basse de
 * rondins, maison de rondins, maison a veranda et jardinet, maison a etage et balcon.
 */
export function cabin(x: number, z: number, ry: number, roofTone: number, stage = 3): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  const wm = winMat();
  const lit: THREE.Mesh[] = [];
  if (st === 1) {
    // Cabane de planches clouees, bache tendue en guise de toit, couchage dehors.
    const walls = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const c = [BOARD, BOARD2, BOARD3][i % 3]!;
      walls.add(plank(2.4, 0.3, 0.08, c, 0, 0.16 + i * 0.31, -0.85), plank(0.08, 0.3, 1.7, c, -1.2, 0.16 + i * 0.31, 0), plank(0.08, 0.3, 1.7, c, 1.2, 0.16 + i * 0.31, 0));
      if (i > 3) walls.add(plank(2.4, 0.3, 0.08, c, 0, 0.16 + i * 0.31, 0.85));
      else walls.add(plank(0.9, 0.3, 0.08, c, -0.75, 0.16 + i * 0.31, 0.85), plank(0.7, 0.3, 0.08, c, 0.85, 0.16 + i * 0.31, 0.85));
    }
    g.add(walls);
    const t = tarp(2.9, 2.2, mixHex(roofTone, 0x6f7a4a, 0.5), 0);
    t.position.y = 1.72;
    t.rotation.x = 0.12;
    g.add(t);
    g.add(group(rot(rcyl(0.13, 0.13, 0.75, 0xb0605a, 0.05, -0.4, 0.13, 1.4), 0, 0.3, Math.PI / 2), at(crate(0.4), 1.0, 0, 1.3, 0.4)));
    return { group: hidden(g, x, z, ry) };
  }
  // Murs de rondins croises aux angles : 4 rangs (cabane basse), 6 (maison), 10 (a etage).
  const tones = [LOG, LOG2, LOG3];
  const rows = st === 2 ? 4 : st === 5 ? 10 : 6;
  const top = 0.18 + rows * 0.32;
  const halves = st === 5 ? 3 : 2;
  const per = Math.ceil(rows / halves);
  for (let h = 0; h < halves; h++) {
    const walls = new THREE.Group();
    walls.position.y = h * per * 0.32;
    for (let i = h * per; i < Math.min(rows, (h + 1) * per); i++) {
      const y = 0.18 + i * 0.32 - walls.position.y;
      for (const s of [-1, 1]) {
        if (i >= 6) {
          // L'etage : bardage de planches peintes (plus leger que les rondins).
          const c = [CREAM, 0xe0d4b8, 0xd4c8a8][(i + (s > 0 ? 0 : 1)) % 3]!;
          walls.add(plank(2.9, 0.31, 0.1, c, 0, y, s * 1.05), plank(0.1, 0.31, 2.2, c, s * 1.4, y, 0));
        } else {
          walls.add(along(logPiece(3.0, 0.155, tones[(i + (s > 0 ? 0 : 1)) % 3]!, 0, y, s * 1.1), 'x'));
          walls.add(along(logPiece(2.4, 0.155, tones[(i + (s > 0 ? 2 : 1)) % 3]!, s * 1.45, y + 0.16, 0), 'z'));
        }
      }
    }
    g.add(walls);
  }
  // Toit : a un pan pour la cabane basse, a deux pans sinon (faitiere, cheminee).
  if (st === 2) {
    const r = tinRoof(3.4, 2.7, roofTone, mixHex(roofTone, 0x8a8f91, 0.5));
    r.position.set(0, top + 0.12, 0);
    r.rotation.x = 0.12;
    g.add(r);
  } else {
    // Le toit pose sur les murs (comme avant les niveaux : 2,45 m pour six rangs).
    const ry0 = top + 0.35;
    g.add(part(ry0 - 0.25,
      along(logPiece(1.4, 0.14, LOG2, 1.45, ry0 - 0.2, 0), 'z'), along(logPiece(1.4, 0.14, LOG, -1.45, ry0 - 0.2, 0), 'z'),
      along(logPiece(0.5, 0.14, LOG3, 1.45, ry0 + 0.08, 0), 'z'), along(logPiece(0.5, 0.14, LOG2, -1.45, ry0 + 0.08, 0), 'z'),
    ));
    for (const s of [-1, 1]) {
      const r = tinRoof(3.5, 1.6, roofTone, s > 0 ? mixHex(roofTone, 0x8a8f91, 0.5) : 0);
      r.position.set(0, ry0, s * 0.65);
      r.rotation.x = s * 0.55;
      g.add(r);
    }
    g.add(part(ry0 - 0.15,
      along(rcyl(0.075, 0.075, 3.56, mixHex(roofTone, 0x000000, 0.25), 0.5, 0, ry0 + 0.44, 0), 'x'),
      cyl(0.12, 0.12, 1.2, 0x55595c, 8, -0.9, ry0 + 0.45, -0.4), cyl(0.135, 0.135, 0.05, IRON, 8, -0.9, ry0 + 0.7, -0.4),
      rcone(0.2, 0.14, IRON, 0.3, -0.9, ry0 + 1.12, -0.4),
    ));
  }
  // Porte, marche, fenetre et sa jardiniere.
  g.add(group(
    plankDoor(0.7, 1.3, 0.5, 0.02, 1.3, BOARD2),
    plank(0.86, 0.1, 0.1, C.woodDark, 0.5, 1.38, 1.3),
    plank(0.95, 0.12, 0.26, BOARD3, 0.5, 0.06, 1.39),
  ));
  const win = box(0.55, 0.45, 0.05, wm, -0.7, 1.15, 1.28);
  g.add(win);
  lit.push(win);
  g.add(part(0.9, windowFrame(0.55, 0.45, -0.7, 1.15, 1.3), ...(st >= 3 ? [flowerBox(0.6, -0.7, 0.82, 1.37)] : [])));
  if (st >= 4) {
    // Veranda : plancher, deux poteaux, auvent ; jardinet et barriere blanche, boite aux lettres.
    g.add(group(
      ...Array.from({ length: 5 }, (_, i) => plank(0.6, 0.08, 0.95, [BOARD, BOARD2, BOARD3][i % 3]!, -1.2 + i * 0.6, 0.08, 1.75)),
      postPiece(st === 5 ? 2.2 : 1.8, 0.06, LOG2, -1.35, 2.15), postPiece(st === 5 ? 2.2 : 1.8, 0.06, LOG, 1.35, 2.15),
    ));
    if (st === 4) {
      const aw = tinRoof(3.0, 1.0, roofTone);
      aw.position.set(0, 1.85, 1.75);
      aw.rotation.x = 0.3;
      g.add(aw);
    }
    // Jardinet sur le cote (devant, c'est la zone ⬆️ et le passage).
    const garden = new THREE.Group();
    for (let i = 0; i < 5; i++) garden.add(box(0.04, 0.5, 0.07, 0xeeeee6, 2.3, 0.25, -0.9 + i * 0.5));
    garden.add(box(0.03, 0.05, 2.1, 0xeeeee6, 2.3, 0.4, 0.1));
    for (let i = 0; i < 4; i++) garden.add(puff(0.17, [0x7fae4f, 0x6f9a42][i % 2]!, 1.92, 0.17, -0.75 + i * 0.55), sphere(0.06, [0xe8584a, 0xf2c94c, 0xd98ad0, 0xffffff][i]!, 1.95, 0.36, -0.72 + i * 0.55, 6));
    garden.add(box(0.05, 0.9, 0.05, C.woodDark, 2.0, 0.45, 1.5), rbox(0.3, 0.18, 0.2, 0x3f6a8a, 0.04, 2.0, 0.95, 1.5));
    g.add(garden);
  }
  if (st === 5) {
    // Balcon a l'etage (sur les poteaux de la veranda), deuxieme fenetre, panneau solaire.
    g.add(part(2.0,
      plank(3.0, 0.1, 1.0, BOARD2, 0, 2.2, 1.75),
      ...Array.from({ length: 9 }, (_, i) => box(0.05, 0.55, 0.05, C.woodDark, -1.4 + i * 0.35, 2.5, 2.22)), box(3.0, 0.06, 0.06, BOARD3, 0, 2.78, 2.22),
    ));
    const win2 = box(0.55, 0.45, 0.05, wm, 0.5, 2.75, 1.28);
    g.add(win2, part(2.5, windowFrame(0.55, 0.45, 0.5, 2.75, 1.3)));
    lit.push(win2);
    const solar = group(box(1.0, 0.05, 0.7, IRON, 0, 0, 0), plank(0.92, 0.04, 0.62, 0x2d4a6e, 0, 0.03, 0));
    solar.position.set(0.7, top + 0.34, 0.7);
    solar.rotation.x = 0.55;
    g.add(solar);
  }
  return { group: hidden(g, x, z, ry), glowMats: [wm], live: lit };
}

/** L'armurerie : un atelier blinde, ratelier d'armes, cible d'entrainement. */
/** Une arme posee au ratelier (face vers +z), crosse en bas. */
function rackGun(kind: string): THREE.Group {
  if (kind === 'shotgun') {
    return group(
      box(0.09, 0.62, 0.07, 0x2b2b2b, 0, 0.5, 0), box(0.07, 0.18, 0.09, 0x6a4a30, 0, 0.62, 0.01),
      plank(0.12, 0.32, 0.08, 0x7a5236, 0, 0.16, 0),
    );
  }
  if (kind === 'crossbow') {
    return group(
      plank(0.08, 0.7, 0.07, 0x6a4a30, 0, 0.36, 0),
      rot(box(0.62, 0.05, 0.05, 0x3a3d40, 0, 0.62, 0.02), 0, 0, 0.12), rot(box(0.62, 0.05, 0.05, 0x3a3d40, 0, 0.62, 0.02), 0, 0, -0.12),
      cyl(0.006, 0.006, 0.6, 0xe8e2d0, 4, 0, 0.6, 0.05),
    );
  }
  return group(box(0.06, 0.75, 0.06, 0x2b2b2b, 0, 0.55, 0), plank(0.1, 0.36, 0.08, BOARD2, 0, 0.18, 0));
}

/**
 * L'armurerie, en cinq aspects : caisse d'armes sous bache, cabane renforcee, blockhaus,
 * blockhaus fortifie, bunker. Le ratelier montre les armes possedees.
 */
export function armory(x: number, z: number, stage = 3, owned: string[] = ['rifle']): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  if (st === 1) {
    // Bache sur deux perches, caisses d'armes, sacs de sable en U.
    g.add(group(
      postPiece(1.9, 0.06, LOG3, -1.3, 0.9), postPiece(1.9, 0.06, LOG3, 1.3, 0.9),
      postPiece(1.3, 0.06, LOG3, -1.3, -0.9), postPiece(1.3, 0.06, LOG3, 1.3, -0.9),
    ));
    const t = tarp(2.9, 2.1, 0x6f7a4a, 0);
    t.position.y = 1.62;
    t.rotation.x = -0.28;
    g.add(t);
    g.add(group(
      plank(1.1, 0.42, 0.6, C.olive, -0.5, 0.21, -0.2), box(1.12, 0.06, 0.62, 0xe8b84a, -0.5, 0.3, -0.2),
      plank(0.7, 0.34, 0.5, 0x5f6a3e, 0.65, 0.17, -0.3), rot(plank(0.6, 0.3, 0.44, C.olive, 0.6, 0.49, -0.3), 0, 0.25),
    ));
    g.add(at(sandbags(2.6, 1, 43), 0, 0, -1.35), at(sandbags(1.8, 1, 44), -1.7, 0, 0, Math.PI / 2), at(sandbags(1.8, 1, 45), 1.7, 0, 0, Math.PI / 2));
  } else if (st === 2) {
    // Cabane de planches doublee de toles, toit plat, petite meurtriere.
    const walls = new THREE.Group();
    for (let i = 0; i < 6; i++) walls.add(plank(3.0, 0.34, 0.1, [BOARD, BOARD2, BOARD3][i % 3]!, 0, 0.18 + i * 0.35, -1.0));
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) walls.add(plank(0.1, 0.34, 2.0, [BOARD2, BOARD3, BOARD][i % 3]!, s * 1.45, 0.18 + i * 0.35, 0));
    for (let i = 0; i < 6; i++) if (i !== 3) {
      walls.add(plank(1.05, 0.34, 0.1, [BOARD3, BOARD, BOARD2][i % 3]!, -0.95, 0.18 + i * 0.35, 1.0), plank(1.05, 0.34, 0.1, [BOARD3, BOARD, BOARD2][i % 3]!, 0.95, 0.18 + i * 0.35, 1.0));
    } else walls.add(plank(0.5, 0.34, 0.1, BOARD2, -0.65, 0.18 + i * 0.35, 1.0), plank(0.5, 0.34, 0.1, BOARD2, 0.65, 0.18 + i * 0.35, 1.0));
    walls.add(box(0.8, 0.12, 0.05, 0x2a2a2a, 0, 1.23, 1.04));
    walls.add(at(tinSheet(1.0, 1.0, 0x8a9097), -0.9, 0.2, 1.07));
    g.add(walls);
    const roof = tinRoof(3.3, 2.4, 0x6a737b);
    roof.position.y = 2.12;
    roof.rotation.x = 0.06;
    g.add(roof);
    g.add(plankDoor(0.8, 1.6, 0.6, 0, 1.06, 0x5a4636));
    g.add(at(sandbags(2.2, 1, 47), -0.2, 0, 1.6));
  } else if (st === 3 || st === 4) {
    // Le blockhaus : caisson, toles ondulees, plaques rapportees, poteaux d'angle.
    g.add(group(
      box(3.4, 2.4, 2.4, 0x6f777e, 0, 1.2, 0),
      corrugated(3.3, 2.3, 0x77808a, 0, 1.2, 1.235, 15),
      rot(corrugated(2.3, 2.3, 0x6a737b, 1.735, 1.2, 0, 10), 0, Math.PI / 2), rot(corrugated(2.3, 2.3, 0x6a737b, -1.735, 1.2, 0, 10), 0, Math.PI / 2),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.16, 2.44, 0.16, 0x55595c, sx * 1.7, 1.22, sz * 1.2))),
      rot(plank(0.8, 0.6, 0.04, 0x8a9097, -1.2, 1.6, 1.29), 0, 0, 0.06), rot(plank(0.6, 0.5, 0.04, 0x9c5a3a, 1.2, 0.7, 1.29), 0, 0, -0.08),
    ));
    g.add(part(2.4, box(3.6, 0.16, 2.6, 0x55595c, 0, 2.48, 0)));
    g.add(at(sandbags(3.0, st === 4 ? 2 : 1, 47), 0, 2.56, 1.0));
    if (st === 4) {
      g.add(at(sandbags(3.0, 2, 48), 0, 2.56, -1.0));
      // Filet de camouflage sur le toit, mitrailleuse sur trepied.
      const r = rng(7);
      const net = new THREE.Group();
      for (let i = 0; i < 10; i++) {
        const b = blob(0.32 + r() * 0.15, mixHex(0x5f6a3e, 0x7a7f4a, r()), -1.4 + r() * 2.8, 2.6, -0.6 + r() * 1.2);
        b.scale.set(1.3, 0.25, 1.1);
        net.add(b);
      }
      g.add(part(2.5, ...net.children.slice()));
      g.add(part(2.6,
        ...[0, 1, 2].map((i) => rot(cyl(0.02, 0.02, 0.5, IRON, 6, -0.9 + Math.cos(i * 2.1) * 0.15, 2.78, Math.sin(i * 2.1) * 0.15), Math.sin(i * 2.1) * 0.3, 0, -Math.cos(i * 2.1) * 0.3)),
        box(0.14, 0.14, 0.4, 0x2b2b2b, -0.9, 3.05, 0.1), rot(cyl(0.025, 0.025, 0.6, 0x2b2b2b, 6, -0.9, 3.07, 0.55), Math.PI / 2),
      ));
    }
    // Double porte d'acier, barre, bandes de danger ; enseigne rouge a la mire blanche.
    const door = group(
      plank(0.68, 1.9, 0.07, 0x3a3d40, -0.35, 0.95, 1.29), plank(0.68, 1.9, 0.07, 0x44474b, 0.35, 0.95, 1.29),
      box(1.3, 0.08, 0.05, C.metal, 0, 1.0, 1.345),
    );
    for (let i = 0; i < 5; i++) door.add(box(0.27, 0.16, 0.03, i % 2 ? 0x2b2b2b : 0xe8b84a, -0.56 + i * 0.28, 0.14, 1.34));
    g.add(door);
    g.add(part(1.9,
      plank(1.6, 0.4, 0.06, RED, 0, 2.15, 1.3),
      torus(0.12, 0.022, C.white, 0, 2.15, 1.34), box(0.34, 0.03, 0.02, C.white, 0, 2.15, 1.345), box(0.03, 0.34, 0.02, C.white, 0, 2.15, 1.345),
    ));
  } else {
    // Le bunker : beton aux aretes adoucies, meurtrieres, porte blindee a volant, antenne.
    g.add(group(
      rbox(3.6, 2.3, 2.6, 0x8f9194, 0.25, 0, 1.15, 0),
      rbox(3.9, 0.35, 2.9, 0x82848a, 0.15, 0, 2.38, 0),
      ...[-1, 1].map((s) => box(0.9, 0.14, 0.05, 0x1e1e1e, s * 1.1, 1.65, 1.31)),
      ...[-1, 1].map((s) => rot(box(0.9, 0.14, 0.05, 0x1e1e1e, s * 1.81, 1.65, 0), 0, Math.PI / 2)),
      box(3.62, 0.12, 0.04, 0xe8b84a, 0, 0.3, 1.31),
    ));
    g.add(group(
      rbox(1.1, 1.9, 0.12, 0x4a4f54, 0.04, 0, 0.95, 1.33),
      torus(0.18, 0.03, C.metal, 0, 1.05, 1.42), box(0.4, 0.03, 0.03, C.metal, 0, 1.05, 1.42), box(0.03, 0.4, 0.03, C.metal, 0, 1.05, 1.42),
    ));
    g.add(part(2.5,
      cyl(0.035, 0.035, 2.2, 0x55595c, 6, 1.3, 3.6, -0.8), torus(0.12, 0.015, 0x55595c, 1.3, 4.2, -0.8),
      plank(0.2, 0.3, 0.04, RED, 1.42, 4.5, -0.8),
    ));
    g.add(at(sandbags(3.2, 2, 49), 0, 2.56, -0.9), at(sandbags(1.4, 1, 50), -1.2, 2.56, 1.0));
    g.add(at(concertina(3.4), 0, 0, 2.3));
    g.add(part(1.9,
      plank(1.6, 0.4, 0.06, RED, 0, 2.05, 1.32),
      torus(0.12, 0.022, C.white, 0, 2.05, 1.36), box(0.34, 0.03, 0.02, C.white, 0, 2.05, 1.365), box(0.03, 0.34, 0.02, C.white, 0, 2.05, 1.365),
    ));
  }
  // Ratelier : les armes que tu possedes, de plus en plus fourni.
  const rx = st === 1 ? 1.75 : st === 2 ? 1.85 : st === 5 ? 2.15 : 1.75;
  const rack = group(
    plank(0.08, 1.45, 0.08, C.woodDark, rx, 0.72, 0.62), plank(0.08, 1.45, 0.08, C.woodDark, rx + 0.8, 0.72, 0.62),
    plank(0.9, 0.1, 0.28, C.woodDark, rx + 0.4, 0.25, 0.6), plank(0.9, 0.1, 0.28, C.woodDark, rx + 0.4, 1.3, 0.6),
  );
  const guns = ['rifle', ...['shotgun', 'crossbow'].filter((k) => owned.includes(k))];
  guns.forEach((k, i) => {
    const gun = rackGun(k);
    gun.position.set(rx + 0.15 + i * 0.25, 0.2, 0.6);
    gun.rotation.z = -0.15;
    rack.add(gun);
  });
  if (st >= 4) rack.add(box(0.92, 0.05, 0.3, 0xe8b84a, rx + 0.4, 1.38, 0.6));
  g.add(rack);
  if (st >= 2) g.add(at(sandbags(1.6, st >= 4 ? 3 : 2, 41), -0.9, 0, 2.0));
  // Cible sur chevalet, caisses de munitions (plus nombreuses avec l'armurerie).
  const target = group(
    cyl(0.45, 0.45, 0.06, C.white, 8, 0, 0, 0), cyl(0.32, 0.32, 0.07, RED, 8, 0, 0, 0),
    cyl(0.18, 0.18, 0.08, C.white, 8, 0, 0, 0), cyl(0.08, 0.08, 0.09, RED, 8, 0, 0, 0),
  );
  target.rotation.x = Math.PI / 2;
  target.position.set(-2.4, 1.1, -0.4);
  g.add(target, group(
    rot(plank(0.08, 1.15, 0.08, C.woodDark, -2.62, 0.55, -0.45), 0, 0, -0.12), rot(plank(0.08, 1.15, 0.08, C.woodDark, -2.18, 0.55, -0.45), 0, 0, 0.12),
  ));
  if (st >= 2) {
    g.add(group(
      plank(0.6, 0.32, 0.4, C.olive, 1.15, 0.16, 1.75), box(0.62, 0.06, 0.42, 0xe8b84a, 1.15, 0.22, 1.75),
      rot(plank(0.55, 0.28, 0.36, 0x5f6a3e, 1.1, 0.46, 1.72), 0, 0.2),
    ));
  }
  if (st >= 4) g.add(group(plank(0.6, 0.32, 0.4, C.olive, 1.8, 0.16, 1.6), at(drum(0x5f6a3e, false), -2.3, 0, 0.9)));
  return { group: hidden(g, x, z, -Math.PI / 2) };
}

/** Tente « cloche » : mur droit, bande rouge a l'avant-toit, toit conique, sommet rouge. */
const TENT: Profile = [
  [0, 0], [1.5, 0], [1.56, 0.04], [1.56, 0.95], [1.62, 1.0], [1.58, 1.04], [1.52, 1.09], [1.15, 1.45], [0.7, 1.85], [0.32, 2.15],
  [0.2, 2.22], [0.1, 2.28], [0, 2.3],
];

/** L'infirmerie : tente a croix rouge, lits de camp, caisses de soins. */
export function infirmary(x: number, z: number): Building {
  const g = new THREE.Group();
  const canvas = new THREE.Color(0xe8e2d0);
  const roofC = new THREE.Color(0xf2ecdc);
  const red = new THREE.Color(RED);
  const tent = paint(lathe(TENT, C.white), 'tent', (_x, y, _z, out) => {
    out.copy(y < 0.97 ? canvas : y < 1.06 ? red : y > 2.19 ? red : roofC);
  });
  tent.scale.set(1.3, 1, 1);
  g.add(tent);
  // L'entree : ouverture sombre, pans releves, auvent sur deux mats.
  g.add(group(
    box(0.8, 0.92, 0.05, 0x5a5040, 0, 0.46, 1.565),
    rot(plank(0.26, 0.92, 0.04, 0xd9d0b8, -0.52, 0.46, 1.6), 0, 0.4), rot(plank(0.26, 0.92, 0.04, 0xd9d0b8, 0.52, 0.46, 1.6), 0, -0.4),
    postPiece(0.98, 0.04, LOG3, -0.6, 2.0), postPiece(0.98, 0.04, LOG3, 0.6, 2.0),
  ));
  const porch = group(plank(1.35, 0.04, 0.62, 0xe8e2d0, 0, 0, 0), plank(1.35, 0.12, 0.03, RED, 0, -0.06, 0.31));
  porch.position.set(0, 1.06, 1.76);
  porch.rotation.x = 0.25;
  g.add(porch);
  // La croix rouge, couchee sur la pente avant du toit (visible d'en haut).
  const cross = group(box(0.8, 0.1, 0.22, RED, 0, 0, 0), box(0.22, 0.1, 0.8, RED, 0, 0, 0));
  cross.position.set(0, 1.65, 0.97);
  cross.rotation.x = 0.727;
  g.add(cross);
  g.add(part(2.2, cyl(0.025, 0.025, 0.4, C.metal, 8, 0, 2.45, 0), plank(0.32, 0.2, 0.02, C.white, 0.17, 2.55, 0)));
  // Lits de camp : cadre, toile olive, couverture, oreiller.
  for (let i = 0; i < 2; i++) {
    const cz = -0.8 + i * 1.6;
    g.add(group(
      plank(0.7, 0.08, 1.6, 0x6f7a4a, 2.1, 0.4, cz),
      ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.05, 0.36, 0.05, C.woodDark, 2.1 + sx * 0.3, 0.18, cz + sz * 0.7))),
      plank(0.72, 0.07, 0.8, i ? 0x6f8fb0 : 0xb0605a, 2.1, 0.47, cz + 0.35),
      rbox(0.55, 0.12, 0.32, C.white, 0.05, 2.1, 0.5, cz - 0.55),
    ));
  }
  // Caisses de soins, panneau a croix.
  g.add(at(crate(0.5, C.white), -2.0, 0, 0.8), group(box(0.3, 0.03, 0.09, RED, -2.0, 0.515, 0.8), box(0.09, 0.03, 0.3, RED, -2.0, 0.515, 0.8)));
  g.add(group(
    plank(0.07, 1.3, 0.07, C.woodDark, 1.05, 0.65, 1.95),
    plank(0.5, 0.5, 0.04, C.white, 1.05, 1.2, 1.99), box(0.32, 0.09, 0.02, RED, 1.05, 1.2, 2.015), box(0.09, 0.32, 0.02, RED, 1.05, 1.2, 2.015),
  ));
  return { group: hidden(g, x, z, Math.PI / 2) };
}

/** L'entrepot : un grand hangar de tole plein de caisses. */
export function warehouse(x: number, z: number): Building {
  const g = new THREE.Group();
  const frame = new THREE.Group();
  for (const s of [-1, 1]) for (const t of [-1, 1]) frame.add(postPiece(t < 0 ? 2.94 : 2.72, 0.12, t < 0 ? LOG : LOG2, s * 2.2, t * 1.5));
  for (const t of [-1, 1]) frame.add(along(logPiece(4.7, 0.1, LOG3, 0, t < 0 ? 2.84 : 2.66, t * 1.5), 'x'));
  for (const s of [-1, 1]) for (const t of [-1, 1]) frame.add(rot(plank(0.08, 0.7, 0.1, BOARD2, s * 1.95, t < 0 ? 2.6 : 2.37, t * 1.5), 0, 0, s * 0.8));
  g.add(frame);
  // Le mur du fond et un bout de mur lateral : toles de recuperation de trois couleurs.
  const back = new THREE.Group();
  [0xa5603a, 0x8a8f91, 0x5f8a85].forEach((c, i) => {
    const s = tinSheet(1.55, 2.85, c);
    s.position.set(-1.45 + i * 1.45, 0, -1.56 - (i % 2) * 0.03);
    s.rotation.z = (i - 1) * 0.02;
    back.add(s);
  });
  const side = tinSheet(1.5, 2.8, 0x9c4a3c);
  side.position.set(-2.25, 0, -0.7);
  side.rotation.y = Math.PI / 2;
  back.add(side);
  g.add(back);
  const roof = tinRoof(5.2, 3.8, C.rust, 0x8a8f91);
  roof.position.y = 2.9;
  roof.rotation.x = 0.06;
  g.add(roof);
  // Palettes, caisses empilees, futs, sacs, un tas bache.
  g.add(group(
    plank(2.3, 0.12, 0.85, BOARD2, -1.05, 0.06, -0.6), plank(1.0, 0.12, 0.85, BOARD, 0.6, 0.06, -0.6),
  ));
  for (let i = 0; i < 6; i++) g.add(at(crate(0.6, i % 2 ? C.wood : C.woodLight), -1.6 + (i % 3) * 1.1, 0.12 + Math.floor(i / 3) * 0.6, -0.6, i * 0.4));
  g.add(at(drum(0x3f6a8a), 1.8, 0, 0.6), at(drum(0x8a3f30), 1.2, 0, 0.9));
  const sack2 = lathe(SACK, 0xc9b48a, 1.75, 0.3, -0.55);
  sack2.rotation.set(0.3, 0, Math.PI / 2);
  g.add(group(lathe(SACK, C.canvas, 1.55, 0, -1.05), lathe(SACK, 0xd2c094, 2.0, 0, -1.0), sack2));
  const heap = blob(0.55, C.tarp, -1.5, 0.28, 0.9);
  heap.scale.set(1.3, 0.62, 0.85);
  g.add(group(heap, along(cyl(0.03, 0.03, 1.5, C.rope, 8, -1.5, 0.52, 0.9), 'x')));
  return { group: hidden(g, x, z) };
}

// ---------------------------------------------------------------- le bus

/** Le bus : epave rouillee au depart, il se refait une beaute a chaque etape. */
export class Bus {
  readonly root = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly rustBits: THREE.Object3D[] = [];
  private readonly wheels: THREE.Object3D[] = [];
  readonly lights: THREE.Sprite[] = [];
  private readonly smoke: THREE.Mesh[] = [];
  stage = 0;
  driving = 0;

  constructor(scene: THREE.Scene) {
    const g = this.root;
    const bodyMat = uniqueMat(0x9a6a3a);
    this.body = rbox(6.4, 2.0, 2.3, bodyMat, 0.3, 0, 1.45, 0);
    g.add(this.body);
    // La caisse : bas de caisse, vitres, pare-brise, liseres, pare-chocs, phares, galerie.
    // Tout ce qui ne change pas est fusionne en un seul maillage.
    const glass = 0x4a5d6e;
    const shell = group(
      rbox(6.45, 0.25, 2.35, 0x4a3a2e, 0.08, 0, 0.6, 0),
      box(0.06, 0.9, 1.9, glass, 3.2, 1.75, 0), box(0.06, 0.7, 1.9, glass, -3.2, 1.85, 0),
      box(0.22, 0.26, 2.42, 0x3a3d40, 3.27, 0.62, 0), box(0.22, 0.26, 2.42, 0x3a3d40, -3.27, 0.62, 0),
      box(0.05, 0.38, 1.0, 0x3a3d40, 3.22, 1.0, 0),
    );
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) shell.add(box(0.9, 0.7, 0.05, glass, -2.4 + i * 1.15, 1.85, s * 1.16));
    for (const s of [-1, 1]) {
      shell.add(box(5.7, 0.14, 0.03, CREAM, 0, 1.33, s * 1.165));
      shell.add(along(cyl(0.17, 0.17, 0.08, CREAM, 8, 3.22, 1.0, s * 0.8), 'x'), along(cyl(0.2, 0.2, 0.05, IRON, 8, 3.2, 1.0, s * 0.8), 'x'));
      shell.add(box(0.08, 0.3, 0.12, IRON, 3.3, 1.9, s * 1.3), box(0.04, 0.04, 0.2, IRON, 3.25, 1.9, s * 1.2));
      shell.add(box(1.25, 0.5, 0.03, 0x2a2622, -2.1, 0.87, s * 1.16), box(1.25, 0.5, 0.03, 0x2a2622, 2.1, 0.87, s * 1.16));
      shell.add(plank(4.0, 0.06, 0.06, IRON, -0.2, 2.53, s * 0.85));
    }
    for (let i = 0; i < 4; i++) shell.add(plank(0.06, 0.06, 1.76, IRON, -1.8 + i * 1.1, 2.5, 0));
    shell.add(
      rbox(0.8, 0.4, 0.5, 0x8a5a3a, 0.08, -1.2, 2.75, 0.35), rbox(0.6, 0.32, 0.45, 0x5f7a8a, 0.08, -1.3, 2.71, -0.3),
      along(rcyl(0.2, 0.2, 1.4, C.tarp, 0.4, 0.4, 2.76, 0), 'z'), plank(0.6, 0.45, 0.6, C.wood, 1.3, 2.78, 0.1),
    );
    g.add(mergeColored(shell));
    for (const [wx, wz] of [[-2.1, 1.1], [2.1, 1.1], [-2.1, -1.1], [2.1, -1.1]] as const) {
      const w = mergeColored(group(
        rcyl(0.5, 0.5, 0.35, 0x2a2a2a, 0.4, 0, 0, 0),
        cyl(0.27, 0.27, 0.37, 0x9aa0a3, 8, 0, 0, 0),
        cyl(0.1, 0.1, 0.39, 0x55595c, 8, 0, 0, 0),
      ));
      w.position.set(wx, 0.5, wz);
      w.rotation.x = Math.PI / 2;
      w.scale.z = 0.75;
      g.add(w);
      this.wheels.push(w);
    }
    // Rouille, vegetation et planches clouees qui disparaitront avec les reparations.
    const rust = group(
      puff(0.6, C.leaf, -1.5, 2.55, 0.4, 2), puff(0.5, C.leafDark, 1.2, 2.55, -0.5, 3), blob(0.45, C.leafLight, 2.8, 1.0, 1.1),
      puff(0.28, C.leafSun, -1.0, 2.6, -0.4, 1), blob(0.2, C.leaf, -2.9, 2.4, 1.0),
      box(1.2, 0.6, 0.05, C.rustDark, 0.4, 1.2, 1.185), box(0.9, 0.5, 0.05, C.rustDark, -2.2, 1.0, -1.185),
      box(0.7, 0.4, 0.05, 0xa5603a, 1.6, 1.0, 1.185),
      rot(plank(1.1, 0.16, 0.05, BOARD2, -1.25, 1.95, 1.2), 0, 0, 0.12), rot(plank(1.05, 0.16, 0.05, BOARD, -1.25, 1.75, 1.2), 0, 0, -0.08),
      rot(plank(0.05, 0.16, 1.4, BOARD3, 3.25, 1.85, 0.2), 0.1, 0, 0),
    );
    const rustM = mergeColored(rust);
    g.add(rustM);
    this.rustBits.push(rustM);
    for (const s of [-1, 1]) {
      const l = glow(0xfff2b0, 1.6);
      l.position.set(3.3, 1.0, s * 0.8);
      g.add(l);
      this.lights.push(l);
    }
    for (let i = 0; i < 3; i++) {
      const p = blob(0.25, mat(0x9a9a9a, { opacity: 0.6 }), -3.4, 0.6, 0.7);
      p.visible = false;
      g.add(p);
      this.smoke.push(p);
    }
    shadow(g);
    for (const p of this.smoke) p.castShadow = false;
    g.position.set(L.bus.x, 0, L.bus.z);
    scene.add(g);
  }

  setStage(stage: number): void {
    this.stage = stage;
    if (stage >= 1) for (const s of this.smoke) s.visible = true;
    if (stage >= 2) {
      for (const b of this.rustBits) b.visible = false;
      (this.body.material as THREE.MeshLambertMaterial).color.setHex(0xf2b632);
      for (const w of this.wheels) w.scale.z = 1;
    }
  }

  update(dt: number, time: number): void {
    this.smoke.forEach((p, i) => {
      if (!p.visible) return;
      const k = (time * 0.8 + i / 3) % 1;
      p.position.set(-3.4 - k * 0.8, 0.6 + k * 1.2, 0.7);
      p.scale.setScalar(0.5 + k * 1.5);
    });
    for (const l of this.lights) (l.material as THREE.SpriteMaterial).opacity = this.stage >= 3 ? 0.9 : 0;
    if (this.driving > 0) {
      this.driving += dt;
      const v = Math.min(12, this.driving * 5);
      this.root.position.x += v * dt;
      for (const w of this.wheels) w.rotation.y += v * dt * 2;
    }
  }
}

// ---------------------------------------------------------------- tours en pierre, en fer

const TOWER_STONE = [0x9c988e, 0x8b877d, 0xaaa69b, 0x827e75];
const TOWER_MORTAR = 0x6c685f;
const TOWER_STEEL = 0x50565c;

/**
 * L'habillage d'une tour selon son aspect (1 a 5, un tous les deux niveaux) : bois nu, bois
 * renforce (sacs de sable, contrefiches, fanion), fut de pierre, fut de briques crenele, fut
 * cercle d'acier a parapet blinde, projecteur et mitrailleuse.
 */
export function towerSkin(g: THREE.Object3D, stage: number): void {
  if ((g.userData.skin ?? 0) === stage) return;
  g.userData.skin = stage;
  const old = g.getObjectByName('skin');
  if (old) {
    g.remove(old);
    old.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  }
  if (stage <= 1) return;
  const legH = 4.2;
  const k = new THREE.Group();
  const r = rng(77);
  if (stage === 2) {
    // Bois renforce : sacs de sable autour du plancher, contrefiches, fanion rouge.
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      const sb = sandbags(2.2, 1, 60 + f);
      sb.position.set(Math.sin(a) * 1.05, legH + 0.08, Math.cos(a) * 1.05);
      sb.rotation.y = a + Math.PI / 2;
      k.add(sb);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(rot(plank(0.1, 2.4, 0.1, C.woodDark, sx * 1.0, 1.6, sz * 1.0), sz * 0.25, 0, -sx * 0.25));
    k.add(cyl(0.025, 0.025, 1.6, C.metal, 6, 0.95, legH + 1.6, 0.95), plank(0.5, 0.3, 0.02, 0xc9412f, 1.2, legH + 2.2, 0.95));
  } else {
    // Fut de pierre (ou de briques) : six assises, a peine evase vers le bas, joints en retrait.
    const brick = stage === 4;
    const tones = brick ? [0xa8553a, 0x9a4a32, 0xb8623f, 0x8a4430] : TOWER_STONE;
    const courses = brick ? 12 : 6;
    const h = legH / courses;
    for (let i = 0; i < courses; i++) {
      const w = 2.16 - i * (brick ? 0.02 : 0.04);
      const y = h * (i + 0.5);
      k.add(brick ? box(w, h - 0.04, w, tones[i % 4]!, 0, y, 0) : rbox(w, h - 0.07, w, tones[i % 4]!, 0.07, 0, y, 0));
      k.add(box(w - 0.06, brick ? 0.04 : 0.07, w - 0.06, brick ? 0xd8ccb8 : TOWER_MORTAR, 0, h * (i + 1) - 0.02, 0));
      if (brick) continue;
      // Quelques pierres qui ressortent : la facade n'est pas un aplat.
      for (let f = 0; f < 4; f++) {
        const a = (f * Math.PI) / 2;
        const along = (r() - 0.5) * w * 0.7;
        const out = w / 2 + 0.02;
        const s = blob(0.16 + r() * 0.06, tones[(i + f + 1) % 4]!, Math.cos(a) * out - Math.sin(a) * along, y + (r() - 0.5) * h * 0.4, Math.sin(a) * out + Math.cos(a) * along);
        s.scale.set(1, 0.7, 0.45);
        s.rotation.y = -a;
        k.add(s);
      }
    }
    // Corniche sous le plancher et porte basse cote echelle.
    k.add(rbox(2.5, 0.22, 2.5, brick ? 0xb8b0a0 : TOWER_STONE[2]!, 0.06, 0, legH - 0.14, 0));
    const door = rbox(0.7, 1.1, 0.08, 0x3a2e24, 0.05, 1.07, 0.55, 0.2);
    door.rotation.y = Math.PI / 2;
    k.add(door);
    if (brick) {
      // Creneaux de briques tout autour du plancher.
      for (let f = 0; f < 4; f++) for (let i = 0; i < 3; i++) {
        const a = (f * Math.PI) / 2;
        const along = -0.9 + i * 0.9;
        k.add(box(0.42, 0.55, 0.42, tones[(i + f) % 4]!, Math.sin(a) * 1.15 + Math.cos(a) * along, legH + 0.3, Math.cos(a) * 1.15 - Math.sin(a) * along));
      }
    }
    if (stage === 5) {
      // Cercles d'acier rivetes, et parapet blinde de plaques.
      for (const y of [1.25, 2.85]) {
        k.add(rbox(2.24, 0.14, 2.24, TOWER_STEEL, 0.03, 0, y, 0));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(sphere(0.045, 0x8a9096, sx * 0.9, y, sz * 1.13, 6));
      }
      for (let f = 0; f < 4; f++) {
        const p = rbox(2.72, 0.95, 0.07, f % 2 ? TOWER_STEEL : 0x5e646a, 0.03, 0, legH + 0.62, 0);
        const a = (f * Math.PI) / 2;
        p.position.set(Math.sin(a) * 1.33, legH + 0.62, Math.cos(a) * 1.33);
        p.rotation.y = a;
        k.add(p);
      }
      // Projecteur et mitrailleuse sur leur pied, au bord du parapet.
      k.add(cyl(0.05, 0.05, 0.7, IRON, 6, 0.9, legH + 1.35, -0.9), rot(cyl(0.2, 0.24, 0.3, 0x3a3d40, 10, 0.9, legH + 1.75, -0.9), 0.5, 0, 0), rot(cyl(0.17, 0.17, 0.02, 0xfff0c0, 10, 0.9, legH + 1.84, -0.77), 0.5, 0, 0));
      k.add(cyl(0.05, 0.05, 0.5, IRON, 6, -0.9, legH + 1.25, 0.9), box(0.16, 0.16, 0.45, 0x2b2b2b, -0.9, legH + 1.55, 1.0), rot(cyl(0.03, 0.03, 0.6, 0x2b2b2b, 6, -0.9, legH + 1.57, 1.45), Math.PI / 2, 0, 0));
    }
  }
  const m = mergeColored(k);
  m.name = 'skin';
  m.userData.keep = true;
  g.add(m);
}
// ---------------------------------------------------------------- l'etal et la reserve (a niveaux)

/**
 * L'etal, encastre dans la palissade sud, en cinq aspects : caisses retournees, porte sur
 * des futs, comptoir de planches et fanions, echoppe peinte a enseigne, marche couvert
 * d'acier et d'ampoules. Le plateau reste a 1 m (les bacs y sont poses) et rien ne passe
 * au-dessus du comptoir : la camera voit tout ce qu'on y pose.
 */
export function stallStand(stage = 2): Building {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const { x, z, w: W } = L.stall;
  const g = new THREE.Group();
  const tones = [0xc8a878, 0xbd9c6a, 0xd0b285];
  const hw = W / 2;
  if (st === 1) {
    // Des caisses alignees, deux planches brutes posees dessus.
    const n = 7;
    for (let i = 0; i < n; i++) g.add(at(crate(0.92, [C.wood, C.woodLight, 0x9c6a3e][i % 3]!), -hw + 0.5 + i * ((W - 1.0) / (n - 1)), 0, 0, (i % 2 ? 0.06 : -0.05)));
    g.add(plank(W - 0.2, 0.08, 0.5, tones[0]!, 0, 0.97, -0.24), plank(W - 0.3, 0.08, 0.46, tones[1]!, 0, 0.97, 0.26));
  } else if (st === 2) {
    // Un long plateau sur trois futs, tole de facade.
    for (const sx of [-1, 0, 1]) g.add(at(drum([0x3f6a8a, 0x6f7a4a, 0x8a3f30][sx + 1]!), sx * (hw - 0.5), 0, 0.05));
    for (let i = 0; i < 3; i++) g.add(plank(W - 0.1, 0.1, 0.33, tones[i]!, 0, 1.0, (i - 1) * 0.335));
    g.add(plank(W - 0.2, 0.05, 0.12, 0x8a6a48, 0, 1.06, 0.45));
    const front = sheet(W - 0.3, 0.85, 0x5f8a85);
    front.position.set(0, 0.05, 0.42);
    g.add(front);
  } else {
    // Comptoir de planches : caisson, facade de planches verticales (peinte a partir de l'echoppe).
    const face = st === 3 ? [BOARD, BOARD2, BOARD3] : st === 4 ? [0x4f8a8a, CREAM, 0x5a9696] : [0xc9412f, CREAM, 0xb83a2a];
    g.add(plank(W - 0.2, 0.9, 0.9, C.woodDark, 0, 0.45, 0));
    const nb = Math.round((W - 0.2) / 0.36);
    for (let i = 0; i < nb; i++) g.add(plank((W - 0.2) / nb - 0.02, 0.86, 0.05, face[i % 3]!, -hw + 0.1 + (i + 0.5) * ((W - 0.2) / nb), 0.45, 0.47));
    for (let i = 0; i < 3; i++) g.add(plank(W - 0.1, 0.1, 0.33, st === 5 ? [0xb8b0a0, 0xc8c0b0, 0xaca494][i]! : tones[i]!, 0, 1.0, (i - 1) * 0.335));
    g.add(plank(W, 0.06, 0.1, st === 5 ? STEEL : 0x8a6a48, 0, 1.06, 0.47));
    // Poteaux aux deux bouts, et ce qui pend entre eux (fanions, enseigne, ampoules).
    const postC = st === 5 ? STEEL : st === 4 ? 0x3f6662 : LOG;
    const PH = st === 3 ? 2.4 : 2.9;
    for (const s of [-1, 1]) {
      if (st === 5) g.add(box(0.14, PH, 0.14, postC, s * (hw + 0.1), PH / 2, -0.35), box(0.14, PH, 0.14, postC, s * (hw + 0.1), PH / 2, 0.35));
      else g.add(postPiece(PH, 0.09, postC, s * (hw + 0.1), -0.35));
    }
    if (st === 3) {
      const flags = [0xd9584a, 0xf2c94c, 0x5f9ad0, 0x8cae4f];
      const bunting = new THREE.Group();
      for (let i = 0; i < 16; i++) {
        const fx = -hw + 0.3 + i * ((W - 0.6) / 15);
        const sag = 0.35 * (1 - (fx / hw) ** 2);
        bunting.add(rot(plank(0.2, 0.24, 0.02, flags[i % 4]!, fx, 2.2 - sag, -0.35), 0, 0, i % 2 ? 0.1 : -0.1));
      }
      bunting.add(along(cyl(0.008, 0.008, W + 0.2, 0xe8e2d0, 4, 0, 2.3, -0.35), 'x'));
      g.add(part(1.8, ...bunting.children.slice()));
      g.add(part(1.6, ...[-1, 1].map((s) => rcyl(0.09, 0.09, 0.2, 0xf2c94c, 0.04, s * (hw - 0.3), 1.85, -0.35))));
    } else {
      // Enseigne en haut, a l'arriere : grande planche, bande de couleur, pieces peintes.
      const board = st === 4 ? 0xeee2c6 : 0xffffff;
      const band = st === 4 ? 0x4f8a8a : 0xc9412f;
      g.add(part(2.4,
        plank(W + 0.3, 0.5, 0.08, board, 0, PH - 0.3, -0.4), plank(W + 0.3, 0.1, 0.09, band, 0, PH - 0.5, -0.4),
        plank(W + 0.4, 0.08, 0.14, postC, 0, PH - 0.02, -0.4),
        ...[-2, -1, 0, 1, 2].map((i) => cyl(0.14, 0.14, 0.03, 0xf2c94c, 12, i * 0.9, PH - 0.28, -0.35)).map((c) => rot(c, Math.PI / 2, 0, 0)),
      ));
      // Etageres de bocaux et pots de fleurs aux deux bouts.
      for (const s of [-1, 1]) {
        g.add(group(
          plank(0.5, 0.05, 0.4, BOARD2, s * (hw + 0.45), 0.7, -0.1), plank(0.5, 0.05, 0.4, BOARD3, s * (hw + 0.45), 1.25, -0.1),
          box(0.05, 1.3, 0.05, C.woodDark, s * (hw + 0.68), 0.65, -0.28), box(0.05, 1.3, 0.05, C.woodDark, s * (hw + 0.22), 0.65, -0.28),
          ...[0, 1].map((k) => rcyl(0.07, 0.07, 0.18, [0xd9584a, 0xe8b84a][k]!, 0.03, s * (hw + 0.35 + k * 0.2), 0.82, -0.1)),
          ...[0, 1].map((k) => rcyl(0.06, 0.06, 0.16, [0x8cae4f, 0xe08a3a][k]!, 0.03, s * (hw + 0.35 + k * 0.2), 1.36, -0.1)),
          rcyl(0.16, 0.12, 0.24, 0xb0603a, 0.04, s * (hw + 0.45), 0.12, 0.3), puff(0.2, C.leafLight, s * (hw + 0.45), 0.38, 0.3),
        ));
      }
      if (st === 5) {
        // Guirlande d'ampoules sous l'enseigne, glaciere au bout.
        g.add(part(2.3, ...Array.from({ length: 12 }, (_, i) => {
          const bx = -hw + 0.3 + i * ((W - 0.6) / 11);
          return sphere(0.06, 0xfff0c0, bx, PH - 0.75 - 0.15 * (1 - (bx / hw) ** 2), -0.32, 6);
        })));
        g.add(group(rbox(0.6, 0.5, 0.4, 0x3f78a8, 0.06, hw + 0.45, 0.25, -0.75), box(0.62, 0.08, 0.42, CREAM, hw + 0.45, 0.48, -0.75)));
      }
    }
  }
  // Enseigne peinte, cote route, au bout du comptoir.
  if (st >= 2) g.add(at(paintedBoard('coin'), hw + (st >= 4 ? 1.0 : 0.5), 0, 0.95, -0.15));
  g.position.set(x, 0, z);
  shadow(g);
  return { group: g };
}

/**
 * Autour du coffre de la reserve, en cinq aspects : bache et sacs, futs et caisse, etageres,
 * appentis de bois, conteneur de stockage. Rien devant le coffre (on s'y sert) ni au-dessus.
 */
export function reserveDeco(stage: number): THREE.Group {
  const st = Math.max(1, Math.min(5, Math.round(stage)));
  const g = new THREE.Group();
  g.name = 'reserve-deco';
  if (st === 1) {
    const t = box(2.6, 0.03, 1.9, 0x4f7a8f, 0, 0.015, -0.3);
    t.rotation.y = 0.08;
    g.add(t, lathe(SACK, C.canvas, -1.25, 0, -0.9), lathe(SACK, 0xc9b48a, 1.2, 0, -0.95));
  }
  if (st >= 2) g.add(at(drum(0x8a3f30), -1.35, 0, -0.6), at(crate(0.55, C.woodLight), 1.3, 0, -0.55, 0.3));
  if (st >= 3) {
    // Etageres derriere le coffre (le couvercle s'ouvre devant elles).
    const sh = new THREE.Group();
    for (const sx of [-1, 1]) sh.add(box(0.07, 1.9, 0.07, C.woodDark, sx * 1.2, 0.95, -1.35), box(0.07, 1.9, 0.07, C.woodDark, sx * 1.2, 0.95, -1.75));
    for (const y of [0.5, 1.15, 1.8]) sh.add(plank(2.5, 0.05, 0.5, BOARD2, 0, y, -1.55));
    for (let i = 0; i < 4; i++) sh.add(at(crate(0.4, [C.wood, C.woodLight][i % 2]!), -0.85 + i * 0.56, 0.53, -1.55, i * 0.2));
    for (let i = 0; i < 5; i++) sh.add(rcyl(0.09, 0.09, 0.24, [0xd9584a, 0xe8b84a, 0x8cae4f, 0x5f9ad0, 0xe08a3a][i]!, 0.03, -0.95 + i * 0.48, 1.3, -1.55));
    g.add(sh);
  }
  if (st === 4) {
    // Appentis : mur de planches au fond, toit de tole qui descend vers l'arriere.
    const lean = new THREE.Group();
    for (let i = 0; i < 6; i++) lean.add(plank(2.9, 0.34, 0.08, [BOARD, BOARD2, BOARD3][i % 3]!, 0, 0.18 + i * 0.35, -1.95));
    for (const sx of [-1, 1]) lean.add(postPiece(2.4, 0.07, LOG2, sx * 1.42, -1.1));
    const roof = tinRoof(3.2, 1.3, C.rust, 0x9c4a3c);
    roof.position.set(0, 2.35, -1.55);
    roof.rotation.x = -0.25;
    lean.add(roof);
    g.add(lean);
  }
  if (st === 5) {
    // Conteneur de stockage, porte roulante ouverte ; diable et caisses empilees a cote.
    g.add(group(
      box(3.0, 2.2, 1.2, 0x5f6a3e, 0, 1.1, -2.1), corrugated(2.9, 2.0, 0x6a754a, 0, 1.1, -1.48, 13),
      box(3.04, 0.12, 1.24, 0x4a5430, 0, 2.24, -2.1),
    ));
    g.add(at(crate(0.55), 1.85, 0, -1.0), at(crate(0.5, C.woodLight), 1.85, 0.55, -1.0, 0.3), at(crate(0.55), -1.9, 0, -1.2, 0.2));
    g.add(group(box(0.05, 1.0, 0.05, C.metal, -1.6, 0.5, -0.3), box(0.05, 1.0, 0.05, C.metal, -1.35, 0.5, -0.3), box(0.35, 0.05, 0.3, C.metal, -1.48, 0.03, -0.15),
      rot(cyl(0.1, 0.1, 0.05, 0x2b2b2b, 10, -1.65, 0.1, -0.35), 0, 0, Math.PI / 2), rot(cyl(0.1, 0.1, 0.05, 0x2b2b2b, 10, -1.3, 0.1, -0.35), 0, 0, Math.PI / 2)));
  }
  shadow(g);
  return g;
}

