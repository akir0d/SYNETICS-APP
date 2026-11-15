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
