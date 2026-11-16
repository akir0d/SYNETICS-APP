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
  /** Taille des objets poses (plus gros sur l'etal, pour qu'on les voie de loin). */
  itemScale = 1.2;

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
    for (const p of this.pieces) p.obj.scale.setScalar(damp(p.obj.scale.x, this.itemScale, 14, dt));
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

/** L'ordre des bacs sur le comptoir, de gauche a droite. */
export const BIN_TYPES: ItemType[] = ['carrot', 'tomato', 'soup', 'log', 'plank', 'scrap'];
/** Contenance d'un bac : on peut deposer enormement avant qu'il deborde. */
export const BIN_CAP = 99;
/** Objets visibles dans un bac (le reste est compte, pas dessine). */
const SHOWN = 8;

interface Bin { type: ItemType; count: number; x: number; items: THREE.Object3D[]; label: HTMLElement; pop: number; root: THREE.Group }

/**
 * Le comptoir de vente : un bac par produit, avec son etiquette « quoi / combien ».
 * Les clients piochent dans le bac de ce qu'ils veulent.
 */
export class Bins {
  readonly root = new THREE.Group();
  readonly bins: Bin[] = [];

  constructor(scene: THREE.Scene, labels: HTMLElement) {
    const W = L.stall.w - 0.3;
    const step = W / BIN_TYPES.length;
    this.root.position.set(L.stall.x, 1.05, L.stall.z - 0.02);
    BIN_TYPES.forEach((type, i) => {
      const x = -W / 2 + (i + 0.5) * step;
      const w = step - 0.08;
      const root = new THREE.Group();
      root.position.x = x;
      // Une caisse ouverte : fond et quatre bords bas.
      root.add(
        box(w, 0.06, 0.82, C.woodDark, 0, 0.03, 0),
        box(w, 0.2, 0.06, C.wood, 0, 0.12, 0.38), box(w, 0.2, 0.06, C.wood, 0, 0.12, -0.38),
        box(0.06, 0.2, 0.82, C.wood, -w / 2, 0.12, 0), box(0.06, 0.2, 0.82, C.wood, w / 2, 0.12, 0),
      );
      const items: THREE.Object3D[] = [];
      for (let k = 0; k < SHOWN; k++) {
        const o = itemMesh(type);
        const layer = Math.floor(k / 4);
        const j = k % 4;
        o.position.set(((j % 2) - 0.5) * w * 0.45, 0.08 + layer * 0.17, (Math.floor(j / 2) - 0.5) * 0.36);
        o.rotation.y = (k * 1.7) % 3;
        o.scale.setScalar(1.15);
        o.visible = false;
        root.add(o);
        items.push(o);
      }
      shadow(root);
      this.root.add(root);
      const label = document.createElement('div');
      label.className = 'bin-label empty';
      labels.appendChild(label);
      this.bins.push({ type, count: 0, x, items, label, pop: 0, root });
      this.refresh(this.bins[i]!);
    });
    scene.add(this.root);
  }

  private bin(t: ItemType): Bin {
    return this.bins.find((b) => b.type === t)!;
  }

  get total(): number {
    return this.bins.reduce((a, b) => a + b.count, 0);
  }

  countOf(t: ItemType): number {
    return this.bin(t).count;
  }

  /** Ou viser pour deposer (ou prendre) dans le bac d'un produit. */
  binWorld(t: ItemType): THREE.Vector3 {
    const b = this.bin(t);
    return new THREE.Vector3(L.stall.x + b.x, 1.35, L.stall.z - 0.02);
  }

  add(t: ItemType): void {
    const b = this.bin(t);
    b.count = Math.min(BIN_CAP, b.count + 1);
    b.pop = 1;
    this.refresh(b);
  }

  take(t: ItemType): THREE.Vector3 | null {
    const b = this.bin(t);
    if (b.count <= 0) return null;
    b.count--;
    this.refresh(b);
    return this.binWorld(t);
  }

  private refresh(b: Bin): void {
    const shown = Math.min(SHOWN, b.count);
    b.items.forEach((o, i) => { o.visible = i < shown; });
    b.label.innerHTML = `<span>${ITEMS[b.type].icon}</span><b>${b.count}</b>`;
    b.label.classList.toggle('empty', b.count === 0);
  }

