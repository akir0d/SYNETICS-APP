import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import './style.css';
import * as THREE from 'three';
import * as sfx from './audio';
import { bakeStatic, consolidate } from './bake';
import { Bus, dock, kitchen, sawmill, shelter, watchTower, windmill, workbench, type Building } from './buildings';
import { Flyers, Particles, Tracers } from './fx';
import { Helper, type HelperCtx, type Job } from './helpers';
import { ITEMS, coinMesh, itemMesh, type ItemType } from './items';
import { damp, easeOutBack, glow } from './kit';
import { CAMP, L, insideFarm, insideStation } from './layout';
import { regions, type NavState } from './nav';
import { LOG_HP, Palisade, logsNeeded, stateOf, type Section } from './palisade';
import type { Segment } from './physics';
import { Player } from './player';
import {
  CYCLE_FROM, PADS, UPGRADES, dayLen, freshSave, loadSave, nightLen, wipeSave, writeSave,
  type Cost, type PadDef, type Save, type UpId,
} from './progress';
import { Bed, ChopTree, FIELD_D, FIELD_W, Pump, ScrapSource, plantForest } from './resources';
import { Restorer } from './restore';
import {
  BOOSTS, BOOST_TIME, CHEST_EVERY, GEM_ADS_PER_DAY, LEVELS, MAX_LEVEL, QUESTS, levelCost, rollQuests, todayKey,
  type BoostId, type LevelId,
} from './meta';
import { PRODUCTS, SIMULATED, purchase, showRewarded, type Product } from './monetize';
import { CREW, OUTFITS, RADIO, WEAPONS, type WeaponId } from './meta';
import { Airdrop, CACHE_SPOTS, Cache, Caravan, DROP_SPOTS, RESCUE_SPOTS, Rescue, type Spot } from './events';
import {
  bedRuin, benchRuin, dockRuin, fieldRuin, gateJunk, junkPile, kitchenRuin, millRuin, sawmillRuin, shelterRuin, towerRuin,
} from './ruins';
import { BIN_CAP, CoinDrops, Converter, Market, Reserve } from './stations';
import { buildWorld } from './world';
import { Horde, type Structure, type Zombie } from './zombies';

// ================================================================ rendu

/** Reperes de chargement (index.html) : si le jeu bloque, on saura a quelle etape. */
const boot = (step: string) => (window as unknown as { __bootStep?: (s: string) => void }).__bootStep?.(step);
boot('rendu 3D');
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 220);

// Ciel voile, lumiere chaude et un peu poussiereuse : le monde d'apres, pas une carte postale.
const DAY = {
  sky: new THREE.Color(0xbfd2cf), hemiSky: new THREE.Color(0xf6e9d2), hemiGround: new THREE.Color(0x6f7a45),
  hemi: 1.6, sunColor: new THREE.Color(0xffdcb0), sun: 2.7, fogNear: 12, fogFar: 62, exposure: 1.02,
};
const NIGHT = {
  sky: new THREE.Color(0x0c1526), hemiSky: new THREE.Color(0x30487a), hemiGround: new THREE.Color(0x0b1220),
  hemi: 0.55, sunColor: new THREE.Color(0x9db8ff), sun: 0.45, fogNear: -2, fogFar: 20, exposure: 1.1,
};
const DUSK_SKY = new THREE.Color(0xf0a878);

scene.background = DAY.sky.clone();
scene.fog = new THREE.Fog(DAY.sky.clone(), 40, 100);
const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
const SUN_OFFSET = new THREE.Vector3(-14, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 70 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

// ================================================================ monde

boot('decor');
const world = buildWorld(scene);
boot('fusion du decor');
bakeStatic(scene, world.keep);

boot('cultures et foret');
const beds = L.beds.map((b, i) => new Bed(scene, b.x, b.z, i < 2 ? 'carrot' : 'tomato'));
/** Les champs de ble de la ferme : des « bacs » geants, recoltes de la meme facon. */
const fields = L.fields.map((f) => new Bed(scene, f.x, f.z, 'wheat', FIELD_W, FIELD_D));
beds.push(...fields);
for (const b of beds) world.walls.push(...b.walls);
const pumps = L.pumps.map((p) => new Pump(scene, p.x, p.z, world.solids));
const trees = plantForest(scene);
for (const t of trees) world.solids.push(t.solid);
const scraps = L.scrap.map((s) => new ScrapSource(scene, s.x, s.z, s.ry, s.kind, world.solids));

boot('batiments');
const tower = watchTower(scene);
const B: Record<string, Building> = {
  bench: workbench(), sawmill: sawmill(), kitchen: kitchen(), shelter: shelter(), mill: windmill(), dock: dock(),
};
for (const b of Object.values(B)) scene.add(b.group);
B.tower = tower;
const bus = new Bus(scene);
world.solids.push({ x: L.bus.x - 2, z: L.bus.z, r: 1.4 }, { x: L.bus.x, z: L.bus.z, r: 1.4 }, { x: L.bus.x + 2, z: L.bus.z, r: 1.4 });

// Les ruines occupent deja la place des batiments : memes collisions avant et apres
// restauration, et la zone de paiement est a cote. Personne n'est jamais deplace.
const SOLIDS: Record<string, { x: number; z: number; r: number }[]> = {
  bench: [{ x: L.bench.x, z: L.bench.z - 0.6, r: 0.8 }, { x: L.bench.x, z: L.bench.z + 0.6, r: 0.8 }],
  sawmill: [{ x: L.sawmill.x - 0.9, z: L.sawmill.z, r: 1.0 }, { x: L.sawmill.x + 0.9, z: L.sawmill.z, r: 1.0 }],
  kitchen: [{ x: L.kitchen.x - 0.7, z: L.kitchen.z, r: 0.9 }, { x: L.kitchen.x + 0.7, z: L.kitchen.z, r: 0.9 }],
  tower: [{ x: L.tower.x, z: L.tower.z, r: 1.4 }],
  shelter: [{ x: L.shelter.x, z: L.shelter.z, r: 2.0 }],
  mill: [{ x: L.mill.x, z: L.mill.z, r: 1.9 }, { x: L.mill.x + 2.0, z: L.mill.z + 0.8, r: 0.9 }],
  chest: [{ x: L.chest.x, z: L.chest.z, r: 0.9 }],
};
for (const list of Object.values(SOLIDS)) for (const s of list) world.solids.push({ ...s });
boot('ruines');
const RUINS: Record<string, THREE.Object3D> = {
  bed2: bedRuin(scene, beds[1]!.x, beds[1]!.z),
  bed3: bedRuin(scene, beds[2]!.x, beds[2]!.z),
  bed4: bedRuin(scene, beds[3]!.x, beds[3]!.z),
  gate: gateJunk(scene),
  bench: benchRuin(scene),
  sawmill: sawmillRuin(scene),
  kitchen: kitchenRuin(scene),
  tower: towerRuin(scene),
  shelter: shelterRuin(scene),
  field1: fieldRuin(scene, fields[0]!.x, fields[0]!.z, FIELD_W, FIELD_D),
  field2: fieldRuin(scene, fields[1]!.x, fields[1]!.z, FIELD_W, FIELD_D),
  field3: fieldRuin(scene, fields[2]!.x, fields[2]!.z, FIELD_W, FIELD_D),
  mill: millRuin(scene, L.mill.x, L.mill.z),
  dock: dockRuin(scene, L.dock.x, L.dock.z),
  westRoad: junkPile(scene, L.farmGate.x, L.farmGate.z + 0.3, 0, 21),
  eastRoad: junkPile(scene, L.stationGate.x - 0.3, L.stationGate.z, Math.PI / 2, 23),
};
/** Le ponton : une fois repare, on peut s'avancer sur l'eau (mais pas tomber dedans). */
const dockWalls: Segment[] = [
  { x1: L.dock.x - 0.75, z1: 28.6, x2: L.dock.x - 0.75, z2: 31.2, off: true },
  { x1: L.dock.x + 0.75, z1: 28.6, x2: L.dock.x + 0.75, z2: 31.2, off: true },
  { x1: L.dock.x - 0.75, z1: 31.2, x2: L.dock.x + 0.75, z2: 31.2, off: true },
];
world.walls.push(...dockWalls);
/** La porte nord est bouchee par un amas de ferraille tant qu'on ne l'a pas degagee. */
const gateBarrier: Segment = { x1: -CAMP.gate, z1: CAMP.minZ, x2: CAMP.gate, z2: CAMP.minZ };
world.walls.push(gateBarrier);

boot('joueur et effets');
const player = new Player();
scene.add(player.root);
const particles = new Particles(scene);
const tracers = new Tracers(scene);
const flyers = new Flyers(scene);
const horde = new Horde(scene);
const drops = new CoinDrops(scene);
const muzzle = new THREE.PointLight(0xffc870, 0, 9, 1.8);
scene.add(muzzle);

const labels = document.querySelector<HTMLElement>('.labels')!;
const hint = document.querySelector<HTMLElement>('.hint')!;
const market = new Market(scene, labels);
const saw = new Converter(scene, L.sawIn, L.sawOut, ['log'], 1, 'plank', 1.6);
const cook = new Converter(scene, L.kitchenIn, L.kitchenOut, ['carrot', 'tomato'], 2, 'soup', 2.4);
const mill = new Converter(scene, L.millIn, L.millOut, ['wheat'], 2, 'bread', 2.8);
const reserve = new Reserve(scene, labels);
const helpers: Helper[] = [];
const nav: NavState = { northOpen: false, westOpen: false, eastOpen: false };
const R = regions(nav);
const navAll = [R.camp, R.farm, R.station];
const navZombies = [R.farm, R.station];

boot('palissade');
const palisade = new Palisade(scene, labels);
world.walls.push(...palisade.walls);
/** Les zombies butent aussi sur les portes fermees ; le joueur, jamais. */
const zombieWalls: Segment[] = [...world.walls, ...palisade.gateWalls];
const restorer = new Restorer({
  dust: (at, big) => particles.burst(at, [0xb9a58a, 0x9a8a72, 0xd8cbb5], big ? 36 : 5, big
    ? { speed: 5, up: 3, size: 0.3, life: 1.0 }
    : { speed: 2, up: 2, size: 0.15, life: 0.5 }),
  tick: () => sfx.sfxChop(),
});

const fireflies = Array.from({ length: 26 }, (_, i) => {
  const s = glow(0xd8ff7a, 0.45);
  const a = (i / 26) * Math.PI * 2;
  const d = 15 + (i % 5) * 3;
  s.userData = { x: Math.cos(a) * d, z: Math.sin(a) * d * 0.8, ph: i * 1.7 };
  scene.add(s);
  return s;
});

// ================================================================ interface

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const ui = {
  clockIcon: $('.clock .ci'), clockText: $('.clock .ct'), clockBar: $('.clock .cbar i'),
  money: $('.money b'), moneyPill: $('.money'), bag: $('.bag b'), bagPill: $('.bag'),
  gems: $('.gems b'), gemsPill: $('.gems'), shop: $('.shop'), shopBody: $('.shop-body'), shopBtn: $('.shop-btn'),
  boostBar: $('.boost-bar'),
  objective: $('.objective'), objIcon: $('.objective .oi'), objText: $('.objective .ot'),
  toast: $('.toast'), modal: $('.modal'), sheetBody: $('.sheet-body'),
  joy: $('.joy'), knob: $('.joy-knob'), hp: $('.hpbar'), hpFill: $('.hpbar i'),
  menuBtn: $('.menu-btn'), menu: $('.menu'), sound: $<HTMLButtonElement>('.menu .m-sound'), reset: $<HTMLButtonElement>('.menu .m-reset'),
};

function toast(msg: string): void {
  ui.toast.textContent = msg;
  ui.toast.classList.remove('show');
  void ui.toast.offsetWidth;
  ui.toast.classList.add('show');
}

function bump(el: HTMLElement): void {
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
}

function buzz(ms: number): void {
  try { navigator.vibrate?.(ms); } catch { /* rien */ }
}

const projected = new THREE.Vector3();
function placeLabel(el: HTMLElement, x: number, y: number, z: number): void {
  projected.set(x, y, z).project(camera);
  const off = projected.z > 1 || Math.abs(projected.x) > 1.3 || Math.abs(projected.y) > 1.3;
  el.classList.toggle('off', off);
  if (off) return;
  const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
  el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
}

function costIcons(c: Cost): string {
  const parts: string[] = [];
  if (c.coins > 0) parts.push(`<span class="coin"></span>${c.coins}`);
  for (const t of Object.keys(ITEMS) as ItemType[]) {
    const n = c[t];
    if (n && n > 0) parts.push(`${ITEMS[t].icon}${n}`);
  }
  return parts.join(' ');
}

// ================================================================ etat

let save: Save = loadSave();
const isBuilt = (id: string) => save.built.includes(id);

// ---------------------------------------------------------------- zones a debloquer

interface Pad {
  def: PadDef;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  label: HTMLElement;
  shown: boolean;
  appear: number;
  pulse: number;
  inflight: number;
}

const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
const fillMat = new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.8, depthWrite: false });

boot('zones et sauvegarde');
const pads: Pad[] = PADS.map((def) => {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.4, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(def.x, 0.05, def.z);
  ring.visible = false;
  scene.add(ring);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(def.x, 0.045, def.z);
  fill.visible = false;
  scene.add(fill);
  const label = document.createElement('div');
  label.className = 'pad-label off';
  labels.appendChild(label);
  return { def, ring, fill, label, shown: false, appear: 0, pulse: 0, inflight: 0 };
});

function paidOf(id: string): Cost {
  return (save.paid[id] ??= { coins: 0 });
}

function remaining(p: Pad): Cost {
  const paid = paidOf(p.def.id);
  const r: Cost = { coins: Math.max(0, p.def.cost.coins - paid.coins) };
  for (const t of Object.keys(ITEMS) as ItemType[]) {
    const need = p.def.cost[t];
    if (need) r[t] = Math.max(0, need - (paid[t] ?? 0));
  }
  return r;
}

function totalCost(c: Cost): number {
  return c.coins + (Object.keys(ITEMS) as ItemType[]).reduce((a, t) => a + (c[t] ?? 0) * 10, 0);
}

function renderPad(p: Pad): void {
  const rem = remaining(p);
  p.label.innerHTML = `<span class="pl-icon">${p.def.icon}</span><span class="pl-name">${p.def.name}</span><span class="pl-cost">${costIcons(rem)}</span>`;
  const done = 1 - totalCost(rem) / Math.max(1, totalCost(p.def.cost));
  p.fill.scale.setScalar(Math.max(0.001, done));
}

