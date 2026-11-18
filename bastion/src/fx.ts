// Particules en un seul InstancedMesh : eclats, etincelles, poussiere.
// Petits galets ronds et lisses, eclaires comme le decor, avec un peu de lumiere propre.

import * as THREE from 'three';
import { look, lookActive } from './kit';

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

/** Icosaedre a normales lisses : rond a l'ecran pour 20 triangles. */
function pebbleGeo(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.56, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  g.deleteAttribute('uv');
  return g;
}

/**
 * Lambert avec l'ombrage d'ambiance, plus une part de lumiere propre tiree de la couleur de
 * chaque particule : les etincelles et confettis restent vifs la nuit, la poussiere garde du volume.
 */
function particleMat(): THREE.MeshLambertMaterial {
  const m = look(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base.call(m, shader, renderer);
    if (!lookActive()) return; // ombrage coupe apres un echec : Lambert simple
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.38;',
    );
  };
  m.customProgramCacheKey = () => (lookActive() ? 'bastion-fx-1' : 'bastion-fx-off');
  return m;
}

export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private readonly ps: P[] = [];
  private next = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(pebbleGeo(), particleMat(), CAP);
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
      // Gonfle vite a la naissance, se resorbe en douceur ; un peu aplati (galet).
      const g = p.size * Math.min(1, k * 2.2) * Math.min(1, p.life * 30 + 0.3);
      this.s.set(g, g * 0.78, g);
      this.m4.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Trainee de balle : un trait lumineux effile qui s'efface en quelques centiemes de seconde. */
interface Tracer { line: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; busy: boolean }

/** Fuseau le long de z (de -0.5 a 0.5) : tete brillante devant, queue qui s'eteint derriere. */
function streakGeo(): THREE.BufferGeometry {
  const prof: [number, number, number][] = [[0, -0.5, 0], [0.35, 0.1, 0.55], [0.5, 0.38, 1], [0.3, 0.47, 1], [0, 0.5, 1]];
  const seg = 6;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const [r, z, c] of prof) {
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
      col.push(c, c, c * 0.85);
    }
  }
  for (let i = 0; i < prof.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j;
      const b = i * seg + ((j + 1) % seg);
      idx.push(a, b, b + seg, a, b + seg, a + seg);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Tracers {
  private readonly items: Tracer[] = [];
  private readonly geo = streakGeo();

  constructor(private readonly scene: THREE.Scene) {}

  fire(from: THREE.Vector3, to: THREE.Vector3): void {
    // Les traits sont recycles : pas de materiau ni de geometrie neuve a chaque tir.
    let it = this.items.find((t) => !t.busy);
    if (!it) {
      if (this.items.length < 24) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xfff1a8, vertexColors: true, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const line = new THREE.Mesh(this.geo, mat);
        line.frustumCulled = false;
        it = { line, mat, life: 0, busy: false };
        this.items.push(it);
      } else {
        it = this.items.reduce((a, b) => (b.life > a.life ? b : a));
      }
    }
    const len = from.distanceTo(to);
    it.line.scale.set(0.09, 0.09, len);
    it.line.position.copy(from).lerp(to, 0.5);
    it.line.lookAt(to);
    it.mat.opacity = 1;
    it.life = 0;
    if (!it.busy) this.scene.add(it.line);
    it.busy = true;
  }

  update(dt: number): void {
    for (const it of this.items) {
      if (!it.busy) continue;
      it.life += dt;
      it.mat.opacity = Math.max(0, 1 - it.life / 0.09);
      if (it.life > 0.09) {
        this.scene.remove(it.line);
        it.busy = false;
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
