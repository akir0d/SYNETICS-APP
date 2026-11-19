// Petit kit de modelisation « figurine » : materiaux partages, formes douces et arrondies.
// Ombrage lisse par defaut, ombrage d'ambiance commun (contact au sol + lisere), primitives
// assez decoupees pour etre rondes. Toutes les geometries sont en cache : on les partage.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const C = {
  grass: 0x8e9f55,
  grassDark: 0x728640,
  grassLight: 0xa6b363,
  dirt: 0xbf9a6e,
  dirtDark: 0x9a7650,
  soil: 0x7a4a2a,
  wood: 0xc68a4f,
  woodDark: 0x8d5a30,
  woodLight: 0xe0b077,
  rust: 0xb8653a,
  rustDark: 0x8a4526,
  concrete: 0xb9b1a3,
  concreteDark: 0x8f877a,
  stone: 0x9a9890,
  leaf: 0x6a9a3e,
  leafDark: 0x4d7633,
  leafLight: 0x8cae4f,
  pine: 0x3f6b47,
  white: 0xf4efe4,
  glass: 0xbfe6ff,
  metal: 0x7d8790,
  skin: 0xf1c27d,
  jacket: 0x3d7fd6,
  jeans: 0x34495e,
  cap: 0xe0443a,
  zombieSkin: 0x8fa66e,
  bulb: 0xffd27a,
  fire: 0xff8a2a,
  // Teintes voisines pour varier sans aplat (ajoutees avec le rendu lisse).
  bark: 0x7a5236,
  barkDark: 0x5c3d28,
  leafSun: 0xa3bf5a,
  leafDeep: 0x3f6530,
  pineLight: 0x55805a,
  canvas: 0xd9c9a3,
  tarp: 0x4f7f8a,
  rope: 0xc9b07a,
  sand: 0xd8c08e,
  tin: 0xa9b2b6,
  olive: 0x6f7a4a,
  brick: 0xb0654a,
};

// ---------------------------------------------------------------- ombrage d'ambiance

/**
 * Reglages partages de l'ombrage d'ambiance (uniformes communs a tous les materiaux « look ») :
 * - rim : couleur * force du lisere de lumiere sur les contours (anime jour/nuit par main.ts) ;
 * - ao : x = force de l'assombrissement au contact du sol, y = hauteur (unites) ou il s'efface.
 */
export const LOOK = {
  rim: { value: new THREE.Color(0xffe6c4).multiplyScalar(0.42) },
  ao: { value: new THREE.Vector2(0.45, 0.8) },
};

// Lambert « adouci » : la transition ombre/lumiere est elargie (aspect figurine),
// sans rien changer la ou dotNL vaut 0 (les ombres portees restent coherentes).
const SOFT_LAMBERT = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  'vec3 irradiance = dotNL * directLight.color;',
  'dotNL = mix( dotNL, smoothstep( 0.0, 0.6, dotNL ), 0.45 );\n\tvec3 irradiance = dotNL * directLight.color;',
);

const LOOK_VERT = /* glsl */`#include <project_vertex>
	vec4 lkW = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		lkW = batchingMatrix * lkW;
	#endif
	#ifdef USE_INSTANCING
		lkW = instanceMatrix * lkW;
	#endif
	vLookY = ( modelMatrix * lkW ).y;`;

const LOOK_FRAG = /* glsl */`#include <aomap_fragment>
	{
		// Normale dans le repere du monde (la matrice de vue est orthonormee).
		vec3 lkN = ( vec4( normal, 0.0 ) * viewMatrix ).xyz;
		// Contact au sol : bas des objets plus sombre, jamais les faces tournees vers le ciel.
		float lkC = 1.0 - smoothstep( 0.0, lookAO.y, vLookY );
		lkC *= lkC * ( 1.0 - smoothstep( 0.3, 0.9, lkN.y ) );
		float lkAo = 1.0 - lookAO.x * lkC;
		reflectedLight.indirectDiffuse *= lkAo;
		reflectedLight.directDiffuse *= 1.0 - 0.6 * lookAO.x * lkC;
		// Lisere : les contours s'eclairent, surtout le haut des formes (lumiere du ciel) ;
		// les murs verticaux, rasants vus d'en haut, n'en recoivent qu'un peu.
		float lkF = 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) );
		lkF = lkF * lkF * lkF;
		reflectedLight.indirectDiffuse += lookRim * diffuseColor.rgb * lkF * saturate( lkN.y + 0.35 );
	}`;

