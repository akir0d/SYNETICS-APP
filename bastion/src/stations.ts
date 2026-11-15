// Les points d'echange : machines (scierie, cuisine), etal avec ses clients, argent.

import * as THREE from 'three';
import { Human } from './humans';
import { ITEMS, coinMesh, itemMesh, type ItemType } from './items';
import { C, box, damp, rbox, shadow } from './kit';
import { L, ROAD_Z } from './layout';
import { pileSlot, zoneRing } from './resources';

interface Piece { type: ItemType; obj: THREE.Object3D }

/** Une pile d'objets posee au sol, sur une palette. */
export class Pile {
  readonly root = new THREE.Group();
  readonly pieces: Piece[] = [];
  readonly ring: THREE.Mesh;

  constructor(scene: THREE.Scene, readonly x: number, readonly z: number, readonly cap: number, private readonly perRow = 3, pallet = true) {
    if (pallet) {
      const p = shadow(rbox(1.6, 0.14, 1.1, C.woodLight, 0.03, 0, 0.07, 0));
      this.root.add(p);
    }
    this.root.position.set(x, pallet ? 0.14 : 0, z);
    scene.add(this.root);
    this.ring = zoneRing(scene, x, z, 1.25);
  }

  get count(): number {
    return this.pieces.length;
  }

  get full(): boolean {
    return this.pieces.length >= this.cap;
  }

  countOf(t: ItemType): number {
    return this.pieces.filter((p) => p.type === t).length;
  }

  slotWorld(i = this.pieces.length): THREE.Vector3 {
    return this.root.localToWorld(pileSlot(i, this.perRow, 0.5, 0.42, 0.26).add(new THREE.Vector3(0, 0.05, 0)));
  }

  add(t: ItemType): void {
    const obj = itemMesh(t);
    obj.position.copy(pileSlot(this.pieces.length, this.perRow, 0.5, 0.42, 0.26)).add(new THREE.Vector3(0, 0.05, 0));
    obj.scale.setScalar(0.01);
    this.root.add(obj);
    this.pieces.push({ type: t, obj });
  }

  take(accept: (t: ItemType) => boolean = () => true): { type: ItemType; pos: THREE.Vector3 } | null {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i]!;
      if (!accept(p.type)) continue;
      const pos = new THREE.Vector3();
      p.obj.getWorldPosition(pos);
      this.root.remove(p.obj);
      this.pieces.splice(i, 1);
      this.pieces.forEach((q, k) => q.obj.position.copy(pileSlot(k, this.perRow, 0.5, 0.42, 0.26)).add(new THREE.Vector3(0, 0.05, 0)));
      return { type: p.type, pos };
    }
    return null;
  }

  update(dt: number, time: number): void {
    for (const p of this.pieces) p.obj.scale.setScalar(damp(p.obj.scale.x, 1.2, 14, dt));
    const s = 1 + Math.sin(time * 3 + this.x) * 0.03;
    this.ring.scale.set(s, s, s);
  }
}

/** Machine de transformation : une pile d'entree, une pile de sortie. */
export class Converter {
  readonly input: Pile;
  readonly output: Pile;
  built = false;
  progress = 0;
  busy = false;

  constructor(
    scene: THREE.Scene,
    inAt: { x: number; z: number },
    outAt: { x: number; z: number },
    readonly accepts: ItemType[],
    readonly perOutput: number,
    readonly product: ItemType,
    readonly period: number,
  ) {
    this.input = new Pile(scene, inAt.x, inAt.z, 18);
    this.output = new Pile(scene, outAt.x, outAt.z, 18);
    this.setVisible(false);
  }

  setVisible(on: boolean): void {
    for (const p of [this.input, this.output]) {
      p.root.visible = on;
      p.ring.visible = on;
    }
  }

  canAccept(t: ItemType): boolean {
    return this.built && this.accepts.includes(t) && !this.input.full;
  }

  update(dt: number, time: number): boolean {
    this.input.update(dt, time);
    this.output.update(dt, time);
    this.busy = this.built && this.input.count >= this.perOutput && !this.output.full;
    if (!this.busy) return false;
    this.progress += dt / this.period;
    if (this.progress < 1) return false;
    this.progress = 0;
    for (let i = 0; i < this.perOutput; i++) this.input.take();
    this.output.add(this.product);
    return true;
  }
}

// ---------------------------------------------------------------- etal et clients

