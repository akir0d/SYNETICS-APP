// Fusionne tout le decor immobile en quelques gros maillages (un par materiau) :
// on passe de centaines d'appels de dessin a une poignee, ce qui compte sur mobile.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { isLook, lookMat } from './kit';

/**
 * Copie de la geometrie d'un maillage, sans les attributs inutiles a la fusion. Toujours
 * indexee (index trivial au besoin) : les sommets partages ne sont pas dupliques, ce qui
 * divise la memoire du decor fusionne. Avec `colors`, garde (ou cree en blanc) l'attribut
 * de couleur de sommet.
 */
function strip(m: THREE.Mesh, colors: boolean): THREE.BufferGeometry {
  const g = m.geometry.clone();
  if (!g.index) {
    const n = g.attributes.position!.count;
    const idx: number[] = new Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(idx);
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(colors && name === 'color')) g.deleteAttribute(name);
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const col = g.getAttribute('color');
  if (colors && (!col || col.itemSize !== 3)) {
    if (col) g.deleteAttribute('color');
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position!.count * 3).fill(1), 3));
  }
  return g;
}

// Lisse, avec l'ombrage d'ambiance commun (kit.ts) : les normales des sommets font le reste.
const colorMat = lookMat({ vertexColors: true });
colorMat.userData.shared = true;
// Pendant pour le sol (taches de terre, routes) : couleurs de sommets, sans ombrage d'ambiance.
const groundColorMat = new THREE.MeshLambertMaterial({ vertexColors: true });
groundColorMat.userData.shared = true;

/** Petit hachage reproductible d'une position : la meme piece a toujours la meme nuance. */
function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

/**
 * Un materiau partage qu'on peut remplacer par des couleurs de sommets sans rien perdre :
 * Lambert lisse, opaque, sans texture, ni emissive, ni double face.
 */
function paintable(material: THREE.Material): material is THREE.MeshLambertMaterial {
  const m = material as THREE.MeshLambertMaterial;
  return !!m.isMeshLambertMaterial && !!m.userData.shared && !m.transparent && !m.map && !m.flatShading
    && m.side === THREE.FrontSide && m.emissive.getHex() === 0;
}

/**
 * Copie de la geometrie de `m` dans le repere `rel`, avec la couleur de son materiau ecrite
 * dans chaque sommet (multipliee par ses couleurs de sommets s'il en a, et nuancee de +/- vary).
 */
function colored(m: THREE.Mesh, material: THREE.MeshLambertMaterial, rel: THREE.Matrix4, vary: number): THREE.BufferGeometry {
  const own = !!material.vertexColors && !!m.geometry.getAttribute('color');
  const g = strip(m, own);
  g.applyMatrix4(rel);
  const n = g.attributes.position!.count;
  const e = m.matrixWorld.elements;
  const k = 1 + (hash3(e[12]!, e[13]!, e[14]!) * 2 - 1) * vary;
  const c = material.color;
  const cr = c.r * k, cg = c.g * k, cb = c.b * k;
  if (own) {
    const col = g.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) col.setXYZ(i, col.getX(i) * cr, col.getY(i) * cg, col.getZ(i) * cb);
  } else {
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  return g;
}

/**
 * Fusionne le decor immobile de la scene (sauf `keep`). Les materiaux partages ordinaires
 * deviennent des couleurs de sommets : tout le decor « look » tient en un maillage (deux
 * avec le sol), quelle que soit la variete des teintes. Les autres materiaux partages
 * (emissifs, plats, textures) sont fusionnes par materiau.
 */
/** Cote des tuiles du decor fusionne (unites du monde). */
const TILE = 16;
const tmpSize = new THREE.Vector3();