/** Coupe si un programme « look » n'a pas compile sur l'appareil (voir guardShaders). */
let lookOff = false;

/** Faux si l'ombrage d'ambiance a ete coupe apres un echec de compilation. */
export function lookActive(): boolean {
  return !lookOff;
}

function lookCompile(shader: THREE.WebGLProgramParametersWithUniforms): void {
  if (lookOff) return;
  shader.uniforms.lookRim = LOOK.rim;
  shader.uniforms.lookAO = LOOK.ao;
  shader.vertexShader = 'varying float vLookY;\n' + shader.vertexShader.replace('#include <project_vertex>', LOOK_VERT);
  shader.fragmentShader = 'uniform vec3 lookRim;\nuniform vec2 lookAO;\nvarying float vLookY;\n' + shader.fragmentShader
    .replace('#include <lights_lambert_pars_fragment>', SOFT_LAMBERT)
    .replace('#include <aomap_fragment>', LOOK_FRAG);
}
// La cle change quand l'ombrage est coupe : three recompile alors en Lambert simple.
const lookKey = (): string => (lookOff ? 'bastion-look-off' : 'bastion-look-1');

/**
 * Filet de securite : si un shader ne compile pas sur l'appareil (WebView ancienne, pilote
 * capricieux), on journalise l'erreur puis on coupe l'ombrage d'ambiance et on recompile
 * tous les materiaux de la scene (Lambert lisse simple). Si l'echec vient d'un programme sans
 * « look » (ou persiste), on appelle une seule fois fallback (ex. courbe de tons d'origine).
 */
export function guardShaders(renderer: THREE.WebGLRenderer, scene: THREE.Scene, fallback?: () => void): void {
  let spare = fallback;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const src = gl.getShaderSource(fs) || '';
    console.error('Bastion : shader en echec' + (src.indexOf('lookRim') >= 0 ? ' (look)' : ''),
      '\nprogramme : ' + (gl.getProgramInfoLog(program) || '').trim(),
      '\nvertex : ' + (gl.getShaderInfoLog(vs) || '').trim(),
      '\nfragment : ' + (gl.getShaderInfoLog(fs) || '').trim());
    if (!lookOff && src.indexOf('lookRim') >= 0) {
      lookOff = true;
      console.error('Bastion : ombrage d\'ambiance coupe, rendu en Lambert simple.');
    } else if (spare) {
      const f = spare;
      spare = undefined;
      f();
    } else return;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      if (Array.isArray(m)) for (const x of m) x.needsUpdate = true;
      else m.needsUpdate = true;
    });
  };
}

/**
 * Donne l'ombrage d'ambiance a un MeshLambertMaterial (le programme est partage entre tous
 * les materiaux « look » : aucun cout de compilation en plus). A utiliser pour un materiau
 * cree a la main (personnage, zombie...). Jamais pour le sol.
 */
export function look<T extends THREE.MeshLambertMaterial>(m: T): T {
  m.onBeforeCompile = lookCompile;
  m.customProgramCacheKey = lookKey;
  return m;
}

/** Vrai si le materiau porte l'ombrage d'ambiance (look, lookMat, mat sans ground). */
export function isLook(m: THREE.Material): boolean {
  return m.customProgramCacheKey === lookKey;
}

/** Nouveau Lambert lisse avec l'ombrage d'ambiance (materiau NON partage : a creer une fois). */
export function lookMat(params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return look(new THREE.MeshLambertMaterial(params));
}

// ---------------------------------------------------------------- materiaux

export interface MatOpts {
  emissive?: number;
  opacity?: number;
  /** Facettes visibles (aspect low poly) : seulement si on le veut vraiment. */
  flat?: boolean;
  /** Sol, taches de terre, routes, eau, flaques : ni contact au sol ni lisere. */
  ground?: boolean;
  /** Visible des deux cotes (bache, feuille) : garde a part par mergeColored. */
  double?: boolean;
}

const matCache = new Map<string, THREE.Material>();

/** Materiau partage (en cache par couleur et options) : Lambert lisse + ombrage d'ambiance. */
export function mat(color: number, opts: MatOpts = {}): THREE.MeshLambertMaterial {
  const flat = opts.flat ?? false;
  const ground = opts.ground ?? false;
  const double = opts.double ?? false;
  const key = `${color}|${opts.emissive ?? ''}|${opts.opacity ?? ''}|${flat}|${ground}|${double}`;
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      flatShading: flat,
      emissive: opts.emissive ?? 0x000000,
      transparent: opts.opacity !== undefined,
      opacity: opts.opacity ?? 1,
      depthWrite: opts.opacity === undefined,
      side: double ? THREE.DoubleSide : THREE.FrontSide,
    });
    if (!ground) look(m);
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/** Materiau partage pour le sol (taches de terre, routes, flaques) : sans ombrage d'ambiance. */
export function groundMat(color: number, opts: { opacity?: number } = {}): THREE.MeshLambertMaterial {
  return mat(color, { ground: true, opacity: opts.opacity });
}