const LOOKS = [
  { shirt: 0xd9734a, pants: 0x3a4a5a, hair: 0x2a1a10 },
  { shirt: 0x6a9ad9, pants: 0x4a3a2a, hair: 0xd9b46a, hat: 0xc9a46a },
  { shirt: 0x8a6ab0, pants: 0x2a2a3a, hair: 0x7a3a1a },
  { shirt: 0x5fb98a, pants: 0x5a4a3a, hair: 0x1a1a1a },
  { shirt: 0xe0c04a, pants: 0x3a3a4a, hair: 0x8a5a2a, hat: 0x5a7a4a },
  { shirt: 0xd95a7a, pants: 0x2a3a4a, hair: 0x3a2a1a },
];

export interface Customer {
  human: Human;
  want: ItemType;
  need: number;
  got: number;
  state: 'arrive' | 'queue' | 'leave';
  path: THREE.Vector3[];
  label: HTMLElement;
  buyClock: number;
  happy: number;
  /** Temps passe en tete de file sans rien recevoir. */
  wait: number;
  sad: boolean;
}

export class Market {
  readonly shelf: Pile;
  readonly customers: Customer[] = [];
  cash = 0;
  private readonly cashRoot = new THREE.Group();
  private readonly cashCoins: THREE.Mesh[] = [];
  readonly cashRing: THREE.Mesh;
  private spawnClock = 2;
  private lookIdx = 0;

  constructor(private readonly scene: THREE.Scene, private readonly labels: HTMLElement) {
    // Les objets en vente sont poses sur le comptoir, cote camp.
    this.shelf = new Pile(scene, L.shelf.x, L.shelf.z, 24, 6, false);
    this.shelf.root.position.set(L.stall.x, 1.12, L.stall.z - 0.1);
    this.cashRoot.position.set(L.cash.x, 0, L.cash.z);
    this.cashRoot.add(shadow(box(1.1, 0.08, 1.1, C.woodDark, 0, 0.04, 0)));
    scene.add(this.cashRoot);
    this.cashRing = zoneRing(scene, L.cash.x, L.cash.z, 1.1, 0xffd84a);
  }

  /** Le joueur depose sur l'etal : la zone est devant le comptoir mais les objets vont dessus. */
  get shelfZone(): { x: number; z: number } {
    return L.shelf;
  }

  addCash(n: number): void {
    this.cash += n;
    this.refreshCash();
  }

  takeCash(): number {
    const n = this.cash;
    this.cash = 0;
    this.refreshCash();
    return n;
  }

  private refreshCash(): void {
    const want = Math.min(60, Math.ceil(this.cash / 2));
    while (this.cashCoins.length < want) {
      const i = this.cashCoins.length;
      const c = coinMesh();
      const col = i % 6;
      c.position.set((col % 3 - 1) * 0.36, 0.11 + Math.floor(i / 6) * 0.065, (Math.floor(col / 3) - 0.5) * 0.36);
      c.rotation.y = Math.random();
      this.cashRoot.add(c);
      this.cashCoins.push(c);
    }
    while (this.cashCoins.length > want) this.cashRoot.remove(this.cashCoins.pop()!);
  }

  cashWorld(): THREE.Vector3 {
    return new THREE.Vector3(L.cash.x, 0.3 + Math.min(10, this.cashCoins.length / 6) * 0.065, L.cash.z);
  }