/** Restaure un chantier : la ruine s'efface, le batiment se remonte piece par piece. */
function restore(id: string, built: THREE.Object3D, instant: boolean, done?: () => void): void {
  const ruin = RUINS[id] ?? null;
  if (instant) {
    restorer.instant(ruin, built);
    done?.();
  } else {
    restorer.run(ruin, built, () => {
      sfx.sfxBuild();
      done?.();
    });
  }
}

/** Un batiment restaure : une fois remonte, ses pieces immobiles sont fusionnees (mobile). */
function restoreBuilding(id: string, b: Building, instant: boolean, done?: () => void): void {
  restore(id, b.group, instant, () => {
    consolidate(b.group, b.live);
    done?.();
  });
}

/** Applique l'effet d'une construction ; `instant` au chargement d'une partie. */
function applyBuild(id: string, instant: boolean): void {
  const bed = { bed2: beds[1], bed3: beds[2], bed4: beds[3], field1: fields[0], field2: fields[1], field3: fields[2] }[id];
  if (bed) {
    bed.unlock();
    restore(id, bed.group, instant);
    return;
  }
  switch (id) {
    case 'gate':
      gateBarrier.off = true;
      palisade.enableNorth();
      restore('gate', palisade.north.root, instant);
      break;
    case 'bench': restoreBuilding(id, B.bench!, instant); break;
    case 'sawmill': restoreBuilding(id, B.sawmill!, instant, () => { saw.built = true; saw.setVisible(true); }); break;
    case 'kitchen': restoreBuilding(id, B.kitchen!, instant, () => { cook.built = true; cook.setVisible(true); }); break;
    case 'tower': restoreBuilding(id, tower, instant); break;
    case 'shelter': restoreBuilding(id, B.shelter!, instant); break;
    case 'farmer': case 'lumber': case 'scav': case 'fisher': case 'porter': case 'cashier':
      helpers.push(new Helper(scene, id as Job));
      break;
    case 'westRoad':
      world.locks.west.off = true;
      nav.westOpen = true;
      restore(id, new THREE.Group(), instant);
      break;
    case 'eastRoad':
      world.locks.east.off = true;
      nav.eastOpen = true;
      market.eastOpen = true;
      restore(id, new THREE.Group(), instant);
      break;
    case 'mill': restoreBuilding(id, B.mill!, instant, () => { mill.built = true; mill.setVisible(true); }); break;
    case 'dock':
      world.locks.dock.off = true;
      for (const w of dockWalls) w.off = false;
      restoreBuilding(id, B.dock!, instant);
      break;
    case 'bus1': bus.setStage(1); break;
    case 'bus2': bus.setStage(2); break;
    case 'bus3': bus.setStage(3); if (!instant) startVictory(); break;
  }
}

function build(p: Pad): void {
  if (isBuilt(p.def.id)) return;
  save.built.push(p.def.id);
  p.ring.visible = false;
  p.fill.visible = false;
  p.label.classList.add('off');
  applyBuild(p.def.id, false);
  sfx.sfxBuild();
  buzz(40);
  shake = 0.25;
  const site = p.def.site ?? p.def;
  particles.burst(new THREE.Vector3(site.x, 1.5, site.z), [0xffd84a, 0xffffff, 0xe0b077], 40, { speed: 6, up: 6, size: 0.16, life: 1.0 });
  toast(`${p.def.icon} ${DONE[p.def.id] ?? p.def.name} !`);
  persist();
}

const DONE: Record<string, string> = {
  bed2: 'Potager remis en état', bed3: 'Potager remis en état', bed4: 'Potager remis en état',
  gate: 'Porte nord dégagée', bench: 'Établi réparé', sawmill: 'La scierie tourne',
  tower: 'Tour de guet relevée', kitchen: 'La cuisine fume', shelter: 'Abri retapé',
  farmer: 'La fermière rejoint le camp', lumber: 'Le bûcheron rejoint le camp',
  scav: 'Le ferrailleur rejoint le camp', fisher: 'Le pêcheur rejoint le camp',
  porter: 'Momo le porteur rejoint le camp', cashier: 'Nadia tient la caisse',
  westRoad: 'La ferme est accessible', eastRoad: 'La route de l’est est libre',
  field1: 'Champ remis en culture', field2: 'Champ remis en culture', field3: 'Champ remis en culture',
  mill: 'Le moulin tourne', dock: 'Ponton réparé',
  bus1: 'Le moteur tousse', bus2: 'Carrosserie retapée', bus3: 'Plein fait',
};

// ---------------------------------------------------------------- demolitions, reparations, niveau du camp

/** Le premier potager n'a pas de chantier : il lui faut sa ruine pour le jour ou on le demolit. */
RUINS.bed1 = bedRuin(scene, beds[0]!.x, beds[0]!.z);
RUINS.bed1.visible = false;

/** Ce que coute la remise en etat d'un batiment demoli. Les potagers se reparent au bois. */
const REPAIR: Record<string, Cost> = {
  bed1: { coins: 0, log: 4 }, bed2: { coins: 0, log: 4 }, bed3: { coins: 0, log: 4 }, bed4: { coins: 0, log: 4 },
  field1: { coins: 0, log: 6 }, field2: { coins: 0, log: 6 }, field3: { coins: 0, log: 6 },
  bench: { coins: 40, log: 6 }, sawmill: { coins: 60, log: 10 }, kitchen: { coins: 80, plank: 6 },
  tower: { coins: 100, plank: 8 }, shelter: { coins: 120, plank: 10 }, mill: { coins: 150, plank: 12 },
};
const STRUCT_HP: Record<string, number> = {
  bed1: 30, bed2: 30, bed3: 30, bed4: 30, field1: 40, field2: 40, field3: 40,
  bench: 50, sawmill: 60, kitchen: 60, tower: 80, shelter: 90, mill: 80,
};
const NAMES: Record<string, string> = {
  bed1: 'Le potager', bed2: 'Le potager', bed3: 'Le potager', bed4: 'Le potager',
  field1: 'Un champ', field2: 'Un champ', field3: 'Un champ', bench: 'L’établi', sawmill: 'La scierie',
  kitchen: 'La cuisine', tower: 'La tour de guet', shelter: 'L’abri', mill: 'Le moulin',
};

const isBroken = (id: string) => save.broken.includes(id);
const structBuilt = (id: string) => id === 'bed1' || isBuilt(id);
/** Le batiment existe et tient debout. */
function structAlive(id: string): boolean {
  return structBuilt(id) && !isBroken(id);
}

function siteOf(id: string): { x: number; z: number; reach: number } {
  const bed = { bed1: beds[0], bed2: beds[1], bed3: beds[2], bed4: beds[3], field1: fields[0], field2: fields[1], field3: fields[2] }[id];
  if (bed) return { x: bed.x, z: bed.z, reach: Math.hypot(bed.w, bed.d) / 2 + 0.3 };
  const p = { bench: L.bench, sawmill: L.sawmill, kitchen: L.kitchen, tower: L.tower, shelter: L.shelter, mill: L.mill }[id]!;
  const r = { bench: 1.6, sawmill: 2.2, kitchen: 2.0, tower: 1.9, shelter: 2.6, mill: 2.4 }[id]!;
  return { x: p.x, z: p.z, reach: r };
}

const STRUCTS: Structure[] = Object.keys(REPAIR).map((id) => {
  const site = siteOf(id);
  return { id, ...site, hp: STRUCT_HP[id]!, max: STRUCT_HP[id]!, alive: () => structAlive(id) };
});

/** Ce qui se voit d'un batiment debout (pour le cacher quand il tombe). */
function builtOf(id: string): THREE.Object3D {
  const bed = { bed1: beds[0], bed2: beds[1], bed3: beds[2], bed4: beds[3], field1: fields[0], field2: fields[1], field3: fields[2] }[id];
  if (bed) return bed.group;
  return id === 'tower' ? tower.group : B[id]!.group;
}

/** Allume ou eteint ce que fait le batiment (production, tir, ameliorations). */
function setWorking(id: string, on: boolean): void {
  const bed = { bed1: beds[0], bed2: beds[1], bed3: beds[2], bed4: beds[3], field1: fields[0], field2: fields[1], field3: fields[2] }[id];
  if (bed) bed.unlocked = on;
  if (id === 'sawmill') saw.built = on;
  if (id === 'kitchen') cook.built = on;
  if (id === 'mill') mill.built = on;
}

let wreckToast = 0;
/** Les zombies ont eu raison d'un batiment : il redevient une ruine et s'arrete. */
function wreck(id: string, instant: boolean): void {
  if (!isBroken(id)) save.broken.push(id);
  const ruin = RUINS[id];
  const built = builtOf(id);
  built.visible = false;
  if (ruin) ruin.visible = true;
  setWorking(id, false);
  if (instant) return;
  const site = siteOf(id);
  particles.burst(new THREE.Vector3(site.x, 1.2, site.z), [0xb9a58a, 0x7a5a3a, 0x3a3a3a], 40, { speed: 6, up: 5, size: 0.28, life: 1.1 });
  sfx.sfxSplat();
  buzz(80);
  if (Math.hypot(site.x - player.position.x, site.z - player.position.z) < 14) shake = Math.max(shake, 0.3);
  if (performance.now() - wreckToast > 2500) {
    wreckToast = performance.now();
    toast(`💥 ${NAMES[id]} est détruit ! Répare-le`);
  }
  persist();
}

function onStructHit(st: Structure, at: THREE.Vector3, dmg: number): void {
  st.hp -= dmg;
  warn(`s${st.id}`, st.x, 2.6, st.z);
  particles.burst(at, [0xc68a4f, 0x7a5a3a], 4, { speed: 3, up: 2, size: 0.1, life: 0.5 });
  if (Math.hypot(at.x - player.position.x, at.z - player.position.z) < 14) sfx.sfxChop();
  if (st.hp <= 0) {
    st.hp = st.max;
    wreck(st.id, false);
  }
}

// ---- alertes : un ⚠️ au-dessus de ce qui se fait attaquer

interface Warning { el: HTMLElement; t: number; x: number; y: number; z: number }
const warnings = new Map<string, Warning>();
function warn(key: string, x: number, y: number, z: number): void {
  let w = warnings.get(key);
  if (!w) {
    const el = document.createElement('div');
    el.className = 'warn-label off';
    el.textContent = '⚠️';
    labels.appendChild(el);
    w = { el, t: 0, x, y, z };
    warnings.set(key, w);
  }
  w.t = 1.6;
  w.x = x;
  w.y = y;
  w.z = z;
}
function placeWarnings(dt: number): void {
  for (const w of warnings.values()) {
    w.t -= dt;
    if (w.t <= 0) { w.el.classList.add('off'); continue; }
    placeLabel(w.el, w.x, w.y, w.z);
  }
}

// ---- tours d'angle (niveau du camp)

const corners = [
  { x: -13.4, z: -11.4, from: 2 }, { x: 13.4, z: -11.4, from: 2 },
  { x: -13.4, z: 11.4, from: 3 }, { x: 13.4, z: 11.4, from: 3 },
].map((c) => ({ ...c, tower: watchTower(scene, c.x, c.z, false) }));
for (const c of corners) world.solids.push({ x: c.x, z: c.z, r: 1.2 });
const cornerClock: number[] = [];

/** Les niveaux du camp : ce que chacun coute et apporte. */
const CAMP_LEVELS: { cost: Cost; title: string; done: string }[] = [
  { cost: { coins: 0 }, title: '', done: '' },
  { cost: { coins: 500, plank: 15 }, title: 'Camp niv. 2 : tours d’angle nord', done: 'Tours d’angle nord en place' },
  { cost: { coins: 1100, plank: 25, scrap: 10 }, title: 'Camp niv. 3 : tours d’angle sud', done: 'Tours d’angle sud en place' },
  { cost: { coins: 2500, plank: 40, scrap: 25 }, title: 'Camp niv. 4 : palissade renforcée', done: 'Palissade et portes renforcées' },
];
const CAMP_PAD = { x: -3.6, z: 6.2 };

function applyCampLevel(instant: boolean): void {
  corners.forEach((c) => {
    if (save.campLv < c.from || c.tower.group.visible) return;
    if (instant) restorer.instant(null, c.tower.group);
    else restorer.run(null, c.tower.group, () => consolidate(c.tower.group, c.tower.live));
    if (instant) consolidate(c.tower.group, c.tower.live);
  });
  if (save.cycle && save.phase === 'day') planDay(save.phaseT / dayLen(save.day));
applyUpgrades();
equipWeapon((WEAPONS.find((x) => x.id === save.weapon)?.id ?? 'rifle') as WeaponId);
wearOutfit(save.outfit);
}

// ---- zones dynamiques : reparations et niveau du camp

interface DynPad {
  key: string; x: number; z: number; cost: Cost; icon: string; title: string;
  ring: THREE.Mesh; fill: THREE.Mesh; label: HTMLElement; inflight: number; done: () => void;
}
const dynPads = new Map<string, DynPad>();
const repairMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false });

function makeDyn(key: string, x: number, z: number, cost: Cost, icon: string, title: string, done: () => void): DynPad {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.4, 48), key.startsWith('fix') ? repairMat : ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  scene.add(ring);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(x, 0.045, z);
  scene.add(fill);
  const label = document.createElement('div');
  label.className = 'pad-label';
  labels.appendChild(label);
  save.fixPaid[key] ??= { coins: 0 };
  const dp: DynPad = { key, x, z, cost, icon, title, ring, fill, label, inflight: 0, done };
  renderDyn(dp);
  return dp;
}

function dropDyn(dp: DynPad): void {
  scene.remove(dp.ring, dp.fill);
  dp.label.remove();
  dynPads.delete(dp.key);
  delete save.fixPaid[dp.key];
}

function dynRemaining(dp: DynPad): Cost {
  const paid = save.fixPaid[dp.key]!;
  const r: Cost = { coins: Math.max(0, dp.cost.coins - paid.coins) };
  for (const t of Object.keys(ITEMS) as ItemType[]) {
    const need = dp.cost[t];
    if (need) r[t] = Math.max(0, need - (paid[t] ?? 0));
  }
  return r;
}

function renderDyn(dp: DynPad): void {
  const rem = dynRemaining(dp);
  const html = `<span class="pl-icon">${dp.icon}</span><span class="pl-name">${dp.title}</span><span class="pl-cost">${costIcons(rem)}</span>`;
  if (dp.label.innerHTML !== html) dp.label.innerHTML = html;
  dp.fill.scale.setScalar(Math.max(0.001, 1 - totalCost(rem) / Math.max(1, totalCost(dp.cost))));
}

function dynLanded(dp: DynPad): void {
  dp.inflight--;
  sfx.sfxDrop(4);
  if (dp.inflight === 0 && totalCost(dynRemaining(dp)) === 0 && dynPads.has(dp.key)) {
    dropDyn(dp);
    dp.done();
    persist();
  }
}

