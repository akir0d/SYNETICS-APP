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
import { crate, drum, gasBottle, sandbags } from './props';

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

export function sawmill(): Building {
  const g = new THREE.Group();
  // Charpente en appentis : poteaux de rondins (plus hauts derriere), sablieres, jambes de force.
  const frame = new THREE.Group();
  for (const s of [-1, 1]) for (const t of [-1, 1]) frame.add(postPiece(t < 0 ? 2.4 : 2.2, 0.13, t < 0 ? LOG : LOG2, s * 1.55, t * 0.8));
  frame.add(along(logPiece(3.5, 0.11, LOG3, 0, 2.1, 0.8), 'x'), along(logPiece(3.5, 0.11, LOG3, 0, 2.28, -0.8), 'x'));
  for (const s of [-1, 1]) for (const t of [-1, 1]) frame.add(rot(plank(0.08, 0.7, 0.1, BOARD2, s * 1.3, t < 0 ? 2.0 : 1.82, t * 0.8), 0, 0, s * 0.8));
  g.add(frame);
  const roof = tinRoof(4.0, 2.5, C.rust, 0x9c4a3c);
  roof.position.y = 2.33;
  roof.rotation.x = 0.12;
  g.add(roof);
  // Le banc de sciage : caisson, pieds, plateau de trois planches, rondin engage, planche sortie.
  g.add(group(
    plank(2.8, 0.66, 1.16, C.woodDark, 0, 0.4, 0),
    ...[-1, 1].flatMap((s) => [-1, 1].map((t) => plank(0.16, 0.86, 0.16, LOG3, s * 1.38, 0.43, t * 0.56))),
    plank(2.9, 0.16, 0.08, BOARD2, 0, 0.72, 0.6),
  ));
  g.add(part(0.9,
    plank(3.2, 0.08, 0.5, C.woodLight, 0, 0.9, -0.5), plank(3.2, 0.08, 0.5, 0xd2a066, 0, 0.9, 0), plank(3.2, 0.08, 0.5, 0xe6b880, 0, 0.9, 0.5),
    along(logPiece(1.0, 0.15, LOG2, -0.95, 1.09, 0), 'x'),
    plank(0.9, 0.06, 0.3, CUT, 0.95, 0.97, 0),
  ));
  // Le moteur : bloc vert, volant, reservoir rouge, pot d'echappement.
  g.add(part(1.0,
    rbox(0.7, 0.5, 0.5, 0x6f8a3a, 0.08, -0.9, 1.19, -0.45),
    along(cyl(0.2, 0.2, 0.08, IRON, 8, -0.9, 1.19, -0.17), 'z'),
    rbox(0.3, 0.18, 0.22, RED, 0.05, -0.75, 1.53, -0.5),
    cyl(0.05, 0.05, 0.45, IRON, 8, -1.12, 1.62, -0.55), rcone(0.08, 0.08, IRON, 0.3, -1.12, 1.88, -0.55),
  ));
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
  blade.position.set(0, 1.15, 0);
  g.add(blade);
  // Rondins a debiter derriere, planches debitees devant, tas de sciure.
  g.add(group(
    along(logPiece(2.4, 0.14, LOG, 0.05, 0.14, -0.85), 'x'), along(logPiece(2.2, 0.14, LOG2, -0.1, 0.14, -1.13), 'x'),
    along(logPiece(2.3, 0.14, LOG3, 0, 0.38, -0.99), 'x'),
    rot(plank(1.3, 0.06, 0.26, CUT, -1.1, 0.03, 0.98), 0, 0.05), rot(plank(1.2, 0.06, 0.26, BOARD3, -1.05, 0.09, 0.97), 0, -0.08),
    rot(plank(1.25, 0.06, 0.26, CUT, -1.12, 0.15, 0.99), 0, 0.12),
  ));
  const dust = blob(0.5, 0xe0c08a, 1.6, 0.05, 0.9);
  dust.scale.set(1.2, 0.3, 0.8);
  const dust2 = blob(0.26, 0xd6b47c, 1.05, 0.04, 1.0);
  dust2.scale.set(1, 0.35, 1);
  g.add(group(dust, dust2));
  return {
    group: hidden(g, L.sawmill.x, L.sawmill.z),
    live: [blade],
    anim: (dt, _t, busy) => { blade.rotation.y += dt * (busy ? 18 : 1.5); },
  };
}

// ---------------------------------------------------------------- la cuisine

const POT: Profile = [[0, 0], [0.32, 0], [0.38, 0.04], [0.42, 0.3], [0.44, 0.5], [0.47, 0.53], [0.46, 0.56], [0.42, 0.55], [0.41, 0.5], [0, 0.5]];

