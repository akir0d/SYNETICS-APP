// Ce qu'on recolte : potagers, arbres a abattre, epaves a demonter.

import * as THREE from 'three';
import { C, at, blob, box, capsule, corrugated, cyl, damp, group, lathe, mat, mixHex, paint, plank, rbox, rcyl, rng, shadow, sphere, torus, vgrad } from './kit';
import { L } from './layout';
import type { Circle, Segment } from './physics';
import { mergeColored } from './bake';
import { wreck } from './props';
import { bend, foliage, leafy, pine, revolveGeo, stone, tubeGeo, vmesh } from './flora';

// ---------------------------------------------------------------- potagers et champs

interface Plant { obj: THREE.Object3D; g: number; pos: THREE.Vector3; pop: number }

export const BED_W = 2.8;
export const BED_D = 2.0;
/** Un champ de ble : plus grand qu'un bac de potager. */
export const FIELD_W = 4.4;
export const FIELD_D = 3.0;

export type Crop = 'carrot' | 'tomato' | 'wheat';
const GROW: Record<Crop, number> = { carrot: 8, tomato: 13, wheat: 10 };

export class Bed {
  readonly group = new THREE.Group();
  readonly plants: Plant[] = [];
  readonly walls: Segment[];
  unlocked = false;
  readonly growTime: number;
  /** Multiplicateur de pousse (niveau du bac, boosts). */
  growMul = 1;
  /** Aspect du bac (1 a 5, suit son niveau d'amelioration) ; le decor est a part des plantes. */
  stage = 0;
  private readonly deco = new THREE.Group();
  private readonly cols: number;
  private readonly rows: number;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, readonly kind: Crop, readonly w = BED_W, readonly d = BED_D) {
    this.growTime = GROW[kind];
    const g = this.group;
    const base = kind === 'wheat' ? 0.12 : 0.44;
    const cols = Math.max(2, Math.round((w - 0.3) / 0.64));
    const rows = Math.max(2, Math.round((d - 0.3) / 0.55));
    this.cols = cols;
    this.rows = rows;
    // Le decor (cadre, terre, serre...) change avec le niveau du bac : il vit dans son groupe.
    g.add(this.deco);
    const r = rng(Math.round(x * 13 + z * 7));
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const px = (j - (cols - 1) / 2) * ((w - 0.5) / Math.max(1, cols - 1));
        const pz = (i - (rows - 1) / 2) * ((d - 0.5) / Math.max(1, rows - 1));
        // Chaque plante est un maillage fusionne, partage entre plantes de meme variete : 60 epis
        // de ble ne coutent que 60 appels de dessin et quatre geometries. Les tirages r()
        // d'origine sont gardes (tomate 9, ble 8) : rotations et pousses inchangees.
        const obj = kind === 'carrot' ? plantModel('carrot', (i * cols + j) % 3)
          : plantModel(kind, Math.floor(draw(r, kind === 'tomato' ? 9 : 8) * 4));
        at(obj, px, base, pz, r() * 6);
        obj.userData.base = base;
        g.add(obj);
        this.plants.push({ obj, g: 0.3 + r() * 0.7, pos: new THREE.Vector3(x + px, 0.6, z + pz), pop: 0 });
      }
    }
    shadow(g);
    // Les plantes recoivent les ombres mais n'en projettent pas : invisible vu de haut, et
    // ~150 appels de dessin en moins dans la passe d'ombre (le cadre et la terre gardent la leur).
    for (const p of this.plants) p.obj.traverse((o) => { o.castShadow = false; });
    this.setStage(1);
    g.position.set(x, 0, z);
    g.visible = false;
    scene.add(g);
    // Le bac (ou sa ruine) occupe sa place des le depart : les collisions ne
    // changent jamais quand on le restaure, personne ne peut s'y retrouver coince.
    const hw = w / 2;
    const hd = d / 2;
    this.walls = [
      { x1: x - hw, z1: z - hd, x2: x + hw, z2: z - hd },
      { x1: x + hw, z1: z - hd, x2: x + hw, z2: z + hd },
      { x1: x + hw, z1: z + hd, x2: x - hw, z2: z + hd },
      { x1: x - hw, z1: z + hd, x2: x - hw, z2: z - hd },
    ];
  }

  unlock(): void {
    this.unlocked = true;
    this.group.visible = true;
  }

  /** Groupe du decor : c'est lui que l'on anime quand le bac change d'aspect. */
  get decoGroup(): THREE.Group {
    return this.deco;
  }

  /**
   * Change l'aspect du bac (1 a 5). Potager : terre nue, bordures de planches, bac en bois, bac
   * sureleve arrose, serre en verre. Champ : friche, bordures, cloture, irrigation en pierre,
   * grande serre. Les plantes suivent la hauteur de la terre ; les collisions ne changent pas.
   */
  setStage(stage: number): void {
    const st = Math.max(1, Math.min(5, Math.round(stage)));
    if (st === this.stage) return;
    this.stage = st;
    for (const c of [...this.deco.children]) this.deco.remove(c);
    const { w, d, cols, rows } = this;
    const made = this.kind === 'wheat'
      ? shared(`fieldS${st},${w},${d},${rows}`, () => fieldDeco(w, d, rows, st))
      : shared(`bedS${st},${w},${d},${cols},${rows}`, () => bedDeco(w, d, cols, rows, st));
    for (const c of [...made.children]) this.deco.add(c);
    const base = this.kind === 'wheat' ? 0.12 : BED_BASE[st - 1]!;
    for (const p of this.plants) {
      p.obj.userData.base = base;
      p.obj.position.y = base;
    }
  }

  /** Distance d'un point au bord du bac. */
  distance(px: number, pz: number): number {
    const dx = Math.max(Math.abs(px - this.x) - this.w / 2, 0);
    const dz = Math.max(Math.abs(pz - this.z) - this.d / 2, 0);
    return Math.hypot(dx, dz);
  }

  ripeCount(): number {
    return this.unlocked ? this.plants.filter((p) => p.g >= 1).length : 0;
  }

  /** Recolte la plante mure la plus proche ; renvoie sa position. */
  harvestNear(px: number, pz: number): THREE.Vector3 | null {
    let best: Plant | null = null;
    let bd = Infinity;
    for (const p of this.plants) {
      if (p.g < 1) continue;
      const d = Math.hypot(p.pos.x - px, p.pos.z - pz);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return null;
    best.g = 0;
    best.pop = 1;
    return best.pos.clone();
  }

  /**
   * Ou un survivant se poste pour recolter : toujours sur un grand cote (nord ou sud).
   * Entre deux bacs voisins par les petits cotes il n'y a pas la place de passer :
   * c'est la que la fermiere se coincait.
   */
  edgePoint(px: number, pz: number, side?: number): THREE.Vector3 {
    const s = side ?? (pz < this.z ? -1 : 1);
    const cx = Math.max(this.x - this.w / 2 + 0.4, Math.min(this.x + this.w / 2 - 0.4, px));
    return new THREE.Vector3(cx, 0, this.z + s * (this.d / 2 + 0.65));
  }

  update(dt: number, time: number): void {
    if (!this.unlocked) return;
    for (const p of this.plants) {
      if (p.g < 1) p.g = Math.min(1, p.g + (dt * this.growMul) / this.growTime);
      p.pop = Math.max(0, p.pop - dt * 3);
      const ripe = p.g >= 1;
      const s = 0.25 + p.g * 0.75;
      p.obj.scale.setScalar(damp(p.obj.scale.x, s, 10, dt));
      p.obj.position.y = (p.obj.userData.base as number) + (ripe ? Math.abs(Math.sin(time * 3 + p.pos.x * 3)) * 0.04 : 0);
      p.obj.rotation.z = ripe ? Math.sin(time * 2 + p.pos.z * 5) * 0.08 : 0;
    }
  }
}