export function bakeStatic(scene: THREE.Scene, keep: Set<THREE.Object3D>): number {
  scene.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  const victims: THREE.Mesh[] = [];

  const visit = (o: THREE.Object3D) => {
    if (keep.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material)) {
      const material = m.material as THREE.Material;
      if (material.userData.shared && !material.transparent) {
        // Les toutes petites pieces (boulons, fils, capuchons) ne projettent pas d'ombre :
        // invisible vu de haut, et autant de triangles en moins dans la passe d'ombre.
        if (m.castShadow) {
          if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
          m.geometry.boundingBox!.getSize(tmpSize);
          if (Math.max(tmpSize.x, tmpSize.y, tmpSize.z) * m.matrixWorld.getMaxScaleOnAxis() < 0.2) m.castShadow = false;
        }
        // Une fusion par tuile de terrain : ce qui est hors champ (ou hors de l'ombre) est ecarte.
        const e = m.matrixWorld.elements;
        const tile = `${Math.floor(e[12]! / TILE)},${Math.floor(e[14]! / TILE)}`;
        let g: THREE.BufferGeometry;
        let target: THREE.Material;
        let key: string;
        if (paintable(material)) {
          const lk = isLook(material);
          target = lk ? colorMat : groundColorMat;
          g = colored(m, material, m.matrixWorld, lk ? 0.03 : 0);
          key = `${lk ? 'vc' : 'vg'}|${m.castShadow}|${m.receiveShadow}|${tile}`;
        } else {
          // Un materiau a couleurs de sommets garde ses couleurs.
          target = material;
          g = strip(m, !!(material as THREE.MeshLambertMaterial).vertexColors);
          g.applyMatrix4(m.matrixWorld);
          key = `${material.uuid}|${m.castShadow}|${m.receiveShadow}|${tile}`;
        }
        let b = buckets.get(key);
        if (!b) {
          b = { material: target, cast: m.castShadow, receive: m.receiveShadow, geos: [] };
          buckets.set(key, b);
        }
        b.geos.push(g);
        victims.push(m);
      }
    }
    for (const c of o.children) visit(c);
  };
  for (const c of [...scene.children]) visit(c);

  for (const v of victims) v.parent?.remove(v);
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, b.material);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }
  return victims.length;
}

/**
 * Fige un batiment une fois restaure : ses enfants immobiles sont fusionnes en un
 * maillage, ceux qui vivent encore (`live` : lame, vapeur, lumieres) restent a part.
 */
export function consolidate(g: THREE.Object3D, live: THREE.Object3D[] = []): void {
  const keep = new Set(live);
  const still = new THREE.Group();
  for (const c of [...g.children]) {
    // userData.keep : habillage qu'on change plus tard (tours en pierre ou en fer).
    if (keep.has(c) || c.userData.keep || (c as THREE.Light).isLight || !(c as THREE.Mesh).isMesh && c.children.length === 0) continue;
    still.add(c);
  }
  if (still.children.length === 0) return;
  g.add(mergeColored(still));
}

/**
 * Fusionne un objet compose (palissade, ruine) en un seul maillage a couleurs de
 * sommets : un seul appel de dessin quelle que soit sa complexite. Les maillages
 * transparents, lumineux, a facettes, textures, non partages ou visibles des deux cotes
 * sont gardes a part, tels quels.
 * Chaque piece recoit une nuance de clarte reproductible (+/- vary) : des planches de
 * meme couleur ne font pas un aplat. Les couleurs de sommets (paint, vgrad) sont gardees.
 */
export function mergeColored(root: THREE.Object3D, vary = 0.035): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const geos: THREE.BufferGeometry[] = [];
  const keep: THREE.Object3D[] = [];
  const out = new THREE.Group();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const material = m.material as THREE.Material;
    if (!paintable(material)) {
      keep.push(m);
      return;
    }
    rel.multiplyMatrices(inv, m.matrixWorld);
    const g = colored(m, material, rel, vary);
    geos.push(g);
  });
  if (geos.length) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) {
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, colorMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      out.add(mesh);
    }
  }
  for (const k of keep) {
    const c = k.clone();
    rel.multiplyMatrices(inv, k.matrixWorld);
    rel.decompose(c.position, c.quaternion, c.scale);
    out.add(c);
  }
  out.position.copy(root.position);
  out.quaternion.copy(root.quaternion);
  out.scale.copy(root.scale);
  return out;
}