  update(dt: number): void {
    for (const b of this.bins) {
      if (b.pop <= 0) continue;
      b.pop = Math.max(0, b.pop - dt * 5);
      b.root.scale.setScalar(1 + Math.sin(b.pop * Math.PI) * 0.12);
    }
  }
}

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
  /** File d'attente : 0 a gauche, 1 a droite. */
  lane: number;
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
  readonly bins: Bins;
  readonly customers: Customer[] = [];
  cash = 0;
  private readonly cashRoot = new THREE.Group();
  private readonly cashCoins: THREE.Mesh[] = [];
  readonly cashRing: THREE.Mesh;
  readonly dropRing: THREE.Mesh;
  private spawnClock = 2;
  private lookIdx = 0;
  private clock = 0;

  constructor(private readonly scene: THREE.Scene, private readonly labels: HTMLElement) {
    this.bins = new Bins(scene, labels);
    this.dropRing = zoneRing(scene, L.shelf.x, L.shelf.z, 1.25);
    this.cashRoot.position.set(L.cash.x, 0, L.cash.z);
    this.cashRoot.add(shadow(box(1.1, 0.08, 1.1, C.woodDark, 0, 0.04, 0)));
    scene.add(this.cashRoot);
    this.cashRing = zoneRing(scene, L.cash.x, L.cash.z, 1.1, 0xffd84a);
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

  private waitingIn(lane: number): Customer[] {
    return this.customers.filter((c) => c.lane === lane && c.state !== 'leave');
  }

  private spawn(products: ItemType[]): void {
    // Le client rejoint la file la plus courte.
    const lens = L.lanes.map((_, i) => this.waitingIn(i).length);
    const lane = lens[0]! <= lens[1]! ? 0 : 1;
    if (lens[lane]! >= L.lanes[lane]!.length) return;
    const side = Math.random() < 0.5 ? -1 : 1;
    const look = LOOKS[this.lookIdx++ % LOOKS.length]!;
    const h = new Human(look);
    h.root.position.set(side * 36, 0, ROAD_Z + 0.8);
    this.scene.add(h.root);
    // Souvent, le client veut ce qu'il voit dans les bacs ; sinon les produits recents,
    // qui rapportent plus, sont un peu plus demandes.
    const onShelf = products.filter((t) => this.bins.countOf(t) > 0);
    let want = products[0]!;
    if (onShelf.length && Math.random() < 0.7) {
      want = onShelf[Math.floor(Math.random() * onShelf.length)]!;
    } else {
      const weights = products.map((_, i) => 1 + i * 0.6);
      let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < products.length; i++) {
        roll -= weights[i]!;
        if (roll <= 0) { want = products[i]!; break; }
      }
    }
    const need = want === 'soup' ? 1 + Math.floor(Math.random() * 3) : 2 + Math.floor(Math.random() * 5);
    const label = document.createElement('div');
    label.className = 'bubble';
    this.labels.appendChild(label);
    const front = L.lanes[lane]![0]!;
    this.customers.push({
      human: h, lane, want, need, got: 0, state: 'arrive', label, buyClock: 0, happy: 0, wait: 0, sad: false,
      path: [new THREE.Vector3(front.x, 0, ROAD_Z + 0.8)],
    });
  }

  /** Renvoie les ventes conclues pendant cette image (pour les effets). */
  update(dt: number, open: boolean, products: ItemType[], onBuy: (from: THREE.Vector3, to: THREE.Vector3, t: ItemType) => void): { pay: number; at: THREE.Vector3 }[] {
    const sales: { pay: number; at: THREE.Vector3 }[] = [];
    this.clock += dt;
    this.bins.update(dt);
    const s = 1 + Math.sin(this.clock * 3) * 0.03;
    this.dropRing.scale.set(s, s, s);
    const waiting = this.customers.filter((c) => c.state !== 'leave').length;
    const room = L.lanes.reduce((a, l) => a + l.length, 0);
    this.spawnClock -= dt;
    if (open && waiting < room && this.spawnClock <= 0 && products.length) {
      // Deux files : les clients arrivent deux fois plus souvent.
      this.spawnClock = 2 + Math.random() * 2.5;
      this.spawn(products);
    }

    for (let i = this.customers.length - 1; i >= 0; i--) {
      const c = this.customers[i]!;
      const h = c.human;
      if (!open && c.state !== 'leave') this.leave(c);

      if (c.state === 'arrive' || c.state === 'queue') {
        const lane = L.lanes[c.lane]!;
        const slot = this.waitingIn(c.lane).indexOf(c);
        const q = lane[Math.min(slot, lane.length - 1)]!;
        const target = c.path.length ? c.path[0]! : new THREE.Vector3(q.x, 0, q.z);
        const arrived = h.walkTo(target, 3.2, dt);
        if (arrived && c.path.length) c.path.shift();
        else if (arrived) {
          c.state = 'queue';
          h.face(Math.PI, dt);
          if (slot === 0) {
            c.buyClock -= dt;
            if (c.buyClock <= 0 && c.got < c.need) {
              const from = this.bins.take(c.want);
              if (from) {
                c.buyClock = 0.2;
                c.got++;
                c.wait = 0;
                onBuy(from, h.root.position.clone().setY(1.3), c.want);
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
    // Chaque file repart de son cote, sans traverser l'autre.
    const side = c.lane === 0 ? -1 : 1;
    const x = L.lanes[c.lane]![0]!.x + side * 0.9;
    c.path = [new THREE.Vector3(x, 0, ROAD_Z - 0.6), new THREE.Vector3(side * 40, 0, ROAD_Z - 0.6)];
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