/** Premier de n tirages : garde la sequence du generateur d'origine. */
function draw(r: () => number, n: number): number {
  const first = r();
  for (let i = 1; i < n; i++) r();
  return first;
}

const smooth = (t: number): number => {
  const k = Math.max(0, Math.min(1, t));
  return k * k * (3 - 2 * k);
};

const modelCache = new Map<string, THREE.Group>();
/** Modele fusionne une seule fois puis clone (geometrie et materiau partages). */
function shared(key: string, make: () => THREE.Group): THREE.Group {
  let m = modelCache.get(key);
  if (!m) {
    m = make();
    modelCache.set(key, m);
  }
  return m.clone();
}

/** Une plante : quelques varietes fusionnees, partagees par toutes les plantes du jeu. */
function plantModel(kind: Crop, v: number): THREE.Group {
  return shared(`${kind}${v}`, () => mergeColored(kind === 'carrot' ? carrotPlant(v) : kind === 'tomato' ? tomatoPlant(v) : wheatPlant(v)));
}

const TONES = [C.wood, mixHex(C.wood, C.woodLight, 0.45), mixHex(C.wood, C.woodDark, 0.3)];

/** Cadre du bac : deux rangs de planches biseautees, poteaux d'angle plus sombres. */
function rot<T extends THREE.Object3D>(o: T, x: number, y = 0, z = 0): T {
  o.rotation.set(x, y, z);
  return o;
}

/** Hauteur de la terre (base des plantes) pour chaque aspect du potager. */
const BED_BASE = [0.16, 0.26, 0.44, 0.62, 0.62];
const GLASS = 0xd6eef2;
const STEEL = 0x5a6066;

