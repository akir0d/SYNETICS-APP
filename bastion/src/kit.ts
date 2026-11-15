// Petit kit de modelisation low-poly : materiaux partages et formes de base.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const C = {
  grass: 0x8cc152,
  grassDark: 0x6fa83e,
  grassLight: 0xa8d65f,
  dirt: 0xd9a066,
  dirtDark: 0xb07a45,
  soil: 0x7a4a2a,
  wood: 0xc68a4f,
  woodDark: 0x8d5a30,
  woodLight: 0xe0b077,
  rust: 0xb8653a,
  rustDark: 0x8a4526,
  concrete: 0xb9b1a3,
  concreteDark: 0x8f877a,
  stone: 0x9a9890,
  leaf: 0x5fae3c,
  leafDark: 0x3f8a2e,
  leafLight: 0x86c94a,
  pine: 0x3e7d4a,
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
};

const matCache = new Map<string, THREE.Material>();

export function mat(color: number, opts: { emissive?: number; opacity?: number; flat?: boolean } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.emissive ?? ''}|${opts.opacity ?? ''}|${opts.flat ?? true}`;
  let m = matCache.get(key) as THREE.MeshLambertMaterial | undefined;
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      flatShading: opts.flat ?? true,
      emissive: opts.emissive ?? 0x000000,
      transparent: opts.opacity !== undefined,
      opacity: opts.opacity ?? 1,
      depthWrite: opts.opacity === undefined,
    });
    m.userData.shared = true;
    matCache.set(key, m);
  }
  return m;
}

/** Materiau non partage : pour ce qu'on anime (emissive de nuit, flash de degat). */
export function uniqueMat(color: number, emissive = 0x000000): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });
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

export function box(w: number, h: number, d: number, color: number | THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  return mesh(g, typeof color === 'number' ? mat(color) : color, x, y, z);
}

/** Boite aux aretes arrondies : le cote « jouet » de la DA. */
export function rbox(w: number, h: number, d: number, color: number | THREE.Material, r = 0.08, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2, h / 2, d / 2)));
  return mesh(g, typeof color === 'number' ? mat(color) : color, x, y, z);
}

export function cyl(rt: number, rb: number, h: number, color: number | THREE.Material, seg = 8, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  return mesh(g, typeof color === 'number' ? mat(color) : color, x, y, z);
}

export function cone(r: number, h: number, color: number | THREE.Material, seg = 7, x = 0, y = 0, z = 0): THREE.Mesh {
  const g = cached(`co${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
  return mesh(g, typeof color === 'number' ? mat(color) : color, x, y, z);
}

export function blob(r: number, color: number | THREE.Material, x = 0, y = 0, z = 0, detail = 0): THREE.Mesh {
  const g = cached(`i${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
  return mesh(g, typeof color === 'number' ? mat(color) : color, x, y, z);
}

export function sphere(r: number, color: number | THREE.Material, x = 0, y = 0, z = 0, seg = 10): THREE.Mesh {
  const g = cached(`s${r},${seg}`, () => new THREE.SphereGeometry(r, seg, Math.max(6, Math.round(seg * 0.7))));
  return mesh(g, typeof color === 'number' ? mat(color) : color, x, y, z);
}

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