/** Materiau non partage : pour ce qu'on anime (emissive de nuit, flash de degat). */
export function uniqueMat(color: number, emissive = 0x000000): THREE.MeshLambertMaterial {
  return lookMat({ color, emissive });
}

let vcolMat: THREE.MeshLambertMaterial | null = null;
/**
 * Materiau partage blanc a couleurs de sommets (voir paint / vgrad) : les degrades et
 * variations survivent a mergeColored et bakeStatic.
 */
export function vmat(): THREE.MeshLambertMaterial {
  if (!vcolMat) {
    vcolMat = lookMat({ color: 0xffffff, vertexColors: true });
    vcolMat.userData.shared = true;
  }
  return vcolMat;
}

export function shadow<T extends THREE.Object3D>(o: T, cast = true, receive = true): T {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = cast;
      c.receiveShadow = receive;
    }
  });
  return o;
}

export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const M = (color: number | THREE.Material): THREE.Material => (typeof color === 'number' ? mat(color) : color);

// ---------------------------------------------------------------- decoupage minimal

/** Nombre de cotes d'une forme de revolution selon son rayon : rond, sans gaspiller. */
function ringSeg(r: number): number {
  return r < 0.06 ? 8 : r < 0.1 ? 10 : r < 0.16 ? 12 : r < 0.4 ? 16 : r < 1 ? 20 : 24;
}
/** seg negatif = nombre exact de cotes voulu (facettes assumees : ecrou, pyramide). */
function segFor(seg: number, r: number): number {
  return seg < 0 ? Math.max(3, -seg) : Math.max(seg, ringSeg(r));
}
/** Subdivision d'une sphere « organique » (icosaedre) selon son rayon. */
function icoDetail(r: number): number {
  return r < 0.07 ? 0 : r < 0.15 ? 1 : r < 0.5 ? 2 : 3;
}

// ---------------------------------------------------------------- constructions de geometrie

/**
 * Assemble une geometrie indexee et remet chaque triangle a l'endroit d'apres les normales
 * de ses sommets (on peut ainsi construire sans se soucier du sens de rotation).
 */