/** Les cinq aspects d'un potager (pieces fusionnees ; le verre reste a part, transparent). */
function bedDeco(w: number, d: number, cols: number, rows: number, stage: number): THREE.Group {
  const g = new THREE.Group();
  if (stage === 1) {
    // Terre nue : une butte retournee a la pelle, quelques cailloux.
    g.add(paint(rbox(w - 0.2, 0.16, d - 0.2, C.soil, 0.08, 0, 0.08, 0), 'soil1', (_x, y, _z, out) => {
      out.lerpColors(SOIL_DEEP, SOIL_TOP, smooth((y + 0.08) / 0.16));
    }));
    mounds(g, w, d, cols, rows, 0.15);
    for (const [sx, sz] of [[-0.5, 0.45], [0.48, -0.5], [0.2, 0.55]] as const) g.add(blob(0.07, 0x8f8a80, sx * w, 0.04, sz * d));
    return mergeColored(g, 0.05);
  }
  if (stage === 2) {
    // Bordures : une planche couchee de chaque cote, la terre un peu plus haut.
    let k = 0;
    for (const s of [-1, 1]) {
      g.add(plank(w, 0.18, 0.11, TONES[k++ % 3]!, 0, 0.09, s * (d / 2 - 0.055)));
      g.add(plank(0.11, 0.18, d - 0.22, TONES[k++ % 3]!, s * (w / 2 - 0.055), 0.09, 0));
    }
    g.add(paint(rbox(w - 0.24, 0.22, d - 0.24, C.soil, 0.08, 0, 0.11, 0), 'soil2', (_x, y, _z, out) => {
      out.lerpColors(SOIL_DEEP, SOIL_TOP, smooth((y + 0.11) / 0.22));
    }));
    mounds(g, w, d, cols, rows, 0.25);
    return mergeColored(g, 0.05);
  }
  if (stage === 3) {
    g.add(bedFrame(w, d), bedSoil(w, d, cols, rows));
    return g;
  }
  // Niveaux 7-8 : bac sureleve de trois planches sur pieds, tuyau d'arrosage goutte a goutte.
  const raised = new THREE.Group();
  const t = 0.13;
  let k = 0;
  for (const y of [0.11, 0.31, 0.51]) {
    for (const s of [-1, 1]) {
      raised.add(plank(w - 0.06, 0.19, t, TONES[k++ % 3]!, 0, y, s * (d / 2 - t / 2)));
      raised.add(plank(t, 0.19, d - 2 * t - 0.01, TONES[k++ % 3]!, s * (w / 2 - t / 2), y, 0));
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) raised.add(plank(0.19, 0.72, 0.19, C.woodDark, sx * (w / 2 - 0.09), 0.36, sz * (d / 2 - 0.09)));
  const soil = bedSoil(w, d, cols, rows);
  soil.position.y = 0.18;
  raised.add(soil);
  raised.add(rot(cyl(0.035, 0.035, w - 0.3, 0x3f6a8a, 10, 0, 0.66, -d / 2 + 0.2), 0, 0, Math.PI / 2));
  for (let i = 0; i < 5; i++) raised.add(sphere(0.03, 0x2d4a60, -w / 2 + 0.35 + i * ((w - 0.7) / 4), 0.64, -d / 2 + 0.2, 6));
  raised.add(cyl(0.05, 0.05, 0.12, 0xc9412f, 10, w / 2 - 0.05, 0.7, -d / 2 + 0.2));
  g.add(mergeColored(raised, 0.05));
  if (stage === 5) {
    // Serre : ossature d'acier et verre (un seul maillage transparent pour les parois et le toit).
    const H = 1.35;
    const fw = w + 0.2;
    const fd = d + 0.2;
    const frame = new THREE.Group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame.add(box(0.07, H, 0.07, STEEL, sx * fw / 2, H / 2, sz * fd / 2));
    for (const sz of [-1, 1]) frame.add(box(fw, 0.06, 0.06, STEEL, 0, H, sz * fd / 2));
    for (const sx of [-1, 1]) frame.add(box(0.06, 0.06, fd, STEEL, sx * fw / 2, H, 0));
    frame.add(box(fw, 0.06, 0.06, STEEL, 0, H + 0.45, 0));
    for (const sz of [-1, 1]) {
      const r = box(fw, 0.05, Math.hypot(fd / 2, 0.45), STEEL, 0, H + 0.225, sz * fd / 4);
      r.rotation.x = sz * Math.atan2(0.45, fd / 2);
      r.scale.set(1, 1, 0.08);
      frame.add(r);
    }
    g.add(mergeColored(frame, 0.04));
    g.add(glassHouse(fw, fd, H, 0.45));
  }
  return g;
}

/** Les cinq aspects d'un champ de ble. */
function fieldDeco(w: number, d: number, rows: number, stage: number): THREE.Group {
  const g = new THREE.Group();
  g.add(fieldSoil(w, d, rows));
  if (stage === 2) {
    const b = new THREE.Group();
    for (const s of [-1, 1]) {
      b.add(plank(w + 0.1, 0.16, 0.1, TONES[1]!, 0, 0.08, s * (d / 2 + 0.05)));
      b.add(plank(0.1, 0.16, d, TONES[2]!, s * (w / 2 + 0.05), 0.08, 0));
    }
    g.add(mergeColored(b, 0.05));
  } else if (stage === 3) {
    g.add(fieldFence(w, d));
  } else if (stage >= 4) {
    // Bordure de pierres taillees et rigole d'irrigation le long d'un cote, avec sa pompe.
    const s4 = new THREE.Group();
    const n = Math.round(w / 0.55);
    for (const sz of [-1, 1]) for (let i = 0; i < n; i++) s4.add(box(w / n - 0.04, 0.2, 0.22, [0x9c988e, 0x8b877d, 0xa9a59a][(i + (sz > 0 ? 1 : 0)) % 3]!, -w / 2 + (i + 0.5) * (w / n), 0.1, sz * (d / 2 + 0.12)));
    const m = Math.round(d / 0.55);
    for (const sx of [-1, 1]) for (let i = 0; i < m; i++) s4.add(box(0.22, 0.2, d / m - 0.04, [0x8b877d, 0xa9a59a, 0x9c988e][i % 3]!, sx * (w / 2 + 0.12), 0.1, -d / 2 + (i + 0.5) * (d / m)));
    s4.add(box(w, 0.05, 0.16, 0x4f8fb0, 0, 0.16, -d / 2 - 0.12));
    s4.add(rbox(0.22, 0.7, 0.22, 0x3f6a8a, 0.05, w / 2 + 0.35, 0.35, -d / 2 - 0.12), rot(cyl(0.03, 0.03, 0.4, 0x2d2d2d, 8, w / 2 + 0.35, 0.78, -d / 2 + 0.02), Math.PI / 2.5, 0, 0));
    g.add(mergeColored(s4, 0.05));
    if (stage === 5) {
      // Grande serre en tunnel : arceaux d'acier et bache de verre.
      const R = d / 2 + 0.35;
      const hoops = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const hp = new THREE.Mesh(new THREE.TorusGeometry(R, 0.04, 6, 18, Math.PI), mat(STEEL));
        hp.rotation.y = Math.PI / 2;
        hp.position.x = -w / 2 + (i / 3) * w;
        hoops.add(hp);
      }
      g.add(mergeColored(hoops, 0.03));
      const tunnel = new THREE.Mesh(new THREE.CylinderGeometry(R, R, w + 0.1, 20, 1, true, -Math.PI / 2, Math.PI), mat(GLASS, { opacity: 0.26, double: true }));
      tunnel.rotation.z = Math.PI / 2;
      tunnel.castShadow = false;
      g.add(tunnel);
    }
  }
  return g;
}