  private spawn(products: ItemType[]): void {
    const side = Math.random() < 0.5 ? -1 : 1;
    const look = LOOKS[this.lookIdx++ % LOOKS.length]!;
    const h = new Human(look);
    h.root.position.set(side * 36, 0, ROAD_Z + 0.8);
    this.scene.add(h.root);
    // Souvent, le client veut ce qu'il voit sur l'etal ; sinon les produits recents,
    // qui rapportent plus, sont un peu plus demandes.
    const onShelf = products.filter((t) => this.shelf.countOf(t) > 0);
    let want = products[0]!;
    if (onShelf.length && Math.random() < 0.6) {
      want = onShelf[Math.floor(Math.random() * onShelf.length)]!;
    } else {
      const weights = products.map((_, i) => 1 + i * 0.6);
      let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < products.length; i++) {
        roll -= weights[i]!;
        if (roll <= 0) { want = products[i]!; break; }
      }
    }
    const need = want === 'soup' ? 1 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 4);
    const label = document.createElement('div');
    label.className = 'bubble';
    this.labels.appendChild(label);
    this.customers.push({
      human: h, want, need, got: 0, state: 'arrive', label, buyClock: 0, happy: 0, wait: 0, sad: false,
      path: [new THREE.Vector3(L.stall.x, 0, ROAD_Z + 0.8)],
    });
  }

  private queueSlot(c: Customer): number {
    return this.customers.filter((x) => x.state !== 'leave').indexOf(c);
  }

  /** Renvoie les ventes conclues pendant cette image (pour les effets). */
  update(dt: number, open: boolean, products: ItemType[], onBuy: (from: THREE.Vector3, to: THREE.Vector3, t: ItemType) => void): { pay: number; at: THREE.Vector3 }[] {
    const sales: { pay: number; at: THREE.Vector3 }[] = [];
    const waiting = this.customers.filter((c) => c.state !== 'leave').length;
    this.spawnClock -= dt;
    if (open && waiting < L.queue.length && this.spawnClock <= 0 && products.length) {
      this.spawnClock = 4 + Math.random() * 4;
      this.spawn(products);
    }

    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i]!;
      const h = c.human;
      if (!open && c.state !== 'leave') this.leave(c);

      if (c.state === 'arrive' || c.state === 'queue') {
        const slot = this.queueSlot(c);
        const q = L.queue[Math.min(slot, L.queue.length - 1)]!;
        const target = c.path.length ? c.path[0]! : new THREE.Vector3(q.x, 0, q.z);
        const arrived = h.walkTo(target, 3.2, dt);
        if (arrived && c.path.length) c.path.shift();
        else if (arrived) {
          c.state = 'queue';
          h.face(Math.PI, dt);
          if (slot === 0) {
            c.buyClock -= dt;
            if (c.buyClock <= 0 && c.got < c.need) {
              const item = this.shelf.take((t) => t === c.want);
              if (item) {
                c.buyClock = 0.22;
                c.got++;
                c.wait = 0;
                onBuy(item.pos, h.root.position.clone().setY(1.3), item.type);
              }
            }
            c.wait += dt;
            if (c.got >= c.need) {
              const pay = c.need * ITEMS[c.want].price;
              sales.push({ pay, at: h.root.position.clone().setY(1.6) });
              c.happy = 1;
              this.leave(c);
            } else if (c.wait > 25) {
              // Lasse d'attendre : il paie ce qu'il a deja pris et s'en va.
              if (c.got > 0) sales.push({ pay: c.got * ITEMS[c.want].price, at: h.root.position.clone().setY(1.6) });
              c.sad = true;
              c.happy = 1;
              this.leave(c);
            }
          }
        }
      } else {
        const target = c.path[0];
        if (!target || h.walkTo(target, 3.6, dt)) {
          if (c.path.length) c.path.shift();
          if (!c.path.length) {
            this.scene.remove(h.root);
            c.label.remove();
            this.customers.splice(i, 1);
            continue;
          }
        }
      }
      h.animate(dt, false);
      c.happy = Math.max(0, c.happy - dt * 0.6);
    }
    return sales;
  }

  private leave(c: Customer): void {
    if (c.state === 'leave') return;
    c.state = 'leave';
    const side = Math.random() < 0.5 ? -1 : 1;
    c.path = [new THREE.Vector3(L.stall.x + side * 0.8, 0, ROAD_Z - 0.6), new THREE.Vector3(side * 40, 0, ROAD_Z - 0.6)];
  }
}

// ---------------------------------------------------------------- pieces au sol (butin de nuit)

interface Drop { mesh: THREE.Mesh; value: number; vel: THREE.Vector3; t: number }

export class CoinDrops {
  private readonly drops: Drop[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  spawn(at: THREE.Vector3, count: number, value: number): void {
    for (let i = 0; i < count; i++) {
      const m = coinMesh();
      m.position.copy(at).setY(1);
      const a = Math.random() * Math.PI * 2;
      this.scene.add(m);
      this.drops.push({ mesh: m, value, vel: new THREE.Vector3(Math.cos(a) * 2.5, 5 + Math.random() * 2, Math.sin(a) * 2.5), t: 0 });
    }
  }

  /** Les pieces bondissent puis filent vers le joueur quand il passe pres. */
  update(dt: number, player: THREE.Vector3, collect: (v: number) => void): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]!;
      d.t += dt;
      const p = d.mesh.position;
      const dist = Math.hypot(p.x - player.x, p.z - player.z);
      if (d.t > 0.6 && dist < 3.2) {
        const k = 1 - Math.exp(-10 * dt);
        p.lerp(player.clone().setY(1.2), k);
        if (dist < 0.5) {
          this.scene.remove(d.mesh);
          this.drops.splice(i, 1);
          collect(d.value);
          continue;
        }
      } else {
        d.vel.y -= 16 * dt;
        p.addScaledVector(d.vel, dt);
        if (p.y < 0.15) {
          p.y = 0.15;
          d.vel.y *= -0.4;
          d.vel.x *= 0.6;
          d.vel.z *= 0.6;
        }
      }
      d.mesh.rotation.y += dt * 4;
      d.mesh.rotation.x = Math.PI / 2;
      if (d.t > 60) {
        this.scene.remove(d.mesh);
        this.drops.splice(i, 1);
      }
    }
  }
}
