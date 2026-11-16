// Fusionne tout le decor immobile en quelques gros maillages (un par materiau) :
// on passe de centaines d'appels de dessin a une poignee, ce qui compte sur mobile.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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
        const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone());
        for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
        g.applyMatrix4(m.matrixWorld);
        const key = `${material.uuid}|${m.castShadow}|${m.receiveShadow}`;
        let b = buckets.get(key);
        if (!b) {
          b = { material, cast: m.castShadow, receive: m.receiveShadow, geos: [] };
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

const colorMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
colorMat.userData.shared = true;

/**
 * Fige un batiment une fois restaure : ses enfants immobiles sont fusionnes en un
 * maillage, ceux qui vivent encore (`live` : lame, vapeur, lumieres) restent a part.
 */
export function consolidate(g: THREE.Object3D, live: THREE.Object3D[] = []): void {
  const keep = new Set(live);
  const still = new THREE.Group();
  for (const c of [...g.children]) {
    if (keep.has(c) || (c as THREE.Light).isLight || !(c as THREE.Mesh).isMesh && c.children.length === 0) continue;
    still.add(c);
  }
  if (still.children.length === 0) return;
  g.add(mergeColored(still));
}

/**
 * Fusionne un objet compose (palissade, ruine) en un seul maillage a couleurs de
 * sommets : un seul appel de dessin quelle que soit sa complexite. Les maillages
 * transparents ou lumineux sont gardes a part, tels quels.
 */
export function mergeColored(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const rel = new THREE.Matrix4();
  const geos: THREE.BufferGeometry[] = [];
  const keep: THREE.Object3D[] = [];
  const out = new THREE.Group();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const material = m.material as THREE.MeshLambertMaterial;
    if (material.transparent || !material.userData.shared || (material.emissive && material.emissive.getHex() !== 0)) {
      keep.push(m);
      return;
    }
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    rel.multiplyMatrices(inv, m.matrixWorld);
    g.applyMatrix4(rel);
    const n = g.attributes.position!.count;
    const col = new Float32Array(n * 3);
    const c = material.color;
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