/** Une butte de terre sous chaque plante. */
function mounds(g: THREE.Group, w: number, d: number, cols: number, rows: number, y: number): void {
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const px = (j - (cols - 1) / 2) * ((w - 0.5) / Math.max(1, cols - 1));
      const pz = (i - (rows - 1) / 2) * ((d - 0.5) / Math.max(1, rows - 1));
      const m = blob(0.14, mixHex(C.soil, 0x8a5a34, 0.4), px, y, pz);
      m.scale.set(1.15, 0.36, 1.15);
      g.add(m);
    }
  }
}

/** Parois et toit a deux pentes en verre, d'un seul maillage transparent. */
function glassHouse(w: number, d: number, H: number, ridge: number): THREE.Mesh {
  const hw = w / 2;
  const hd = d / 2;
  const v = [
    // parois (4 rectangles)
    -hw, 0, -hd, hw, 0, -hd, hw, H, -hd, -hw, H, -hd,
    -hw, 0, hd, hw, 0, hd, hw, H, hd, -hw, H, hd,
    -hw, 0, -hd, -hw, 0, hd, -hw, H, hd, -hw, H, -hd,
    hw, 0, -hd, hw, 0, hd, hw, H, hd, hw, H, -hd,
    // toit (2 pans) et pignons (2 triangles)
    -hw, H, -hd, hw, H, -hd, hw, H + ridge, 0, -hw, H + ridge, 0,
    -hw, H, hd, hw, H, hd, hw, H + ridge, 0, -hw, H + ridge, 0,
  ];
  const idx: number[] = [];
  for (let q = 0; q < 6; q++) {
    const o = q * 4;
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
  }
  const base = 24;
  v.push(-hw, H, -hd, -hw, H, hd, -hw, H + ridge, 0, hw, H, -hd, hw, H, hd, hw, H + ridge, 0);
  idx.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(GLASS, { opacity: 0.28, double: true }));
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

function bedFrame(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  const t = 0.13;
  let k = 0;
  for (const y of [0.11, 0.31]) {
    for (const s of [-1, 1]) {
      g.add(plank(w - 0.06, 0.19, t, TONES[k++ % 3]!, 0, y, s * (d / 2 - t / 2)));
      g.add(plank(t, 0.19, d - 2 * t - 0.01, TONES[k++ % 3]!, s * (w / 2 - t / 2), y, 0));
    }
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(plank(0.17, 0.52, 0.17, C.woodDark, sx * (w / 2 - 0.085), 0.26, sz * (d / 2 - 0.085)));
  return mergeColored(g, 0.05);
}

const SOIL_DEEP = new THREE.Color(0x4f2f1b);
const SOIL_TOP = new THREE.Color(0x744628);

/** Terre sombre et bombee du bac, avec une butte sous chaque plante et quelques mottes. */
function bedSoil(w: number, d: number, cols: number, rows: number): THREE.Group {
  const g = new THREE.Group();
  g.add(paint(rbox(w - 0.26, 0.3, d - 0.26, C.soil, 0.13, 0, 0.31, 0), 'soil', (_x, y, _z, out) => {
    out.lerpColors(SOIL_DEEP, SOIL_TOP, smooth((y + 0.15) / 0.3));
  }));
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const px = (j - (cols - 1) / 2) * ((w - 0.5) / Math.max(1, cols - 1));
      const pz = (i - (rows - 1) / 2) * ((d - 0.5) / Math.max(1, rows - 1));
      const m = blob(0.145, mixHex(C.soil, 0x8a5a34, 0.4), px, 0.43, pz);
      m.scale.set(1.15, 0.36, 1.15);
      g.add(m);
    }
  }
  const q = rng(77);
  for (let i = 0; i < 7; i++) g.add(blob(0.05, 0x5c3820, (q() - 0.5) * (w - 0.6), 0.46, (q() - 0.5) * (d - 0.6)));
  return mergeColored(g, 0.04);
}