/** Ou se tenir pour reparer : la zone du chantier d'origine, ou pres du premier potager. */
function repairSpot(id: string): { x: number; z: number } {
  if (id === 'bed1') return { x: -7.8, z: -8.9 };
  const d = PADS.find((p) => p.id === id)!;
  return { x: d.x, z: d.z };
}

function repaired(id: string): void {
  save.broken = save.broken.filter((b) => b !== id);
  const st = STRUCTS.find((s) => s.id === id);
  if (st) st.hp = st.max;
  setWorking(id, true);
  restorer.run(RUINS[id] ?? null, builtOf(id));
  toast(`🔨 ${NAMES[id]} est réparé`);
  sfx.sfxBuild();
}

/** Fait correspondre les zones affichees a l'etat : une par batiment demoli, une pour le camp. */
function syncDynPads(): void {
  for (const id of save.broken) {
    const key = `fix:${id}`;
    if (dynPads.has(key)) continue;
    const at = repairSpot(id);
    dynPads.set(key, makeDyn(key, at.x, at.z, REPAIR[id]!, '🔨', `Réparer : ${NAMES[id]!.toLowerCase()}`, () => repaired(id)));
  }
  const next = save.campLv + 1;
  const key = `camp:${next}`;
  const want = save.obj >= 11 && next < CAMP_LEVELS.length;
  if (want && !dynPads.has(key)) {
    const lvl = CAMP_LEVELS[next]!;
    dynPads.set(key, makeDyn(key, CAMP_PAD.x, CAMP_PAD.z, lvl.cost, '🏰', lvl.title, () => {
      save.campLv = next;
      applyCampLevel(false);
      toast(`🏰 ${lvl.done} !`);
      sfx.sfxVictory();
    }));
  }
}

// ---------------------------------------------------------------- objectifs

interface Objective { icon: string; text: string; target: () => THREE.Vector3 | null; done: () => boolean }

const padPos = (id: string) => () => {
  const d = PADS.find((p) => p.id === id)!;
  return new THREE.Vector3(d.x, 0, d.z);
};
function nearestOf<T extends { x: number; z: number }>(list: T[], ok: (t: T) => boolean): () => THREE.Vector3 | null {
  return () => {
    let best: T | null = null;
    let bd = Infinity;
    for (const t of list) {
      if (!ok(t)) continue;
      const d = Math.hypot(t.x - player.position.x, t.z - player.position.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best ? new THREE.Vector3(best.x, 0, best.z) : null;
  };
}

/** Le troncon abime le plus proche, de preference a l'interieur de la zone de jeu. */
function nearestRepair(): THREE.Vector3 | null {
  let best: Section | null = null;
  let bd = Infinity;
  for (const s of palisade.sections) {
    if (!s.enabled || s.hp >= s.max) continue;
    const d = Math.hypot(s.repair.x - player.position.x, s.repair.z - player.position.z);
    if (d < bd) { bd = d; best = s; }
  }
  return best ? new THREE.Vector3(best.repair.x, 0, best.repair.z) : null;
}

const stat = (k: keyof Save['stats']) => () => save.stats[k] > 0;
const at = (p: { x: number; z: number }) => () => new THREE.Vector3(p.x, 0, p.z);

const OBJECTIVES: Objective[] = [
  // ---- le camp (0 a 18)
  { icon: '🥕', text: 'Récolte des carottes au potager', target: () => new THREE.Vector3(beds[0]!.x, 0, beds[0]!.z), done: stat('harvested') },
  { icon: '🧺', text: 'Pose-les dans les bacs de l’étal', target: at(L.shelf), done: stat('shelved') },
  { icon: '💰', text: 'Ramasse l’argent des ventes', target: at(L.cash), done: stat('cashed') },
  { icon: '🥕', text: 'Remets en état le deuxième potager', target: padPos('bed2'), done: () => isBuilt('bed2') },
  { icon: '🚪', text: 'Dégage la porte nord', target: padPos('gate'), done: () => isBuilt('gate') },
  { icon: '🪓', text: 'Coupe du bois dans la forêt', target: nearestOf(trees, (t) => t.standing), done: stat('logs') },
  { icon: '🪵', text: 'Répare un trou de la palissade', target: nearestRepair, done: () => save.stats.repairs > 0 || !palisade.sections.some((s) => s.enabled && s.hp < s.max) },
  { icon: '🔧', text: 'Répare l’établi', target: padPos('bench'), done: () => isBuilt('bench') },
  { icon: '🪚', text: 'Remets la scierie en marche', target: padPos('sawmill'), done: () => isBuilt('sawmill') },
  { icon: '🪚', text: 'Apporte du bois à la scierie', target: at(L.sawIn), done: stat('planks') },
  { icon: '🔩', text: 'Démonte une épave sur la route', target: nearestOf(scraps, (s) => s.amount > 0 && !insideStation(s.x, s.z)), done: stat('scrap') },
  { icon: '🗼', text: 'Relève la tour de guet', target: padPos('tower'), done: () => isBuilt('tower') },
  { icon: '🍅', text: 'Remets en état un potager à tomates', target: padPos('bed3'), done: () => isBuilt('bed3') },
  { icon: '🍲', text: 'Remets la cuisine en état', target: padPos('kitchen'), done: () => isBuilt('kitchen') },
  { icon: '🍲', text: 'Fais cuire de la soupe (légumes à la cuisine)', target: at(L.kitchenIn), done: stat('soup') },
  { icon: '🏠', text: 'Retape l’abri des survivants', target: padPos('shelter'), done: () => isBuilt('shelter') },
  { icon: '👩‍🌾', text: 'Recrute une fermière', target: padPos('farmer'), done: () => isBuilt('farmer') },
  { icon: '📦', text: 'Récupère sa récolte dans la réserve', target: () => new THREE.Vector3(reserve.zone.x, 0, reserve.zone.z), done: stat('chest') },
  { icon: '🧔', text: 'Recrute un bûcheron', target: padPos('lumber'), done: () => isBuilt('lumber') },
  // ---- la ferme (19 a 24)
  { icon: '🚜', text: 'Dégage l’entrée de la ferme, à l’ouest', target: padPos('westRoad'), done: () => isBuilt('westRoad') },
  { icon: '🌾', text: 'Remets un champ de blé en culture', target: padPos('field1'), done: () => isBuilt('field1') },
  { icon: '🌾', text: 'Récolte du blé', target: () => new THREE.Vector3(fields[0]!.x, 0, fields[0]!.z), done: () => save.stats.wheat > 0 || player.stack.has('wheat') || (reserve.counts.get('wheat') ?? 0) > 0 },
  { icon: '🍞', text: 'Restaure le moulin', target: padPos('mill'), done: () => isBuilt('mill') },
  { icon: '🍞', text: 'Apporte du blé au moulin pour faire du pain', target: at(L.millIn), done: stat('bread') },
  { icon: '🌾', text: 'Remets un deuxième champ en culture', target: padPos('field2'), done: () => isBuilt('field2') },
  // ---- l'etang (25 a 27)
  { icon: '🎣', text: 'Répare le ponton de l’étang, au sud', target: padPos('dock'), done: () => isBuilt('dock') },
  { icon: '🐟', text: 'Pêche au bout du ponton (reste immobile)', target: at(L.fishSpot), done: stat('fish') },
  { icon: '🧑‍🦰', text: 'Recrute un pêcheur', target: padPos('fisher'), done: () => isBuilt('fisher') },
  // ---- la station (28 a 30)
  { icon: '⛽', text: 'Dégage la route de l’est', target: padPos('eastRoad'), done: () => isBuilt('eastRoad') },
  { icon: '⛽', text: 'Siphonne du carburant à la station', target: nearestOf(pumps, (p) => p.amount > 0), done: stat('fuel') },
  { icon: '🧑‍🔧', text: 'Recrute un ferrailleur', target: padPos('scav'), done: () => isBuilt('scav') },
  // ---- le depart (31 a 36)
  { icon: '🍅', text: 'Remets en état le dernier potager', target: padPos('bed4'), done: () => isBuilt('bed4') },
  { icon: '🌾', text: 'Remets le dernier champ en culture', target: padPos('field3'), done: () => isBuilt('field3') },
  { icon: '🛡️', text: 'Renforce la palissade à l’établi', target: at(L.benchZone), done: () => save.up.wall > 0 },
  { icon: '🔧', text: 'Répare le moteur du bus', target: padPos('bus1'), done: () => isBuilt('bus1') },
  { icon: '🚌', text: 'Retape la carrosserie du bus', target: padPos('bus2'), done: () => isBuilt('bus2') },
  { icon: '⛽', text: 'Fais le plein et quitte la vallée', target: padPos('bus3'), done: () => isBuilt('bus3') },
];

function currentObjective(): Objective | null {
  return OBJECTIVES[save.obj] ?? null;
}

function renderObjective(): void {
  const o = currentObjective();
  ui.objective.classList.toggle('off', !o);
  if (!o) return;
  ui.objIcon.textContent = o.icon;
  ui.objText.textContent = o.text;
  bump(ui.objective);
}

function advanceObjectives(): void {
  let moved = false;
  while (save.obj < OBJECTIVES.length && OBJECTIVES[save.obj]!.done()) {
    save.obj++;
    moved = true;
  }
  if (moved) {
    renderObjective();
    sfx.sfxObjective();
    playRadio();
    persist();
  }
}

/** Un message radio debloque par l'objectif atteint (une seule fois chacun). */
function playRadio(): void {
  const msg = RADIO.find((r) => save.obj >= r.at && !save.radio.includes(r.at));
  if (!msg || ui.modal.classList.contains('show')) return;
  save.radio.push(msg.at);
  sfx.sfxToggle(true);
  showModal(`<div class="modal-big">📻</div><h2>${msg.from}</h2><p class="radio">« ${msg.text} »</p>`);
}

// Guidage : chevron qui rebondit au-dessus de la cible, et fleche au sol pres du joueur.
const guide = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.8, 4), new THREE.MeshBasicMaterial({ color: 0xffd84a }));
guide.rotation.x = Math.PI;
scene.add(guide);
const arrowShape = new THREE.Shape();
arrowShape.moveTo(0, 0.7);
arrowShape.lineTo(0.42, 0.05);
arrowShape.lineTo(0.16, 0.05);
arrowShape.lineTo(0.16, -0.5);
arrowShape.lineTo(-0.16, -0.5);
arrowShape.lineTo(-0.16, 0.05);
arrowShape.lineTo(-0.42, 0.05);
arrowShape.closePath();
const groundArrow = new THREE.Mesh(
  new THREE.ShapeGeometry(arrowShape),
  new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.9, depthWrite: false }),
);
groundArrow.rotation.order = 'YXZ';
scene.add(groundArrow);

// ---------------------------------------------------------------- ameliorations

function applyUpgrades(): void {
  player.stack.cap = 8 + 4 * save.up.bag;
  player.speedMul = 1 + 0.12 * save.up.boots;
  player.maxHp = 100 + 30 * save.up.health;
  player.hp = Math.min(player.hp, player.maxHp);
  // Portes renforcees (niveau 4 du camp) : un cran de solidite en plus pour toute la palissade.
  palisade.setLevel(save.up.wall + (save.campLv >= 4 ? 1 : 0));
}

let sheetOpen = false;
function renderSheet(): void {
  const levels = LEVELS.filter((d) => !d.needs || isBuilt(d.needs)).map((d) => {
    const lvl = lv(d.id);
    const max = lvl >= MAX_LEVEL;
    const cost = levelCost(d, lvl);
    return `<div class="card">
      <div class="card-icon">${d.icon}</div>
      <div class="card-main"><div class="card-title">${d.name} <span class="lv">niv. ${lvl}/${MAX_LEVEL}</span></div>
      <div class="card-desc">${d.effect(max ? lvl : lvl + 1)}</div></div>
      <button class="btn ${!max && save.coins < cost ? 'poor' : ''}" data-lv="${d.id}" ${max ? 'disabled' : ''}>${max ? 'MAX' : `<span class="coin"></span>${cost}`}</button>
    </div>`;
  }).join('');
  ui.sheetBody.innerHTML = `<h2>🏗️ Le camp</h2>${levels}<h2>🔧 Ton équipement</h2>` + UPGRADES.map((u) => {
    const lvl = save.up[u.id];
    const max = lvl >= u.costs.length;
    const cost = u.costs[lvl] ?? 0;
    return `<div class="card">
      <div class="card-icon">${u.icon}</div>
      <div class="card-main"><div class="card-title">${u.name} <span class="lv">${lvl}/${u.costs.length}</span></div>
      <div class="card-desc">${u.effect(max ? lvl : lvl + 1)}</div></div>
      <button class="btn ${!max && save.coins < cost ? 'poor' : ''}" data-up="${u.id}" ${max ? 'disabled' : ''}>${max ? 'MAX' : `<span class="coin"></span>${cost}`}</button>
    </div>`;
  }).join('');
}

ui.sheetBody.addEventListener('click', (e) => {
  const lb = (e.target as HTMLElement).closest<HTMLElement>('[data-lv]');
  if (lb) {
    const d = LEVELS.find((x) => x.id === lb.dataset.lv)!;
    const cost = levelCost(d, lv(d.id));
    if (lv(d.id) >= MAX_LEVEL) return;
    if (save.coins < cost) {
      sfx.sfxNope();
      lb.classList.remove('shake');
      void lb.offsetWidth;
      lb.classList.add('shake');
      return;
    }
    save.coins -= cost;
    save.lv[d.id] = lv(d.id) + 1;
    sfx.sfxBuild();
    buzz(30);
    particles.burst(player.position.clone().setY(2), [0xffd84a, 0xffffff], 30, { speed: 4, up: 5, size: 0.14 });
    renderSheet();
    persist();
    return;
  }
  const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-up]');
  if (!btn) return;
  const id = btn.dataset.up as UpId;
  const u = UPGRADES.find((x) => x.id === id)!;
  const lvl = save.up[id];
  const cost = u.costs[lvl];
  if (cost === undefined) return;
  if (save.coins < cost) {
    sfx.sfxNope();
    btn.classList.remove('shake');
    void btn.offsetWidth;
    btn.classList.add('shake');
    return;
  }
  save.coins -= cost;
  save.up[id] = lvl + 1;
  applyUpgrades();
equipWeapon((WEAPONS.find((x) => x.id === save.weapon)?.id ?? 'rifle') as WeaponId);
wearOutfit(save.outfit);
  if (id === 'health') player.hp = player.maxHp;
  sfx.sfxBuild();
  buzz(30);
  particles.burst(player.position.clone().setY(2), [0xffd84a, 0xffffff], 30, { speed: 4, up: 5, size: 0.14 });
  renderSheet();
  persist();
});