function build(pos: number[], nor: number[], idx: number[], uv?: number[]): THREE.BufferGeometry {
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t]! * 3, b = idx[t + 1]! * 3, c = idx[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!;
    const vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const nx = nor[a]! + nor[b]! + nor[c]!, ny = nor[a + 1]! + nor[b + 1]! + nor[c + 1]!, nz = nor[a + 2]! + nor[b + 2]! + nor[c + 2]!;
    if (fx * nx + fy * ny + fz * nz < 0) {
      const s = idx[t + 1]!;
      idx[t + 1] = idx[t + 2]!;
      idx[t + 2] = s;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Profil d'une forme de revolution : paires [rayon, hauteur], du bas vers le haut. */
export type Profile = ReadonlyArray<readonly [number, number]>;

/**
 * Tour (revolution autour de Y). Normales lissees en ponderant par la longueur des segments
 * (un petit biseau prend la normale de ses grands voisins : arete adoucie) ; au-dela de
 * `crease` radians entre deux segments, l'arete reste vive. Un point de rayon 0 est un pole.
 */
function latheGeo(prof: Profile, seg: number, crease = 1.0): THREE.BufferGeometry {
  const p: [number, number][] = [];
  for (const [r, y] of prof) {
    const last = p[p.length - 1];
    if (last && Math.abs(last[0] - r) < 1e-6 && Math.abs(last[1] - y) < 1e-6) continue;
    p.push([Math.max(0, r), y]);
  }
  const n = p.length;
  const sn: [number, number][] = [];
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dr = p[i + 1]![0] - p[i]![0];
    const dy = p[i + 1]![1] - p[i]![1];
    const l = Math.hypot(dr, dy) || 1e-6;
    sn.push([dy / l, -dr / l]);
    sl.push(l);
  }
  type V = { r: number; y: number; nr: number; ny: number; at: number };
  const inc: V[] = [];
  const out: V[] = [];
  const cosC = Math.cos(crease);
  for (let i = 0; i < n; i++) {
    const [r, y] = p[i]!;
    const a = i > 0 ? sn[i - 1]! : null;
    const b = i < n - 1 ? sn[i]! : null;
    if (a && b && a[0] * b[0] + a[1] * b[1] < cosC) {
      inc[i] = { r, y, nr: a[0], ny: a[1], at: -1 };
      out[i] = { r, y, nr: b[0], ny: b[1], at: -1 };
    } else {
      let nr: number;
      let ny: number;
      if (a && b) {
        nr = a[0] * sl[i - 1]! + b[0] * sl[i]!;
        ny = a[1] * sl[i - 1]! + b[1] * sl[i]!;
        const l = Math.hypot(nr, ny) || 1;
        nr /= l;
        ny /= l;
      } else {
        const s = (a ?? b)!;
        nr = s[0];
        ny = s[1];
      }
      const v = { r, y, nr, ny, at: -1 };
      inc[i] = v;
      out[i] = v;
    }
  }
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  const step = (Math.PI * 2) / seg;
  // Un anneau = seg sommets ; un pole = seg sommets aussi (un par triangle, normale au milieu).
  const ring = (v: V, pole: boolean): number => {
    if (v.at >= 0) return v.at;
    v.at = pos.length / 3;
    for (let j = 0; j < seg; j++) {
      const a = (j + (pole ? 0.5 : 0)) * step;
      const s = Math.sin(a);
      const c = Math.cos(a);
      pos.push(s * v.r, v.y, c * v.r);
      nor.push(s * v.nr, v.ny, c * v.nr);
    }
    return v.at;
  };
  for (let i = 0; i < n - 1; i++) {
    const va = out[i]!;
    const vb = inc[i + 1]!;
    const pa = va.r < 1e-5;
    const pb = vb.r < 1e-5;
    if (pa && pb) continue;
    const A = ring(va, pa);
    const B = ring(vb, pb);
    for (let j = 0; j < seg; j++) {
      const j1 = (j + 1) % seg;
      if (pa) idx.push(A + j, B + j, B + j1);
      else if (pb) idx.push(A + j, A + j1, B + j);
      else idx.push(A + j, A + j1, B + j1, A + j, B + j1, B + j);
    }
  }
  return build(pos, nor, idx);
}

/** Boite chanfreinee (44 triangles) : les biseaux prennent les normales des faces voisines, l'arete accroche la lumiere comme un arrondi. */
function chamferBox(w: number, h: number, d: number, b: number): THREE.BufferGeometry {
  const half = [w / 2, h / 2, d / 2];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Sommet du coin `c` (signes) appartenant a la face d'axe `a`.
  const vtx = new Map<string, number>();
  const V = (c: number[], a: number): number => {
    const key = `${c.join(',')}|${a}`;
    let i = vtx.get(key);
    if (i === undefined) {
      i = pos.length / 3;
      const p = [0, 1, 2].map((k) => c[k]! * (half[k]! - (k === a ? 0 : b)));
      pos.push(p[0]!, p[1]!, p[2]!);
      nor.push(a === 0 ? c[0]! : 0, a === 1 ? c[1]! : 0, a === 2 ? c[2]! : 0);
      const u = a === 0 ? 2 : 0;
      const v = a === 1 ? 2 : 1;
      uv.push(p[u]! / (2 * half[u]!) + 0.5, p[v]! / (2 * half[v]!) + 0.5);
      vtx.set(key, i);
    }
    return i;
  };
  const S = [-1, 1];
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const s of S) {
      // Face
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
        const c = [0, 0, 0];
        c[a] = s;
        c[u] = su!;
        c[v] = sv!;
        return V(c, a);
      });
      idx.push(q[0]!, q[1]!, q[2]!, q[0]!, q[2]!, q[3]!);
    }
    // Biseaux le long de l'axe a (entre les faces u et v).
    for (const su of S) {
      for (const sv of S) {
        const c0 = [0, 0, 0];
        const c1 = [0, 0, 0];
        c0[a] = -1;
        c1[a] = 1;
        c0[u] = c1[u] = su;
        c0[v] = c1[v] = sv;
        const e = [V(c0, u), V(c0, v), V(c1, v), V(c1, u)];
        idx.push(e[0]!, e[1]!, e[2]!, e[0]!, e[2]!, e[3]!);
      }
    }
  }
  for (const sx of S) for (const sy of S) for (const sz of S) {
    const c = [sx, sy, sz];
    idx.push(V(c, 0), V(c, 1), V(c, 2));
  }
  return build(pos, nor, idx, uv);
}