/** Cloture du champ : piquets arrondis, deux lisses sur les grands cotes. */
function fieldFence(w: number, d: number): THREE.Group {
  const g = new THREE.Group();
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) g.add(rcyl(0.065, 0.075, 0.72, C.woodDark, 0.6, sx * w / 2, 0.36, sz * d / 2));
  for (const sz of [-1, 1]) {
    g.add(plank(w, 0.08, 0.05, C.wood, 0, 0.52, sz * d / 2));
    g.add(plank(w, 0.07, 0.05, TONES[2]!, 0, 0.27, sz * d / 2));
  }
  return mergeColored(g, 0.05);
}

/** Terre labouree : un fond et un sillon bombe sous chaque rang d'epis. */
function fieldSoil(w: number, d: number, rows: number): THREE.Group {
  const g = new THREE.Group();
  g.add(paint(rbox(w - 0.06, 0.12, d - 0.06, C.soil, 0.05, 0, 0.06, 0), 'field', (_x, y, _z, out) => {
    out.lerpColors(SOIL_DEEP, SOIL_TOP, smooth((y + 0.06) / 0.12) * 0.8);
  }));
  for (let i = 0; i < rows; i++) {
    const pz = (i - (rows - 1) / 2) * ((d - 0.5) / Math.max(1, rows - 1));
    const ridge = capsule(0.1, w - 0.45, mixHex(C.soil, 0x8a5a34, 0.45), 0, 0.1, pz);
    ridge.rotation.z = Math.PI / 2;
    ridge.scale.set(0.7, 1, 1.5);
    g.add(ridge);
  }
  return mergeColored(g, 0.04);
}

const CARROT: [number, number][] = [[0, -0.12], [0.03, -0.09], [0.058, 0], [0.07, 0.08], [0.062, 0.125], [0.035, 0.15], [0, 0.155]];
const CARROT_DEEP = new THREE.Color(0xd8611f);
const CARROT_LIT = new THREE.Color(0xf5913a);
const CARROT_TOP = new THREE.Color(0x9c9a3c);

/** Carotte : l'epaule orange qui sort de terre et un plumeau de quatre fanes. */
function carrotPlant(v: number): THREE.Group {
  const q = rng(v * 17 + 3);
  const g = new THREE.Group();
  g.add(paint(lathe(CARROT, 0xf07f2c), 'carrot', (_x, y, _z, out) => {
    out.lerpColors(CARROT_DEEP, CARROT_LIT, smooth((y + 0.1) / 0.2));
    if (y > 0.11) out.lerp(CARROT_TOP, smooth((y - 0.11) / 0.04));
  }));
  for (let i = 0; i < 4; i++) {
    const frond = vgrad(sphere(0.08, C.leaf, 0, 0, 0, -6), i % 2 ? C.leaf : C.leafDark, C.leafSun);
    frond.scale.set(0.42, 2.1, 0.24);
    const tilt = 0.28 + q() * 0.22;
    frond.rotation.x = tilt;
    frond.position.set(0, 0.168 * Math.cos(tilt), 0.168 * Math.sin(tilt));
    const pivot = group(frond);
    pivot.position.y = 0.12;
    pivot.rotation.y = i * (Math.PI / 2) + q() * 0.6;
    g.add(pivot);
  }
  return g;
}

const TOMATO = new THREE.Color(0xe2402b);
const TOMATO_DEEP = new THREE.Color(0xa82a1c);
const TOMATO_SHINE = new THREE.Color(0xff9c84);

/** Plant de tomates : tuteur, touffe de feuilles, trois tomates rondes et luisantes. */
function tomatoPlant(v: number): THREE.Group {
  const q = rng(v * 23 + 5);
  const g = new THREE.Group();
  g.add(cyl(0.022, 0.026, 0.86, C.woodLight, 0, 0.07, 0.43, -0.06));
  const bush = foliage(0.24, C.leafDark, 0, 0.46, 0, v, 0.26);
  bush.scale.y = 1.08;
  bush.rotation.y = v * 1.3;
  g.add(bush, blob(0.065, C.leaf, 0.18, 0.66, 0.05), blob(0.065, C.leaf, -0.15, 0.3, -0.1));
  for (let i = 0; i < 3; i++) {
    const a = v * 1.7 + i * 2.1 + q() * 0.5;
    const t = paint(sphere(0.072, TOMATO.getHex(), Math.sin(a) * 0.205, 0.3 + i * 0.12 + q() * 0.06, Math.cos(a) * 0.205, -6), 'tomato', (x, y, _z, out) => {
      out.lerpColors(TOMATO_DEEP, TOMATO, smooth((y + 0.072) / 0.1));
      if (y > 0.02 && x < 0.01) out.lerp(TOMATO_SHINE, 0.45);
    });
    g.add(t);
  }
  return g;
}

/** Touffe de ble : quatre tiges vert-dore, epis allonges, legerement ecartees. */
function wheatPlant(v: number): THREE.Group {
  const q = rng(v * 29 + 7);
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const stalk = vgrad(cyl(0.016, 0.02, 0.78, C.olive, 0, 0, 0.39, 0), 0x8a8f45, 0xd2b04c);
    const ear = vgrad(sphere(0.05, 0xe8c25a, 0, 0.88, 0, -5), 0xc9973a, 0xf0d27a);
    ear.scale.set(1, 2.6, 1);
    const stem = group(stalk, ear);
    stem.position.set((q() - 0.5) * 0.3, 0, (q() - 0.5) * 0.3);
    stem.rotation.set((q() - 0.5) * 0.26, 0, (q() - 0.5) * 0.26);
    g.add(stem);
  }
  return g;
}