function setSheet(open: boolean): void {
  if (open === sheetOpen) {
    if (open) refreshSheetButtons();
    return;
  }
  sheetOpen = open;
  document.body.classList.toggle('sheet-open', open);
  if (open) renderSheet();
}

function refreshSheetButtons(): void {
  ui.sheetBody.querySelectorAll<HTMLElement>('[data-up]').forEach((b) => {
    const id = b.dataset.up as UpId;
    const cost = UPGRADES.find((x) => x.id === id)!.costs[save.up[id]];
    b.classList.toggle('poor', cost !== undefined && save.coins < cost);
  });
  ui.sheetBody.querySelectorAll<HTMLElement>('[data-lv]').forEach((b) => {
    const d = LEVELS.find((x) => x.id === b.dataset.lv)!;
    b.classList.toggle('poor', lv(d.id) < MAX_LEVEL && save.coins < levelCost(d, lv(d.id)));
  });
}

// ---------------------------------------------------------------- meta : niveaux, boosts, quetes, boutique

const lv = (id: LevelId) => save.lv[id] ?? 0;
const owns = (id: string) => save.owned.includes(id);
const boostOn = (id: BoostId) => (save.boosts[id] ?? 0) > 0;
/** Ce que rapporte une vente : niveau de l'etal et boost « ventes x2 ». */
/** Chaque survivant sauve fait de la reclame au camp : +4 % sur les ventes (jusqu'a +40 %). */
const sellMul = () => (1 + 0.06 * lv('stall') + Math.min(0.4, 0.04 * save.rescued)) * (boostOn('sell') ? 2 : 1);

/** Applique niveaux et boosts aux machines, cultures, reserve et au joueur (chaque image). */
function applyMeta(dt: number): void {
  for (const b of BOOSTS) if ((save.boosts[b.id] ?? 0) > 0) save.boosts[b.id] = Math.max(0, save.boosts[b.id]! - dt);
  const grow = boostOn('grow') ? 2 : 1;
  for (const b of beds) b.growMul = (1 + 0.12 * lv('crops')) * grow;
  saw.speed = (1 + 0.15 * lv('saw')) * grow;
  cook.speed = (1 + 0.15 * lv('cook')) * grow;
  mill.speed = (1 + 0.15 * lv('mill')) * grow;
  reserve.cap = 240 + 60 * lv('reserve');
  player.speedMul = (1 + 0.12 * save.up.boots) * (boostOn('speed') ? 1.4 : 1);
}

function startBoost(id: BoostId): void {
  save.boosts[id] = (save.boosts[id] ?? 0) + BOOST_TIME;
  const b = BOOSTS.find((x) => x.id === id)!;
  sfx.sfxObjective();
  toast(`${b.icon} ${b.name} : 3 minutes !`);
  persist();
}

/** Pieces qu'offre un coffre : de quoi avancer, a la mesure de la partie. */
const chestCoins = () => 120 + 60 * save.day + 8 * save.obj;

function gainGems(n: number): void {
  save.gems += n;
  bump(ui.gemsPill);
  sfx.sfxCoin();
}

function ensureQuests(): void {
  const key = todayKey();
  if (save.quests.key === key) return;
  save.quests = { key, list: rollQuests(key, save.obj, save.day, save.stats) };
  if (save.gemAds.key !== key) save.gemAds = { key, n: 0 };
}

function questProgress(q: { id: string; base: number; goal: number }): number {
  const def = QUESTS.find((d) => d.id === q.id)!;
  return Math.min(q.goal, save.stats[def.stat] - q.base);
}

const chestReady = () => Date.now() >= save.chestAt;
const questToClaim = () => save.quests.list.some((q) => !q.claimed && questProgress(q) >= q.goal);

function fmtWait(ms: number): string {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

let shopTab: 'shop' | 'quests' = 'shop';
let hudClock = 0;

function renderMetaHud(): void {
  hudClock -= 1;
  if (hudClock > 0) return;
  hudClock = 20;
  ensureQuests();
  const alert = chestReady() || questToClaim();
  ui.shopBtn.classList.toggle('alert', alert);
  ui.shop.querySelector('[data-tab="quests"]')!.classList.toggle('alert', questToClaim());
  const html = BOOSTS.filter((b) => boostOn(b.id))
    .map((b) => `<span>${b.icon} ${b.name} · ${Math.ceil(save.boosts[b.id]! / 60)} min</span>`).join('');
  if (ui.boostBar.innerHTML !== html) ui.boostBar.innerHTML = html;
  if (ui.shop.classList.contains('show')) renderShop();
}

function renderShop(): void {
  ensureQuests();
  ui.shop.querySelectorAll<HTMLElement>('[data-tab]').forEach((t) => t.classList.toggle('on', t.dataset.tab === shopTab));
  let h = '';
  if (shopTab === 'quests') {
    h = `<h3>Quêtes du jour</h3>` + save.quests.list.map((q, i) => {
      const def = QUESTS.find((d) => d.id === q.id)!;
      const n = questProgress(q);
      const done = n >= q.goal;
      return `<div class="card"><div class="card-icon">${def.icon}</div>
        <div class="card-main"><div class="card-title">${def.text.replace('{n}', String(q.goal))}</div>
        <div class="card-desc">${n} / ${q.goal}</div><div class="bar"><i style="width:${(n / q.goal) * 100}%"></i></div></div>
        <button class="btn gem" data-claim="${i}" ${!done || q.claimed ? 'disabled' : ''}>${q.claimed ? '✓' : `+${def.gems} 💎`}</button></div>`;
    }).join('') + `<p class="note">Nouvelles quêtes chaque jour à minuit.</p>`;
  } else {
    const wait = save.chestAt - Date.now();
    const adsLeft = GEM_ADS_PER_DAY - (save.gemAds.key === todayKey() ? save.gemAds.n : 0);
    const card = (icon: string, title: string, desc: string, btns: string) =>
      `<div class="card"><div class="card-icon">${icon}</div><div class="card-main"><div class="card-title">${title}</div><div class="card-desc">${desc}</div></div><div class="btns">${btns}</div></div>`;
    h = `<h3>Gratuit</h3>`;
    h += card('🎁', 'Coffre du ravitailleur', chestReady() ? `${chestCoins()} pièces et 3 💎` : `Prochain dans ${fmtWait(wait)}`,
      chestReady() ? `<button class="btn" data-chest="free">Ouvrir</button>` : `<button class="btn ad" data-chest="ad">📺 Ouvrir</button>`);
    h += card('💎', 'Gemmes offertes', `+3 💎 · encore ${adsLeft} aujourd'hui`, `<button class="btn ad" data-gemad ${adsLeft <= 0 ? 'disabled' : ''}>📺 +3</button>`);
    h += `<h3>Boosts · 3 minutes</h3>`;
    for (const b of BOOSTS) {
      const left = save.boosts[b.id] ?? 0;
      h += card(b.icon, b.name, left > 0 ? `En cours · ${Math.ceil(left / 60)} min` : b.desc,
        `<button class="btn ad" data-boost="${b.id}" data-pay="ad">📺</button><button class="btn gem" data-boost="${b.id}" data-pay="gem">${b.gems} 💎</button>`);
    }
    h += `<h3>Armes</h3>`;
    for (const wd of WEAPONS) {
      const owned = save.weapons.includes(wd.id);
      const on = save.weapon === wd.id;
      const btns = on ? `<button class="btn" disabled>Équipée</button>`
        : owned ? `<button class="btn" data-equip="${wd.id}">Équiper</button>`
          : `<button class="btn" data-weapon="${wd.id}" data-pay="coin"><span class="coin"></span>${wd.coins}</button><button class="btn gem" data-weapon="${wd.id}" data-pay="gem">${wd.gems} 💎</button>`;
      h += card(wd.icon, wd.name, wd.desc, btns);
    }
    h += `<h3>Tenues</h3>`;
    for (const o of OUTFITS) {
      const owned = save.outfits.includes(o.id);
      const on = save.outfit === o.id;
      const swatch = `<i class="swatch" style="background:#${o.jacket.toString(16).padStart(6, '0')}"></i>`;
      const btns = on ? `<button class="btn" disabled>Portée</button>`
        : owned ? `<button class="btn" data-outfit="${o.id}">Porter</button>`
          : `<button class="btn gem" data-outfit="${o.id}">${o.gems} 💎</button>`;
      h += card(o.icon, `${o.name} ${swatch}`, owned ? 'Dans ton sac' : 'Tenue', btns);
    }
    h += `<h3>Pièces</h3>`;
    h += card('💰', 'Sac de pièces', `${chestCoins() * 2} pièces`, `<button class="btn gem" data-coins="1">30 💎</button>`);
    h += card('💰', 'Coffre de pièces', `${chestCoins() * 9} pièces`, `<button class="btn gem" data-coins="2">120 💎</button>`);
    h += `<h3>Offres</h3>`;
    for (const p of PRODUCTS) {
      if (p.once && owns(p.id)) continue;
      h += card(p.icon, p.name, p.desc, `<button class="btn real" data-buy="${p.id}">${p.price}</button>`);
    }
    if (SIMULATED) h += `<p class="note">Version de test : les publicités et les achats sont simulés, rien n'est jamais débité.</p>`;
  }
  // On ne reconstruit que si le contenu a change : un bouton remplace sous le doigt perd le toucher.
  if (h === lastShop) return;
  lastShop = h;
  const scroll = ui.shopBody.scrollTop;
  ui.shopBody.innerHTML = h;
  ui.shopBody.scrollTop = scroll;
}
let lastShop = '';

function openShop(tab: 'shop' | 'quests' = shopTab): void {
  shopTab = tab;
  renderShop();
  ui.shop.classList.add('show');
}

ui.shopBtn.addEventListener('click', () => openShop(questToClaim() && !chestReady() ? 'quests' : 'shop'));
ui.shop.querySelector('.shop-close')!.addEventListener('click', () => ui.shop.classList.remove('show'));
ui.shop.addEventListener('click', (e) => {
  if (e.target === ui.shop) ui.shop.classList.remove('show');
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (t) { shopTab = t.dataset.tab as 'shop' | 'quests'; renderShop(); }
});

function grantChest(): void {
  save.chestAt = Date.now() + CHEST_EVERY;
  gainGems(3);
  flyCoins(chestCoins(), player.position.clone().add(new THREE.Vector3(0, 4, 2)), playerChest, earn, 14);
  toast(`🎁 Coffre : ${chestCoins()} pièces et 3 💎`);
  persist();
}

function payCoins(n: number): boolean {
  if (save.coins < n) {
    sfx.sfxNope();
    toast('💰 Pas assez de pièces');
    return false;
  }
  save.coins -= n;
  return true;
}

function equipWeapon(id: WeaponId): void {
  save.weapon = id;
  player.setWeapon(id);
}

function wearOutfit(id: string): void {
  const o = OUTFITS.find((x) => x.id === id) ?? OUTFITS[0]!;
  save.outfit = o.id;
  player.setOutfit(o.jacket, o.cap, o.pants);
}

function payGems(n: number): boolean {
  if (save.gems < n) {
    sfx.sfxNope();
    toast('💎 Pas assez de gemmes');
    return false;
  }
  save.gems -= n;
  return true;
}

function grantProduct(p: Product): void {
  if (p.once) save.owned.push(p.id);
  if (p.id === 'starter') {
    gainGems(150);
    save.coins += 1500;
    save.up.bag = Math.min(4, save.up.bag + 1);
    applyUpgrades();
equipWeapon((WEAPONS.find((x) => x.id === save.weapon)?.id ?? 'rifle') as WeaponId);
wearOutfit(save.outfit);
  } else if (p.id === 'gems_s') gainGems(80);
  else if (p.id === 'gems_m') gainGems(500);
  else if (p.id === 'gems_l') gainGems(1200);
  toast(`${p.icon} ${p.name} obtenu !`);
  sfx.sfxVictory();
  persist();
}

ui.shopBody.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const d = el.dataset;
  if (d.claim !== undefined) {
    const q = save.quests.list[Number(d.claim)]!;
    if (q.claimed || questProgress(q) < q.goal) return;
    q.claimed = true;
    gainGems(QUESTS.find((x) => x.id === q.id)!.gems);
    persist();
  } else if (d.chest === 'free') grantChest();
  else if (d.chest === 'ad') void showRewarded('le coffre du ravitailleur', owns('noads')).then((ok) => ok && grantChest());
  else if (d.gemad !== undefined) {
    void showRewarded('3 gemmes', owns('noads')).then((ok) => {
      if (!ok) return;
      ensureQuests();
      save.gemAds.n++;
      gainGems(3);
      persist();
      renderShop();
    });
  } else if (d.boost) {
    const id = d.boost as BoostId;
    const b = BOOSTS.find((x) => x.id === id)!;
    if (d.pay === 'gem') { if (payGems(b.gems)) startBoost(id); }
    else void showRewarded(b.name, owns('noads')).then((ok) => ok && startBoost(id));
  } else if (d.coins) {
    const big = d.coins === '2';
    if (payGems(big ? 120 : 30)) {
      const n = chestCoins() * (big ? 9 : 2);
      flyCoins(n, player.position.clone().add(new THREE.Vector3(0, 4, 2)), playerChest, earn, 16);
      persist();
    }
  } else if (d.weapon) {
    const wd = WEAPONS.find((x) => x.id === d.weapon)!;
    const ok = d.pay === 'gem' ? payGems(wd.gems) : payCoins(wd.coins);
    if (ok) {
      save.weapons.push(wd.id);
      equipWeapon(wd.id);
      toast(`${wd.icon} ${wd.name} : à toi !`);
      sfx.sfxVictory();
      persist();
    }
  } else if (d.equip) {
    equipWeapon(d.equip as WeaponId);
    persist();
  } else if (d.outfit) {
    const o = OUTFITS.find((x) => x.id === d.outfit)!;
    if (!save.outfits.includes(o.id)) {
      if (!payGems(o.gems)) return renderShop();
      save.outfits.push(o.id);
      toast(`${o.icon} ${o.name} : nouvelle tenue !`);
    }
    wearOutfit(o.id);
    persist();
  } else if (d.buy) {
    const p = PRODUCTS.find((x) => x.id === d.buy)!;
    void purchase(p).then((ok) => ok && grantProduct(p));
  }
  renderShop();
});

/** K.O. avec un gros chargement : une pub pour le recuperer, au choix du joueur. */
function offerKeepBag(lost: ItemType[]): void {
  showModal(`<div class="modal-big">💫</div><h2>K.O. !</h2>
    <p>Tu as lâché ton chargement (${lost.length} objets).</p>
    <button class="btn ad" data-keep>📺 Le récupérer</button>`);
  ui.modal.querySelector('[data-keep]')!.addEventListener('click', () => {
    void showRewarded('ton chargement', owns('noads')).then((ok) => {
      if (!ok) return;
      ui.modal.classList.remove('show');
      for (const t of lost) player.stack.add(t);
      toast('🎒 Chargement récupéré');
    });
  }, { once: true });
}