/** Sphere bosselee (icosaedre subdivise, sommets partages, normales lisses), rayon ~1. */
function lumpyGeo(detail: number, seed: number, lump: number, flatten: number, lobes: number): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const r = rng(seed * 7919 + 17);
  const dirs: THREE.Vector3[] = [];
  const wts: number[] = [];
  for (let k = 0; k < lobes; k++) {
    // Lobes plutot vers le haut et l'exterieur : silhouette de nuage, pas de patate.
    dirs.push(new THREE.Vector3(r() * 2 - 1, r() * 1.6 - 0.5, r() * 2 - 1).normalize());
    wts.push(0.6 + r() * 0.5);
  }
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const f = new Float32Array(pos.count);
  const v = new THREE.Vector3();
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let s = 0;
    for (let k = 0; k < lobes; k++) {
      const d = Math.max(0, v.dot(dirs[k]!));
      s += wts[k]! * d * d * d;
    }
    f[i] = s;
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  const span = hi - lo || 1;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(1 + lump * ((f[i]! - lo) / span - 0.5));
    if (v.y < 0) v.y *= flatten;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Quart de cercle (k pas) de centre (cx, cy), de l'angle a0 a a1. */
function arc(out: [number, number][], cx: number, cy: number, rad: number, a0: number, a1: number, k: number): void {
  for (let i = 0; i <= k; i++) {
    const a = a0 + ((a1 - a0) * i) / k;
    out.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
}
const arcSteps = (r: number): number => (r < 0.06 ? 2 : r < 0.25 ? 3 : r < 0.6 ? 4 : 5);

function cylProfile(rt: number, rb: number, h: number): Profile {
  const y0 = -h / 2;
  const y1 = h / 2;
  const big = Math.max(rt, rb);
  const b = big < 0.08 ? 0 : Math.min(0.04, 0.22 * Math.min(big, h));
  const p: [number, number][] = [[0, y0]];
  if (rb > 1e-4) {
    if (b > 0 && rb > b * 1.6) p.push([rb - b, y0], [rb, y0 + b]);
    else p.push([rb, y0]);
  }
  if (rt > 1e-4) {
    if (b > 0 && rt > b * 1.6) p.push([rt, y1 - b], [rt - b, y1]);
    else p.push([rt, y1]);
  }
  p.push([0, y1]);
  return p;
}

function coneProfile(r: number, h: number, round: number): Profile {
  const y0 = -h / 2;
  const y1 = h / 2;
  const p: [number, number][] = [[0, y0]];
  const b = r < 0.08 ? 0 : Math.min(0.04, 0.2 * Math.min(r, h));
  const L = Math.hypot(r, h) || 1;
  // Chanfrein de la base : un pas sur le fond, un pas le long de la pente.
  if (b > 0) p.push([r - b, y0], [r - (r * b) / L, y0 + (h * b) / L]);
  else p.push([r, y0]);
  const q = r < 0.1 ? 0 : Math.min(0.45, round);
  if (q > 0) {
    // Pointe arrondie : courbe de Bezier tangente a la pente, a plat sur l'axe.
    const pa: [number, number] = [r * q, y1 - h * q];
    const yE = y1 - h * q * 0.5;
    const cc: [number, number] = [r * q * 0.5, yE];
    for (const t of [0, 0.5]) {
      const u = 1 - t;
      p.push([u * u * pa[0] + 2 * u * t * cc[0], u * u * pa[1] + 2 * u * t * cc[1] + t * t * yE]);
    }
    p.push([0, yE]);
    // On etire en hauteur pour que la pointe arrondie touche toujours y = h / 2.
    const k = h / (yE - y0);
    for (const q2 of p) q2[1] = y0 + (q2[1] - y0) * k;
  } else {
    p.push([0, y1]);
  }
  return p;
}

function pillProfile(rt: number, rb: number, h: number): Profile {
  const s = Math.min(1, h / Math.max(1e-4, rt + rb));
  const ra = rb * s;
  const rc = rt * s;
  const p: [number, number][] = [];
  arc(p, 0, -h / 2 + ra, ra, -Math.PI / 2, 0, arcSteps(ra));
  arc(p, 0, h / 2 - rc, rc, 0, Math.PI / 2, arcSteps(rc));
  return p;
}

function rcylProfile(rt: number, rb: number, h: number, round: number): Profile {
  const e = Math.max(0.002, Math.min(1, round) * Math.min(Math.max(rt, rb), h / 2));
  const eb = Math.min(e, rb);
  const et = Math.min(e, rt);
  const p: [number, number][] = [[0, -h / 2]];
  arc(p, rb - eb, -h / 2 + eb, eb, -Math.PI / 2, 0, arcSteps(eb));
  arc(p, rt - et, h / 2 - et, et, 0, Math.PI / 2, arcSteps(et));
  p.push([0, h / 2]);
  return p;
}

const pkey = (prof: Profile): string => prof.map((q) => `${q[0].toFixed(4)},${q[1].toFixed(4)}`).join(';');

// ---------------------------------------------------------------- primitives

/** Boite aux aretes legerement chanfreinees (lumiere accrochee sur les aretes). */
export function box(w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`b${w},${h},${d}`, () => {
    const b = Math.min(0.04, Math.min(w, h, d) * 0.22);
    return b < 0.004 ? new THREE.BoxGeometry(w, h, d) : chamferBox(w, h, d, b);
  });
  return mesh(g, M(color), x, y, z);
}