// ---------------------------------------------------------------- arbres

let stumpMesh: THREE.Mesh | null = null;
/**
 * Souche partagee par tous les arbres (une geometrie, un appel de dessin) : ecorce aux
 * racines evasees, coupe claire avec ses cernes, quelques copeaux autour.
 */
function stumpModel(): THREE.Mesh {
  if (!stumpMesh) {
    const g = new THREE.Group();
    g.add(vmesh(revolveGeo([
      [0.44, -0.03, 0.62, 0.3],
      [0.34, 0.06, 0.72, 0.22],
      [0.27, 0.16, 0.85, 0.06],
      [0.255, 0.3, 0.95, 0.02],
      [0.25, 0.37, 1.05, 0.02],
      [0.226, 0.395, 1.12],
    ], 20, C.bark, 5, 0.4)));
    // La coupe : des anneaux alternes clair / fonce, le coeur plus sombre.
    g.add(vmesh(revolveGeo([
      [0.226, 0.394, 0.8],
      [0.2, 0.396, 1.06],
      [0.165, 0.398, 0.86],
      [0.125, 0.4, 1.06],
      [0.085, 0.401, 0.88],
      [0.045, 0.402, 1.04],
      [0, 0.403, 0.78],
    ], 20, 0xe9c48e)));
    const q = rng(5);
    for (let i = 0; i < 5; i++) {
      const a = i * 1.3 + q();
      const chip = plank(0.12, 0.03, 0.07, i % 2 ? C.woodLight : 0xe9c48e, Math.sin(a) * (0.5 + q() * 0.2), 0.02, Math.cos(a) * (0.5 + q() * 0.2));
      chip.rotation.set((q() - 0.5) * 0.4, q() * 3, (q() - 0.5) * 0.4);
      g.add(chip);
    }
    stumpMesh = mergeColored(g, 0.02).children[0] as THREE.Mesh;
  }
  return new THREE.Mesh(stumpMesh.geometry, stumpMesh.material);
}

export class ChopTree {
  readonly root = new THREE.Group();
  readonly model: THREE.Group;
  readonly stump: THREE.Mesh;
  readonly solid: Circle;
  logs = 3;
  state: 'standing' | 'falling' | 'stump' | 'growing' = 'standing';
  private t = 0;
  private shake = 0;
  private fallDir = 0;
  private readonly baseScale: number;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, r: () => number) {
    // Fusionne : un seul appel de dessin par arbre debout (memes tirages r() qu'avant).
    this.model = mergeColored(r() < 0.5 ? pine(r) : leafy(r));
    this.baseScale = 0.85 + r() * 0.3;
    this.model.scale.setScalar(this.baseScale);
    this.model.rotation.y = r() * 6;
    this.stump = shadow(stumpModel());
    this.stump.visible = false;
    this.root.add(this.model, this.stump);
    this.root.position.set(x, 0, z);
    scene.add(this.root);
    this.solid = { x, z, r: 0.55 };
  }

  get standing(): boolean {
    return this.state === 'standing';
  }

  /** Un coup de hache : renvoie true si un rondin tombe. */
  chop(fromX: number, fromZ: number, logsPerTree: number): boolean {
    if (this.state !== 'standing') return false;
    this.shake = 1;
    this.logs -= 1;
    if (this.logs <= 0) {
      this.state = 'falling';
      this.t = 0;
      this.fallDir = Math.atan2(this.x - fromX, this.z - fromZ);
      this.solid.off = true;
      this.logs = logsPerTree;
    }
    return true;
  }

  update(dt: number): void {
    this.shake = Math.max(0, this.shake - dt * 5);
    if (this.state === 'standing') {
      this.model.rotation.z = Math.sin(this.shake * 30) * this.shake * 0.08;
    } else if (this.state === 'falling') {
      this.t += dt;
      // Le tronc bascule dans la direction opposee au bucheron, puis disparait.
      const k = Math.min(1, this.t / 0.7);
      this.model.rotation.set(0, 0, 0);
      const axis = new THREE.Vector3(Math.cos(this.fallDir), 0, -Math.sin(this.fallDir));
      this.model.quaternion.setFromAxisAngle(axis, k * k * 1.5);
      if (this.t > 0.9) this.model.scale.setScalar(this.baseScale * Math.max(0.001, 1 - (this.t - 0.9) * 3));
      this.stump.visible = true;
      if (this.t > 1.25) {
        this.state = 'stump';
        this.t = 0;
        this.model.visible = false;
      }
    } else if (this.state === 'stump') {
      this.t += dt;
      if (this.t > 40) {
        this.state = 'growing';
        this.t = 0;
        this.model.visible = true;
        this.model.quaternion.identity();
        this.stump.visible = false;
        this.solid.off = false;
      }
    } else {
      this.t += dt;
      const k = Math.min(1, this.t / 6);
      this.model.scale.setScalar(this.baseScale * (0.15 + 0.85 * k));
      if (k >= 1) this.state = 'standing';
    }
  }
}

export function plantForest(scene: THREE.Scene): ChopTree[] {
  const r = rng(41);
  const trees: ChopTree[] = [];
  const f = L.forest;
  let guard = 0;
  while (trees.length < 64 && guard++ < 4000) {
    const x = f.minX + r() * (f.maxX - f.minX);
    const z = f.minZ + r() * (f.maxZ - f.minZ);
    // Un chemin degage depuis la porte nord.
    if (Math.abs(x) < 1.6 && z > -19) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 2.6)) continue;
    trees.push(new ChopTree(scene, x, z, r));
  }
  return trees;
}