// ---------------------------------------------------------------- menu

ui.menuBtn.addEventListener('click', () => ui.menu.classList.toggle('on'));
ui.sound.addEventListener('click', () => {
  save.muted = !save.muted;
  sfx.setMuted(save.muted);
  ui.sound.textContent = save.muted ? '🔇 Son coupé' : '🔊 Son activé';
  persist();
});
let resetArmed = 0;
ui.reset.addEventListener('click', () => {
  if (Date.now() - resetArmed > 3000) {
    resetArmed = Date.now();
    ui.reset.textContent = 'Touche encore pour confirmer';
    setTimeout(() => { ui.reset.textContent = 'Recommencer le camp'; }, 3000);
    return;
  }
  wipeSave();
  save = freshSave();
  writeSave(save);
  location.reload();
});

// ================================================================ echanges

let pendingIn = 0;
const freeSpace = () => player.stack.cap - player.stack.count - pendingIn;

/** Un objet vole vers le dos du joueur. */
function giveToPlayer(t: ItemType, from: THREE.Vector3, onArrive?: () => void): void {
  pendingIn++;
  flyers.launch(itemMesh(t), from, () => player.stack.topWorld(), () => {
    pendingIn = Math.max(0, pendingIn - 1);
    if (ko > 0) return;
    player.stack.add(t);
    sfx.sfxPickup(player.stack.count);
    buzz(6);
    bump(ui.bagPill);
    onArrive?.();
  }, 0.24, 1.2);
}

/** Des pieces volent ; le montant est credite a l'arrivee de chacune. */
function flyCoins(total: number, from: THREE.Vector3, to: () => THREE.Vector3, credit: (n: number) => void, maxPieces = 10): void {
  if (total <= 0) return;
  const pieces = Math.min(maxPieces, total);
  const base = Math.floor(total / pieces);
  for (let i = 0; i < pieces; i++) {
    const share = i === pieces - 1 ? total - base * (pieces - 1) : base;
    const m = coinMesh();
    m.rotation.x = Math.PI / 2;
    const start = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6));
    setTimeout(() => flyers.launch(m, start, to, () => credit(share), 0.32 + Math.random() * 0.1, 1.6), i * 45);
  }
}

function earn(n: number): void {
  save.coins += n;
  save.stats.earned += n;
  sfx.sfxCoin();
  bump(ui.moneyPill);
}

const playerChest = () => player.position.clone().setY(1.3);

/** Objets en vol vers chaque bac de l'etal. */
const shelfPending = new Map<ItemType, number>();
const convPending = new Map<Converter, number>([[saw, 0], [cook, 0], [mill, 0]]);

function putOnShelf(t: ItemType, from: THREE.Vector3): void {
  shelfPending.set(t, (shelfPending.get(t) ?? 0) + 1);
  const target = market.bins.binWorld(t);
  flyers.launch(itemMesh(t), from, () => target, () => {
    shelfPending.set(t, Math.max(0, (shelfPending.get(t) ?? 1) - 1));
    market.bins.add(t);
  }, 0.26, 1.0);
}

function putInConverter(c: Converter, t: ItemType, from: THREE.Vector3): void {
  const pend = (convPending.get(c) ?? 0) + 1;
  convPending.set(c, pend);
  const target = c.input.slotWorld(c.input.count + pend - 1);
  flyers.launch(itemMesh(t), from, () => target, () => {
    convPending.set(c, Math.max(0, (convPending.get(c) ?? 1) - 1));
    c.input.add(t);
  }, 0.26, 1.0);
}

const shelfRoom = (t: ItemType) => ITEMS[t].price > 0 ? BIN_CAP - market.bins.countOf(t) - (shelfPending.get(t) ?? 0) : 0;
const convRoom = (c: Converter) => c.input.cap - c.input.count - (convPending.get(c) ?? 0);

let actClock = 0;
let harvestClock = 0;
let dropClock = 0;
let pickClock = 0;
let payClock = 0;
let fullClock = 0;
let fishClock = 0;
let pumpClock = 0;
/** Temps passe immobile : on ne depose rien tant qu'on n'est pas reste 0,5 s sur place. */
let still = 0;
const SETTLE = 0.5;

const near = (x: number, z: number, r: number) => Math.hypot(player.position.x - x, player.position.z - z) < r;

function interact(dt: number): void {
  const p = player.position;
  actClock -= dt;
  harvestClock -= dt;
  dropClock -= dt;
  pickClock -= dt;
  payClock -= dt;
  fishClock -= dt;
  pumpClock -= dt;
  still = move.lengthSq() > 0 ? 0 : still + dt;
  const settled = still >= SETTLE;
  if (ko > 0) return;

  // Sac plein pres d'une ressource : on le signale, sans insister.
  fullClock -= dt;
  if (freeSpace() <= 0 && fullClock <= 0) {
    const nearRes = beds.some((b) => b.unlocked && b.ripeCount() > 0 && b.distance(p.x, p.z) < 0.95)
      || trees.some((t) => t.standing && Math.hypot(t.x - p.x, t.z - p.z) < 1.75)
      || scraps.some((s) => s.amount > 0 && Math.hypot(s.x - p.x, s.z - p.z) < s.radius);
    if (nearRes) {
      fullClock = 6;
      toast('🎒 Sac plein ! Va vider ton chargement');
      bump(ui.bagPill);
    }
  }

  // Potagers : on recolte en longeant les bacs.
  if (harvestClock <= 0 && freeSpace() > 0) {
    for (const b of beds) {
      if (!b.unlocked || b.distance(p.x, p.z) > 0.95) continue;
      const from = b.harvestNear(p.x, p.z);
      if (from) {
        harvestClock = 0.1;
        const kind: ItemType = b.kind;
        giveToPlayer(kind, from, () => {
          save.stats.harvested++;
          if (kind === 'wheat') save.stats.wheat++;
        });
        particles.burst(from, [0x7fdc5a, 0x5a3a20], 4, { speed: 2, up: 3, size: 0.08, life: 0.4 });
        break;
      }
    }
  }

  // Outils : hache pres d'un arbre, marteau pres d'une epave, fusil face a un zombie.
  let tool: 'axe' | 'hammer' | null = null;
  let tree: ChopTree | null = null;
  let src: ScrapSource | null = null;
  if (freeSpace() > 0) {
    let bd = 1.75;
    for (const t of trees) {
      if (!t.standing) continue;
      const d = Math.hypot(t.x - p.x, t.z - p.z);
      if (d < bd) { bd = d; tree = t; }
    }
    if (tree) tool = 'axe';
    else {
      for (const s of scraps) {
        if (s.amount > 0 && Math.hypot(s.x - p.x, s.z - p.z) < s.radius) { src = s; tool = 'hammer'; break; }
      }
    }
  }
  player.setTool(aimTarget ? 'gun' : tool ?? 'none');
  const toolTarget = tree ?? src;
  if (toolTarget && !aimTarget) {
    player.faceTowards(toolTarget.x, toolTarget.z, dt);
    const interval = tool === 'axe' ? 0.5 - 0.06 * save.up.axe : 0.45;
    if (actClock <= 0 && player.strike()) {
      actClock = interval;
      const tt = tree;
      const ss = src;
      // L'impact arrive au milieu du geste.
      setTimeout(() => {
        if (tt && tt.chop(p.x, p.z, 3 + save.up.axe)) {
          sfx.sfxChop();
          buzz(12);
          const at = new THREE.Vector3(tt.x, 1.2, tt.z);
          particles.burst(at, [0xc68a4f, 0xe0b077, 0x6fa83e], 10, { speed: 3, up: 3, size: 0.1, life: 0.6 });
          if (freeSpace() > 0) giveToPlayer('log', at, () => { save.stats.logs++; });
          if (!tt.standing) shake = Math.max(shake, 0.12);
        } else if (ss && ss.hit()) {
          sfx.sfxClang();
          buzz(12);
          const at = new THREE.Vector3(ss.x, 1.0, ss.z);
          particles.burst(at, [0xfff1a8, 0x9aa3ab, 0xb8653a], 10, { speed: 4, up: 3, size: 0.08, life: 0.4 });
          if (freeSpace() > 0) giveToPlayer('scrap', at, () => { save.stats.scrap++; });
        }
      }, 140);
    }
  }

  // Station : on siphonne les cuves, bidon par bidon.
  if (freeSpace() > 0 && pumpClock <= 0) {
    const pump = pumps.find((u) => u.amount > 0 && near(u.x, u.z, u.radius));
    if (pump && pump.take()) {
      pumpClock = 0.8;
      sfx.sfxClang();
      const from = new THREE.Vector3(pump.x, 1.0, pump.z);
      particles.burst(from, [0xc9412f, 0x3a3a3a], 5, { speed: 2, up: 2, size: 0.08, life: 0.4 });
      giveToPlayer('fuel', from, () => { save.stats.fuel++; });
    }
  }
  // Peche : au bout du ponton, immobile, ca mord regulierement.
  if (isBuilt('dock') && settled && freeSpace() > 0 && near(L.fishSpot.x, L.fishSpot.z, 1.1)) {
    player.faceTowards(L.fishSpot.x, L.fishSpot.z + 3, dt);
    if (fishClock <= 0) {
      fishClock = 1.9;
      const from = new THREE.Vector3(L.fishSpot.x + (Math.random() - 0.5) * 1.4, 0.3, L.fishSpot.z + 1.6 + Math.random());
      particles.burst(from, [0xbfe6ff, 0xffffff, 0x4f8090], 14, { speed: 2.5, up: 4, size: 0.12, life: 0.6 });
      sfx.sfxPickup(3);
      giveToPlayer('fish', from, () => { save.stats.fish++; });
    }
  }
  // Reserve : immobile devant le coffre, on recupere ce que les survivants y ont mis.
  if (settled && pickClock <= 0 && reserve.total > 0 && freeSpace() > 0 && near(reserve.zone.x, reserve.zone.z, 1.1)) {
    const t = reserve.take();
    if (t) {
      pickClock = 0.09;
      giveToPlayer(t, reserve.topWorld(), () => { save.stats.chest++; });
    }
  }

  // Deposer a l'etal tout ce qui se vend.
  if (settled && dropClock <= 0 && near(L.shelf.x, L.shelf.z, 1.6)) {
    const item = player.stack.take((t) => shelfRoom(t) > 0);
    if (item) {
      dropClock = 0.08;
      putOnShelf(item.type, item.pos);
      save.stats.shelved++;
      sfx.sfxDrop(market.bins.total);
    }
  }
  // Reparer la palissade : immobile le long d'un troncon abime, avec des rondins.
  // On ne repare pas si l'on se tient dans une autre zone (etal, chantier, machine) :
  // le bois va la ou on l'a voulu.
  const busyZone = near(L.shelf.x, L.shelf.z, 1.8) || near(reserve.zone.x, reserve.zone.z, 1.3)
    || pads.some((q) => q.shown && !isBuilt(q.def.id) && near(q.def.x, q.def.z, 1.6))
    || [saw, cook, mill].some((c) => c.built && near(c.input.x, c.input.z, 1.5));
  repairTarget = !busyZone && player.stack.has('log') ? palisade.repairable(p.x, p.z) : null;
  if (settled && dropClock <= 0 && repairTarget) {
    const s = repairTarget;
    const item = player.stack.take((t) => t === 'log');
    if (item) {
      dropClock = 0.16;
      s.inflight++;
      const to = new THREE.Vector3(s.x, 1.1, s.z);
      flyers.launch(itemMesh('log'), item.pos, () => to, () => repairLanded(s), 0.3, 1.3);
    }
  }
  // Nourrir les machines, ramasser ce qu'elles produisent.
  for (const c of [saw, cook, mill]) {
    if (!c.built) continue;
    if (settled && dropClock <= 0 && near(c.input.x, c.input.z, 1.35) && convRoom(c) > 0) {
      const item = player.stack.take((t) => c.accepts.includes(t));
      if (item) {
        dropClock = 0.08;
        putInConverter(c, item.type, item.pos);
        sfx.sfxDrop(c.input.count);
      }
    }
    if (pickClock <= 0 && near(c.output.x, c.output.z, 1.35) && freeSpace() > 0 && c.output.count > 0) {
      const item = c.output.take();
      if (item) {
        pickClock = 0.09;
        giveToPlayer(item.type, item.pos);
      }
    }
  }
  // Encaisser.
  if (market.cash > 0 && near(L.cash.x, L.cash.z, 1.4)) {
    const n = market.takeCash();
    flyCoins(n, market.cashWorld(), playerChest, (k) => {
      earn(k);
      save.stats.cashed += k;
    }, 12);
  }
  // Payer les zones a debloquer : d'abord les pieces, puis les materiaux.
  for (const pad of pads) {
    if (!settled || !pad.shown || isBuilt(pad.def.id) || payClock > 0 || !near(pad.def.x, pad.def.z, 1.45)) continue;
    const rem = remaining(pad);
    const paid = paidOf(pad.def.id);
    const target = () => new THREE.Vector3(pad.def.x, 0.2, pad.def.z);
    if (rem.coins > 0 && save.coins > 0) {
      const chunk = Math.min(save.coins, rem.coins, Math.max(1, Math.ceil(pad.def.cost.coins / 25)));
      save.coins -= chunk;
      paid.coins += chunk;
      pad.inflight++;
      const m = coinMesh();
      m.rotation.x = Math.PI / 2;
      flyers.launch(m, playerChest(), target, () => landOnPad(pad), 0.25, 1.0);
      payClock = 0.05;
      renderPad(pad);
    } else {
      const item = player.stack.take((t) => (rem[t] ?? 0) > 0);
      if (item) {
        paid[item.type] = (paid[item.type] ?? 0) + 1;
        pad.inflight++;
        flyers.launch(itemMesh(item.type), item.pos, target, () => landOnPad(pad), 0.26, 1.0);
        payClock = 0.06;
        renderPad(pad);
      }
    }
  }

  interactEvents(dt, settled);
  // Reparations et niveau du camp : memes regles que les chantiers.
  syncDynPads();
  for (const dp of dynPads.values()) {
    if (!settled || payClock > 0 || !near(dp.x, dp.z, 1.45)) continue;
    const rem = dynRemaining(dp);
    const paid = save.fixPaid[dp.key]!;
    const target = () => new THREE.Vector3(dp.x, 0.2, dp.z);
    if (rem.coins > 0 && save.coins > 0) {
      const chunk = Math.min(save.coins, rem.coins, Math.max(1, Math.ceil(dp.cost.coins / 25)));
      save.coins -= chunk;
      paid.coins += chunk;
      dp.inflight++;
      const m = coinMesh();
      m.rotation.x = Math.PI / 2;
      flyers.launch(m, playerChest(), target, () => dynLanded(dp), 0.25, 1.0);
      payClock = 0.05;
    } else {
      const item = player.stack.take((t) => (rem[t] ?? 0) > 0);
      if (item) {
        paid[item.type] = (paid[item.type] ?? 0) + 1;
        dp.inflight++;
        flyers.launch(itemMesh(item.type), item.pos, target, () => dynLanded(dp), 0.26, 1.0);
        payClock = 0.06;
      }
    }
    renderDyn(dp);
  }

  // Etabli : le panneau d'ameliorations s'ouvre quand on se tient devant.
  setSheet(structAlive('bench') && near(L.benchZone.x, L.benchZone.z, 1.5));
}