export function kitchen(): Building {
  const g = new THREE.Group();
  // Auvent : poteaux, sablieres suivant la pente, tole verte, fanions.
  const frame = new THREE.Group();
  for (const s of [-1, 1]) for (const t of [-1, 1]) frame.add(postPiece(s < 0 ? 2.36 : 2.58, 0.1, t < 0 ? LOG : LOG2, s * 1.45, t * 0.95));
  for (const t of [-1, 1]) {
    const b = logPiece(3.2, 0.08, LOG3, 0, 2.48, t * 0.95);
    b.rotation.z = Math.PI / 2 + 0.08;
    frame.add(b);
  }
  g.add(frame);
  const roof = tinRoof(3.5, 2.4, 0x5f8a85, 0x7f9a6a);
  roof.position.y = 2.6;
  roof.rotation.z = 0.08;
  g.add(roof);
  const flags = [0xd9584a, 0xf2c94c, 0x5f9ad0, 0x8cae4f];
  const bunting = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const x = -1.2 + i * 0.4;
    const sag = 0.1 * (1 - (x / 1.45) ** 2);
    bunting.add(rot(plank(0.17, 0.19, 0.025, flags[i % flags.length]!, x, 2.48 + x * 0.08 - 0.2 - sag, 1.06), 0, 0, (i % 2 ? 0.08 : -0.08)));
  }
  g.add(part(2.2, ...bunting.children.slice()));
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
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  const fire = box(0.3, 0.22, 0.06, fireMat, -0.5, 0.45, 0.33);
  g.add(fire);
  g.add(part(1.0,
    along(cyl(0.07, 0.07, 0.32, 0x4a4a4a, 8, -0.86, 0.8, -0.2), 'x'),
    cyl(0.1, 0.1, 2.2, 0x4a4a4a, 8, -0.98, 1.85, -0.2),
    cyl(0.115, 0.115, 0.05, 0x2c2e30, 8, -0.98, 1.6, -0.2), cyl(0.115, 0.115, 0.05, 0x2c2e30, 8, -0.98, 2.3, -0.2),
    rcone(0.2, 0.14, 0x2c2e30, 0.3, -0.98, 3.02, -0.2),
  ));
  // La marmite : soupe orange, anses, louche.
  const soup = new THREE.Color(0xe08a3a);
  const iron = new THREE.Color(0x2f2f2f);
  const pot = group(
    paint(lathe(POT, C.white), 'pot', (x, y, z, out) => { out.copy(y < 0.505 && Math.hypot(x, z) < 0.415 && y > 0.45 ? soup : iron); }),
    plank(0.12, 0.05, 0.14, IRON, -0.5, 0.42, 0), plank(0.12, 0.05, 0.14, IRON, 0.5, 0.42, 0),
    rot(cyl(0.02, 0.02, 0.6, C.metal, 8, 0.15, 0.72, 0.12), 0, 0, 0.5),
  );
  pot.position.set(-0.5, 0.98, 0);
  g.add(pot);
  // Le comptoir : caisson cloue, plateau, planche a decouper, pain, legumes.
  g.add(group(
    plank(1.3, 0.82, 0.8, C.woodDark, 0.8, 0.41, 0),
    plank(0.42, 0.74, 0.04, BOARD, 0.38, 0.41, 0.41), plank(0.42, 0.74, 0.04, BOARD3, 0.81, 0.41, 0.41), plank(0.42, 0.74, 0.04, BOARD2, 1.24, 0.41, 0.41),
  ));
  const bread = rcyl(0.11, 0.11, 0.3, 0xd49a52, 0.6, 0.45, 1.01, 0.1);
  bread.rotation.set(Math.PI / 2, 0, 0.3);
  bread.scale.set(1, 1, 0.75);
  g.add(part(0.86,
    plank(1.4, 0.07, 0.9, 0xc8a878, 0.8, 0.86, 0),
    plank(0.42, 0.04, 0.28, CUT, 0.5, 0.915, 0.1),
    bread,
    rot(pill(0.05, 0.05, 0.22, 0xe07a2a, 0.75, 0.95, 0.3), 0, 0, Math.PI / 2), rot(pill(0.05, 0.05, 0.22, 0xe8862e, 0.85, 0.95, 0.27), 0, 0.4, Math.PI / 2),
  ));
  g.add(at(gasBottle(), 1.7, 0, -0.6), at(crate(0.45, C.woodLight), 1.2, 0.9, 0.05, 0.3));
  g.add(part(1.36,
    blob(0.11, 0x8fb35a, 1.12, 1.44, 0.05), blob(0.1, 0x7ea04e, 1.3, 1.43, -0.05),
    rot(cone(0.05, 0.24, 0xff8a2a, 5, 1.2, 1.41, 0.17), 0, 0, 1.4), puff(0.06, C.leafLight, 1.08, 1.43, 0.17),
  ));
  // Poeles et casseroles pendues a une barre, au fond ; un tabouret-souche.
  g.add(part(1.7,
    along(cyl(0.025, 0.025, 2.9, C.metal, 8, 0, 2.05, -0.92), 'x'),
    along(cyl(0.15, 0.15, 0.03, 0x34373a, 8, 0.35, 1.78, -0.9), 'z'), box(0.04, 0.3, 0.03, 0x34373a, 0.35, 2.0, -0.9),
    along(cyl(0.12, 0.12, 0.03, 0xb87a4a, 8, 0.8, 1.8, -0.9), 'z'), box(0.04, 0.25, 0.03, 0xb87a4a, 0.8, 1.98, -0.9),
    box(0.06, 0.32, 0.03, C.metal, 1.15, 1.85, -0.9),
  ));
  g.add(group(rcyl(0.2, 0.22, 0.44, LOG, 0.25, 0.25, 0.22, 0.72), cyl(0.17, 0.17, 0.02, CUT, 8, 0.25, 0.445, 0.72)));
  const steam: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const p = blob(0.16, mat(0xffffff, { opacity: 0.55 }), -0.5, 1.6 + i * 0.3, 0);
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
        p.position.y = 1.55 + k * 1.3;
        p.position.x = -0.5 + Math.sin(t * 2 + i) * 0.15;
        p.scale.setScalar(busy ? 0.6 + k * 1.2 : 0.001);
      });
      fireMat.emissiveIntensity = busy ? 1 + Math.sin(t * 20) * 0.3 : 0.3;
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

