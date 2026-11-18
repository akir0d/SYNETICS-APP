// Silhouettes humaines « figurine » : clients de l'etal, survivants recrutes, marchand, rescape.
// Tete un peu grosse, membres ronds, vetements lisibles de haut (col, ceinture, poches, bretelles).
// Un personnage tient en 5 maillages (corps, 2 bras, 2 jambes) a couleurs de sommets, partageant
// un seul materiau ; les geometries fusionnees sont en cache par apparence : rien n'est cree par
// client qui passe (stations.ts les retire sans dispose).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mergeColored } from './bake';
import { C, blob, box, group, lathe, mat, mixHex, puff, sphere, type Profile } from './kit';

export interface HumanLook {
  shirt: number;
  pants: number;
  hair: number;
  skin?: number;
  hat?: number;
  scale?: number;
}

/** Ombre au sol partagee par tous les personnages (pas de geometrie par client qui passe). */
const BLOB_GEO = new THREE.CircleGeometry(0.5, 14);
const BLOB_MAT = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false });

// ---------------------------------------------------------------- fusion

/** Couleur ou materiau (le joueur passe ses materiaux de tenue, recolores par setOutfit). */
export type Tint = number | THREE.Material;

/**
 * Nuance une piece : couleur partagee assombrie (k < 1) ou eclaircie (k > 1) ; pour un
 * materiau propre a couleurs de sommets (tenue du joueur), la nuance va dans les sommets.
 */
export function tone<T extends THREE.Mesh>(m: T, k: number): T {
  const material = m.material as THREE.MeshLambertMaterial;
  if (material.userData.shared) m.material = mat(material.color.clone().multiplyScalar(k).getHex());
  else m.userData.shade = k;
  return m;
}

/** Copie de geometrie dans le repere donne, reduite a position + normale, toujours indexee. */
function placed(m: THREE.Mesh, rel: THREE.Matrix4, shade: number | null): THREE.BufferGeometry {
  const g = m.geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.index) {
    const n = g.attributes.position!.count;
    const idx: number[] = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(idx);
  }
  g.applyMatrix4(rel);
  if (shade !== null) {
    const col = new Float32Array(g.attributes.position!.count * 3).fill(shade);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}

export interface Fused {
  /** Toutes les pieces a couleurs partagees, en un maillage a couleurs de sommets. */
  colored: THREE.Mesh | null;
  /** Les pieces a materiau propre, fusionnees par materiau (nuances dans les sommets). */
  tinted: THREE.Mesh[];
}

/**
 * Fusionne un assemblage de pieces du kit (repere de `root`) : un maillage pour les couleurs
 * partagees, un par materiau propre. Les geometries temporaires sont liberees.
 */
export function fuseAll(root: THREE.Object3D, vary = 0.025): Fused {
  // Le maillage fusionne est le seul dont le materiau n'appartient a aucune piece.
  const used = new Set<THREE.Material>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) used.add(m.material as THREE.Material);
  });
  const out = mergeColored(root, vary);
  let colored: THREE.Mesh | null = null;
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const rel = new THREE.Matrix4();
  for (const c of out.children) {
    const m = c as THREE.Mesh;
    if (!m.isMesh) continue;
    const material = m.material as THREE.Material;
    if (!used.has(material) && !colored) {
      colored = m;
      continue;
    }
    rel.compose(m.position, m.quaternion, m.scale);
    const vc = !!(material as THREE.MeshLambertMaterial).vertexColors;
    const list = byMat.get(material) ?? [];
    list.push(placed(m, rel, vc ? (m.userData.shade as number | undefined) ?? 1 : null));
    byMat.set(material, list);
  }
  const tinted: THREE.Mesh[] = [];
  for (const [material, geos] of byMat) {
    const g = mergeGeometries(geos, false);
    for (const x of geos) x.dispose();
    if (!g) continue;
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    m.receiveShadow = true;
    tinted.push(m);
  }
  return { colored, tinted };
}

const fusedCache = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }>();

/**
 * Maillage fusionne en cache sous `key` : `make` n'est appele qu'une fois par cle, ensuite la
 * geometrie et le materiau (partage) sont reutilises. `material` remplace le materiau (zombie).
 */