/** Le troncon que le joueur est en train de reparer (pour son etiquette). */
let repairTarget: Section | null = null;

function repairLanded(s: Section): void {
  s.inflight = Math.max(0, s.inflight - 1);
  const before = stateOf(s);
  palisade.setHp(s, s.hp + LOG_HP);
  save.stats.repairs++;
  sfx.sfxChop();
  buzz(10);
  const at = new THREE.Vector3(s.x, 1.2, s.z);
  particles.burst(at, [0xc68a4f, 0xe0b077, 0xd9b07a], 10, { speed: 3, up: 3, size: 0.12, life: 0.6 });
  if (stateOf(s) !== before) {
    palisade.bump(s);
    particles.burst(at.setY(0.4), [0xb9a58a, 0x9a8a72], 12, { speed: 3, up: 2, size: 0.22, life: 0.7 });
  }
  if (s.hp >= s.max) {
    sfx.sfxBuild();
    toast('🪵 Palissade consolidée');
  }
}

let wallToast = 0;
/** Un coup de zombie sur la palissade : eclats de bois, et alerte si elle cede. */
function onWallHit(s: Section, at: THREE.Vector3): void {
  particles.burst(at, [0xc68a4f, 0x7a5a3a, 0xd9b07a], 5, { speed: 3, up: 2, size: 0.1, life: 0.5 });
  warn(`w${s.id}`, s.x, s.z > CAMP.maxZ - 0.5 ? 2.4 : 3.6, s.z);
  const near0 = Math.hypot(at.x - player.position.x, at.z - player.position.z) < 14;
  if (near0) sfx.sfxChop();
  if (s.hp <= 0 && performance.now() - wallToast > 4000) {
    wallToast = performance.now();
    toast('⚠️ La palissade a cédé !');
    buzz(60);
    if (near0) shake = Math.max(shake, 0.2);
  }
}

function landOnPad(pad: Pad): void {
  pad.inflight--;
  sfx.sfxDrop(4);
  pad.pulse = 1;
  if (pad.inflight === 0 && totalCost(remaining(pad)) === 0) build(pad);
}

// ================================================================ survivants

/** Les survivants deposent tout dans la reserve ; le joueur s'y sert. */
let reservePending = 0;
function putInReserve(t: ItemType, from: THREE.Vector3): void {
  reservePending++;
  flyers.launch(itemMesh(t), from, () => reserve.topWorld(), () => {
    reservePending = Math.max(0, reservePending - 1);
    reserve.add(t);
  }, 0.3, 1.1);
}

const helperCtx: HelperCtx = {
  beds, trees, scraps, walls: world.walls, solids: world.solids, nav: navAll, night: false, dockReady: false,
  reachable: (x, z) => (!insideFarm(x, z) || nav.westOpen) && (!insideStation(x, z) || nav.eastOpen),
  reserve: { at: reserve.zone, room: () => reserve.total + reservePending < reserve.cap, put: putInReserve },
  onHarvest: (from, _to, t) => {
    if (t === 'wheat') save.stats.wheat++;
    particles.burst(from, [0x7fdc5a, 0x5a3a20], 4, { speed: 2, up: 3, size: 0.08, life: 0.4 });
  },
  onChop: (tree, h) => {
    if (tree.chop(h.human.root.position.x, h.human.root.position.z, 3)) {
      h.stack.add('log');
      particles.burst(new THREE.Vector3(tree.x, 1.2, tree.z), [0xc68a4f, 0xe0b077], 6, { speed: 3, up: 3, size: 0.09, life: 0.5 });
    }
  },
  onScrap: (src, h) => {
    if (src.hit()) {
      h.stack.add('scrap');
      particles.burst(new THREE.Vector3(src.x, 1.0, src.z), [0xfff1a8, 0x9aa3ab], 6, { speed: 3, up: 3, size: 0.08, life: 0.4 });
    }
  },
  onFish: (h) => {
    h.stack.add('fish');
    particles.burst(new THREE.Vector3(L.fishSpot.x, 0.3, L.fishSpot.z + 1.8), [0xbfe6ff, 0xffffff], 8, { speed: 2, up: 3, size: 0.1, life: 0.5 });
  },
  reserveCount: () => reserve.total,
  reserveTake: () => reserve.take(),
  porterDrop: (t) => {
    // D'abord la machine qui transforme, sinon le bac de l'etal.
    const conv = t === 'log' ? saw : t === 'carrot' || t === 'tomato' ? cook : t === 'wheat' ? mill : null;
    if (conv && conv.built && convRoom(conv) > 0) return { at: { x: conv.input.x, z: conv.input.z }, put: (x, from) => putInConverter(conv, x, from) };
    if (shelfRoom(t) > 0) return { at: L.shelf, put: (x, from) => putOnShelf(x, from) };
    return null;
  },
  outputs: () => [cook, mill].filter((c) => c.built && c.output.count > 0 && shelfRoom(c.product) > 0)
    .map((c) => ({ at: { x: c.output.x, z: c.output.z }, take: () => c.output.take() })),
  cashSpot: { x: L.cash.x - 1.2, z: L.cash.z - 0.4 },
  onCashier: () => {
    if (market.cash <= 0) return;
    const n = market.takeCash();
    flyCoins(n, market.cashWorld(), playerChest, (k) => { earn(k); save.stats.cashed += k; }, 6);
  },
};

// ================================================================ jour / nuit et combat

let nightK = 0;
let fireClock = 0;
let towerClock = 0;
let aimTarget: THREE.Vector3 | null = null;
let shake = 0;
let invuln = 0;
let ko = 0;

function startNight(): void {
  save.phase = 'night';
  save.phaseT = 0;
  horde.startNight(save.day);
  endDayEvents();
  sfx.sfxToggle(true);
  toast(horde.bruteNight ? `🌙 Nuit ${save.day} : une brute est avec eux !` : `🌙 Nuit ${save.day} : ils arrivent !`);
  document.body.classList.add('night');
}

function startDay(): void {
  horde.endNight();
  save.stats.nights++;
  save.day++;
  save.phase = 'day';
  save.phaseT = 0;
  sfx.sfxToggle(false);
  save.gems += 2;
  toast(`☀️ Jour ${save.day} : le camp a tenu ! +2 💎`);
  document.body.classList.remove('night');
  planDay(0);
  persist();
}

// ================================================================ evenements et fouille

const caches = CACHE_SPOTS.map((sp) => new Cache(scene, sp));
const airdrop = new Airdrop(scene);
const caravan = new Caravan(scene);
const rescue = new Rescue(scene);
const zoneOpen = (sp: Spot) => sp.zone === null || (sp.zone === 'farm' ? nav.westOpen : nav.eastOpen);
const CACHE_REFILL = 8 * 60 * 1000;
caches.forEach((c, i) => { if ((save.caches[`c${i}`] ?? 0) > Date.now()) c.open(); });

const evLabel = (cls: string) => {
  const el = document.createElement('div');
  el.className = `event-label ${cls} off`;
  labels.appendChild(el);
  return el;
};
const cacheLabel = evLabel('cache');
const dropLabel = evLabel('drop');
const caravanLabel = evLabel('caravan');
const rescueLabel = evLabel('rescue');

/** Ce que la journee reserve, en fraction de sa duree (tire au lever du jour). */
const plan = { drop: -1, caravan: -1, rescue: -1 };
interface Offer { want: ItemType; need: number; got: number; pay: number; gems: number }
let offer: Offer | null = null;
let rescueHold = 0;
let smokeClock = 0;
let tradeClock = 0;

function planDay(from: number): void {
  const pick = (chance: number, a: number, b: number) => (Math.random() < chance ? Math.max(from + 0.02, a + Math.random() * (b - a)) : -1);
  plan.drop = pick(0.75, 0.12, 0.6);
  plan.caravan = save.day >= 2 ? pick(0.6, 0.15, 0.35) : -1;
  plan.rescue = save.day >= 3 ? pick(0.45, 0.3, 0.7) : -1;
}

function endDayEvents(): void {
  if (airdrop.active) airdrop.hide();
  if (caravan.active) { caravan.show(false); offer = null; }
  if (rescue.active) rescue.hide();
  plan.drop = plan.caravan = plan.rescue = -1;
}

/** Butin d'une cache (petit) ou d'un ravitaillement (gros). */
function giveLoot(at: THREE.Vector3, big: boolean): void {
  const coins = (big ? 150 : 40) + (big ? 50 : 12) * save.day;
  flyCoins(coins, at, playerChest, earn, 10);
  const pool: ItemType[] = ['scrap', 'plank', 'log', 'scrap'];
  if (nav.eastOpen) pool.push('fuel');
  const n = big ? 5 : 2 + Math.floor(Math.random() * 2);
  let given = 0;
  for (let i = 0; i < n && freeSpace() > 0; i++) {
    const t = pool[Math.floor(Math.random() * pool.length)]!;
    giveToPlayer(t, at.clone().add(new THREE.Vector3(0, 0.3 * i, 0)));
    given++;
  }
  const gems = big ? 4 + Math.floor(Math.random() * 3) : Math.random() < 0.25 ? 1 + Math.floor(Math.random() * 2) : 0;
  if (gems) gainGems(gems);
  particles.burst(at, [0xffd84a, 0xffffff, 0x8be36b], big ? 40 : 18, { speed: 5, up: 6, size: 0.15, life: 0.9 });
  sfx.sfxBuild();
  toast(`${big ? '🪂 Ravitaillement' : '📦 Cache'} : ${coins} pièces${given ? `, ${given} objets` : ''}${gems ? `, ${gems} 💎` : ''}`);
}

/** La caravane demande un lot d'un produit qu'on sait faire, et paie bien plus que l'etal. */
function makeOffer(): Offer {
  const options = productsList().filter((t) => t !== 'carrot');
  const want = options[Math.floor(Math.random() * options.length)] ?? 'carrot';
  const need = Math.max(6, Math.round(60 / ITEMS[want].price)) + save.day;
  return { want, need, got: 0, pay: Math.round(need * ITEMS[want].price * 2.5), gems: 3 };
}

function updateEvents(dt: number, time: number): void {
  for (const c of caches) c.update(dt);
  caravan.update(dt);
  rescue.update(dt);
  if (airdrop.update(dt, time)) {
    shake = Math.max(shake, 0.2);
    particles.burst(new THREE.Vector3(airdrop.x, 0.5, airdrop.z), [0xb9a58a, 0x9a8a72], 30, { speed: 5, up: 3, size: 0.3, life: 1 });
  }
  // Fumigene vert au-dessus du ravitaillement : on le voit de loin.
  if (airdrop.active && airdrop.landed) {
    smokeClock -= dt;
    if (smokeClock <= 0) {
      smokeClock = 0.12;
      particles.burst(new THREE.Vector3(airdrop.x + 0.6, 1.1, airdrop.z), [0x8be36b, 0x6fd36a, 0xc8f0b0], 2, { speed: 0.6, up: 4, size: 0.4, life: 2.2, gravity: -1 });
    }
  }
  if (!save.cycle || save.phase !== 'day') return;
  const f = save.phaseT / dayLen(save.day);
  if (plan.drop >= 0 && f >= plan.drop) {
    plan.drop = -1;
    const spots = DROP_SPOTS.filter(zoneOpen);
    const sp = spots[Math.floor(Math.random() * spots.length)]!;
    airdrop.drop(sp.x, sp.z);
    sfx.sfxObjective();
    toast('🪂 Un ravitaillement est largué ! Cherche la fumée verte');
  }
  if (plan.caravan >= 0 && f >= plan.caravan) {
    plan.caravan = -1;
    offer = makeOffer();
    caravan.show(true);
    sfx.sfxObjective();
    toast(`🛒 Une caravane s’arrête sur la route : elle achète ${ITEMS[offer.want].icon} au prix fort`);
  }
  if (plan.rescue >= 0 && f >= plan.rescue) {
    plan.rescue = -1;
    const spots = RESCUE_SPOTS.filter(zoneOpen);
    const sp = spots[Math.floor(Math.random() * spots.length)]!;
    rescue.start(sp.x, sp.z);
    rescueHold = 0;
    sfx.sfxObjective();
    toast('🆘 Quelqu’un appelle à l’aide dans la vallée !');
  }
  // La caravane repart en fin d'apres-midi.
  if (caravan.active && f > 0.85) {
    caravan.show(false);
    offer = null;
    toast('🛒 La caravane reprend la route');
  }
}

/** Fouille, ravitaillement, caravane, sauvetage : tout se fait immobile, 0,5 s. */
function interactEvents(dt: number, settled: boolean): void {
  if (!settled) rescueHold = 0;
  // Caches
  caches.forEach((c, i) => {
    if (!c.ready && (save.caches[`c${i}`] ?? 0) <= Date.now()) c.ready = true;
    if (!settled || !c.ready || !zoneOpen(c.spot) || !near(c.spot.x, c.spot.z, 1.3)) return;
    c.open();
    save.caches[`c${i}`] = Date.now() + CACHE_REFILL;
    giveLoot(new THREE.Vector3(c.spot.x, 0.8, c.spot.z), false);
    persist();
  });
  // Ravitaillement
  if (settled && airdrop.active && airdrop.landed && near(airdrop.x, airdrop.z, 1.7)) {
    giveLoot(new THREE.Vector3(airdrop.x, 1.0, airdrop.z), true);
    airdrop.hide();
    persist();
  }
  // Caravane : on lui depose ce qu'elle demande.
  tradeClock -= dt;
  if (settled && offer && caravan.active && tradeClock <= 0 && near(caravan.zone.x, caravan.zone.z, 1.5)) {
    const o = offer;
    const item = player.stack.take((t) => t === o.want);
    if (item) {
      tradeClock = 0.1;
      o.got++;
      flyers.launch(itemMesh(item.type), item.pos, () => caravan.trader.root.getWorldPosition(new THREE.Vector3()).setY(1.3), () => sfx.sfxDrop(o.got), 0.3, 1.0);
      if (o.got >= o.need) {
        flyCoins(o.pay, new THREE.Vector3(caravan.zone.x, 1.5, caravan.zone.z), playerChest, earn, 14);
        gainGems(o.gems);
        toast(`🛒 Marché conclu : ${o.pay} pièces et ${o.gems} 💎 !`);
        offer = null;
        setTimeout(() => caravan.show(false), 2500);
      }
    }
  }
  // Sauvetage : rester 2 s pres de lui pour degager les gravats.
  if (rescue.active && near(rescue.x, rescue.z, 1.8)) {
    if (settled) rescueHold += dt;
    rescue.progress = Math.min(1, rescueHold / 2);
    if (rescueHold >= 2) {
      save.rescued++;
      gainGems(5);
      particles.burst(new THREE.Vector3(rescue.x, 1.2, rescue.z), [0xffd84a, 0xffffff, 0x8be36b], 30, { speed: 4, up: 6, size: 0.15 });
      sfx.sfxVictory();
      toast(`🙌 Survivant sauvé ! Il rejoint le camp et fait connaître l’étal : ventes +4 %`);
      rescue.hide();
      persist();
    }
  }
}