// ---------------------------------------------------------------- ferraille

const BARREL: [number, number][] = [
  [0, 0], [0.26, 0], [0.29, 0.025], [0.29, 0.08], [0.31, 0.105], [0.29, 0.13], [0.305, 0.45],
  [0.29, 0.77], [0.31, 0.795], [0.29, 0.82], [0.29, 0.875], [0.26, 0.9], [0.22, 0.885], [0, 0.885],
];

/** Tas de ferraille : futs, toles ondulees, portiere, pneus, tuyaux et caisse sur un lit de gravats. */
function scrapHeap(): THREE.Group {
  const g = new THREE.Group();
  const bed = blob(0.75, C.rustDark, 0, 0.04, 0);
  bed.scale.set(1.5, 0.28, 1.25);
  g.add(bed);
  g.add(lathe(BARREL, C.rust, -0.78, 0, -0.32));
  const lying = group(lathe(BARREL, 0x4f7a9a, 0, -0.45, 0));
  lying.position.set(0.5, 0.31, 0.55);
  lying.rotation.set(0, 0.5, Math.PI / 2);
  g.add(lying);
  g.add(at(plank(0.5, 0.5, 0.5, C.wood, 0, 0, 0), 0.02, 0.25, -0.08, 0.5));
  const s1 = corrugated(1.2, 0.95, C.rust);
  s1.position.set(-0.05, 0.5, -0.62);
  s1.rotation.set(-0.45, 0.25, 0.05);
  const s2 = corrugated(1.0, 0.8, 0x6f8a7a);
  s2.position.set(0.1, 0.56, -0.02);
  s2.rotation.set(-Math.PI / 2 + 0.3, 0.6, 0.1);
  g.add(s1, s2);
  const door = rbox(0.9, 0.55, 0.07, 0x5f7a8a, 0.035);
  door.add(box(0.5, 0.2, 0.076, 0x2e3a42, 0.08, 0.12, 0));
  door.position.set(0.88, 0.36, -0.38);
  door.rotation.set(0, 1.2, 0.45);
  g.add(door);
  const t1 = torus(0.3, 0.11, 0x2f2f2f, -0.55, 0.11, 0.72);
  t1.rotation.x = Math.PI / 2;
  const t2 = torus(0.34, 0.12, 0x343434, 1.02, 0.42, 0.25);
  t2.rotation.set(0.15, 1.3, 0);
  g.add(t1, t2);
  const p1 = cyl(0.055, 0.055, 1.5, C.metal, 0, -0.1, 0.62, 0.3);
  p1.rotation.set(0, 0.4, Math.PI / 2 - 0.15);
  const p2 = cyl(0.045, 0.045, 1.1, C.rust, 0, -0.3, 0.42, -0.1);
  p2.rotation.set(0.2, -0.6, Math.PI / 2 + 0.25);
  g.add(p1, p2);
  const q = rng(9);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.6 + q();
    g.add(blob(0.12, i % 2 ? C.metal : C.rust, Math.sin(a) * 1.2, 0.06, Math.cos(a) * 1.05));
  }
  return mergeColored(g, 0.05);
}

/** Pompe a essence : socle, corps rouge degrade, tete blanche, ecran, pistolet et tuyau qui pend. */
function pumpModel(): THREE.Group {
  const g = new THREE.Group();
  g.add(rbox(0.95, 0.18, 0.75, C.concrete, 0.05, 0, 0.09, 0));
  g.add(vgrad(rbox(0.6, 1.36, 0.45, 0xc9412f, 0.08, 0, 0.84, 0), 0xa8382a, 0xd64b35));
  g.add(box(0.62, 0.08, 0.47, 0xf2c14e, 0, 0.42, 0));
  g.add(rbox(0.66, 0.36, 0.52, C.white, 0.1, 0, 1.5, 0));
  const badge = cyl(0.12, 0.12, 0.03, 0xf2c14e, 0, 0, 1.5, 0.265);
  badge.rotation.x = Math.PI / 2;
  g.add(badge);
  g.add(rbox(0.4, 0.22, 0.04, C.concrete, 0.015, 0, 1.18, 0.226));
  g.add(box(0.32, 0.15, 0.03, 0x2e3439, 0, 1.18, 0.243));
  g.add(box(0.22, 0.035, 0.02, 0xe6b04a, 0, 1.21, 0.258), box(0.14, 0.035, 0.02, 0xe6b04a, -0.04, 1.15, 0.258));
  // Etui sur le flanc, pistolet range dedans, tuyau qui pend en boucle.
  g.add(box(0.09, 0.16, 0.13, C.metal, 0.345, 0.95, 0.1));
  g.add(box(0.07, 0.2, 0.08, 0x3a3f44, 0.37, 0.86, 0.1));
  const hose = bend(new THREE.Vector3(0.3, 1.0, -0.08), new THREE.Vector3(0.5, 0.45, -0.1), new THREE.Vector3(0.46, 0.3, -0.01), 4);
  hose.push(...bend(hose[hose.length - 1]!, new THREE.Vector3(0.43, 0.2, 0.06), new THREE.Vector3(0.37, 0.76, 0.1), 4).slice(1));
  g.add(vmesh(tubeGeo(hose, hose.map(() => 0.035), 7, 0x2b2b2b)));
  return mergeColored(g, 0.03);
}