/** Planche biseautee : comme box, avec un biseau plus marque (bois, caisses, poutres). */
export function plank(w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`pk${w},${h},${d}`, () => chamferBox(w, h, d, Math.min(0.06, Math.min(w, h, d) * 0.3)));
  return mesh(g, M(color), x, y, z);
}

/** Boite aux aretes arrondies : le cote « jouet » de la DA. */
export function rbox(w: number, h: number, d: number, color: number | THREE.Material, r = 0.08, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`rb${w},${h},${d},${r}`, () => {
    const rr = Math.min(r, w / 2, h / 2, d / 2);
    return new RoundedBoxGeometry(w, h, d, rr >= 0.12 ? 3 : 2, rr);
  });
  return mesh(g, M(color), x, y, z);
}

/** Cylindre (ou tronc de cone) aux bords biseautes ; seg est un minimum (negatif = exact, facettes). */
export function cyl(rt: number, rb: number, h: number, color: number | THREE.Material, seg = 8, x = 0, y = 0, z = 0): THREE.Mesh {
  const s = segFor(seg, Math.max(rt, rb));
  const g = cached(`c${rt},${rb},${h},${s},${seg < 0}`, () => {
    if (seg >= 0) return latheGeo(cylProfile(rt, rb, h), s);
    const f = new THREE.CylinderGeometry(rt, rb, h, s).toNonIndexed();
    f.computeVertexNormals();
    return f;
  });
  return mesh(g, M(color), x, y, z);
}

/** Cone a base biseautee et pointe adoucie ; seg est un minimum (negatif = exact, facettes : pyramide). */
export function cone(r: number, h: number, color: number | THREE.Material, seg = 7, x = 0, y = 0, z = 0): THREE.Mesh {
  const s = segFor(seg, r);
  const g = cached(`co${r},${h},${s},${seg < 0}`, () => {
    if (seg >= 0) return latheGeo(coneProfile(r, h, 0.08), s);
    const f = new THREE.ConeGeometry(r, h, s).toNonIndexed();
    f.computeVertexNormals();
    return f;
  });
  return mesh(g, M(color), x, y, z);
}

/** Galet rond et doux, a peine irregulier (rochers, buissons, petites boules). */
export function blob(r: number, color: number | THREE.Material, x = 0, y = 0, z = 0, detail = 0): THREE.Mesh {
  const d = Math.max(detail, icoDetail(r));
  // Forme unite en cache (8 variantes par finesse), puis simple mise a l'echelle : la
  // deformation (couteuse au chargement) n'est calculee qu'une fois par variante.
  const v = Math.round(r * 1000) % 8;
  const g = cached(`i${r},${d}`, () => cached(`iu${v},${d}`, () => lumpyGeo(d, v, 0.1, 0.92, 5)).clone().scale(r, r, r));
  return mesh(g, M(color), x, y, z);
}

/** Sphere lisse ; seg est un minimum (negatif = exact). */
export function sphere(r: number, color: number | THREE.Material, x = 0, y = 0, z = 0, seg = 10): THREE.Mesh {
  const tier = r < 0.05 ? 6 : r < 0.1 ? 8 : r < 0.15 ? 10 : r < 0.4 ? 14 : r < 1 ? 20 : 24;
  const s = seg < 0 ? Math.max(3, -seg) : Math.max(seg, tier);
  const g = cached(`s${r},${s}`, () => new THREE.SphereGeometry(r, s, Math.max(5, Math.round(s * 0.7))));
  return mesh(g, M(color), x, y, z);
}