/** Etiquettes des evenements (la plus proche cache, le ravitaillement, la caravane, l'appel a l'aide). */
function placeEventLabels(): void {
  const p = player.position;
  let best: Cache | null = null;
  let bd = 9;
  for (const c of caches) {
    if (!c.ready || !zoneOpen(c.spot)) continue;
    const d = Math.hypot(c.spot.x - p.x, c.spot.z - p.z);
    if (d < bd) { bd = d; best = c; }
  }
  if (best) { cacheLabel.textContent = '🔍 Fouiller'; placeLabel(cacheLabel, best.spot.x, 1.2, best.spot.z); } else cacheLabel.classList.add('off');
  if (airdrop.active) { dropLabel.textContent = airdrop.landed ? '🪂 Ravitaillement' : '🪂'; placeLabel(dropLabel, airdrop.x, airdrop.root.position.y + 2.2, airdrop.z); } else dropLabel.classList.add('off');
  if (caravan.active && offer) {
    const html = `🛒 ${ITEMS[offer.want].icon} ${offer.got}/${offer.need} → <span class="coin"></span>${offer.pay}`;
    if (caravanLabel.innerHTML !== html) caravanLabel.innerHTML = html;
    placeLabel(caravanLabel, caravan.zone.x, 2.6, caravan.zone.z);
  } else caravanLabel.classList.add('off');
  if (rescue.active) {
    rescueLabel.textContent = rescue.progress > 0 ? `🆘 ${Math.round(rescue.progress * 100)} %` : '🆘 À l’aide !';
    placeLabel(rescueLabel, rescue.x, 2.4, rescue.z);
  } else rescueLabel.classList.add('off');
}

// ---- les survivants ont un nom, et parlent quand on passe

interface Talk { el: HTMLElement; say: number; next: number }
const talks = new Map<Helper, Talk>();
function placeCrew(dt: number): void {
  for (const h of helpers) {
    let t = talks.get(h);
    if (!t) {
      const el = document.createElement('div');
      el.className = 'name-label';
      labels.appendChild(el);
      t = { el, say: 0, next: 4 + Math.random() * 8 };
      talks.set(h, t);
    }
    const crew = CREW[h.job]!;
    const q = h.human.root.position;
    const d = Math.hypot(q.x - player.position.x, q.z - player.position.z);
    t.next -= dt;
    if (d < 4 && t.next <= 0 && t.say <= 0) {
      t.say = 3.5;
      t.next = 18 + Math.random() * 20;
      t.el.innerHTML = `<b>${crew.name}</b><span>${crew.lines[Math.floor(Math.random() * crew.lines.length)]}</span>`;
      t.el.classList.add('talk');
    }
    if (t.say > 0) {
      t.say -= dt;
      if (t.say <= 0) t.el.classList.remove('talk');
    } else if (t.el.innerHTML !== `<b>${crew.name}</b>`) t.el.innerHTML = `<b>${crew.name}</b>`;
    if (d > 11) { t.el.classList.add('off'); continue; }
    placeLabel(t.el, q.x, 2.4, q.z);
  }
}

function updateCycle(dt: number): void {
  if (!save.cycle) {
    if (save.obj >= CYCLE_FROM) {
      save.cycle = true;
      save.phase = 'day';
      save.phaseT = 0;
    }
    return;
  }
  if (save.won && save.phase === 'day') return;
  save.phaseT += dt;
  if (save.phase === 'day' && save.phaseT >= dayLen(save.day)) startNight();
  else if (save.phase === 'night') {
    const cleared = horde.remaining === 0 && save.phaseT > 10;
    if (save.phaseT >= nightLen(save.day) || cleared) startDay();
  }
}

function shoot(z: Zombie, from: THREE.Vector3, dmg: number, light = true): void {
  const hit = horde.damage(z, dmg, from);
  if (!hit) return;
  tracers.fire(from, hit.pos);
  if (light) {
    muzzle.position.copy(from);
    muzzle.intensity = 45;
  }
  particles.burst(from, [0xfff1a8, 0xffc870], 3, { speed: 2, up: 1, size: 0.07, life: 0.15, gravity: 0 });
  sfx.sfxShot();
  if (hit.killed) {
    particles.burst(hit.pos, hit.colors, 24, { speed: 5, up: 5, size: 0.2, life: 1.1 });
    sfx.sfxSplat();
    buzz(20);
    save.stats.kills++;
    // Hordes nombreuses : un zombie sur deux lache une piece, les brutes un vrai butin.
    if (z.brute) drops.spawn(hit.pos, 10, 2 + save.day);
    else if (Math.random() < 0.5) drops.spawn(hit.pos, 1, 1 + Math.floor(save.day / 3));
  } else {
    particles.burst(hit.pos, hit.colors, 5, { speed: 3, up: 2, size: 0.12, life: 0.5 });
  }
}

function updateCombat(dt: number): void {
  fireClock -= dt;
  towerClock -= dt;
  muzzle.intensity = Math.max(0, muzzle.intensity - dt * 400);
  const night = save.phase === 'night' && save.cycle;
  const w = WEAPONS.find((x) => x.id === save.weapon) ?? WEAPONS[0]!;
  const range = w.range(save.up.gun);
  const z = night && ko <= 0 ? horde.nearest(player.position, range) : null;
  aimTarget = z ? z.root.position : null;
  player.aiming = aimTarget;
  if (z && fireClock <= 0) {
    fireClock = w.interval(save.up.gun);
    const fwd = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
    const from = player.position.clone().addScaledVector(fwd, 0.9).setY(1.2);
    const targets = w.targets > 1 ? horde.nearestMany(player.position, range, w.targets) : [z];
    targets.forEach((t, i) => shoot(t, from, w.damage(save.up.gun), i === 0));
    if (w.id === 'shotgun') shake = Math.max(shake, 0.08);
  }
  if (night && structAlive('tower') && towerClock <= 0) {
    const tz = horde.nearest(new THREE.Vector3(L.tower.x, 0, L.tower.z), 16);
    if (tz) {
      towerClock = 0.7 / (1 + 0.08 * lv('tower'));
      shoot(tz, tower.muzzle, 1 + Math.floor(save.day / 3) + lv('tower'), false);
    }
  }
  // Tours d'angle (niveau du camp) : elles couvrent les flancs.
  if (night) {
    corners.forEach((c, i) => {
      if (save.campLv < c.from) return;
      cornerClock[i] = (cornerClock[i] ?? 0) - dt;
      if (cornerClock[i]! > 0) return;
      const cz = horde.nearest(new THREE.Vector3(c.x, 0, c.z), 15);
      if (!cz) return;
      cornerClock[i] = 0.9 / (1 + 0.08 * lv('tower'));
      shoot(cz, c.tower.muzzle, 1 + lv('tower'), false);
    });
  }
}

function hurt(dt: number, contacts: number): void {
  invuln = Math.max(0, invuln - dt);
  if (ko > 0) {
    ko -= dt;
    if (ko <= 0) {
      player.position.set(L.spawn.x, 0, L.spawn.z);
      player.hp = player.maxHp;
      invuln = 3;
      document.body.classList.remove('ko');
    }
    return;
  }
  if (contacts > 0 && invuln <= 0) {
    player.hp -= contacts * 16 * dt;
    player.hurtFlash = 1;
    shake = Math.max(shake, 0.06);
    if (player.hp <= 0) {
      ko = 1.6;
      const lost = player.stack.clear();
      pendingIn = 0;
      document.body.classList.add('ko');
      buzz(120);
      if (lost.length >= 3) offerKeepBag(lost);
      else toast('💫 K.O. !');
    }
  } else if (contacts === 0) {
    player.hp = Math.min(player.maxHp, player.hp + dt * (save.phase === 'night' ? 4 : 20));
  }
}

// ================================================================ victoire et hors ligne

let victoryT = 0;
function startVictory(): void {
  save.won = true;
  bus.driving = 0.001;
  victoryT = 0.001;
  persist();
}

function showModal(html: string, onClose?: () => void): void {
  ui.modal.innerHTML = `<div class="modal-card">${html}<button class="btn big" data-close>Continuer</button></div>`;
  ui.modal.classList.add('show');
  ui.modal.querySelector('[data-close]')!.addEventListener('click', () => {
    ui.modal.classList.remove('show');
    onClose?.();
  }, { once: true });
}

function showVictory(): void {
  const mins = Math.max(1, Math.round(save.playTime / 60));
  showModal(`
    <div class="modal-big">🚌</div>
    <h2>Camp 1 terminé !</h2>
    <p>Le bus quitte la Clairière avec tes survivants. Prochaine étape : la Ville.</p>
    <div class="stats">
      <div><b>${save.stats.nights}</b><span>nuits tenues</span></div>
      <div><b>${save.stats.kills}</b><span>zombies</span></div>
      <div><b>${save.stats.earned}</b><span>pièces gagnées</span></div>
      <div><b>${mins} min</b><span>de jeu</span></div>
    </div>
    <p class="muted">Tu peux continuer à faire tourner le camp.</p>`, () => {
    bus.driving = 0;
    bus.root.position.set(L.bus.x, 0, L.bus.z);
  });
  sfx.sfxVictory();
  for (let i = 0; i < 3; i++) setTimeout(() => particles.burst(player.position.clone().setY(3), [0xffd84a, 0xff8fb1, 0x8be36b, 0x6fd3ff], 60, { speed: 8, up: 9, size: 0.2, life: 1.6 }), i * 300);
}

function offlineGains(): void {
  const gap = (Date.now() - save.lastSeen) / 1000;
  const workers = helpers.length;
  save.lastSeen = Date.now();
  if (gap < 60 || workers === 0) return;
  const gain = Math.floor(Math.min(gap, 3 * 3600) * 0.35 * workers);
  if (gain <= 0) return;
  showModal(`
    <div class="modal-big">⛺</div>
    <h2>Bon retour !</h2>
    <p>Pendant ton absence, tes survivants ont fait tourner le camp :</p>
    <div class="modal-gain"><span class="coin big"></span>${gain}</div>
    <button class="btn ad" data-double>📺 Doubler : ${gain * 2} pièces</button>`, () => {
    flyCoins(gain, player.position.clone().add(new THREE.Vector3(0, 4, 2)), playerChest, earn, 14);
  });
  ui.modal.querySelector('[data-double]')?.addEventListener('click', () => {
    void showRewarded('gains hors ligne doublés', owns('noads')).then((ok) => {
      if (!ok) return;
      ui.modal.classList.remove('show');
      flyCoins(gain * 2, player.position.clone().add(new THREE.Vector3(0, 4, 2)), playerChest, earn, 16);
    });
  }, { once: true });
}

// ================================================================ sauvegarde

function persist(): void {
  save.lastSeen = Date.now();
  save.walls = palisade.hpList();
  writeSave(save);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) persist();
  else {
    clock.getDelta();
    offlineGains();
  }
});
window.addEventListener('pagehide', persist);

// ================================================================ commandes

const move = new THREE.Vector2();
const keys = new Set<string>();
let joyId: number | null = null;
const joyOrigin = new THREE.Vector2();
const joyVec = new THREE.Vector2();

window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (joyId !== null) return;
  ui.menu.classList.remove('on');
  joyId = e.pointerId;
  joyOrigin.set(e.clientX, e.clientY);
  joyVec.set(0, 0);
  ui.joy.style.left = `${e.clientX}px`;
  ui.joy.style.top = `${e.clientY}px`;
  ui.joy.classList.add('on');
  ui.knob.style.transform = 'translate(-50%, -50%)';
  hint.classList.add('gone');
});
window.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joyId) return;
  const R = 56;
  joyVec.set(e.clientX - joyOrigin.x, e.clientY - joyOrigin.y);
  if (joyVec.length() > R) joyVec.setLength(R);
  ui.knob.style.transform = `translate(calc(-50% + ${joyVec.x}px), calc(-50% + ${joyVec.y}px))`;
  joyVec.divideScalar(R);
});
const endJoy = (e: PointerEvent) => {
  if (e.pointerId !== joyId) return;
  joyId = null;
  joyVec.set(0, 0);
  ui.joy.classList.remove('on');
};
window.addEventListener('pointerup', endJoy);
window.addEventListener('pointercancel', endJoy);

function readMove(): void {
  move.copy(joyVec);
  if (keys.size) {
    const kx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('q') || keys.has('a') || keys.has('arrowleft') ? 1 : 0);
    const kz = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('z') || keys.has('w') || keys.has('arrowup') ? 1 : 0);
    if (kx || kz) {
      move.set(kx, kz).normalize();
      hint.classList.add('gone');
    }
  }
  if (move.length() < 0.12 || ko > 0) move.set(0, 0);
}

// ================================================================ eclairage

const tmpC = new THREE.Color();
let camDist = 30;