export function shelter(): Building {
  const g = new THREE.Group();
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
  // Une vraie porte de planches, une fenetre allumee avec volets et jardiniere.
  g.add(plankDoor(1.0, 1.9, 0.9, 0.02, 1.2, C.wood));
  const wm = winMat();
  const win = box(0.9, 0.6, 0.04, wm, -1.0, 1.5, 1.17);
  g.add(win);
  g.add(part(1.1,
    windowFrame(0.9, 0.6, -1.0, 1.5, 1.19),
    rot(plank(0.42, 0.66, 0.04, 0xb9874a, -1.75, 1.5, 1.3), 0, 0.5), rot(plank(0.42, 0.66, 0.04, 0xa8783e, -0.25, 1.5, 1.3), 0, -0.5),
    flowerBox(0.9, -1.0, 1.04, 1.27),
  ));
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
  g.add(at(sandbags(1.4, 2, 31), -1.4, 0, 2.0));
  // Sur le toit : panneau solaire, citerne, antenne et son panneau jaune.
  const solar = group(box(1.1, 0.06, 0.8, IRON, 0, 0, 0), plank(1.0, 0.04, 0.7, 0x2d4a6e, 0, 0.04, 0), box(0.04, 0.045, 0.7, 0x5a7aa0, 0, 0.05, 0));
  solar.position.set(-0.9, 2.66, -0.25);
  solar.rotation.x = 0.35;
  g.add(solar);
  g.add(part(2.4,
    box(0.08, 0.3, 0.08, IRON, -0.9, 2.55, -0.55),
    rcyl(0.35, 0.35, 0.6, 0x3f6a8a, 0.3, 0.75, 2.71, -0.5), cyl(0.36, 0.36, 0.05, 0x2f5470, 8, 0.75, 2.71, -0.5),
    cyl(0.04, 0.04, 1.4, C.metal, 8, 1.8, 3.0, -0.6), plank(0.6, 0.35, 0.04, 0xe8b84a, 2.1, 3.5, -0.6),
  ));
  g.add(at(crate(0.55), 2.5, 0, 0.9), at(crate(0.45, C.woodLight), 2.5, 0.55, 0.9, 0.4));
  return { group: hidden(g, L.shelter.x, L.shelter.z, -0.5), glowMats: [wm], live: [win] };
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

/** Le moulin de la ferme : il moud le ble et un four accole en fait du pain. */
export function windmill(): Building {
  const g = new THREE.Group();
  const stone = new THREE.Color(C.stone);
  const plaster = new THREE.Color(0xe6dccb);
  const crown = new THREE.Color(C.woodDark);
  const tower = paint(lathe(MILL, C.white), 'mill', (_x, y, _z, out) => { out.copy(y < 0.6 ? stone : y > 4.09 ? crown : plaster); });
  const body = group(tower);
  // Pierres apparentes dans l'enduit : quelques rapiecages.
  for (const [a, y, r] of [[-0.5, 1.3, 0.2], [0.6, 2.2, 0.16], [-0.2, 3.3, 0.14], [1.2, 0.95, 0.18], [-1.1, 2.6, 0.15]] as const) {
    const R = millR(y);
    const b = blob(r, a > 0 ? C.stone : 0x85837b, Math.sin(a) * R, y, Math.cos(a) * R);
    b.rotation.y = a;
    b.scale.set(1.2, 0.8, 0.45);
    body.add(b);
  }
  g.add(body);
  g.add(part(4.24,
    paint(lathe(MILL_CAP, C.white, 0, 4.24, 0), 'millcap', (_x, y, _z, out) => { out.setHex(y > 0.535 && y < 1.0 ? 0xa0573a : 0x8f4a2a); }),
    cyl(0.04, 0.04, 0.4, IRON, 8, 0, 6.05, 0), sphere(0.08, 0xd9b44a, 0, 6.27, 0, 8),
  ));
  // La porte dans son encadrement de pierre, la fenetre allumee.
  g.add(group(
    plank(0.18, 1.55, 0.3, C.stone, -0.5, 0.775, 1.76), plank(0.18, 1.55, 0.3, 0x85837b, 0.5, 0.775, 1.76),
    plank(1.18, 0.2, 0.32, C.stone, 0, 1.55, 1.75),
    plankDoor(0.82, 1.43, 0, 0.02, 1.9, C.woodDark),
  ));
  const wm = winMat();
  const wz = millR(2.8) + 0.02;
  const win = box(0.42, 0.5, 0.05, wm, 0, 2.8, wz);
  g.add(win);
  g.add(part(2.5, windowFrame(0.42, 0.5, 0, 2.8, wz + 0.02)));
  g.add(part(3.8, along(cyl(0.17, 0.17, 0.75, IRON, 8, 0, 4.0, 1.62), 'z')));
  // Les ailes : longerons, cadres et toiles, fusionnes en un seul maillage qui tourne.
  const arms = group(along(cyl(0.2, 0.2, 0.3, 0x3a3a3a, 8, 0, 0, 0), 'z'), sphere(0.13, 0x2c2e30, 0, 0, 0.17, 8));
  for (let i = 0; i < 4; i++) {
    const cloth = i % 2 ? 0xe8e0cc : C.canvas;
    const arm = group(
      plank(0.14, 3.2, 0.1, C.woodDark, 0, 1.7, 0),
      plank(0.5, 2.5, 0.025, cloth, 0.36, 1.95, 0.04),
      plank(0.045, 2.6, 0.05, BOARD2, 0.1, 1.95, 0.06), plank(0.045, 2.6, 0.05, BOARD2, 0.62, 1.95, 0.06),
    );
    for (let k = 0; k < 4; k++) arm.add(plank(0.6, 0.045, 0.05, BOARD2, 0.36, 0.75 + k * 0.8, 0.08));
    if (i === 1) arm.add(plank(0.22, 0.3, 0.03, 0xc9573a, 0.42, 2.4, 0.06));
    arm.rotation.z = (i * Math.PI) / 2;
    arms.add(arm);
  }
  const hub = new THREE.Group();
  hub.position.set(0, 4.0, 2.05);
  hub.add(mergeColored(arms));
  g.add(hub);
  // Le four de brique en dome, sur un socle de pierre ; bois de chauffe, cheminee.
  const dome = lathe(DOME, C.brick, 2.0, 0.34, 0.8);
  dome.scale.set(1.1, 1, 0.92);
  g.add(group(
    plank(1.6, 0.36, 1.3, C.stone, 2.0, 0.18, 0.8),
    dome,
    plank(0.6, 0.1, 0.12, 0x8a4a32, 2.0, 0.72, 1.42), plank(0.1, 0.32, 0.12, 0x8a4a32, 1.74, 0.52, 1.42), plank(0.1, 0.32, 0.12, 0x8a4a32, 2.26, 0.52, 1.42),
  ));
  g.add(part(0.8, plank(0.3, 0.9, 0.3, 0x8a4a32, 2.35, 1.25, 0.5), plank(0.38, 0.08, 0.38, IRON, 2.35, 1.72, 0.5)));
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  const fire = box(0.42, 0.3, 0.06, fireMat, 2.0, 0.52, 1.43);
  g.add(fire);
  g.add(group(
    along(logPiece(0.5, 0.07, LOG, 2.55, 0.07, 1.6), 'x'), along(logPiece(0.5, 0.07, LOG2, 2.58, 0.07, 1.75), 'x'),
    along(logPiece(0.5, 0.07, LOG3, 2.56, 0.2, 1.67), 'x'),
  ));
  // Sacs de farine, gerbe de ble, caisse.
  const lying = lathe(SACK, 0xc9b48a, -1.9, 0.33, 0.3);
  lying.rotation.set(0, 0.4, Math.PI / 2);
  g.add(group(
    lathe(SACK, C.canvas, -2.2, 0, -0.4), lying,
    rcyl(0.15, 0.2, 0.7, 0xd9b24a, 0.3, -2.4, 0.35, 0.75), cyl(0.16, 0.16, 0.06, 0xb08a3a, 8, -2.4, 0.4, 0.75),
  ));
  g.add(at(crate(0.5, C.woodLight), -1.9, 0, 1.2));
  return {
    group: hidden(g, L.mill.x, L.mill.z),
    glowMats: [fireMat, wm],
    live: [hub, fire, win],
    anim: (dt, t, busy) => {
      hub.rotation.z -= dt * (busy ? 1.6 : 0.25);
      fireMat.emissiveIntensity = busy ? 1 + Math.sin(t * 18) * 0.3 : 0.2;
    },
  };
}

// ---------------------------------------------------------------- le ponton

const BUCKET: Profile = [[0, 0], [0.15, 0], [0.17, 0.02], [0.2, 0.3], [0.21, 0.32], [0.19, 0.32], [0.18, 0.28], [0, 0.28]];

/** Le ponton de l'etang : on y peche. */
export function dock(): Building {
  const g = new THREE.Group();
  const posts = new THREE.Group();
  for (let i = 0; i < 3; i++) for (const sx of [-0.6, 0.6]) posts.add(postPiece(0.6, 0.1, i % 2 ? 0x5e452c : 0x6a4e32, sx, -1.2 + i * 1.3, -0.1));
  posts.add(plank(0.12, 0.1, 3.7, C.woodDark, -0.5, 0.0, 0.1), plank(0.12, 0.1, 3.7, C.woodDark, 0.5, 0.0, 0.1));
  g.add(posts);
  const deck = new THREE.Group();
  const tones = [C.wood, C.woodLight, 0xb98450];
  for (let i = 0; i < 11; i++) {
    const p = plank(1.5 - (i % 3) * 0.04, 0.06, 0.3, tones[i % 3]!, ((i * 7) % 3 - 1) * 0.02, 0.07, -1.6 + i * 0.34);
    p.rotation.y = ((i * 5) % 3 - 1) * 0.015;
    deck.add(p);
  }
  g.add(deck);
  // Cordage, seau, canne a peche appuyee, caisse.
  g.add(part(0.1,
    rot(torus(0.14, 0.04, C.rope, -0.35, 0.13, 1.35), Math.PI / 2), rot(torus(0.1, 0.03, C.rope, 0.6, 0.38, 1.4), Math.PI / 2),
    lathe(BUCKET, 0x5f7a8a, -0.5, 0.1, -1.3),
    rot(cyl(0.015, 0.02, 1.8, BOARD2, 8, 0.62, 0.7, 0.0), 0.35, 0, -0.22),
  ));
  g.add(at(crate(0.45), 0.45, 0.1, -1.4, 0.3));
  return { group: hidden(g, L.dock.x, L.dock.z) };
}

// ---------------------------------------------------------------- la carriere

/** La cabane de la carriere : treuil en bois, outils, brouette. */
export function quarryShed(): Building {
  const g = new THREE.Group();
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
  const roof = tinRoof(2.7, 2.1, C.rust, 0x8a8f91);
  roof.position.set(-2.4, 1.88, 0.6);
  roof.rotation.x = -0.06;
  g.add(roof);
  // Outils appuyes contre la cabane.
  const pick = group(cyl(0.025, 0.025, 1.0, CUT, 8, 0, 0.5, 0), rot(box(0.5, 0.06, 0.06, IRON, 0, 0.98, 0), 0, 0, 0.12));
  pick.position.set(-1.16, 0, 0.15);
  pick.rotation.z = 0.2;
  const shovel = group(cyl(0.025, 0.025, 1.0, BOARD3, 8, 0, 0.62, 0), plank(0.03, 0.28, 0.2, C.metal, 0, 0.1, 0));
  shovel.position.set(-1.18, 0, -0.1);
  shovel.rotation.z = 0.18;
  g.add(group(pick, shovel));
  // La brouette, chargee de pierres, et un tas de cailloux.
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
  return { group: hidden(g, L.quarryShed.x, L.quarryShed.z, 0.4) };
}

// ---------------------------------------------------------------- la fonderie

const KILN: Profile = [[0, 0], [1.15, 0], [1.18, 0.04], [1.18, 0.3], [1.13, 0.36], [1.1, 1.15], [1.0, 1.55], [0.78, 1.8], [0.46, 1.93], [0, 1.96]];
const BARREL: Profile = [[0, 0], [0.28, 0], [0.3, 0.03], [0.3, 0.68], [0.28, 0.7], [0.26, 0.66], [0, 0.66]];

/** La fonderie : un four de briques, un creuset rougeoyant, une cheminee. */
export function foundry(): Building {
  const g = new THREE.Group();
  // Halle d'acier : poteaux, poutres, jambes de force, toit de tole grise rapiecee.
  const frame = new THREE.Group();
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const h = t > 0 ? 2.785 : 3.045;
    frame.add(box(0.16, h, 0.16, t > 0 ? STEEL : 0x55595c, s * 1.9, h / 2, t * 1.3));
    frame.add(rot(box(0.08, 0.6, 0.08, STEEL, s * 1.68, h - 0.3, t * 1.3), 0, 0, s * 0.8));
  }
  frame.add(box(4.0, 0.14, 0.14, 0x55595c, 0, 2.715, 1.3), box(4.0, 0.14, 0.14, 0x55595c, 0, 2.975, -1.3));
  g.add(frame);
  const roof = tinRoof(4.6, 3.4, STEEL, C.rust);
  roof.position.y = 2.95;
  roof.rotation.x = 0.1;
  g.add(roof);
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
  // La cheminee : brique, puis tuyau d'acier coiffe.
  g.add(part(1.6,
    cyl(0.36, 0.4, 1.4, 0x8a4a32, 8, -0.6, 2.3, -0.3),
    cyl(0.25, 0.27, 1.5, STEEL, 8, -0.6, 3.7, -0.3), cyl(0.28, 0.28, 0.06, IRON, 8, -0.6, 3.3, -0.3),
    rcone(0.36, 0.2, IRON, 0.3, -0.6, 4.55, -0.3),
  ));
  const fireMat = uniqueMat(0xff8a2a, 0xff5a10);
  const mouth = box(0.6, 0.45, 0.06, fireMat, -0.6, 0.6, 1.16);
  g.add(mouth);
  // L'enclume sur sa souche, le bac de trempe, les lingots, le tas de charbon.
  g.add(group(
    rcyl(0.24, 0.28, 0.6, LOG, 0.3, 1.2, 0.3, 0.2), cyl(0.21, 0.21, 0.02, CUT, 8, 1.2, 0.6, 0.2),
    box(0.22, 0.12, 0.16, IRON, 1.2, 0.66, 0.2), box(0.5, 0.14, 0.22, 0x46494d, 1.2, 0.79, 0.2),
    rot(cone(0.07, 0.24, IRON, 7, 1.56, 0.8, 0.2), 0, 0, -Math.PI / 2),
  ));
  const water = new THREE.Color(0x3f6a8a);
  const metal = new THREE.Color(0x55595c);
  g.add(group(
    paint(lathe(BARREL, C.white, 1.75, 0, 0.95), 'quench', (x, y, z, out) => {
      out.copy(y < 0.665 && y > 0.6 && Math.hypot(x, z) < 0.265 ? water : metal);
    }),
    cyl(0.31, 0.31, 0.05, IRON, 8, 1.75, 0.18, 0.95), cyl(0.31, 0.31, 0.05, IRON, 8, 1.75, 0.55, 0.95),
  ));
  const ingots = group(plank(0.8, 0.1, 0.6, BOARD2, 0.5, 0.05, 1.15));
  for (let i = 0; i < 4; i++) ingots.add(box(0.32, 0.1, 0.14, 0xb8bec4, 0.32 + (i % 2) * 0.36, 0.15, 1.0 + Math.floor(i / 2) * 0.3));
  ingots.add(rot(box(0.32, 0.1, 0.14, 0xc9cfd4, 0.5, 0.25, 1.15), 0, Math.PI / 2));
  g.add(ingots);
  const coal = blob(0.6, 0x34312e, 1.4, 0.15, -0.9);
  coal.scale.y = 0.4;
  g.add(group(coal, blob(0.14, 0x2b2b2b, 0.85, 0.08, -0.6), blob(0.12, 0x3a3632, 1.95, 0.07, -0.55), blob(0.1, 0x2b2b2b, 1.6, 0.28, -0.75)));
  return {
    group: hidden(g, L.foundry.x, L.foundry.z),
    glowMats: [fireMat],
    live: [mouth],
    anim: (_dt, t, busy) => { fireMat.emissiveIntensity = busy ? 1.2 + Math.sin(t * 16) * 0.3 : 0.25; },
  };
}