export function fusedMesh(key: string, make: () => THREE.Object3D, material?: THREE.Material): THREE.Mesh {
  let f = fusedCache.get(key);
  if (!f) {
    const { colored } = fuseAll(make());
    const geo = colored ? colored.geometry : new THREE.BufferGeometry();
    f = { geo, mat: colored ? colored.material as THREE.Material : mat(0xffffff) };
    fusedCache.set(key, f);
  }
  const m = new THREE.Mesh(f.geo, material ?? f.mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- gabarit commun

const EYE = 0x2b1d14;
const MOUTH = 0x8a3f33;
const SKINS = [C.skin, 0xe9b386, 0xc98b5f, 0x9a6440, 0xf4d2ac];
const SHOES = [0x4a3020, 0x3a3532, 0x5c3b26];

/** Profils (rayon, hauteur) du gabarit, repere du personnage a l'echelle 1. */
const TORSO: Profile = [
  [0, 0.62], [0.26, 0.62], [0.295, 0.65], [0.305, 0.72], [0.296, 0.84], [0.305, 1.0],
  [0.315, 1.12], [0.29, 1.23], [0.21, 1.31], [0.1, 1.345], [0, 1.35],
];
const HIPS: Profile = [[0, 0.5], [0.2, 0.5], [0.265, 0.56], [0.28, 0.66], [0, 0.69]];
/** Profondeur du torse (section ovale). */
export const TORSO_Z = 0.72;
const SLEEVE_LONG: Profile = [
  [0, -0.49], [0.08, -0.49], [0.1, -0.465], [0.1, -0.4], [0.087, -0.385], [0.112, -0.03], [0.09, 0.08], [0, 0.115],
];
const SLEEVE_SHORT: Profile = [[0, -0.27], [0.1, -0.27], [0.119, -0.25], [0.119, -0.2], [0.116, -0.02], [0.09, 0.08], [0, 0.115]];
const FOREARM: Profile = [[0, -0.5], [0.07, -0.49], [0.08, -0.4], [0.086, -0.27], [0, -0.23]];
const LEG: Profile = [
  [0, -0.52], [0.1, -0.52], [0.114, -0.505], [0.114, -0.44], [0.098, -0.425], [0.1, -0.22],
  [0.118, -0.02], [0.105, 0.05], [0, 0.095],
];
const LEG_PLAIN: Profile = [[0, -0.52], [0.1, -0.52], [0.106, -0.5], [0.1, -0.22], [0.118, -0.02], [0.105, 0.05], [0, 0.095]];
const BOOT: Profile = [[0.112, -0.57], [0.124, -0.52], [0.124, -0.41], [0.106, -0.395]];
const COLLAR: Profile = [[0.13, 1.29], [0.2, 1.3], [0.218, 1.34], [0.175, 1.385]];
const CREW: Profile = [[0.2, 1.3], [0.216, 1.32], [0.19, 1.345], [0.15, 1.356]];
const BELT: Profile = [[0.3, 0.7], [0.318, 0.712], [0.318, 0.768], [0.3, 0.78]];
const HAT_BRIM: Profile = [
  [0, 0.15], [0.375, 0.15], [0.4, 0.165], [0.378, 0.18], [0.305, 0.185], [0.29, 0.31], [0.21, 0.385], [0, 0.395],
];
const BEANIE: Profile = [
  [0.3, 0.1], [0.316, 0.115], [0.316, 0.18], [0.3, 0.19], [0.29, 0.24], [0.24, 0.33], [0.13, 0.385], [0, 0.4],
];
const CAP_DOME: Profile = [[0.312, 0.1], [0.302, 0.17], [0.262, 0.27], [0.17, 0.34], [0, 0.37]];
const CAP_BRIM: Profile = [[0, -0.016], [0.22, -0.016], [0.236, 0], [0.22, 0.016], [0, 0.016]];

/** Sur la face avant du torse ovale (rayon r a cette hauteur) : position z et angle pour suivre la courbe. */
export function onFront(x: number, r: number, depth = TORSO_Z): { z: number; ry: number } {
  const b = r * depth;
  const z = b * Math.sqrt(Math.max(0, 1 - (x * x) / (r * r)));
  return { z, ry: Math.atan2(x / (r * r), z / (b * b)) };
}

export function oval<T extends THREE.Object3D>(o: T, k = TORSO_Z): T {
  o.scale.z = k;
  return o;
}

export interface HeadOpts {
  skin: number;
  hair: number;
  /** 0 courts, 1 boucles, 2 chignon, 3 ras + barbe. */
  hairStyle: number;
  /** Couvre-chef : 0 chapeau a bord, 1 bonnet, 2 casquette. */
  hat?: { tint: Tint; style: number };
}

/** Tete (centre en 0, rayon 0.29) : visage simple et sympathique, coiffure, couvre-chef. */
export function headParts(o: HeadOpts): THREE.Group {
  const skin = o.skin;
  const g = group(
    sphere(0.29, skin, 0, 0, 0, 14),
    oval(blob(0.065, skin, -0.282, -0.02, -0.01), 0.75),
    oval(blob(0.065, skin, 0.282, -0.02, -0.01), 0.75),
    // Yeux ovales, sourcils doux, nez rond.
    sphere(0.042, EYE, -0.1, 0, 0.256, 6), sphere(0.042, EYE, 0.1, 0, 0.256, 6),
    blob(0.048, mixHex(skin, 0xb0603a, 0.18), 0, -0.04, 0.28),
  );
  for (const e of g.children.slice(3, 5)) e.scale.set(1, 1.3, 0.8);
  const brow = mixHex(o.hair, 0x000000, 0.2);
  const bl = box(0.1, 0.024, 0.018, brow, -0.1, 0.088, 0.262);
  bl.rotation.z = 0.14;
  const br = box(0.1, 0.024, 0.018, brow, 0.1, 0.088, 0.262);
  br.rotation.z = -0.14;
  g.add(bl, br);
  const beard = o.hairStyle === 3;
  if (!beard) g.add(box(0.075, 0.02, 0.018, MOUTH, 0, -0.1, 0.268));

  const hair = o.hair;
  if (o.hat) {
    // Sous un couvre-chef : cheveux visibles sur la nuque et les cotes seulement.
    const cap = sphere(0.298, hair, 0, 0.02, -0.04, -10);
    cap.scale.set(1.02, 0.85, 1);
    g.add(cap);
  } else if (o.hairStyle === 1) {
    const curls = puff(0.29, hair, 0, 0.1, -0.07, 3, 0.2);
    curls.scale.set(1.12, 0.92, 1.1);
    g.add(curls);
  } else {
    const short = o.hairStyle === 3;
    const cap = sphere(short ? 0.296 : 0.3, hair, 0, short ? 0.04 : 0.065, short ? -0.02 : -0.045, -12);
    cap.scale.set(short ? 1.01 : 1.04, short ? 0.84 : 0.86, short ? 1 : 1.02);
    g.add(cap);
    if (o.hairStyle === 0) {
      const fringe = blob(0.09, hair, 0.07, 0.2, 0.18);
      fringe.scale.set(1.5, 0.6, 1);
      fringe.rotation.z = -0.25;
      g.add(fringe);
    } else if (o.hairStyle === 2) {
      g.add(sphere(0.1, hair, 0, 0.3, -0.13, 10));
    }
  }
  if (beard) {
    const b = sphere(0.21, hair, 0, -0.14, 0.1, -10);
    b.scale.set(1.15, 0.75, 0.9);
    g.add(b);
  }

  if (o.hat) {
    const t = o.hat.tint;
    if (o.hat.style === 0) {
      g.add(lathe(HAT_BRIM, t, 0, 0, -0.01, 16));
    } else if (o.hat.style === 1) {
      g.add(lathe(BEANIE, t, 0, 0, -0.01, 16));
      g.add(tone(blob(0.075, t, 0, 0.42, -0.01), 1.18));
    } else {
      g.add(lathe(CAP_DOME, t, 0, 0, -0.01, 16));
      const brim = tone(lathe(CAP_BRIM, t, 0, 0.115, 0.25, 12), 0.86);
      brim.scale.z = 0.75;
      brim.rotation.x = 0.1;
      g.add(brim);
    }
  }
  return g;
}

export interface TorsoOpts {
  shirt: Tint;
  pants: Tint;
  /** 0 veste (col, fermeture, poches), 1 t-shirt et ceinture, 2 chemise a bretelles. */
  style: number;
  belt?: number;
}

/** Tronc et bassin, repere du personnage (pieds en y = 0). */
export function torsoParts(o: TorsoOpts): THREE.Group {
  const g = group(oval(lathe(TORSO, o.shirt, 0, 0, 0, 12)), oval(lathe(HIPS, o.pants, 0, 0, 0, 10), 0.74));
  const belt = (): void => {
    const c = o.belt ?? 0x5a3a24;
    g.add(oval(lathe(BELT, c, 0, 0, 0, 16)));
    g.add(box(0.08, 0.062, 0.02, C.tin, 0, 0.74, 0.318 * TORSO_Z + 0.004));
  };
  if (o.style === 0) {
    g.add(tone(oval(lathe(COLLAR, o.shirt, 0, 0, 0, 14), 0.85), 0.8));
    g.add(box(0.028, 0.44, 0.014, 0xe8e2d4, 0, 0.98, 0.222));
    for (const s of [-1, 1]) {
      const f = onFront(0.14, 0.31);
      const flap = tone(box(0.13, 0.05, 0.014, o.shirt, s * 0.14, 1.04, f.z + 0.004), 0.78);
      flap.rotation.y = s * f.ry;
      g.add(flap);
    }
  } else if (o.style === 1) {
    g.add(tone(oval(lathe(CREW, o.shirt, 0, 0, 0, 14), 0.85), 1.22));
    belt();
  } else {
    const strap = typeof o.pants === 'number' ? mixHex(o.pants, 0x000000, 0.2) : o.pants;
    for (const s of [-1, 1]) {
      const f = onFront(0.12, 0.305);
      const front = box(0.055, 0.5, 0.016, strap, s * 0.12, 0.99, f.z + 0.006);
      front.rotation.y = s * f.ry;
      const back = box(0.055, 0.5, 0.016, strap, s * 0.12, 0.99, -f.z - 0.006);
      back.rotation.y = -s * f.ry;
      const over = box(0.055, 0.016, 0.34, strap, s * 0.13, 1.3, -0.01);
      over.rotation.z = s * -0.35;
      g.add(front, back, over, sphere(0.022, C.tin, s * 0.12, 1.2, f.z + 0.015, 6));
    }
    belt();
  }
  return g;
}

export interface ArmOpts {
  sleeve: Tint;
  skin: number;
  /** Manches courtes : avant-bras nus. */
  short?: boolean;
  /** Couleur de la main (gant), sinon la peau. */
  glove?: number;
}

/** Bras pendant depuis l'epaule (pivot en 0) ; la main est vers y = -0.565. */
export function armParts(o: ArmOpts): THREE.Group {
  const g = new THREE.Group();
  if (o.short) {
    g.add(lathe(SLEEVE_SHORT, o.sleeve, 0, 0, 0, 10), lathe(FOREARM, o.skin, 0, 0, 0, 10));
  } else {
    const s = lathe(SLEEVE_LONG, o.sleeve, 0, 0, 0, 10);
    g.add(s);
  }
  const hand = sphere(0.088, o.glove ?? o.skin, 0, -0.565, 0.01, -7);
  hand.scale.set(0.95, 1.05, 0.95);
  g.add(hand);
  return g;
}

export interface LegOpts {
  pants: Tint;
  shoe: number;
  /** Bottes montantes (le joueur). */
  boots?: boolean;
}

/** Jambe depuis la hanche (pivot en 0), chaussure ronde au sol (y = -0.66). */
export function legParts(o: LegOpts): THREE.Group {
  const g = group(lathe(o.boots ? LEG_PLAIN : LEG, o.pants, 0, 0, 0, 10));
  const shoe = sphere(0.115, o.shoe, 0, -0.585, 0.045, -8);
  shoe.scale.set(1, 0.62, 1.45);
  g.add(shoe);
  if (o.boots) g.add(lathe(BOOT, o.shoe, 0, 0, 0, 10));
  return g;
}

// ---------------------------------------------------------------- apparence

/** Hachage reproductible d'une apparence : coiffure, vetements, teint, chaussures. */
function styleOf(l: HumanLook): { hair: number; top: number; hat: number; skin: number; shoe: number } {
  let h = 0xb1ed6895;
  for (const v of [l.shirt, l.pants, l.hair, l.hat ?? 0x777]) {
    h = Math.imul(h ^ v, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  h >>>= 0;
  return { hair: h % 4, top: (h >>> 3) % 3, hat: (h >>> 6) % 3, skin: (h >>> 9) % SKINS.length, shoe: (h >>> 13) % SHOES.length };
}

export class Human {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly legL: THREE.Object3D;
  readonly legR: THREE.Object3D;
  readonly armL: THREE.Object3D;
  readonly armR: THREE.Object3D;
  readonly hand: THREE.Object3D;
  phase = Math.random() * 6;
  heading = 0;
  speed = 0;

  constructor(look: HumanLook) {
    const st = styleOf(look);
    const skin = look.skin ?? SKINS[st.skin]!;
    const shoe = SHOES[st.shoe]!;
    // Les boucles ne passent pas sous un chapeau.
    const hairStyle = look.hat !== undefined && st.hair === 1 ? 0 : st.hair;
    const id = `${look.shirt}|${look.pants}|${look.hair}|${look.hat ?? ''}|${skin}`;

    const leg = (): THREE.Mesh => fusedMesh(`hl|${look.pants}|${shoe}`, () => legParts({ pants: look.pants, shoe }));
    const arm = (): THREE.Mesh => fusedMesh(`ha|${look.shirt}|${skin}|${st.top}`, () => armParts({ sleeve: look.shirt, skin, short: st.top === 1 }));
    this.legL = group(leg());
    this.legR = group(leg());
    this.legL.position.set(-0.16, 0.66, 0);
    this.legR.position.set(0.16, 0.66, 0);
    this.armL = group(arm());
    this.hand = new THREE.Group();
    this.hand.position.set(0, -0.58, 0.05);
    this.armR = group(arm(), this.hand);
    this.armL.position.set(-0.4, 1.22, 0);
    this.armR.position.set(0.4, 1.22, 0);
    const trunk = fusedMesh(`hb|${id}|${hairStyle}|${st.top}|${st.hat}`, () => {
      const head = headParts({
        skin, hair: look.hair, hairStyle,
        hat: look.hat !== undefined ? { tint: look.hat, style: st.hat } : undefined,
      });
      head.position.set(0, 1.56, 0);
      return group(torsoParts({ shirt: look.shirt, pants: look.pants, style: st.top }), head);
    });
    this.body.add(trunk, this.legL, this.legR, this.armL, this.armR);
    this.root.add(this.body);
    const blobShadow = new THREE.Mesh(BLOB_GEO, BLOB_MAT);
    blobShadow.rotation.x = -Math.PI / 2;
    blobShadow.position.y = 0.02;
    this.root.add(blobShadow);
    this.root.scale.setScalar(look.scale ?? 1);
  }

  /** Avance vers une cible ; renvoie true une fois arrive. */
  walkTo(target: THREE.Vector3, maxSpeed: number, dt: number, stop = 0.15): boolean {
    const p = this.root.position;
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= stop) {
      this.speed = Math.max(0, this.speed - dt * 12);
      return true;
    }
    this.speed = Math.min(maxSpeed, this.speed + dt * 14);
    const step = Math.min(d, this.speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    this.face(Math.atan2(dx, dz), dt);
    return false;
  }

  face(angle: number, dt: number): void {
    let diff = angle - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * (1 - Math.exp(-12 * dt));
    this.body.rotation.y = this.heading;
  }

  animate(dt: number, carrying: boolean, working = 0): void {
    const k = Math.min(1, this.speed / 4);
    this.phase += dt * (4 + this.speed * 1.6);
    const sw = Math.sin(this.phase) * 0.7 * k;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    const swing = carrying ? 0.3 : 0.7;
    this.armL.rotation.x = -sw * swing - (carrying ? 0.2 : 0);
    this.armR.rotation.x = working > 0 ? -2.2 + Math.sin(working * Math.PI) * 2.0 : sw * swing - (carrying ? 0.2 : 0);
    this.body.position.y = Math.abs(Math.sin(this.phase)) * 0.07 * k;
  }
}