// ---------------------------------------------------------------- formes douces (ajouts)

/**
 * Boule de feuillage « nuage » : sphere a lobes tires d'une graine (meme graine = meme
 * geometrie partagee), dessous un peu aplati. lump : amplitude des lobes (0.1 a 0.35).
 */
export function puff(r: number, color: number | THREE.Material, x = 0, y = 0, z = 0, seed = 0, lump = 0.22): THREE.Mesh {
  const d = r < 0.3 ? 1 : r < 0.8 ? 2 : 3;
  const g = cached(`pf${r},${seed},${lump},${d}`, () => cached(`pfu${seed},${lump},${d}`, () => lumpyGeo(d, seed + 101, lump, 0.8, 7)).clone().scale(r, r, r));
  return mesh(g, M(color), x, y, z);
}

/** Capsule verticale centree (membres, troncs fins, sacs) : h = hauteur totale. */
export function capsule(r: number, h: number, color: number | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  return pill(r, r, h, color, x, y, z);
}

/** Capsule effilee centree : rayon rt en haut, rb en bas, h = hauteur totale (bras, jambes, branches). */
export function pill(rt: number, rb: number, h: number, color: number | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const s = ringSeg(Math.max(rt, rb));
  const g = cached(`pl${rt},${rb},${h}`, () => latheGeo(pillProfile(rt, rb, h), s));
  return mesh(g, M(color), x, y, z);
}

/**
 * Forme de revolution autour de Y a partir d'un profil [rayon, hauteur] du bas vers le haut
 * (futs, pots, chapeaux, seaux, champignons...). Le profil n'est pas recentre : y = 0 est
 * l'origine de l'objet. Les aretes de plus de ~57 degres restent vives, les autres sont
 * lissees. seg = 0 : choisi selon le plus grand rayon.
 */
export function lathe(profile: Profile, color: number | THREE.Material, x = 0, y = 0, z = 0, seg = 0): THREE.Mesh {
  const big = profile.reduce((m, q) => Math.max(m, q[0]), 0);
  const s = seg > 0 ? seg : ringSeg(big);
  const g = cached(`la${s}|${pkey(profile)}`, () => latheGeo(profile, s));
  return mesh(g, M(color), x, y, z);
}

/** Cylindre centre aux bords tres arrondis (round : fraction du rayon, 0 a 1) : coussins, sacs, souches, bidons. */
export function rcyl(rt: number, rb: number, h: number, color: number | THREE.Material, round = 0.35, x = 0, y = 0, z = 0): THREE.Mesh {
  const s = ringSeg(Math.max(rt, rb));
  const g = cached(`rc${rt},${rb},${h},${round}`, () => latheGeo(rcylProfile(rt, rb, h, round), s));
  return mesh(g, M(color), x, y, z);
}

/** Cone centre a pointe bien arrondie (round 0 a 0.45) : etages de sapin, toits, chapeaux pointus. */
export function rcone(r: number, h: number, color: number | THREE.Material, round = 0.25, x = 0, y = 0, z = 0): THREE.Mesh {
  const s = ringSeg(r);
  const g = cached(`rk${r},${h},${round}`, () => latheGeo(coneProfile(r, h, round), s));
  return mesh(g, M(color), x, y, z);
}

/** Tore dans le plan XY (comme THREE.TorusGeometry) : pneus, anneaux, couronnes. */
export function torus(R: number, tube: number, color: number | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`to${R},${tube}`, () => new THREE.TorusGeometry(R, tube, tube < 0.05 ? 6 : tube < 0.15 ? 8 : 10, R < 0.3 ? 16 : R < 1 ? 20 : 28));
  return mesh(g, M(color), x, y, z);
}

/**
 * Tole ondulee debout, centree, dans le plan XY (epaisseur ~0.05 en Z, comme box(w, h, 0.05)) :
 * les ondes sont verticales. Pour un toit, la coucher (rotation.x = -PI / 2).
 */