// ---------------------------------------------------------------- batiments des extensions du camp

/** Une maison d'artisan : cabane de rondins, toit de tole, fenetre allumee le soir. */
export function cabin(x: number, z: number, ry: number, roofTone: number): Building {
  const g = new THREE.Group();
  const tones = [LOG, LOG2, LOG3];
  // Murs de rondins croises aux angles, en deux moities (du bas vers le haut).
  for (const half of [0, 1]) {
    const walls = new THREE.Group();
    walls.position.y = half * 0.96;
    for (let i = half * 3; i < half * 3 + 3; i++) {
      const y = 0.18 + i * 0.32 - walls.position.y;
      for (const s of [-1, 1]) {
        walls.add(along(logPiece(3.0, 0.155, tones[(i + (s > 0 ? 0 : 1)) % 3]!, 0, y, s * 1.1), 'x'));
        walls.add(along(logPiece(2.4, 0.155, tones[(i + (s > 0 ? 2 : 1)) % 3]!, s * 1.45, y + 0.16, 0), 'z'));
      }
    }
    g.add(walls);
  }
  // Pignons : rondins de plus en plus courts sous la pente du toit.
  g.add(part(2.2,
    along(logPiece(1.4, 0.14, LOG2, 1.45, 2.25, 0), 'z'), along(logPiece(1.4, 0.14, LOG, -1.45, 2.25, 0), 'z'),
    along(logPiece(0.5, 0.14, LOG3, 1.45, 2.53, 0), 'z'), along(logPiece(0.5, 0.14, LOG2, -1.45, 2.53, 0), 'z'),
  ));
  // Toit a deux pans, faitiere, cheminee.
  for (const s of [-1, 1]) {
    const r = tinRoof(3.5, 1.6, roofTone, s > 0 ? mixHex(roofTone, 0x8a8f91, 0.5) : 0);
    r.position.set(0, 2.45, s * 0.65);
    r.rotation.x = s * 0.55;
    g.add(r);
  }
  g.add(part(2.3,
    along(rcyl(0.075, 0.075, 3.56, mixHex(roofTone, 0x000000, 0.25), 0.5, 0, 2.89, 0), 'x'),
    cyl(0.12, 0.12, 1.2, 0x55595c, 8, -0.9, 2.9, -0.4), cyl(0.135, 0.135, 0.05, IRON, 8, -0.9, 3.15, -0.4),
    rcone(0.2, 0.14, IRON, 0.3, -0.9, 3.57, -0.4),
  ));
  // Porte, marche, fenetre et sa jardiniere.
  g.add(group(
    plankDoor(0.7, 1.3, 0.5, 0.02, 1.3, BOARD2),
    plank(0.86, 0.1, 0.1, C.woodDark, 0.5, 1.38, 1.3),
    plank(0.95, 0.12, 0.26, BOARD3, 0.5, 0.06, 1.39),
  ));
  const wm = winMat();
  const win = box(0.55, 0.45, 0.05, wm, -0.7, 1.15, 1.28);
  g.add(win);
  g.add(part(0.9, windowFrame(0.55, 0.45, -0.7, 1.15, 1.3), flowerBox(0.6, -0.7, 0.82, 1.37)));
  return { group: hidden(g, x, z, ry), glowMats: [wm], live: [win] };
}

