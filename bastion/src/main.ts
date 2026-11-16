import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import './style.css';
import * as THREE from 'three';
import * as sfx from './audio';
import { bakeStatic, consolidate } from './bake';
import { Bus, kitchen, sawmill, shelter, watchTower, workbench, type Building } from './buildings';
import { Flyers, Particles, Tracers } from './fx';
import { Helper, type Drop, type HelperCtx } from './helpers';
import { ITEMS, coinMesh, itemMesh, type ItemType } from './items';
import { damp, easeOutBack, glow } from './kit';
import { CAMP, L } from './layout';
import { LOG_HP, Palisade, logsNeeded, stateOf, type Section } from './palisade';
import type { Segment } from './physics';
import { Player } from './player';
import {
  CYCLE_FROM, DAY_LEN, PADS, UPGRADES, freshSave, loadSave, nightLen, wipeSave, writeSave,
  type Cost, type PadDef, type Save, type UpId,
} from './progress';
import { Bed, ChopTree, ScrapSource, plantForest } from './resources';
import { Restorer } from './restore';
import { bedRuin, benchRuin, gateJunk, kitchenRuin, sawmillRuin, shelterRuin, towerRuin } from './ruins';
import { CoinDrops, Converter, Market } from './stations';
import { buildWorld } from './world';
import { Horde, type Zombie } from './zombies';

// ================================================================ rendu

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

const world = buildWorld(scene);
bakeStatic(scene, world.keep);

const beds = L.beds.map((b, i) => new Bed(scene, b.x, b.z, i < 2 ? 'carrot' : 'tomato'));
for (const b of beds) world.walls.push(...b.walls);
const trees = plantForest(scene);
for (const t of trees) world.solids.push(t.solid);
const scraps = L.scrap.map((s) => new ScrapSource(scene, s.x, s.z, s.ry, s.kind, world.solids));

const tower = watchTower(scene);
const B: Record<string, Building> = {
  bench: workbench(), sawmill: sawmill(), kitchen: kitchen(), shelter: shelter(),
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
};
for (const list of Object.values(SOLIDS)) for (const s of list) world.solids.push({ ...s });
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
};
/** La porte nord est bouchee par un amas de ferraille tant qu'on ne l'a pas degagee. */
const gateBarrier: Segment = { x1: -CAMP.gate, z1: CAMP.minZ, x2: CAMP.gate, z2: CAMP.minZ };
world.walls.push(gateBarrier);

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
const helpers: Helper[] = [];

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
  const bed = { bed2: beds[1], bed3: beds[2], bed4: beds[3] }[id];
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
    case 'farmer': helpers.push(new Helper(scene, 'farmer')); break;
    case 'lumber': helpers.push(new Helper(scene, 'lumber')); break;
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
  bus1: 'Le moteur tousse', bus2: 'Carrosserie retapée', bus3: 'Plein fait',
};

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