export class ScrapSource {
  readonly root: THREE.Group;
  amount = 6;
  readonly max = 6;
  private regen = 0;
  private shake = 0;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, ry: number, kind: 'car' | 'heap', solids: Circle[]) {
    if (kind === 'car') {
      // Carcasse fusionnee une fois par couleur (une vingtaine de maillages sinon) ; le groupe
      // garde l'inclinaison propre a wreck().
      const tone = x > 0 ? 0x8a5a3a : 0x5f7a8a;
      this.root = shadow(at(shared(`wreck${tone}`, () => mergeColored(group(wreck(tone)))), x, 0, z, ry));
      scene.add(this.root);
    } else {
      const g = shared('heap', scrapHeap);
      this.root = shadow(at(g, x, 0, z, ry));
      scene.add(this.root);
    }
    solids.push({ x, z, r: kind === 'car' ? 1.7 : 1.4 });
  }

  get radius(): number {
    return 2.7;
  }

  hit(): boolean {
    if (this.amount <= 0) return false;
    this.amount -= 1;
    this.shake = 1;
    return true;
  }

  update(dt: number): void {
    if (this.amount < this.max) {
      this.regen += dt;
      if (this.regen > 9) {
        this.regen = 0;
        this.amount += 1;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 6);
    this.root.position.x = this.x + Math.sin(this.shake * 40) * this.shake * 0.06;
  }
}

const ROCK = [0x9a9890, 0x8b867c, 0xaea795];

/** Affleurement rocheux de la carriere : on le casse a la pioche, il se reconstitue lentement. */
export class StoneSource {
  readonly root = new THREE.Group();
  amount = 8;
  readonly max = 8;
  private regen = 0;
  private shake = 0;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, solids: Circle[]) {
    // Gros galets lites et serres (un seul maillage fusionne), eclats et cailloux au pied.
    const r = rng(Math.round(x * 17 + z * 5));
    const rock = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const b = stone(Math.round((0.6 + r() * 0.5) * 20) / 20, ROCK[i % 3]!, i === 0, (r() - 0.5) * 1.6, 0.35 + r() * 0.4, (r() - 0.5) * 1.4);
      b.scale.set(1.05, 0.7 + r() * 0.5, 0.95);
      b.rotation.y = r() * 3;
      rock.add(b);
    }
    for (let i = 0; i < 5; i++) {
      const a = i * 1.26 + r();
      const p = stone(0.12 + (i % 2) * 0.06, ROCK[(i + 1) % 3]!, false, Math.sin(a) * 1.25, 0.06, Math.cos(a) * 1.1);
      p.scale.y = 0.65;
      rock.add(p);
    }
    this.root.add(mergeColored(rock, 0.04));
    shadow(this.root);
    this.root.position.set(x, 0, z);
    scene.add(this.root);
    solids.push({ x, z, r: 1.3 });
  }

  get radius(): number {
    return 2.4;
  }

  hit(): boolean {
    if (this.amount <= 0) return false;
    this.amount -= 1;
    this.shake = 1;
    return true;
  }

  update(dt: number): void {
    if (this.amount < this.max) {
      this.regen += dt;
      if (this.regen > 6) {
        this.regen = 0;
        this.amount += 1;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 6);
    this.root.position.x = this.x + Math.sin(this.shake * 40) * this.shake * 0.05;
    // Plus il est entame, plus il est petit.
    const k = 0.55 + 0.45 * (this.amount / this.max);
    this.root.scale.set(1, k, 1);
  }
}

/** Pompe de la station : il reste du carburant au fond des cuves, on le siphonne en bidons. */
export class Pump {
  readonly root: THREE.Group;
  amount = 4;
  readonly max = 4;
  private regen = 0;
  private shake = 0;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, solids: Circle[]) {
    this.root = shadow(at(shared('pump', pumpModel), x, 0, z));
    scene.add(this.root);
    solids.push({ x, z, r: 0.55 });
  }

  get radius(): number {
    return 1.7;
  }

  take(): boolean {
    if (this.amount <= 0) return false;
    this.amount -= 1;
    this.shake = 1;
    return true;
  }

  update(dt: number): void {
    if (this.amount < this.max) {
      this.regen += dt;
      if (this.regen > 12) {
        this.regen = 0;
        this.amount += 1;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 6);
    this.root.position.z = this.z + Math.sin(this.shake * 40) * this.shake * 0.04;
  }
}

/** Repere visuel commun : cercle pulse au sol autour des zones d'echange. */
export function zoneRing(scene: THREE.Scene, x: number, z: number, r: number, color = 0xffffff): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.22, r, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.04, z);
  scene.add(ring);
  return ring;
}

/** Petit tas d'objets pose au sol (entree ou sortie d'une machine, etal). */
export function pileSlot(i: number, perRow: number, dx = 0.46, dz = 0.4, dy = 0.24): THREE.Vector3 {
  const layer = Math.floor(i / (perRow * 2));
  const k = i % (perRow * 2);
  return new THREE.Vector3((k % perRow - (perRow - 1) / 2) * dx, layer * dy, Math.floor(k / perRow) * dz - dz / 2);
}