function applyLighting(t: number, dusk: number, time: number): void {
  const lerpC = (a: THREE.Color, b: THREE.Color) => tmpC.copy(a).lerp(b, t);
  const sky = scene.background as THREE.Color;
  sky.copy(lerpC(DAY.sky, NIGHT.sky)).lerp(DUSK_SKY, dusk * (1 - t) * 0.6);
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(sky);
  fog.near = camDist + DAY.fogNear + (NIGHT.fogNear - DAY.fogNear) * t;
  fog.far = camDist + DAY.fogFar + (NIGHT.fogFar - DAY.fogFar) * t;
  hemi.color.copy(lerpC(DAY.hemiSky, NIGHT.hemiSky));
  hemi.groundColor.copy(lerpC(DAY.hemiGround, NIGHT.hemiGround));
  hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * t;
  sun.color.copy(lerpC(DAY.sunColor, NIGHT.sunColor)).lerp(DUSK_SKY, dusk * (1 - t) * 0.5);
  sun.intensity = DAY.sun + (NIGHT.sun - DAY.sun) * t;
  renderer.toneMappingExposure = DAY.exposure + (NIGHT.exposure - DAY.exposure) * t;

  for (const nl of world.nightLights) {
    const flick = nl.flicker ? 1 + Math.sin(time * 13) * nl.flicker * 0.5 + Math.sin(time * 29) * nl.flicker * 0.3 : 1;
    nl.light.intensity = (nl.day + (nl.night - nl.day) * t) * flick;
  }
  for (const g of world.glows) (g.s.material as THREE.SpriteMaterial).opacity = g.day + (g.night - g.day) * t;
  for (const m of world.bulbMats) m.emissiveIntensity = 0.15 + t * 2.2;
  for (const [id, b] of Object.entries(B)) {
    if (id === 'kitchen') continue;
    for (const m of b.glowMats ?? []) m.emissiveIntensity = t * 2;
  }
  tower.light.intensity = structAlive('tower') ? t * 45 : 0;
  player.flashlight.intensity = t * 48;
  fireflies.forEach((f) => {
    const d = f.userData as { x: number; z: number; ph: number };
    f.position.set(d.x + Math.sin(time * 0.6 + d.ph) * 1.5, 0.8 + Math.sin(time * 1.7 + d.ph) * 0.4, d.z + Math.cos(time * 0.5 + d.ph) * 1.5);
    (f.material as THREE.SpriteMaterial).opacity = t * (0.5 + 0.5 * Math.sin(time * 3 + d.ph));
  });
}

// ================================================================ HUD

let shownCoins = save.coins;
function setText(el: HTMLElement, t: string): void {
  if (el.textContent !== t) el.textContent = t;
}

function renderHud(dt: number): void {
  shownCoins = Math.abs(save.coins - shownCoins) < 0.5 ? save.coins : damp(shownCoins, save.coins, 10, dt);
  setText(ui.money, String(Math.round(shownCoins)));
  setText(ui.bag, `${player.stack.count}/${player.stack.cap}`);
  setText(ui.gems, String(save.gems));
  renderMetaHud();
  ui.bagPill.classList.toggle('full', player.stack.count >= player.stack.cap);
  if (!save.cycle) {
    setText(ui.clockText, 'Jour 1');
    setText(ui.clockIcon, '☀️');
    ui.clockBar.style.width = '0%';
  } else if (save.phase === 'day') {
    setText(ui.clockIcon, '☀️');
    setText(ui.clockText, `Jour ${save.day}`);
    ui.clockBar.style.width = `${Math.min(100, (save.phaseT / dayLen(save.day)) * 100)}%`;
  } else {
    setText(ui.clockIcon, '🌙');
    setText(ui.clockText, `Nuit ${save.day} · 🧟 ${horde.remaining}`);
    ui.clockBar.style.width = `${Math.min(100, (save.phaseT / nightLen(save.day)) * 100)}%`;
  }
  const showHp = (save.cycle && save.phase === 'night') || player.hp < player.maxHp - 0.5;
  ui.hp.classList.toggle('hidden', !showHp);
  ui.hpFill.style.width = `${Math.max(0, (player.hp / player.maxHp) * 100)}%`;
  if (showHp) placeLabel(ui.hp, player.position.x, 2.7, player.position.z);
}

// ================================================================ boucle

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  camDist = Math.max(22, Math.min(42, 14 / (2 * Math.tan(fovRad / 2) * camera.aspect)));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const CAM_DIR = new THREE.Vector3(0, 1, 0.78).normalize();

function productsList(): ItemType[] {
  // Dans l'ordre d'arrivee : les derniers produits, plus chers, sont un peu plus demandes.
  const list: ItemType[] = ['carrot'];
  if (isBuilt('gate')) list.push('log');
  if (isBuilt('sawmill')) list.push('plank');
  if (save.stats.scrap > 0) list.push('scrap');
  if (isBuilt('bed3')) list.push('tomato');
  if (isBuilt('kitchen')) list.push('soup');
  if (isBuilt('field1')) list.push('wheat');
  if (isBuilt('mill')) list.push('bread');
  if (isBuilt('dock')) list.push('fish');
  if (isBuilt('eastRoad')) list.push('fuel');
  return list;
}

function step(dt: number, time: number): void {
  save.playTime += dt;
  applyMeta(dt);
  readMove();
  player.update(dt, move, world.walls, world.solids, world.bounds, time);
  interact(dt);
  updateCycle(dt);
  updateCombat(dt);
  const contacts = horde.update(dt, player.position, zombieWalls, world.solids, nightK, palisade, onWallHit, navZombies, STRUCTS, onStructHit);
  palisade.update(dt, save.cycle && save.phase === 'night', time);
  hurt(dt, contacts);
  drops.update(dt, player.position, (v) => earn(v));

  for (const b of beds) b.update(dt, time);
  restorer.update(dt);
  for (const t of trees) t.update(dt);
  for (const s of scraps) s.update(dt);
  for (const u of pumps) u.update(dt);
  if (saw.update(dt, time)) save.stats.planks++;
  if (cook.update(dt, time)) save.stats.soup++;
  if (mill.update(dt, time)) save.stats.bread++;
  reserve.update(dt, time);
  B.sawmill!.anim?.(dt, time, saw.busy);
  B.kitchen!.anim?.(dt, time, cook.busy);
  B.mill!.anim?.(dt, time, mill.busy);
  bus.update(dt, time);

  const open = !save.cycle || save.phase === 'day';
  const sales = market.update(dt, open, productsList(), (from, to, t) => {
    flyers.launch(itemMesh(t), from, () => to, () => undefined, 0.3, 0.8);
  });
  for (const s of sales) {
    save.stats.sold++;
    sfx.sfxSell();
    flyCoins(Math.round(s.pay * sellMul()), s.at, () => market.cashWorld(), (n) => market.addCash(n), 6);
  }

  nav.northOpen = isBuilt('gate');
  helperCtx.dockReady = isBuilt('dock');
  updateEvents(dt, time);
  // Abri demoli : les survivants n'ont plus de toit et restent pres du feu.
  helperCtx.night = (save.cycle && save.phase === 'night') || isBroken('shelter');
  for (const h of helpers) h.update(dt, helperCtx);

  flyers.update(dt);
  particles.update(dt);
  tracers.update(dt);
  advanceObjectives();

  for (const pad of pads) {
    const show = !isBuilt(pad.def.id) && save.obj >= pad.def.after;
    if (show && !pad.shown) {
      pad.shown = true;
      pad.appear = 0;
      pad.ring.visible = true;
      pad.fill.visible = true;
      renderPad(pad);
    }
    if (!pad.shown || isBuilt(pad.def.id)) continue;
    pad.appear = Math.min(1, pad.appear + dt * 2.5);
    pad.pulse = Math.max(0, pad.pulse - dt * 4);
    const s = Math.max(0.001, easeOutBack(pad.appear)) * (1 + pad.pulse * 0.12 + (near(pad.def.x, pad.def.z, 1.45) ? 0.05 : 0));
    pad.ring.scale.set(s, s, s);
  }
  if (victoryT > 0) {
    victoryT += dt;
    if (victoryT > 3.2) { victoryT = 0; showVictory(); }
  }
}

const clock = new THREE.Clock();
let lastPersist = performance.now();
const SIM = { scale: 1 };

let firstFrame = true;
function frame(): void {
  // La premiere image est notee comme une etape : si elle bloque, on le saura.
  if (firstFrame) boot('premiere image');
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;
  // Les tests automatiques peuvent accelerer la simulation.
  for (let i = 0; i < SIM.scale; i++) step(dt, time);

  nightK = damp(nightK, save.cycle && save.phase === 'night' ? 1 : 0, 1.6, dt * SIM.scale);
  const dusk = save.cycle && save.phase === 'day' ? Math.max(0, (save.phaseT - (dayLen(save.day) - 20)) / 20) : 0;
  applyLighting(nightK, dusk, time);

  for (const s of world.swayers) {
    s.o.rotation.z = Math.sin(time * 1.6 + s.phase) * s.amp;
    s.o.rotation.x = Math.cos(time * 1.3 + s.phase) * s.amp * 0.6;
  }
  for (const f of world.flames) {
    f.scale.set(1 + Math.sin(time * 17) * 0.08, 1 + Math.sin(time * 11) * 0.18, 1 + Math.cos(time * 15) * 0.08);
    f.rotation.y += dt * 2;
  }

  // Guidage vers l'objectif en cours.
  const tgt = currentObjective()?.target() ?? null;
  guide.visible = !!tgt;
  groundArrow.visible = false;
  if (tgt) {
    guide.position.set(tgt.x, 3.2 + Math.abs(Math.sin(time * 3)) * 0.5, tgt.z);
    guide.rotation.y += dt * 2;
    const dx = tgt.x - player.position.x;
    const dz = tgt.z - player.position.z;
    const d = Math.hypot(dx, dz);
    if (d > 5) {
      groundArrow.visible = true;
      groundArrow.position.set(player.position.x + (dx / d) * 1.8, 0.07, player.position.z + (dz / d) * 1.8);
      groundArrow.rotation.set(-Math.PI / 2, Math.atan2(-dx, -dz), 0);
    }
  }

  camTarget.x = damp(camTarget.x, player.position.x, 5, dt);
  camTarget.z = damp(camTarget.z, player.position.z, 5, dt);
  shake = Math.max(0, shake - dt);
  camera.position.copy(camTarget).addScaledVector(CAM_DIR, camDist);
  camera.position.x += (Math.random() - 0.5) * shake * 0.8;
  camera.position.y += (Math.random() - 0.5) * shake * 0.8;
  camera.lookAt(camTarget.x, 0.8, camTarget.z);
  sun.position.copy(camTarget).add(SUN_OFFSET);
  sun.target.position.copy(camTarget);

  for (const pad of pads) if (pad.shown && !isBuilt(pad.def.id)) placeLabel(pad.label, pad.def.x, 0.3, pad.def.z - 1.4);
  // Bacs de l'etal : ce qu'il y a dedans et combien, des qu'on est dans le coin.
  const nearStall = Math.hypot(L.stall.x - player.position.x, L.stall.z - player.position.z) < 13;
  market.bins.bins.forEach((bin, i) => {
    if (!nearStall) { bin.label.classList.add('off'); return; }
    // Deux rangees en quinconce : dix etiquettes sans se chevaucher.
    if (i % 2 === 0) placeLabel(bin.label, L.stall.x + bin.x, 0.35, L.stall.z + 0.6);
    else placeLabel(bin.label, L.stall.x + bin.x, 1.95, L.stall.z - 0.1);
  });
  // Reserve : son contenu, quand on passe a cote.
  if (Math.hypot(L.chest.x - player.position.x, L.chest.z - player.position.z) < 9) placeLabel(reserve.label, L.chest.x, 1.6, L.chest.z);
  else reserve.label.classList.add('off');
  placeWarnings(dt);
  placeEventLabels();
  placeCrew(dt);
  for (const dp of dynPads.values()) placeLabel(dp.label, dp.x, 0.3, dp.z - 1.4);
  // Palissade : une seule etiquette, celle du troncon abime le plus proche.
  let wallLabel: Section | null = repairTarget;
  if (!wallLabel) {
    let bd = 7;
    for (const s of palisade.sections) {
      if (!s.enabled || s.hp >= s.max) continue;
      const d = palisade.distanceTo(s, player.position.x, player.position.z);
      if (d < bd) { bd = d; wallLabel = s; }
    }
  }
  for (const s of palisade.sections) {
    if (s !== wallLabel) { s.label.classList.add('off'); continue; }
    const html = `🪵 ${logsNeeded(s)}`;
    if (s.label.innerHTML !== html) s.label.innerHTML = html;
    s.label.classList.toggle('broken', s.hp <= 0);
    s.label.classList.toggle('active', s === repairTarget);
    placeLabel(s.label, s.x, s.z > CAMP.maxZ - 0.5 ? 2.2 : 3.4, s.z);
  }
  for (const c of market.customers) {
    const left = c.need - c.got;
    const html = c.state === 'leave' ? (c.happy > 0 ? (c.sad ? '😞' : '😊') : '') : `${ITEMS[c.want].icon} ${left}`;
    if (c.label.innerHTML !== html) c.label.innerHTML = html;
    c.label.classList.toggle('empty', !html);
    if (html) placeLabel(c.label, c.human.root.position.x, 2.5, c.human.root.position.z);
  }

  renderHud(dt);
  renderer.render(scene, camera);
  if (firstFrame) {
    firstFrame = false;
    (window as unknown as { __bootDone?: () => void }).__bootDone?.();
  }

  // Sauvegarde reguliere, en temps reel (independante de la fluidite).
  if (performance.now() - lastPersist > 4000) { lastPersist = performance.now(); persist(); }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- demarrage

boot('restauration de la partie');
beds[0]!.unlock();
{
  const hp = save.walls && save.walls.length === palisade.sections.length ? save.walls : palisade.initialHp();
  palisade.sections.forEach((s, i) => palisade.setHp(s, hp[i]!));
}
for (const id of save.built) applyBuild(id, true);
// Ce que les zombies avaient demoli reste en ruine jusqu'a reparation.
for (const id of [...save.broken]) wreck(id, true);
applyCampLevel(true);
applyUpgrades();
equipWeapon((WEAPONS.find((x) => x.id === save.weapon)?.id ?? 'rifle') as WeaponId);
wearOutfit(save.outfit);
player.hp = player.maxHp;
player.position.set(L.spawn.x, 0, L.spawn.z);
const camTarget = player.position.clone();
sfx.setMuted(save.muted);
ui.sound.textContent = save.muted ? '🔇 Son coupé' : '🔊 Son activé';
renderObjective();
if (save.obj > 0) hint.classList.add('gone');
if (save.cycle && save.phase === 'night') {
  // Une nuit interrompue reprend depuis le debut.
  save.phaseT = 0;
  horde.startNight(save.day);
  document.body.classList.add('night');
}
boot('gains hors ligne');
offlineGains();
requestAnimationFrame(frame);

// Acces pour les tests automatiques.
(window as unknown as { __bastion: unknown }).__bastion = {
  player, save: () => save, SIM, market, beds, pads, horde, trees, scraps, helpers, saw, cook, palisade,
  renderer, reserve, pumps, fields, mill,
  give: (n: number) => { save.coins += n; },
  build: (id: string) => { const p = pads.find((x) => x.def.id === id); if (p) { save.paid[id] = { ...p.def.cost }; build(p); } },
  setObj: (n: number) => { save.obj = n; renderObjective(); },
  night: () => { save.cycle = true; save.phase = 'day'; save.phaseT = dayLen(save.day); },
};