const OBJECTIVES: Objective[] = [
  { icon: '🥕', text: 'Récolte des carottes au potager', target: () => new THREE.Vector3(beds[0]!.x, 0, beds[0]!.z), done: () => save.stats.harvested > 0 },
  { icon: '🧺', text: 'Pose-les sur l’étal', target: () => new THREE.Vector3(L.shelf.x, 0, L.shelf.z), done: () => save.stats.shelved > 0 },
  { icon: '💰', text: 'Ramasse l’argent des ventes', target: () => new THREE.Vector3(L.cash.x, 0, L.cash.z), done: () => save.stats.cashed > 0 },
  { icon: '🥕', text: 'Remets en état le deuxième potager', target: padPos('bed2'), done: () => isBuilt('bed2') },
  { icon: '🚪', text: 'Dégage la porte nord', target: padPos('gate'), done: () => isBuilt('gate') },
  { icon: '🪓', text: 'Coupe du bois dans la forêt', target: nearestOf(trees, (t) => t.standing), done: () => save.stats.logs > 0 },
  { icon: '🪵', text: 'Répare un trou de la palissade', target: nearestRepair, done: () => save.stats.repairs > 0 || !palisade.sections.some((s) => s.enabled && s.hp < s.max) },
  { icon: '🔧', text: 'Répare l’établi', target: padPos('bench'), done: () => isBuilt('bench') },
  { icon: '🪚', text: 'Remets la scierie en marche', target: padPos('sawmill'), done: () => isBuilt('sawmill') },
  { icon: '🪚', text: 'Apporte du bois à la scierie', target: () => new THREE.Vector3(L.sawIn.x, 0, L.sawIn.z), done: () => save.stats.planks > 0 },
  { icon: '🔩', text: 'Démonte une épave sur la route', target: nearestOf(scraps, (s) => s.amount > 0), done: () => save.stats.scrap > 0 },
  { icon: '🗼', text: 'Relève la tour de guet', target: padPos('tower'), done: () => isBuilt('tower') },
  { icon: '🍅', text: 'Remets en état un potager à tomates', target: padPos('bed3'), done: () => isBuilt('bed3') },
  { icon: '🍲', text: 'Remets la cuisine en état', target: padPos('kitchen'), done: () => isBuilt('kitchen') },
  { icon: '🏠', text: 'Retape l’abri des survivants', target: padPos('shelter'), done: () => isBuilt('shelter') },
  { icon: '👩‍🌾', text: 'Recrute une fermière', target: padPos('farmer'), done: () => isBuilt('farmer') },
  { icon: '🧔', text: 'Recrute un bûcheron', target: padPos('lumber'), done: () => isBuilt('lumber') },
  { icon: '🔧', text: 'Répare le moteur du bus', target: padPos('bus1'), done: () => isBuilt('bus1') },
  { icon: '🚌', text: 'Retape la carrosserie du bus', target: padPos('bus2'), done: () => isBuilt('bus2') },
  { icon: '⛽', text: 'Fais le plein et quitte le camp', target: padPos('bus3'), done: () => isBuilt('bus3') },
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
    persist();
  }
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
}

