// La restauration d'un chantier : la ruine s'affaisse dans un nuage de poussiere,
// puis le batiment se remonte piece par piece, du sol vers le haut.

import * as THREE from 'three';

interface Part {
  o: THREE.Object3D;
  pos: THREE.Vector3;
  scale: THREE.Vector3;
  delay: number;
  landed: boolean;
}

interface Job {
  ruin: THREE.Object3D | null;
  ruinPos: THREE.Vector3;
  ruinScale: THREE.Vector3;
  built: THREE.Object3D;
  parts: Part[];
  t: number;
  end: number;
  dusted: boolean;
  done?: () => void;
}

export interface RestoreFx {
  /** Nuage de poussiere a une position monde. */
  dust: (at: THREE.Vector3, big: boolean) => void;
  /** Un coup de marteau quand une piece se pose. */
  tick: () => void;
}

const RUIN_TIME = 0.45;
const FALL = 0.3;
const SPAN = 1.1;

export class Restorer {
  private readonly jobs: Job[] = [];
  private tickClock = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly fx: RestoreFx) {}

  get busy(): boolean {
    return this.jobs.length > 0;
  }

  /** Au chargement d'une partie : directement l'etat restaure. */
  instant(ruin: THREE.Object3D | null, built: THREE.Object3D): void {
    if (ruin) ruin.visible = false;
    built.visible = true;
  }

  run(ruin: THREE.Object3D | null, built: THREE.Object3D, done?: () => void): void {
    const parts: Part[] = built.children
      .filter((c) => c.visible && !(c as THREE.Light).isLight)
      .map((o) => ({ o, pos: o.position.clone(), scale: o.scale.clone(), delay: 0, landed: false }));
    // Du bas vers le haut : la charpente avant le toit.
    parts.sort((a, b) => a.pos.y - b.pos.y);
    parts.forEach((p, i) => {
      p.delay = RUIN_TIME + (parts.length > 1 ? (i / (parts.length - 1)) * SPAN : 0);
      p.o.scale.setScalar(0.0001);
    });
    built.visible = true;
    this.jobs.push({
      ruin, ruinPos: ruin ? ruin.position.clone() : new THREE.Vector3(), ruinScale: ruin ? ruin.scale.clone() : new THREE.Vector3(1, 1, 1),
      built, parts, t: 0, end: RUIN_TIME + SPAN + FALL + 0.05, dusted: false, done,
    });
    built.getWorldPosition(this.tmp);
    this.fx.dust(this.tmp.clone().setY(0.6), true);
  }

  /** Le batiment tombe pendant qu'on le remonte : on arrete tout, pieces remises en place. */
  cancel(built: THREE.Object3D): void {
    for (let j = this.jobs.length - 1; j >= 0; j--) {
      const job = this.jobs[j]!;
      if (job.built !== built) continue;
      for (const p of job.parts) {
        p.o.position.copy(p.pos);
        p.o.scale.copy(p.scale);
      }
      if (job.ruin) {
        job.ruin.position.copy(job.ruinPos);
        job.ruin.scale.copy(job.ruinScale);
      }
      this.jobs.splice(j, 1);
      job.done?.();
    }
  }

  update(dt: number): void {
    this.tickClock -= dt;
    for (let j = this.jobs.length - 1; j >= 0; j--) {
      const job = this.jobs[j]!;
      job.t += dt;
      const t = job.t;
      if (job.ruin && job.ruin.visible) {
        const k = Math.min(1, t / RUIN_TIME);
        job.ruin.position.set(
          job.ruinPos.x + Math.sin(t * 70) * 0.06 * (1 - k),
          job.ruinPos.y - k * k * 1.2,
          job.ruinPos.z + Math.cos(t * 63) * 0.06 * (1 - k),
        );
        job.ruin.scale.set(job.ruinScale.x, job.ruinScale.y * (1 - 0.6 * k), job.ruinScale.z);
        if (k >= 1) {
          job.ruin.visible = false;
          job.ruin.position.copy(job.ruinPos);
          job.ruin.scale.copy(job.ruinScale);
        }
      }
      if (!job.dusted && t > RUIN_TIME * 0.8) {
        job.dusted = true;
        job.built.getWorldPosition(this.tmp);
        this.fx.dust(this.tmp.clone().setY(0.4), true);
      }
      job.parts.forEach((p, i) => {
        const k = Math.max(0, Math.min(1, (t - p.delay) / FALL));
        if (k <= 0) return;
        const drop = (1 - k) * (1 - k) * 3.2;
        p.o.position.set(p.pos.x, p.pos.y + drop, p.pos.z);
        const s = Math.min(1, k * 2.5);
        p.o.scale.set(p.scale.x * s, p.scale.y * s, p.scale.z * s);
        if (k >= 1 && !p.landed) {
          p.landed = true;
          if (this.tickClock <= 0) {
            this.tickClock = 0.07;
            this.fx.tick();
          }
          if (i % 3 === 0) {
            p.o.getWorldPosition(this.tmp);
            this.fx.dust(this.tmp.clone(), false);
          }
        }
      });
      if (t >= job.end) {
        for (const p of job.parts) {
          p.o.position.copy(p.pos);
          p.o.scale.copy(p.scale);
        }
        this.jobs.splice(j, 1);
        job.done?.();
      }
    }
  }
}