/** L'armurerie : un atelier blinde, ratelier d'armes, cible d'entrainement. */
export function armory(x: number, z: number): Building {
  const g = new THREE.Group();
  // Le blockhaus : caisson, toles ondulees, plaques rapportees, poteaux d'angle.
  g.add(group(
    box(3.4, 2.4, 2.4, 0x6f777e, 0, 1.2, 0),
    corrugated(3.3, 2.3, 0x77808a, 0, 1.2, 1.235, 15),
    rot(corrugated(2.3, 2.3, 0x6a737b, 1.735, 1.2, 0, 10), 0, Math.PI / 2), rot(corrugated(2.3, 2.3, 0x6a737b, -1.735, 1.2, 0, 10), 0, Math.PI / 2),
    ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => box(0.16, 2.44, 0.16, 0x55595c, sx * 1.7, 1.22, sz * 1.2))),
    rot(plank(0.8, 0.6, 0.04, 0x8a9097, -1.2, 1.6, 1.29), 0, 0, 0.06), rot(plank(0.6, 0.5, 0.04, 0x9c5a3a, 1.2, 0.7, 1.29), 0, 0, -0.08),
  ));
  g.add(part(2.4, box(3.6, 0.16, 2.6, 0x55595c, 0, 2.48, 0)));
  g.add(at(sandbags(3.0, 1, 47), 0, 2.56, 1.0));
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
  // Ratelier : trois fusils contre le mur.
  const rack = group(
    plank(0.08, 1.45, 0.08, C.woodDark, 1.75, 0.72, 0.62), plank(0.08, 1.45, 0.08, C.woodDark, 2.55, 0.72, 0.62),
    plank(0.9, 0.1, 0.28, C.woodDark, 2.15, 0.25, 0.6), plank(0.9, 0.1, 0.28, C.woodDark, 2.15, 1.3, 0.6),
  );
  for (let i = 0; i < 3; i++) {
    const gun = group(box(0.06, 0.75, 0.06, 0x2b2b2b, 0, 0.55, 0), plank(0.1, 0.36, 0.08, BOARD2, 0, 0.18, 0));
    gun.position.set(1.9 + i * 0.25, 0.2, 0.6);
    gun.rotation.z = -0.15;
    rack.add(gun);
  }
  g.add(rack);
  g.add(at(sandbags(1.6, 2, 41), -0.9, 0, 2.0));
  // Cible sur chevalet, caisses de munitions.
  const target = group(
    cyl(0.45, 0.45, 0.06, C.white, 8, 0, 0, 0), cyl(0.32, 0.32, 0.07, RED, 8, 0, 0, 0),
    cyl(0.18, 0.18, 0.08, C.white, 8, 0, 0, 0), cyl(0.08, 0.08, 0.09, RED, 8, 0, 0, 0),
  );
  target.rotation.x = Math.PI / 2;
  target.position.set(-2.4, 1.1, -0.4);
  g.add(target, group(
    rot(plank(0.08, 1.15, 0.08, C.woodDark, -2.62, 0.55, -0.45), 0, 0, -0.12), rot(plank(0.08, 1.15, 0.08, C.woodDark, -2.18, 0.55, -0.45), 0, 0, 0.12),
  ));
  g.add(group(
    plank(0.6, 0.32, 0.4, C.olive, 1.15, 0.16, 1.75), box(0.62, 0.06, 0.42, 0xe8b84a, 1.15, 0.22, 1.75),
    rot(plank(0.55, 0.28, 0.36, 0x5f6a3e, 1.1, 0.46, 1.72), 0, 0.2),
  ));
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
 * Habillage d'une tour selon son materiau : 0 bois (rien), 1 pierre (fut de moellons autour des
 * pieds, corniche sous le plancher), 2 fer (la pierre, cerclee d'acier, parapet blinde).
 * L'habillage reste a part (userData.keep) : on peut le changer apres coup.
 */
export function towerSkin(g: THREE.Object3D, stage: number): void {
  if ((g.userData.skin ?? 0) === stage) return;
  g.userData.skin = stage;
  const old = g.getObjectByName('skin');
  if (old) {
    g.remove(old);
    old.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
  }
  if (stage <= 0) return;
  const legH = 4.2;
  const k = new THREE.Group();
  const r = rng(77);
  // Fut de pierre : six assises de moellons, a peine evase vers le bas, joints en retrait.
  const courses = 6;
  const h = legH / courses;
  for (let i = 0; i < courses; i++) {
    const w = 2.16 - i * 0.04;
    const y = h * (i + 0.5);
    k.add(rbox(w, h - 0.07, w, TOWER_STONE[i % 4]!, 0.07, 0, y, 0));
    k.add(box(w - 0.1, 0.07, w - 0.1, TOWER_MORTAR, 0, h * (i + 1) - 0.035, 0));
    // Quelques pierres qui ressortent : la facade n'est pas un aplat.
    for (let f = 0; f < 4; f++) {
      const a = (f * Math.PI) / 2;
      const along = (r() - 0.5) * w * 0.7;
      const out = w / 2 + 0.02;
      const s = blob(0.16 + r() * 0.06, TOWER_STONE[(i + f + 1) % 4]!, Math.cos(a) * out - Math.sin(a) * along, y + (r() - 0.5) * h * 0.4, Math.sin(a) * out + Math.cos(a) * along);
      s.scale.set(1, 0.7, 0.45);
      s.rotation.y = -a;
      k.add(s);
    }
  }
  // Corniche sous le plancher et porte basse cote echelle.
  k.add(rbox(2.5, 0.22, 2.5, TOWER_STONE[2]!, 0.06, 0, legH - 0.14, 0));
  const door = rbox(0.7, 1.1, 0.08, 0x3a2e24, 0.05, 1.07, 0.55, 0.2);
  door.rotation.y = Math.PI / 2;
  k.add(door);
  if (stage >= 2) {
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
  }
  const m = mergeColored(k);
  m.name = 'skin';
  m.userData.keep = true;
  g.add(m);
}