let sheetOpen = false;
function renderSheet(): void {
  ui.sheetBody.innerHTML = `<h2>🔧 Établi</h2>` + UPGRADES.map((u) => {
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

let shelfPending = 0;
const convPending = new Map<Converter, number>([[saw, 0], [cook, 0]]);

function putOnShelf(t: ItemType, from: THREE.Vector3): void {
  shelfPending++;
  const target = market.shelf.slotWorld(market.shelf.count + shelfPending - 1);
  flyers.launch(itemMesh(t), from, () => target, () => {
    shelfPending--;
    market.shelf.add(t);
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

const shelfRoom = () => market.shelf.cap - market.shelf.count - shelfPending;
const convRoom = (c: Converter) => c.input.cap - c.input.count - (convPending.get(c) ?? 0);

let actClock = 0;
let harvestClock = 0;
let dropClock = 0;
let pickClock = 0;
let payClock = 0;
let fullClock = 0;

const near = (x: number, z: number, r: number) => Math.hypot(player.position.x - x, player.position.z - z) < r;

function interact(dt: number): void {
  const p = player.position;
  actClock -= dt;
  harvestClock -= dt;
  dropClock -= dt;
  pickClock -= dt;
  payClock -= dt;
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
        giveToPlayer(kind, from, () => { save.stats.harvested++; });
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

  // Deposer a l'etal tout ce qui se vend.
  if (dropClock <= 0 && near(L.shelf.x, L.shelf.z, 1.45) && shelfRoom() > 0) {
    const item = player.stack.take((t) => ITEMS[t].price > 0);
    if (item) {
      dropClock = 0.08;
      putOnShelf(item.type, item.pos);
      save.stats.shelved++;
      sfx.sfxDrop(market.shelf.count);
    }
  }
  // Reparer la palissade : chaque rondin depose devant un troncon abime le consolide.
  if (dropClock <= 0 && player.stack.has('log')) {
    for (const s of palisade.sections) {
      if (!s.enabled || logsNeeded(s) - s.inflight <= 0 || !near(s.repair.x, s.repair.z, 1.0)) continue;
      const item = player.stack.take((t) => t === 'log');
      if (!item) break;
      dropClock = 0.14;
      s.inflight++;
      const to = new THREE.Vector3(s.x, 1.1, s.z);
      flyers.launch(itemMesh('log'), item.pos, () => to, () => repairLanded(s), 0.3, 1.3);
      break;
    }
  }
  // Nourrir les machines, ramasser ce qu'elles produisent.
  for (const c of [saw, cook]) {
    if (!c.built) continue;
    if (dropClock <= 0 && near(c.input.x, c.input.z, 1.35) && convRoom(c) > 0) {
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
    if (!pad.shown || isBuilt(pad.def.id) || payClock > 0 || !near(pad.def.x, pad.def.z, 1.45)) continue;
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

  // Etabli : le panneau d'ameliorations s'ouvre quand on se tient devant.
  setSheet(isBuilt('bench') && near(L.benchZone.x, L.benchZone.z, 1.5));
}

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

function dropFor(t: ItemType): Drop | null {
  const conv = t === 'log' ? saw : t === 'carrot' || t === 'tomato' ? cook : null;
  if (conv && conv.built && convRoom(conv) > 0) {
    return { at: () => ({ x: conv.input.x, z: conv.input.z }), accept: (x) => conv.accepts.includes(x) && convRoom(conv) > 0, put: (x, from) => putInConverter(conv, x, from) };
  }
  if (ITEMS[t].price > 0 && shelfRoom() > 0) {
    return { at: () => L.shelf, accept: (x) => ITEMS[x].price > 0 && shelfRoom() > 0, put: (x, from) => putOnShelf(x, from) };
  }
  return null;
}

const helperCtx: HelperCtx = {
  beds, trees, walls: world.walls, solids: world.solids, northOpen: false, night: false, dropFor,
  onHarvest: (from) => particles.burst(from, [0x7fdc5a, 0x5a3a20], 4, { speed: 2, up: 3, size: 0.08, life: 0.4 }),
  onChop: (tree, h) => {
    if (tree.chop(h.human.root.position.x, h.human.root.position.z, 3)) {
      h.stack.add('log');
      particles.burst(new THREE.Vector3(tree.x, 1.2, tree.z), [0xc68a4f, 0xe0b077], 6, { speed: 3, up: 3, size: 0.09, life: 0.5 });
    }
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
  sfx.sfxToggle(true);
  toast(`🌙 Nuit ${save.day} : ils arrivent !`);
  document.body.classList.add('night');
}

function startDay(): void {
  horde.endNight();
  save.stats.nights++;
  save.day++;
  save.phase = 'day';
  save.phaseT = 0;
  sfx.sfxToggle(false);
  toast(`☀️ Jour ${save.day} : le camp a tenu !`);
  document.body.classList.remove('night');
  persist();
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
  if (save.phase === 'day' && save.phaseT >= DAY_LEN) startNight();
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
    drops.spawn(hit.pos, 2 + Math.floor(Math.random() * 3), 2 + save.day);
  } else {
    particles.burst(hit.pos, hit.colors, 5, { speed: 3, up: 2, size: 0.12, life: 0.5 });
  }
}

function updateCombat(dt: number): void {
  fireClock -= dt;
  towerClock -= dt;
  muzzle.intensity = Math.max(0, muzzle.intensity - dt * 400);
  const night = save.phase === 'night' && save.cycle;
  const range = 10 + save.up.gun;
  const z = night && ko <= 0 ? horde.nearest(player.position, range) : null;
  aimTarget = z ? z.root.position : null;
  player.aiming = aimTarget;
  if (z && fireClock <= 0) {
    fireClock = 0.32 - 0.03 * save.up.gun;
    const fwd = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
    shoot(z, player.position.clone().addScaledVector(fwd, 0.9).setY(1.2), 1 + save.up.gun);
  }
  if (night && isBuilt('tower') && towerClock <= 0) {
    const tz = horde.nearest(new THREE.Vector3(L.tower.x, 0, L.tower.z), 16);
    if (tz) {
      towerClock = 0.7;
      shoot(tz, tower.muzzle, 1 + Math.floor(save.day / 3), false);
    }
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
      toast(lost.length ? '💫 K.O. ! Ton chargement est perdu' : '💫 K.O. !');
      buzz(120);
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
    <div class="modal-gain"><span class="coin big"></span>${gain}</div>`, () => {
    flyCoins(gain, player.position.clone().add(new THREE.Vector3(0, 4, 2)), playerChest, earn, 14);
  });
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
  tower.light.intensity = isBuilt('tower') ? t * 45 : 0;
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
  ui.bagPill.classList.toggle('full', player.stack.count >= player.stack.cap);
  if (!save.cycle) {
    setText(ui.clockText, 'Jour 1');
    setText(ui.clockIcon, '☀️');
    ui.clockBar.style.width = '0%';
  } else if (save.phase === 'day') {
    setText(ui.clockIcon, '☀️');
    setText(ui.clockText, `Jour ${save.day}`);
    ui.clockBar.style.width = `${Math.min(100, (save.phaseT / DAY_LEN) * 100)}%`;
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
  const list: ItemType[] = ['carrot'];
  if (isBuilt('gate')) list.push('log');
  if (isBuilt('sawmill')) list.push('plank');
  if (save.stats.scrap > 0) list.push('scrap');
  if (isBuilt('bed3')) list.push('tomato');
  if (isBuilt('kitchen')) list.push('soup');
  return list;
}

function step(dt: number, time: number): void {
  save.playTime += dt;
  readMove();
  player.update(dt, move, world.walls, world.solids, world.bounds, time);
  interact(dt);
  updateCycle(dt);
  updateCombat(dt);
  const contacts = horde.update(dt, player.position, zombieWalls, world.solids, nightK, palisade, onWallHit);
  palisade.update(dt, save.cycle && save.phase === 'night', time);
  hurt(dt, contacts);
  drops.update(dt, player.position, (v) => earn(v));

  for (const b of beds) b.update(dt, time);
  restorer.update(dt);
  for (const t of trees) t.update(dt);
  for (const s of scraps) s.update(dt);
  if (saw.update(dt, time)) save.stats.planks++;
  cook.update(dt, time);
  B.sawmill!.anim?.(dt, time, saw.busy);
  B.kitchen!.anim?.(dt, time, cook.busy);
  bus.update(dt, time);

  const open = !save.cycle || save.phase === 'day';
  const sales = market.update(dt, open, productsList(), (from, to, t) => {
    flyers.launch(itemMesh(t), from, () => to, () => undefined, 0.3, 0.8);
  });
  for (const s of sales) {
    save.stats.sold++;
    sfx.sfxSell();
    flyCoins(s.pay, s.at, () => market.cashWorld(), (n) => market.addCash(n), 6);
  }

  helperCtx.northOpen = isBuilt('gate');
  helperCtx.night = save.cycle && save.phase === 'night';
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

function frame(): void {
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;
  // Les tests automatiques peuvent accelerer la simulation.
  for (let i = 0; i < SIM.scale; i++) step(dt, time);

  nightK = damp(nightK, save.cycle && save.phase === 'night' ? 1 : 0, 1.6, dt * SIM.scale);
  const dusk = save.cycle && save.phase === 'day' ? Math.max(0, (save.phaseT - (DAY_LEN - 20)) / 20) : 0;
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
  // Troncons abimes : combien de rondins pour les remettre d'aplomb (seulement a proximite).
  for (const s of palisade.sections) {
    const need = s.enabled ? logsNeeded(s) : 0;
    const show = need > 0 && Math.hypot(s.repair.x - player.position.x, s.repair.z - player.position.z) < 7.5;
    if (!show) {
      s.label.classList.add('off');
      continue;
    }
    const html = `🪵 ${need}`;
    if (s.label.innerHTML !== html) s.label.innerHTML = html;
    s.label.classList.toggle('broken', s.hp <= 0);
    placeLabel(s.label, s.repair.x, 0.2, s.repair.z - 0.9);
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

  // Sauvegarde reguliere, en temps reel (independante de la fluidite).
  if (performance.now() - lastPersist > 4000) { lastPersist = performance.now(); persist(); }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- demarrage

beds[0]!.unlock();
{
  const hp = save.walls && save.walls.length === palisade.sections.length ? save.walls : palisade.initialHp();
  palisade.sections.forEach((s, i) => palisade.setHp(s, hp[i]!));
}
for (const id of save.built) applyBuild(id, true);
applyUpgrades();
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
offlineGains();
requestAnimationFrame(frame);

// Acces pour les tests automatiques.
(window as unknown as { __bastion: unknown }).__bastion = {
  player, save: () => save, SIM, market, beds, pads, horde, trees, scraps, helpers, saw, cook, palisade,
  renderer,
  give: (n: number) => { save.coins += n; },
  build: (id: string) => { const p = pads.find((x) => x.def.id === id); if (p) { save.paid[id] = { ...p.def.cost }; build(p); } },
  setObj: (n: number) => { save.obj = n; renderObjective(); },
  night: () => { save.cycle = true; save.phase = 'day'; save.phaseT = DAY_LEN; },
};