export function corrugated(w: number, h: number, color: number | THREE.Material, x = 0, y = 0, z = 0, waves = 0): THREE.Mesh {
  const nw = waves > 0 ? waves : Math.max(2, Math.round(w / 0.16));
  const g = cached(`cg${w},${h},${nw}`, () => {
    const A = 0.02;
    const t = 0.012;
    const N = nw * 4;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const k = (Math.PI * 2 * nw) / w;
    const col = (side: number, yy: number, i: number): number => {
      const px = -w / 2 + (w * i) / N;
      const pz = A * Math.sin(k * (px + w / 2)) + side * t;
      const dz = A * k * Math.cos(k * (px + w / 2));
      const l = Math.hypot(dz, 1);
      pos.push(px, yy, pz);
      nor.push((-dz / l) * side, 0, (1 / l) * side);
      return pos.length / 3 - 1;
    };
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) { col(side, -h / 2, i); col(side, h / 2, i); }
      for (let i = 0; i < N; i++) {
        const a = base + i * 2;
        idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
      }
    }
    // Tranches haut et bas.
    for (const sy of [1, -1]) {
      const base = pos.length / 3;
      for (let i = 0; i <= N; i++) {
        const px = -w / 2 + (w * i) / N;
        const pz = A * Math.sin(k * (px + w / 2));
        pos.push(px, (sy * h) / 2, pz + t, px, (sy * h) / 2, pz - t);
        nor.push(0, sy, 0, 0, sy, 0);
      }
      for (let i = 0; i < N; i++) {
        const a = base + i * 2;
        idx.push(a, a + 2, a + 3, a, a + 3, a + 1);
      }
    }
    // Tranches des cotes.
    for (const sx of [-1, 1]) {
      const px = (sx * w) / 2;
      const pz = A * Math.sin(k * (px + w / 2));
      const base = pos.length / 3;
      pos.push(px, -h / 2, pz + t, px, h / 2, pz + t, px, h / 2, pz - t, px, -h / 2, pz - t);
      nor.push(sx, 0, 0, sx, 0, 0, sx, 0, 0, sx, 0, 0);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return build(pos, nor, idx);
  });
  return mesh(g, M(color), x, y, z);
}

// ---------------------------------------------------------------- couleurs de sommets

const paintCache = new Map<string, THREE.BufferGeometry>();

/**
 * Peint les sommets d'un maillage du kit : `fn(x, y, z, out)` recoit la position locale et
 * ecrit la couleur dans `out` (out.setHex(...), out.lerpColors(...)). La geometrie peinte
 * est en cache sous `key` (meme cle = meme peinture) ; le materiau devient vmat() (partage,
 * blanc) : l'emissive et la transparence d'origine sont perdues. Survit a mergeColored et
 * bakeStatic.
 */
export function paint<T extends THREE.Mesh>(m: T, key: string, fn: (x: number, y: number, z: number, out: THREE.Color) => void): T {
  const src = m.geometry;
  const k = `${src.uuid}|${key}`;
  let g = paintCache.get(k);
  if (!g) {
    g = src.clone();
    const pos = g.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.setRGB(1, 1, 1);
      fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    paintCache.set(k, g);
  }
  m.geometry = g;
  m.material = vmat();
  return m;
}

/** Degrade vertical (repere local du maillage) : `bottom` en bas, `top` en haut. */
export function vgrad<T extends THREE.Mesh>(m: T, bottom: number, top: number): T {
  const g = m.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const y0 = g.boundingBox!.min.y;
  const span = g.boundingBox!.max.y - y0 || 1;
  const a = new THREE.Color(bottom);
  const b = new THREE.Color(top);
  return paint(m, `vg${bottom},${top}`, (_x, y, _z, out) => { out.lerpColors(a, b, (y - y0) / span); });
}

/** Melange de deux couleurs hexadecimales (t = 0 : a, t = 1 : b). */
export function mixHex(a: number, b: number, t: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

/** Variante proche d'une couleur (clarte +/- amt), tiree d'un generateur : deux ou trois teintes voisines plutot qu'un aplat. */
export function vary(color: number, r: () => number, amt = 0.08): number {
  return new THREE.Color(color).multiplyScalar(1 + (r() * 2 - 1) * amt).getHex();
}

// ---------------------------------------------------------------- outils

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}

export function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, s = 1): T {
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.scale.setScalar(s);
  return o;
}

/** Generateur pseudo-aleatoire reproductible : le decor est identique a chaque chargement. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let glowTex: THREE.Texture | null = null;
/** Halo additif : simule un « bloom » sans post-traitement (couteux sur mobile). */
export function glow(color: number, size: number): THREE.Sprite {
  if (!glowTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    glowTex.colorSpace = THREE.SRGBColorSpace;
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
  }));
  s.scale.setScalar(size);
  return s;
}

export function easeOutBack(t: number): number {
  const c1 = 1.9;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function damp(a: number, b: number, lambda: number, dt: number): number {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}
