// Particules en un seul InstancedMesh : eclats, etincelles, poussiere.

import * as THREE from 'three';

interface P {
  alive: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: number;
  life: number;
  max: number;
  size: number;
  gravity: number;
}

const CAP = 600;

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly ps: P[] = [];
  private next = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      CAP,
    );
    this.mesh.frustumCulled = false;
    for (let i = 0; i < CAP; i++) {
      this.ps.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: 0, life: 0, max: 1, size: 0, gravity: 0 });
      this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
      this.mesh.setColorAt(i, this.col.setHex(0xffffff));
    }
    scene.add(this.mesh);
  }

  burst(at: THREE.Vector3, colors: number[], count: number, opts: { speed?: number; up?: number; size?: number; life?: number; gravity?: number } = {}): void {
    const speed = opts.speed ?? 4;
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % CAP;
      const p = this.ps[i]!;
      p.alive = true;
      p.pos.copy(at);
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      p.vel.set(Math.cos(a) * sp, (opts.up ?? 4) * (0.5 + Math.random()), Math.sin(a) * sp);
      p.rot.set(Math.random() * 6, Math.random() * 6, 0);
      p.spin = (Math.random() - 0.5) * 14;
      p.life = 0;
      p.max = (opts.life ?? 0.7) * (0.6 + Math.random() * 0.8);
      p.size = (opts.size ?? 0.14) * (0.6 + Math.random() * 0.8);
      p.gravity = opts.gravity ?? 14;
      this.mesh.setColorAt(i, this.col.setHex(colors[k % colors.length]!));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < CAP; i++) {
      const p = this.ps[i]!;
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        this.mesh.setMatrixAt(i, this.m4.makeScale(0, 0, 0));
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.05) {
        p.pos.y = 0.05;
        p.vel.y *= -0.35;
        p.vel.x *= 0.6;
        p.vel.z *= 0.6;
      }
      p.rot.x += p.spin * dt;
      p.rot.y += p.spin * dt * 0.7;
      const k = 1 - p.life / p.max;
      this.q.setFromEuler(p.rot);
      this.s.setScalar(p.size * Math.min(1, k * 2.2));
      this.m4.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Trainee de balle : un trait lumineux qui s'efface en quelques centiemes de seconde. */
export class Tracers {
  private readonly items: { line: THREE.Mesh; life: number }[] = [];
  private readonly geo = new THREE.BoxGeometry(1, 1, 1);

  constructor(private readonly scene: THREE.Scene) {}

  fire(from: THREE.Vector3, to: THREE.Vector3): void {
    const m = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Mesh(this.geo, m);
    const len = from.distanceTo(to);
    line.scale.set(0.06, 0.06, len);
    line.position.copy(from).lerp(to, 0.5);
    line.lookAt(to);
    this.scene.add(line);
    this.items.push({ line, life: 0 });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      it.life += dt;
      const m = it.line.material as THREE.MeshBasicMaterial;
      m.opacity = Math.max(0, 1 - it.life / 0.09);
      if (it.life > 0.09) {
        this.scene.remove(it.line);
        m.dispose();
        this.items.splice(i, 1);
      }
    }
  }
}

/** Objets qui volent en cloche d'un point a un autre (recoltes, pieces, livraisons). */
interface Flight { obj: THREE.Object3D; from: THREE.Vector3; to: () => THREE.Vector3; t: number; dur: number; arc: number; spin: number; done: () => void }

export class Flyers {
  private readonly items: Flight[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  launch(obj: THREE.Object3D, from: THREE.Vector3, to: () => THREE.Vector3, done: () => void, dur = 0.28, arc = 1.4): void {
    obj.position.copy(from);
    this.scene.add(obj);
    this.items.push({ obj, from: from.clone(), to, t: 0, dur, arc, spin: (Math.random() - 0.5) * 10, done });
  }

  get count(): number {
    return this.items.length;
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i]!;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      const e = k * (2 - k);
      f.obj.position.lerpVectors(f.from, f.to(), e);
      f.obj.position.y += Math.sin(k * Math.PI) * f.arc;
      f.obj.rotation.y += f.spin * dt;
      if (k >= 1) {
        this.scene.remove(f.obj);
        this.items.splice(i, 1);
        f.done();
      }
    }
  }
}
