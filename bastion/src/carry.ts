// Une pile d'objets portee sur le dos (joueur, survivants) : elle se tasse et oscille.

import * as THREE from 'three';
import { damp } from './kit';
import { ITEMS, itemMesh, type ItemType } from './items';

interface Slot { type: ItemType; obj: THREE.Object3D; y: number }

export class Stack {
  readonly root = new THREE.Group();
  readonly slots: Slot[] = [];
  cap: number;
  private lean = 0;
  private wobble = 0;

  constructor(cap: number) {
    this.cap = cap;
  }

  get count(): number {
    return this.slots.length;
  }

  get full(): boolean {
    return this.slots.length >= this.cap;
  }

  has(t: ItemType): boolean {
    return this.slots.some((s) => s.type === t);
  }

  countOf(t: ItemType): number {
    return this.slots.filter((s) => s.type === t).length;
  }

  /** Position monde du sommet de la pile : la ou le prochain objet atterrira. */
  topWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const h = this.slots.reduce((a, s) => a + ITEMS[s.type].h, 0);
    out.set(0, h, 0);
    return this.root.localToWorld(out);
  }

  add(t: ItemType): THREE.Object3D | null {
    if (this.full) return null;
    const obj = itemMesh(t);
    const y = this.slots.reduce((a, s) => a + ITEMS[s.type].h, 0);
    obj.position.y = y;
    obj.scale.setScalar(1.35);
    obj.rotation.y = (Math.random() - 0.5) * 0.25;
    this.root.add(obj);
    this.slots.push({ type: t, obj, y });
    this.wobble = 1;
    return obj;
  }

  /** Retire l'objet le plus haut parmi les types acceptes ; renvoie sa position monde. */
  take(accept: (t: ItemType) => boolean): { type: ItemType; pos: THREE.Vector3 } | null {
    for (let i = this.slots.length - 1; i >= 0; i--) {
      const s = this.slots[i]!;
      if (!accept(s.type)) continue;
      const pos = new THREE.Vector3();
      s.obj.getWorldPosition(pos);
      this.root.remove(s.obj);
      this.slots.splice(i, 1);
      this.relayout();
      return { type: s.type, pos };
    }
    return null;
  }

  clear(): ItemType[] {
    const types = this.slots.map((s) => s.type);
    for (const s of this.slots) this.root.remove(s.obj);
    this.slots.length = 0;
    return types;
  }

  private relayout(): void {
    let y = 0;
    for (const s of this.slots) {
      s.y = y;
      y += ITEMS[s.type].h;
    }
  }

  update(dt: number, speedK: number, walkPhase: number): void {
    this.lean = damp(this.lean, -speedK * 0.16, 6, dt);
    this.wobble = Math.max(0, this.wobble - dt * 4);
    const n = this.slots.length;
    this.slots.forEach((s, i) => {
      const f = n > 1 ? i / Math.max(8, n) : 0;
      s.obj.position.y = damp(s.obj.position.y, s.y, 16, dt);
      s.obj.position.z = this.lean * f * i * 0.35;
      s.obj.rotation.x = this.lean * f * 1.4 + Math.sin(walkPhase * 0.5 + i * 0.5) * 0.04 * speedK;
      const pop = i === n - 1 ? 1 + this.wobble * 0.35 : 1;
      s.obj.scale.setScalar(damp(s.obj.scale.x, pop, 14, dt));
    });
  }
}
