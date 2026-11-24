import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import './style.css';
import * as THREE from 'three';
import * as sfx from './audio';
import { bakeStatic, consolidate } from './bake';
import {
  Bus, armory, cabin, dock, foundry, infirmary, kitchen, quarryShed, sawmill, shelter, warehouse, watchTower, windmill, workbench,
  type Building,
} from './buildings';
import { Flyers, Particles, Tracers } from './fx';
import { Helper, type HelperCtx, type Job } from './helpers';
import { HUNTERS, HUNTER_COST, HUNTER_LV, HUNT_RANGE, Hunter, MERC, type HuntZone, type HunterCtx } from './hunters';
import { ITEMS, coinMesh, itemMesh, type ItemType } from './items';
import { LOOK, box, damp, easeOutBack, glow, guardShaders, rbox } from './kit';
import { CAMP, FARM, L, ROAD_Z, insideFarm, insideStation } from './layout';
import { regions, type NavState } from './nav';
import { Palisade, TIERS, logsNeeded, stateOf, unitHp, type Section } from './palisade';
import type { Segment } from './physics';
import { Player } from './player';
import {
  CYCLE_FROM, PADS, UPGRADES, dayLen, freshSave, loadSave, nightLen, wipeSave, writeSave,
  type Cost, type PadDef, type Save, type UpId,
} from './progress';
import { Bed, ChopTree, FIELD_D, FIELD_W, Pump, ScrapSource, StoneSource, plantForest } from './resources';
import { Restorer } from './restore';
import {
  AD_CAPS, AD_DAY_MAX, BOOSTS, BOOST_MAX, BOOST_MAX_AD, BOOST_TIME, CHEST_EVERY, CONTRACTS, GEMS_PER_AD, LEVELS, LOGIN, MAX_LEVEL, QUESTS,
  levelPrice, rollQuests, todayKey,
  type AdSpot, type BoostId, type ContractId, type LevelId,
} from './meta';
import { PRODUCTS, SIMULATED, purchase, showRewarded, type Product } from './monetize';
import { simulateOffline } from './offline';
import { CREW, OUTFITS, RADIO, WEAPONS, type WeaponId } from './meta';
import { Airdrop, CACHE_SPOTS, Cache, Caravan, DROP_SPOTS, RESCUE_SPOTS, Rescue, type Spot } from './events';
import {
  bedRuin, benchRuin, buildSite, dockRuin, fieldRuin, foundryRuin, gateJunk, junkPile, kitchenRuin, millRuin, quarryRuin, sawmillRuin, shelterRuin, towerRuin,
} from './ruins';
import { BIN_CAP, CoinDrops, Converter, Market, Reserve } from './stations';
import { campDirt, planarUV } from './textures';
import { buildWorld } from './world';
import { Horde, type Structure, type Zombie } from './zombies';

// ================================================================ rendu

/** Reperes de chargement (index.html) : si le jeu bloque, on saura a quelle etape. */
const boot = (step: string) => (window as unknown as { __bootStep?: (s: string) => void }).__bootStep?.(step);
boot('rendu 3D');
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
/** Resolution : pleine sur un bon telephone, reduite d'un cran si les images ralentissent. */
const PR_MAX = Math.min(window.devicePixelRatio, 1.75);
const PR_STEPS = [PR_MAX, Math.min(PR_MAX, 1.4), Math.min(PR_MAX, 1.15)];
renderer.setPixelRatio(PR_MAX);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Courbe de tons maison (la Neutral de Khronos sans son ecrasement des noirs) : les teintes
// des modeles restent franches et fideles, l'epaule n'adoucit que les hautes lumieres, les
// ombres et la nuit restent lisibles. Calculee dans chaque shader : aucun post-traitement.
const TONE_CHUNK = THREE.ShaderChunk.tonemapping_pars_fragment;
THREE.ShaderChunk.tonemapping_pars_fragment = TONE_CHUNK.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `vec3 CustomToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < 0.76 ) return color;
	float np = 1.0 - 0.0576 / ( peak - 0.52 );
	color *= np / peak;
	float g = 1.0 - 1.0 / ( 0.15 * ( peak - np ) + 1.0 );
	return mix( color, vec3( np ), g );
}`,
);
renderer.toneMapping = THREE.CustomToneMapping;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
// Shader en echec sur l'appareil : on coupe l'ombrage d'ambiance, puis au besoin la courbe
// de tons maison (retour a la Neutral de three) pour que le jeu s'affiche quand meme.
guardShaders(renderer, scene, () => {
  THREE.ShaderChunk.tonemapping_pars_fragment = TONE_CHUNK;
  renderer.toneMapping = THREE.NeutralToneMapping;
  console.error('Bastion : courbe de tons maison coupee.');
});
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 220);

// Jour : soleil chaud et ciel de remplissage frais (ombres douces, jamais bouchees), sol qui
// renvoie une lumiere chaude par en dessous. Nuit : bleu profond mais lisible, contours
// eclaires par la lune (lisere de kit.ts). rim = couleur * force du lisere.
const DAY = {
  sky: new THREE.Color(0xc4d7d0), hemiSky: new THREE.Color(0xe4e8e8), hemiGround: new THREE.Color(0x8f7d58),
  hemi: 2.1, sunColor: new THREE.Color(0xffe6c4), sun: 2.5, fogNear: 12, fogFar: 62, exposure: 1.0,
  rim: new THREE.Color(0xffe6c4).multiplyScalar(0.42),
};
const NIGHT = {
  sky: new THREE.Color(0x101d36), hemiSky: new THREE.Color(0x4064a2), hemiGround: new THREE.Color(0x1a2040),
  hemi: 0.8, sunColor: new THREE.Color(0xa6ccff), sun: 0.6, fogNear: -2, fogFar: 20, exposure: 1.05,
  rim: new THREE.Color(0x8fb4ff).multiplyScalar(0.5),
};
const DUSK_SKY = new THREE.Color(0xf2a67c);
const DUSK_RIM = DUSK_SKY.clone().multiplyScalar(0.45);

scene.background = DAY.sky.clone();
scene.fog = new THREE.Fog(DAY.sky.clone(), 40, 100);
const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
const SUN_OFFSET = new THREE.Vector3(-14, 22, 10);
sun.castShadow = true;
// Boite d'ombre ajustee a ce que voit la camera (calcul pour portrait et paysage, objets
// jusqu'a 4 de haut, plus une marge) : deux fois moins de surface que la boite carree,
// donc une carte plus petite pour la meme nettete.
sun.shadow.mapSize.set(1536, 1536);
Object.assign(sun.shadow.camera, { left: -23, right: 15, top: 18.5, bottom: -11.5, near: 1, far: 70 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.035;
// Ombres portees un peu transparentes : lisibles mais douces, dans l'esprit « jouet ».
sun.shadow.intensity = 0.86;
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
const rocks = L.rocks.map((p) => new StoneSource(scene, p.x, p.z, world.solids));
const trees = plantForest(scene);
for (const t of trees) world.solids.push(t.solid);
const scraps = L.scrap.map((s) => new ScrapSource(scene, s.x, s.z, s.ry, s.kind, world.solids));

boot('batiments');
const tower = watchTower(scene);
const B: Record<string, Building> = {
  bench: workbench(), sawmill: sawmill(), kitchen: kitchen(), shelter: shelter(), mill: windmill(), dock: dock(),
  quarry: quarryShed(), foundry: foundry(),
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
  foundry: [{ x: L.foundry.x - 0.6, z: L.foundry.z, r: 1.3 }, { x: L.foundry.x + 1.2, z: L.foundry.z + 0.2, r: 0.6 }],
  quarry: [{ x: L.quarryShed.x - 2.2, z: L.quarryShed.z + 0.4, r: 1.3 }],
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
  quarry: quarryRuin(scene, L.quarryShed.x, L.quarryShed.z),
  foundry: foundryRuin(scene, L.foundry.x, L.foundry.z),
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
const forge = new Converter(scene, L.foundryIn, L.foundryOut, ['scrap'], 2, 'metal', 3.2);
const reserve = new Reserve(scene, labels);
const helpers: Helper[] = [];
const nav: NavState = { northOpen: false, westOpen: false, eastOpen: false };
const R = regions(nav);
const navAll = [R.camp, R.farm, R.station];
const navZombies = [R.farm, R.station];

boot('palissade');
let palisade = new Palisade(scene, labels);
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
  toast: $('.toast'), modal: $('.modal'), sheetBody: $('.sheet-body'), sheet: $('.sheet'), sheetHandle: $('.sheet-handle'), sheetTitle: $('.sheet-title'),
  joy: $('.joy'), knob: $('.joy-knob'), hp: $('.hpbar'), hpFill: $('.hpbar i'),
  adPill: $<HTMLButtonElement>('.ad-pill'),
  menuBtn: $('.menu-btn'), menu: $('.menu'), sound: $<HTMLButtonElement>('.menu .m-sound'), reset: $<HTMLButtonElement>('.menu .m-reset'),
};

/** Instant du dernier toast (temps de jeu) : les astuces attendent que l'ecran soit libre. */
let toastAt = -99;
/** Astuces en attente : jamais par-dessus un autre toast, marquees vues seulement une fois montrees. */
const hintQ: { key: string; msg: string }[] = [];

function toast(msg: string): void {
  toastAt = save.playTime;
  ui.toast.textContent = msg;
  ui.toast.classList.remove('show');
  void ui.toast.offsetWidth;
  ui.toast.classList.add('show');
}

function hintLater(key: string, msg: string): void {
  if (save.seen.includes(key) || hintQ.some((h) => h.key === key)) return;
  hintQ.push({ key, msg });
}

/** Une astuce a la fois, une fois le toast precedent fini et hors de la nuit. */
function drainHints(): void {
  if (!hintQ.length || save.playTime - toastAt <= 2.8 || (save.cycle && save.phase === 'night')) return;
  const h = hintQ.shift()!;
  if (save.seen.includes(h.key)) return;
  save.seen.push(h.key);
  toast(h.msg);
  persist();
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

/** Les grands nombres restent lisibles : 18 500, puis 125k. */
function fmt(n: number): string {
  n = Math.round(n);
  if (n >= 100000) return `${Math.round(n / 1000)}k`;
  if (n >= 10000) return `${Math.floor(n / 1000)} ${String(n % 1000).padStart(3, '0')}`;
  return String(n);
}

/** Un cout en texte simple (pour les messages). */
function costText(c: Cost): string {
  const parts: string[] = [];
  if (c.coins > 0) parts.push(`${fmt(c.coins)} pièces`);
  for (const t of Object.keys(ITEMS) as ItemType[]) {
    const n = c[t];
    if (n && n > 0) parts.push(`${ITEMS[t].icon}${n}`);
  }
  return parts.join(' ');
}

function costIcons(c: Cost): string {
  const parts: string[] = [];
  if (c.coins > 0) parts.push(`<span class="coin"></span>${fmt(c.coins)}`);
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
/** Geometries des zones, partagees (les zones de reparation vont et viennent). */
const PAD_RING = new THREE.RingGeometry(1.15, 1.4, 48);
const PAD_FILL = new THREE.CircleGeometry(1.1, 48);
const fillMat = new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.8, depthWrite: false });

boot('zones et sauvegarde');
const pads: Pad[] = PADS.map((def) => {
  const ring = new THREE.Mesh(PAD_RING, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(def.x, 0.05, def.z);
  ring.visible = false;
  scene.add(ring);
  const fill = new THREE.Mesh(PAD_FILL, fillMat);
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

/** Un repere invisible : la poussiere d'un chantier sans batiment part de la. */
function marker(x: number, z: number): THREE.Object3D {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  return g;
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
      restore(id, marker(L.farmGate.x, L.farmGate.z), instant);
      break;
    case 'eastRoad':
      world.locks.east.off = true;
      nav.eastOpen = true;
      market.eastOpen = true;
      restore(id, marker(L.stationGate.x, L.stationGate.z), instant);
      break;
    case 'mill': restoreBuilding(id, B.mill!, instant, () => { mill.built = true; mill.setVisible(true); }); break;
    case 'quarry': restoreBuilding(id, B.quarry!, instant); break;
    case 'foundry': restoreBuilding(id, B.foundry!, instant, () => { forge.built = true; forge.setVisible(true); }); break;
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
  bench: { coins: 100, log: 6 }, sawmill: { coins: 150, log: 10 }, kitchen: { coins: 250, plank: 6 },
  tower: { coins: 300, plank: 8 }, shelter: { coins: 400, plank: 10 }, mill: { coins: 600, plank: 12 },
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
  const P: Record<string, { x: number; z: number }> = { bench: L.bench, sawmill: L.sawmill, kitchen: L.kitchen, tower: L.tower, shelter: L.shelter, mill: L.mill, foundry: L.foundry };
  const R: Record<string, number> = { bench: 1.6, sawmill: 2.2, kitchen: 2.0, tower: 1.9, shelter: 2.6, mill: 2.4, foundry: 2.2 };
  const p = P[id] ?? L.bench;
  return { x: p.x, z: p.z, reach: R[id] ?? 2 };
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
  restorer.cancel(built);
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

// ---- chiffres qui s'envolent : chaque gain se voit la ou il arrive

interface Floater { el: HTMLElement; x: number; y: number; z: number; t: number }
const floaters: Floater[] = [];
const FLOAT_T = 1.2;
function floatText(text: string, x: number, y: number, z: number, cls = ''): void {
  let f = floaters.find((q) => q.t <= 0);
  if (!f) {
    if (floaters.length >= 14) f = floaters.reduce((a, b) => (a.t < b.t ? a : b));
    else {
      f = { el: document.createElement('div'), x: 0, y: 0, z: 0, t: 0 };
      labels.appendChild(f.el);
      floaters.push(f);
    }
  }
  f.el.className = `float-num ${cls}`;
  f.el.textContent = text;
  f.x = x;
  f.y = y;
  f.z = z;
  f.t = FLOAT_T;
}
function placeFloaters(dt: number): void {
  for (const f of floaters) {
    if (f.t <= 0) continue;
    f.t -= dt;
    if (f.t <= 0) { f.el.classList.add('off'); continue; }
    const k = 1 - f.t / FLOAT_T;
    placeLabel(f.el, f.x, f.y + (1 - (1 - k) * (1 - k)) * 1.8, f.z);
    f.el.style.opacity = String(Math.min(1, f.t * 3));
  }
}
const floatAtPlayer = (text: string, cls = '') => floatText(text, player.position.x, 2.6, player.position.z, cls);

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
  placeEdgeArrows();
}

/** Fleches au bord de l'ecran : elles montrent ce qui se fait attaquer hors de vue. */
const edgeArrows: HTMLElement[] = [];
const MAX_ARROWS = 4;
function edgeArrow(i: number): HTMLElement {
  let el = edgeArrows[i];
  if (!el) {
    el = document.createElement('div');
    el.className = 'edge-arrow off';
    el.innerHTML = '<i></i><span>⚠️</span>';
    document.body.appendChild(el);
    edgeArrows[i] = el;
  }
  return el;
}
/** Lignes de la barre des boosts (mise a jour par renderMetaHud) : les fleches passent dessous. */
let boostRows = 0;
function placeEdgeArrows(): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  // Les attaques les plus recentes d'abord, une fleche par endroit (6 unites d'ecart au moins).
  const active = [...warnings.values()].filter((w) => w.t > 0).sort((a, b) => b.t - a.t);
  const picked: Warning[] = [];
  for (const w of active) {
    if (picked.length >= MAX_ARROWS) break;
    if (picked.some((p) => Math.hypot(p.x - w.x, p.z - w.z) < 6)) continue;
    picked.push(w);
  }
  if (!picked.length) {
    for (const el of edgeArrows) el.classList.add('off');
    return;
  }
  // Marges : le haut et le bas de l'ecran sont pris par l'interface. Elles bornent le centre
  // de la fleche, donc on compte sa taille (disque de 46 px et sa pointe).
  const R = 26;
  const M = 12 + R;
  const TOP = 120 + R + 8; // objectif et porte-monnaie finissent vers 120 px
  // Panneau ouvert (etabli, reserve) : ce qu'il cache compte comme hors de l'ecran. Lu
  // seulement quand il y a une alerte, pour ne pas forcer une mise en page a chaque image.
  const sheetTop = sheetOpen ? ui.sheet.getBoundingClientRect().top : H;
  const botY = Math.max(TOP + 60, Math.min(H - 100, sheetTop - 30));
  // A gauche, la barre des boosts ; a droite, la boutique et la pastille de pub.
  const leftTop = boostRows > 0 ? 118 + boostRows * 27 + R : TOP;
  const shopOn = !ui.shopBtn.classList.contains('off');
  const adOn = !ui.adPill.classList.contains('off');
  const rightLimit = adOn ? H - 185 - R : shopOn ? H - 140 - R : Infinity;
  const cx = W / 2;
  const cy = Math.min(H / 2, (TOP + botY) / 2);
  let n = 0;
  for (const w of picked) {
    projected.set(w.x, 1, w.z).project(camera);
    const behind = projected.z > 1;
    const px = behind ? -projected.x : projected.x;
    const py = behind ? -projected.y : projected.y;
    const sx = (px * 0.5 + 0.5) * W;
    const sy = (-py * 0.5 + 0.5) * H;
    if (!behind && sx > M && sx < W - M && sy > TOP && sy < botY) continue;
    const dx = sx - cx;
    const dy = sy - cy || -1;
    const kx = dx > 0 ? (W - M - cx) / dx : dx < 0 ? (M - cx) / dx : Infinity;
    const ky = dy > 0 ? (botY - cy) / dy : (TOP - cy) / dy;
    const k = Math.min(kx, ky);
    let ax = cx + dx * k;
    let ay = cy + dy * k;
    if (ax < W / 2 && ay < leftTop) ay = leftTop;
    if (ax > W - 100 && ay > rightLimit) { ax = W - M; ay = rightLimit; }
    const el = edgeArrow(n++);
    el.classList.remove('off');
    el.style.transform = `translate(${ax.toFixed(1)}px, ${ay.toFixed(1)}px) translate(-50%, -50%)`;
    (el.firstChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
  }
  for (let i = n; i < edgeArrows.length; i++) edgeArrows[i]!.classList.add('off');
}

// ---- tours d'angle (niveau du camp)

// ---- agrandissement du camp : chaque niveau pousse la palissade et ajoute des batiments

/** Largeur du camp a chaque niveau : il s'etend a l'est (niv. 2), puis a l'ouest (niv. 3). */
const CAMP_SIZES = [{ minX: -13, maxX: 13 }, { minX: -13, maxX: 13 }, { minX: -13, maxX: 19 }, { minX: -19, maxX: 19 }, { minX: -19, maxX: 19 }];

/**
 * Tours d'angle : au niveau 2 du camp, la tour de guet part au coin sud-est ; les trois autres
 * coins s'equipent ensuite (camp niveau 3), chantiers chers.
 */
const corners = [
  { id: 'towerNE', x: 19.4, z: -11.4, from: 3 },
  { id: 'towerNW', x: -19.4, z: -11.4, from: 3 }, { id: 'towerSW', x: -19.4, z: 11.4, from: 3 },
].map((c) => ({ ...c, tower: watchTower(scene, c.x, c.z, false) }));
const CORNER_COST: Record<string, Cost> = {
  towerNE: { coins: 7000, plank: 30, scrap: 20 },
  towerNW: { coins: 9000, plank: 40, scrap: 30 },
  towerSW: { coins: 12000, stone: 60, scrap: 20 },
};
/** Ou la tour de guet s'installe quand le camp s'agrandit vers l'est. */
const TOWER_CORNER = { x: 19.4, z: 11.4 };
const TOWER_CORNER_PAD = { x: 18.3, z: 7.0 };
const cornerClock: number[] = [];

/** Les batiments des extensions, et le niveau qui les apporte. */
/**
 * Les chantiers de l'agrandissement : chaque niveau du camp ouvre des emplacements (dalle,
 * piquets, planches) ; on paie a cote pour batir. Rien n'apparait tout fait.
 */
interface ExtSite {
  id: string; name: string; icon: string; lv: number; r: number; x: number; z: number;
  pad: { x: number; z: number }; cost: Cost; group: THREE.Object3D; live: THREE.Object3D[]; site: THREE.Object3D;
}
const extDef = (id: string, name: string, icon: string, lv: number, r: number, b: Building, pad: { x: number; z: number }, cost: Cost) => ({
  id, name, icon, lv, r, pad, cost, b,
});
const EXT_DEFS = [
  extDef('armory', 'l’armurerie', '🛡️', 2, 1.9, armory(16.2, 4.5), { x: 13.0, z: 4.5 }, { coins: 3000, plank: 20, scrap: 15 }),
  extDef('house1', 'une maison', '🏡', 2, 1.7, cabin(16, -2.6, -Math.PI / 2, 0x5f8a85), { x: 13.0, z: -2.6 }, { coins: 1800, plank: 20 }),
  extDef('house2', 'une maison', '🏡', 2, 1.7, cabin(16, -8.2, -Math.PI / 2, 0x9c4a3c), { x: 13.0, z: -8.2 }, { coins: 1800, plank: 20 }),
  extDef('infirmary', 'l’infirmerie', '🩹', 3, 2.4, infirmary(-16, 4), { x: -12.6, z: 4.0 }, { coins: 5000, plank: 25, bread: 10 }),
  extDef('house3', 'une maison', '🏡', 3, 1.7, cabin(-16, -2.6, Math.PI / 2, 0x6f7a4a), { x: -13.0, z: -2.6 }, { coins: 3000, plank: 25, scrap: 10 }),
  extDef('house4', 'une maison', '🏡', 3, 1.7, cabin(-16, -8.2, Math.PI / 2, 0xb9874a), { x: -13.0, z: -8.2 }, { coins: 3000, plank: 25, scrap: 10 }),
  extDef('warehouse', 'l’entrepôt', '🏬', 4, 2.4, warehouse(16, 9.0), { x: 12.9, z: 9.6 }, { coins: 8000, stone: 40, metal: 10 }),
];
for (const e of EXT_DEFS) scene.add(e.b.group);
const TOWER_PADS: Record<string, { x: number; z: number }> = {
  towerNE: { x: 17.6, z: -10.2 }, towerNW: { x: -17.6, z: -10.2 }, towerSW: { x: -17.6, z: 10.0 },
};
const EXT: ExtSite[] = [
  ...EXT_DEFS.map((e, i) => ({
    id: e.id, name: e.name, icon: e.icon, lv: e.lv, r: e.r, x: e.b.group.position.x, z: e.b.group.position.z,
    pad: e.pad, cost: e.cost, group: e.b.group, live: e.b.live ?? [], site: buildSite(scene, e.b.group.position.x, e.b.group.position.z, e.r, 900 + i),
  })),
  ...corners.map((c, i) => ({
    id: c.id, name: 'une tour d’angle', icon: '🗼', lv: c.from, r: 1.2, x: c.x, z: c.z, pad: TOWER_PADS[c.id]!,
    cost: CORNER_COST[c.id]!,
    group: c.tower.group, live: c.tower.live ?? [], site: buildSite(scene, c.x, c.z, 1.3, 950 + i),
  })),
];
for (const e of EXT) e.site.visible = false;
/** Emplacements deja ouverts (collision posee une seule fois). */
const extShown = new Set<string>();
/** Les parties d'avant les chantiers avaient deja ces batiments : on les leur garde. */
if (!save.seen.includes('ext-v1')) {
  save.seen.push('ext-v1');
  for (const e of EXT) if (save.campLv >= e.lv && !save.built.includes(e.id)) save.built.push(e.id);
}

/** Les artisans qui ont besoin d'une maison (fermiere et bucheron logent a l'abri). */
const HOUSED = ['fisher', 'scav', 'porter', 'cashier'];
const houses = () => ['house1', 'house2', 'house3', 'house4'].filter((id) => isBuilt(id)).length;
const freeHouse = () => houses() - HOUSED.filter((id) => isBuilt(id)).length > 0;

/** Les niveaux du camp : ce que chacun coute et apporte. */
const CAMP_LEVELS: { cost: Cost; title: string; done: string }[] = [
  { cost: { coins: 0 }, title: '', done: '' },
  { cost: { coins: 0 }, title: '', done: '' },
  { cost: { coins: 5000, plank: 30, log: 30 }, title: 'Camp niv. 2 : extension est', done: 'Le camp s’agrandit ! Chantiers : armurerie, 2 maisons, 2 tours' },
  { cost: { coins: 9000, plank: 50, scrap: 30, bread: 20 }, title: 'Camp niv. 3 : extension ouest', done: 'Le camp s’agrandit ! Chantiers : infirmerie, 2 maisons, 2 tours' },
  { cost: { coins: 10000, stone: 80, metal: 25 }, title: 'Camp niv. 4 : bastion', done: 'Bastion : palissade renforcée ! Chantier : entrepôt' },
];
const CAMP_PAD = { x: -3.6, z: 6.2 };
const dirtStrips = new Set<number>();

/** Reconstruit la palissade aux dimensions actuelles du camp (troncons neufs, intacts). */
function rebuildPalisade(): void {
  const northOn = palisade.north.enabled;
  // Ce qui volait vers un troncon retourne a la reserve plutot que de se perdre.
  for (const s of palisade.sections) for (let i = 0; i < s.inflight; i++) reserve.add(palisade.repairItem);
  for (const sg of palisade.walls) {
    const i = world.walls.indexOf(sg);
    if (i >= 0) world.walls.splice(i, 1);
  }
  palisade.dispose();
  palisade = new Palisade(scene, labels);
  world.walls.push(...palisade.walls);
  syncZombieWalls();
  palisade.setTier(save.wallTier);
  palisade.setLevel(save.up.wall + (save.campLv >= 4 ? 1 : 0));
  if (northOn) palisade.enableNorth();
  repairTarget = null;
}

/** Applique le niveau du camp : taille, palissade, batiments et tours (`instant` au chargement). */
function applyCampLevel(instant: boolean): void {
  const size = CAMP_SIZES[Math.min(save.campLv, CAMP_SIZES.length - 1)]!;
  if (size.minX !== CAMP.minX || size.maxX !== CAMP.maxX) {
    CAMP.minX = size.minX;
    CAMP.maxX = size.maxX;
    rebuildPalisade();
    // Terre battue sur les nouvelles bandes du camp.
    for (const [x0, x1] of [[13, size.maxX], [size.minX, -13]] as const) {
      if (x1 - x0 <= 0 || dirtStrips.has(x0)) continue;
      dirtStrips.add(x0);
      const sg = new THREE.PlaneGeometry(x1 - x0 + 0.6, 22.6);
      planarUV(sg, 1 / 6);
      const strip = new THREE.Mesh(sg, campDirt(0xc9a57a));
      strip.rotation.x = -Math.PI / 2;
      strip.position.set((x0 + x1) / 2, 0.014, 0);
      strip.receiveShadow = true;
      scene.add(strip);
    }
  }
  relocateTower(instant);
  // Chaque niveau ouvre ses emplacements : chantier a payer, ou batiment deja bati.
  for (const e of EXT) {
    // Deja bati (anciennes parties) : on le garde, meme si son niveau a change depuis.
    if ((save.campLv < e.lv && !isBuilt(e.id)) || extShown.has(e.id)) continue;
    extShown.add(e.id);
    world.solids.push({ x: e.x, z: e.z, r: e.r });
    if (isBuilt(e.id)) {
      restorer.instant(e.site, e.group);
      consolidate(e.group, e.live);
    } else {
      e.site.visible = true;
      if (!instant) particles.burst(new THREE.Vector3(e.x, 0.6, e.z), [0xb9a58a, 0x9a8a72], 14, { speed: 3, up: 3, size: 0.2, life: 0.8 });
    }
  }
  applyUpgrades();
}

/**
 * Camp niveau 2 : la tour de guet quitte le milieu du camp pour le coin sud-est, d'ou elle
 * couvre l'etal, la route et la nouvelle extension. Tout ce qui depend de sa place suit.
 */
let towerMoved = false;
function relocateTower(instant: boolean): void {
  if (towerMoved || save.campLv < 2) return;
  towerMoved = true;
  const dx = TOWER_CORNER.x - L.tower.x;
  const dz = TOWER_CORNER.z - L.tower.z;
  const solid = world.solids.find((c) => c.x === L.tower.x && c.z === L.tower.z);
  if (solid) { solid.x += dx; solid.z += dz; }
  const st = STRUCTS.find((x) => x.id === 'tower');
  if (st) { st.x += dx; st.z += dz; }
  for (const o of [tower.group, tower.light, tower.light.target, RUINS.tower]) {
    if (!o) continue;
    o.position.x += dx;
    o.position.z += dz;
    o.updateMatrixWorld(true);
  }
  tower.muzzle.x += dx;
  tower.muzzle.z += dz;
  L.tower.x = TOWER_CORNER.x;
  L.tower.z = TOWER_CORNER.z;
  // Zone de la tour (chantier ou reparation) : a cote, dans le camp.
  const pd = PADS.find((p) => p.id === 'tower');
  if (pd) {
    pd.x = TOWER_CORNER_PAD.x;
    pd.z = TOWER_CORNER_PAD.z;
    const pad = pads.find((p) => p.def === pd);
    if (pad) {
      pad.ring.position.set(pd.x, 0.05, pd.z);
      pad.fill.position.set(pd.x, 0.045, pd.z);
    }
  }
  // Une reparation en cours suit la tour (ce qui a deja ete paye reste acquis).
  const fix = dynPads.get('fix:tower');
  if (fix && pd) {
    fix.x = pd.x;
    fix.z = pd.z;
    fix.ring.position.set(pd.x, 0.05, pd.z);
    fix.fill.position.set(pd.x, 0.045, pd.z);
  }
  if (!instant && isBuilt('tower')) {
    restorer.run(null, tower.group);
    toast('🗼 La tour de guet s’installe au coin du camp');
  }
}

/** On paie un chantier de l'agrandissement : le batiment se monte sous nos yeux. */
function buildExt(e: ExtSite): void {
  if (isBuilt(e.id)) return;
  save.built.push(e.id);
  restorer.run(e.site, e.group, () => consolidate(e.group, e.live));
  sfx.sfxBuild();
  buzz(40);
  shake = Math.max(shake, 0.2);
  toast(`${e.icon} Chantier terminé : ${e.name.replace(/^une |^l’/, '')} !`);
  applyUpgrades();
  renderObjective();
  persist();
}

// ---- zones dynamiques : reparations et niveau du camp

interface DynPad {
  key: string; x: number; z: number; cost: Cost; icon: string; title: string;
  ring: THREE.Mesh; fill: THREE.Mesh; label: HTMLElement; inflight: number; done: () => void;
  /** Apparue sous les pieds du joueur : rien n'y part tant qu'il n'en est pas sorti. */
  armed: boolean;
}
const dynPads = new Map<string, DynPad>();
const repairMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, depthWrite: false });

function makeDyn(key: string, x: number, z: number, cost: Cost, icon: string, title: string, done: () => void): DynPad {
  const ring = new THREE.Mesh(PAD_RING, key.startsWith('fix') ? repairMat : ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.05, z);
  scene.add(ring);
  const fill = new THREE.Mesh(PAD_FILL, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(x, 0.045, z);
  scene.add(fill);
  const label = document.createElement('div');
  label.className = 'pad-label';
  labels.appendChild(label);
  save.fixPaid[key] ??= { coins: 0 };
  const dp: DynPad = { key, x, z, cost, icon, title, ring, fill, label, inflight: 0, done, armed: !near(x, z, 1.6) };
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

/** Convoi n°k vers la Ville : de plus en plus cher, il emporte aussi des vivres et du carburant. */
function convoyCost(k: number): Cost {
  return { coins: Math.round((15000 * Math.pow(1.3, k)) / 100) * 100, fuel: 20, bread: 30, fish: 30, metal: 10 };
}
const CONVOY_TIME = 10 * 60 * 1000;

function startConvoy(): void {
  save.convoyAt = nowT() + CONVOY_TIME;
  bus.root.visible = true;
  bus.root.position.set(L.bus.x, 0, L.bus.z);
  bus.driving = 0.001;
  sfx.sfxVictory();
  toast(`🚌 Convoi n°${save.convoys + 1} en route vers la Ville : retour dans 10 min`);
  persist();
}

function convoyBack(): void {
  save.convoyAt = 0;
  save.convoys++;
  save.renown = Math.min(20, save.renown + 1);
  bus.driving = 0;
  bus.root.position.set(L.bus.x, 0, L.bus.z);
  bus.root.visible = true;
  restorer.run(null, bus.root);
  gainGems(25);
  const outfit = save.convoys === 3 ? 'convoy' : save.convoys === 10 ? 'legend' : null;
  if (outfit && !save.outfits.includes(outfit)) save.outfits.push(outfit);
  const o = outfit ? OUTFITS.find((x) => x.id === outfit) : null;
  showModal(`<div class="modal-big">🚌</div><h2>Le convoi est rentré !</h2>
    <p>La Ville a reçu tes vivres. Ton camp gagne en renommée.</p>
    <div class="stats"><div><b>+25 💎</b><span>gemmes</span></div><div><b>${save.renown}/20</b><span>renommée (+${3 * save.renown} % ventes)</span></div></div>
    ${o ? `<p>${o.icon} Nouvelle tenue : <b>${o.name}</b> (boutique)</p>` : ''}`);
  sfx.sfxVictory();
  persist();
}

function updateConvoy(): void {
  if (bus.driving > 6) {
    // Le bus a quitte l'ecran : il reviendra au retour du convoi.
    bus.driving = 0;
    bus.root.visible = false;
    bus.root.position.set(L.bus.x, 0, L.bus.z);
  }
  if (save.convoyAt > 0 && nowT() >= save.convoyAt && !ui.modal.classList.contains('show')) convoyBack();
}

/** Fait correspondre les zones affichees a l'etat : une par batiment demoli, une pour le camp, un convoi. */
function syncDynPads(): void {
  for (const e of EXT) {
    const key = `ext:${e.id}`;
    if (save.campLv < e.lv || isBuilt(e.id) || dynPads.has(key)) continue;
    const name = e.name.replace(/^une |^l’/, '');
    dynPads.set(key, makeDyn(key, e.pad.x, e.pad.z, e.cost, e.icon, `Bâtir : ${name}`, () => buildExt(e)));
  }
  // Apres la victoire : un convoi a la fois, depuis l'arret du bus.
  const ckey = `convoy:${save.convoys}`;
  if (save.won && save.convoyAt === 0 && victoryT === 0 && bus.driving === 0 && !dynPads.has(ckey)) {
    dynPads.set(ckey, makeDyn(ckey, L.busPad.x, L.busPad.z, convoyCost(save.convoys), '🚌', `Convoi n°${save.convoys + 1} vers la Ville`, startConvoy));
  }
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
  syncFarmPads();
}


// ---- la ferme fortifiee : palissade (pieux, puis pierre), porte, deux tours de garde

/** Les deux niveaux de la palissade de la ferme : materiau (TIERS), cout, condition. */
const FARM_WALL: { tier: number; cost: Cost; icon: string; title: string; done: string; ready: () => boolean }[] = [
  {
    tier: 2, cost: { coins: 3500, log: 50, plank: 20 }, icon: '🪓', title: 'Fortifier la ferme : palissade',
    done: '🪓 La ferme est fortifiée : palissade de pieux, porte fermée la nuit', ready: () => isBuilt('mill'),
  },
  {
    tier: 3, cost: { coins: 7000, stone: 100 }, icon: '🧱', title: 'Ferme : palissade en pierre',
    done: '🧱 La palissade de la ferme passe à la pierre', ready: () => isBuilt('quarry'),
  },
];
/** Chantier de la palissade : devant l'entree de la ferme, a gauche de la porte, hors du passage. */
const FARM_WALL_PAD = { x: -38.6, z: 15.8 };
const FARM_TOWER_COST: Cost = { coins: 3000, plank: 15, scrap: 10 };
const FARM_TOWER_RANGE = 18;
/** Les tours de la ferme ne visent que le cote ferme (entre son mur est et le mur ouest du camp). */
const FARM_TOWER_MAXX = FARM.maxX + 2;
/**
 * Tours de garde de la ferme (apres la palissade) : au milieu des murs est (champs) et ouest
 * (moulin, maison). Deux coins laisseraient deux angles hors de portee ; a mi-mur, a 18 m,
 * elles couvrent toute la palissade. Ids gardes pour les sauvegardes. Chantiers comme les
 * tours d'angle du camp.
 */
const farmTowers = [
  { id: 'farmTowerSE', x: -22.6, z: 2.0, pad: { x: -24.8, z: 4.5 } },
  { id: 'farmTowerNW', x: -48.4, z: 2.0, pad: { x: -45.8, z: 3.4 } },
].map((t, i) => {
  const tw = watchTower(scene, t.x, t.z, false);
  const site: ExtSite = {
    id: t.id, name: 'une tour de garde', icon: '🗼', lv: 0, r: 1.2, x: t.x, z: t.z, pad: t.pad, cost: FARM_TOWER_COST,
    group: tw.group, live: tw.live ?? [], site: buildSite(scene, t.x, t.z, 1.3, 970 + i),
  };
  site.site.visible = false;
  return { site, tower: tw, at: new THREE.Vector3(t.x, 0, t.z), clock: 0, shown: false };
});
/** Groupe de la palissade de la ferme : la restauration la remonte d'un seul geste. */
const farmRoot = new THREE.Group();
scene.add(farmRoot);
let farmWall: Palisade | null = null;

// Jamais d'apparition dans la ferme fortifiee (ni juste devant ses murs).
const campNoSpawn = horde.noSpawn;
horde.noSpawn = (x, z) => campNoSpawn(x, z)
  || (farmWall !== null && x > FARM.minX - 3 && x < FARM.maxX + 3 && z > FARM.minZ - 3 && z < FARM.maxZ + 3);

const wallsBuf: Palisade[] = [];
/** Les palissades en place : celle du camp, et celle de la ferme une fois batie. */
function allWalls(): Palisade[] {
  wallsBuf.length = 0;
  wallsBuf.push(palisade);
  if (farmWall) wallsBuf.push(farmWall);
  return wallsBuf;
}

/** La palissade a laquelle appartient un troncon. */
function wallOf(s: Section): Palisade {
  return s.site === 'farm' && farmWall ? farmWall : palisade;
}

/** Hauteur d'une etiquette au-dessus d'un troncon : son enclos est bas au sud, haut ailleurs. */
function wallTop(s: Section, low: number, high: number): number {
  return s.z > (s.site === 'farm' ? FARM.maxZ : CAMP.maxZ) - 0.5 ? low : high;
}

/** Les zombies butent sur les murs et sur les portes fermees (camp et ferme) ; le joueur, jamais. */
function syncZombieWalls(): void {
  zombieWalls.length = 0;
  zombieWalls.push(...world.walls, ...palisade.gateWalls);
  if (farmWall) zombieWalls.push(...farmWall.gateWalls);
}

/** Debout sur une zone de paiement dynamique (chantier, reparation) : le bois y va, pas au mur. */
function onDynPad(): boolean {
  for (const dp of dynPads.values()) if (near(dp.x, dp.z, 1.45)) return true;
  return false;
}

/** Bati la palissade de la ferme a son niveau (ou change son materiau) ; `instant` au chargement. */
function applyFarmWall(instant: boolean): void {
  const n = Math.min(save.farmLv, FARM_WALL.length);
  if (n <= 0) return;
  const tier = FARM_WALL[n - 1]!.tier;
  const fence = world.farmFence;
  if (!farmWall) {
    farmWall = new Palisade(farmRoot, labels, 'farm', tier);
    world.walls.push(...farmWall.walls);
    syncZombieWalls();
    // La cloture de bois disparait : la palissade la remplace.
    for (const sg of fence.segs) sg.off = true;
    // Les zombies ne contournent plus la ferme par sa porte : ils defoncent la palissade.
    const i = navZombies.indexOf(R.farm);
    if (i >= 0) navZombies.splice(i, 1);
    if (instant) restorer.instant(fence.mesh, farmRoot);
    else restorer.run(fence.mesh, farmRoot);
  } else if (farmWall.tier !== tier) {
    farmWall.setTier(tier);
    if (!instant) restorer.run(null, farmRoot);
  }
  showFarmTowers(instant);
}

/** Les emplacements des tours de garde s'ouvrent avec la palissade de la ferme. */
function showFarmTowers(instant: boolean): void {
  if (save.farmLv < 1) return;
  for (const t of farmTowers) {
    if (t.shown) continue;
    t.shown = true;
    const e = t.site;
    world.solids.push({ x: e.x, z: e.z, r: e.r });
    if (isBuilt(e.id)) {
      restorer.instant(e.site, e.group);
      consolidate(e.group, e.live);
    } else {
      e.site.visible = true;
      if (!instant) particles.burst(new THREE.Vector3(e.x, 0.6, e.z), [0xb9a58a, 0x9a8a72], 14, { speed: 3, up: 3, size: 0.2, life: 0.8 });
    }
  }
}

/** Chantiers de la ferme fortifiee : la palissade (un niveau a la fois), puis les deux tours. */
function syncFarmPads(): void {
  const fl = save.farmLv;
  const fw = FARM_WALL[fl];
  const key = `farm:wall:${fl + 1}`;
  if (fw && fw.ready() && !dynPads.has(key)) {
    dynPads.set(key, makeDyn(key, FARM_WALL_PAD.x, FARM_WALL_PAD.z, fw.cost, fw.icon, fw.title, () => {
      save.farmLv = fl + 1;
      applyFarmWall(false);
      toast(fw.done);
      sfx.sfxBuild();
      buzz(40);
      shake = Math.max(shake, 0.2);
      renderObjective();
    }));
    if (fl === 0) hintLater('hint:farmwall', '🪓 Nouveau chantier devant la ferme : une palissade pour protéger les champs');
  }
  if (fl < 1) return;
  for (const t of farmTowers) {
    const e = t.site;
    const k = `ext:${e.id}`;
    if (isBuilt(e.id) || dynPads.has(k)) continue;
    dynPads.set(k, makeDyn(k, e.pad.x, e.pad.z, e.cost, e.icon, 'Bâtir : tour de garde', () => buildExt(e)));
  }
}


// ---- chasseurs de prime : recrutes a l'armurerie, ils defendent la nuit le camp ou la ferme

/** Zone devant l'armurerie (la ou etait son chantier) : elle ouvre le panneau des chasseurs. */
const HUNT_PAD = { x: 13.0, z: 4.5 };
/** Ou ils attendent le jour : pres de l'armurerie ; le chasseur de passage, pres du feu. */
const HUNT_REST = [{ x: 12.2, z: 2.3 }, { x: 12.2, z: 6.7 }, { x: 11.0, z: 4.5 }];
const MERC_REST = { x: L.campfire.x - 2.8, z: L.campfire.z + 1.4 };
/** Le chasseur de passage arrive et repart par la route. */
const MERC_ROAD = { x: 1.5, z: ROAD_Z + 4 };

const huntRingMat = new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.85, depthWrite: false });
const huntRing = new THREE.Mesh(PAD_RING, huntRingMat);
huntRing.rotation.x = -Math.PI / 2;
huntRing.position.set(HUNT_PAD.x, 0.05, HUNT_PAD.z);
huntRing.visible = false;
scene.add(huntRing);
const huntLabel = document.createElement('div');
huntLabel.className = 'pad-label off';
labels.appendChild(huntLabel);

const hunters: Hunter[] = [];
let merc: Hunter | null = null;
/** Dernier troncon frappe de chaque palissade, et quand (temps de jeu) : les chasseurs y courent. */
const hotWall: Record<HuntZone, { s: Section | null; t: number }> = { camp: { s: null, t: -99 }, farm: { s: null, t: -99 } };

/** Places ouvertes : une avec l'armurerie, deux au camp niveau 3, trois au niveau 4. */
const huntSlots = () => (isBuilt('armory') ? HUNTER_LV.filter((l) => save.campLv >= l).length : 0);
/** Un peu plus fort qu'une tour d'angle, moins que le joueur ; il suit la menace et le niveau des tours. */
const huntDmg = () => 2 + Math.floor(threat() / 4) + lv('tower');
/** La ferme n'est defendue qu'une fois fortifiee (sinon il reste au camp). */
const zoneOf = (i: number): HuntZone => (save.hunters[i] === 'farm' && farmWall ? 'farm' : 'camp');
const mercOn = () => save.cycle && save.merc === save.day;
const inCampZone = (x: number, z: number) => x > CAMP.minX + 1.2 && x < CAMP.maxX - 1.2 && z > CAMP.minZ + 1.2 && z < CAMP.maxZ - 1.2;
const inFarmZone = (x: number, z: number) => x > FARM.minX + 1.2 && x < FARM.maxX - 1.2 && z > FARM.minZ + 1.2 && z < FARM.maxZ - 1.2;
const nowhere = () => false;

const postBuf = { x: 0, z: 0 };
/**
 * Poste du k-ieme chasseur d'une zone : derriere le troncon attaque (8 dernieres secondes) ou
 * le plus abime, sinon la porte nord (camp) ou les champs (ferme). Les suivants s'ecartent.
 */
function huntPost(zone: HuntZone, k: number): { x: number; z: number } {
  const off = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2.4;
  const wall = zone === 'farm' ? farmWall : palisade;
  const hw = hotWall[zone];
  let s = hw.s && hw.s.enabled && save.playTime - hw.t < 8 && wall && wall.sections.includes(hw.s) ? hw.s : null;
  if (!s && wall) {
    let worst = 0.7;
    for (const q of wall.sections) if (q.enabled && q.hp / q.max < worst) { worst = q.hp / q.max; s = q; }
  }
  if (s) {
    postBuf.x = s.x + s.nx * 2.4 - s.nz * off;
    postBuf.z = s.z + s.nz * 2.4 + s.nx * off;
  } else if (zone === 'farm') {
    postBuf.x = -32.8;
    postBuf.z = 1.5 + off;
  } else {
    postBuf.x = off;
    postBuf.z = CAMP.minZ + 2.6;
  }
  return postBuf;
}

const huntCtx: HunterCtx = {
  walls: world.walls, solids: world.solids, nav: navAll, duty: false, night: false,
  rest: HUNT_REST[0]!, post: postBuf, inside: inCampZone,
  target: (from, range) => horde.nearest(from, range),
  fire: (_h, z, from) => shoot(z, from, huntDmg(), false),
};

function updateHunters(dt: number): void {
  const night = save.cycle && save.phase === 'night';
  // Au crepuscule (30 dernieres secondes du jour), ils partent deja vers leur poste.
  const duty = night || (save.cycle && save.phase === 'day' && save.phaseT > dayLen(save.day) - 30);
  if (isBuilt('armory')) hintLater('hint:hunters', '🤠 Devant l’armurerie : recrute des chasseurs de prime pour défendre la nuit');
  // Recrute (ou relu dans la sauvegarde) : il sort de l'armurerie.
  while (hunters.length < Math.min(save.hunters.length, HUNTERS.length)) {
    const r = HUNT_REST[hunters.length]!;
    hunters.push(new Hunter(scene, HUNTERS[hunters.length]!, r.x, r.z));
  }
  let camp = 0;
  let farm = 0;
  huntCtx.night = night;
  huntCtx.duty = duty;
  hunters.forEach((h, i) => {
    const zone = zoneOf(i);
    huntCtx.rest = HUNT_REST[i]!;
    huntCtx.post = huntPost(zone, zone === 'farm' ? farm++ : camp++);
    huntCtx.inside = !duty ? inCampZone : zone === 'farm' ? inFarmZone : inCampZone;
    h.update(dt, huntCtx);
  });
  // Le chasseur de passage : il arrive par la route, defend le camp une nuit, puis repart.
  const on = mercOn();
  if (on && !merc) merc = new Hunter(scene, MERC, MERC_ROAD.x, MERC_ROAD.z);
  if (!merc) return;
  const root = merc.human.root;
  if (on && !root.visible) {
    root.visible = true;
    root.position.set(MERC_ROAD.x, 0, MERC_ROAD.z);
  }
  if (!root.visible) return;
  if (on) {
    huntCtx.rest = MERC_REST;
    huntCtx.post = huntPost('camp', camp++);
    huntCtx.inside = inCampZone;
  } else {
    huntCtx.duty = false;
    huntCtx.night = false;
    huntCtx.rest = MERC_ROAD;
    huntCtx.inside = nowhere;
  }
  merc.update(dt, huntCtx);
  if (!on && Math.hypot(root.position.x - MERC_ROAD.x, root.position.z - MERC_ROAD.z) < 1) root.visible = false;
}

/** Recrute la place i (la suivante, si elle est ouverte) : paiement unique. */
function hireHunter(i: number): boolean {
  if (i !== save.hunters.length || i >= huntSlots() || i >= HUNTERS.length) return false;
  if (!payCoins(HUNTER_COST[i]!)) return false;
  save.hunters.push('camp');
  const d = HUNTERS[i]!;
  const r = HUNT_REST[i]!;
  toast(`${d.icon} ${d.name} rejoint le camp : il le défendra chaque nuit`);
  sfx.sfxVictory();
  buzz(30);
  particles.burst(new THREE.Vector3(r.x, 1.5, r.z), [0xffd84a, 0xffffff, 0xe0b077], 30, { speed: 4, up: 5, size: 0.14 });
  persist();
  return true;
}

/** Choisit la zone que le chasseur i defend la nuit (la ferme seulement si elle est fortifiee). */
function setHuntZone(i: number, z: HuntZone): boolean {
  if (i >= save.hunters.length) return false;
  if (z === 'farm' && !farmWall) {
    sfx.sfxNope();
    toast('🌾 Bâtis d’abord la palissade de la ferme');
    return false;
  }
  if (save.hunters[i] === z) return true;
  save.hunters[i] = z;
  const d = HUNTERS[i]!;
  toast(`${d.icon} ${d.name} défendra ${z === 'farm' ? 'la ferme' : 'le camp'} la nuit`);
  sfx.sfxDrop(4);
  buzz(15);
  persist();
  return true;
}

/** Renfort d'une nuit par une pub (au choix du joueur, une par jour). */
function callMerc(): void {
  if (mercOn() || !save.cycle) return;
  void rewarded('hunter', 'un chasseur en renfort cette nuit').then((ok) => {
    if (!ok || mercOn()) return;
    save.merc = save.day;
    toast(`${MERC.icon} ${MERC.name} arrive par la route : il défendra le camp cette nuit`);
    sfx.sfxObjective();
    persist();
    if (panel === 'hunters') renderHunters();
  });
}

/** Le contenu ne change qu'apres un toucher (ou un niveau du camp) : on ne reconstruit qu'alors. */
let huntKey = '';
function renderHunters(): void {
  const slots = huntSlots();
  const on = mercOn();
  const adOk = adLeft('hunter') > 0;
  const dmg = huntDmg();
  const key = `${slots}|${save.hunters.join(',')}|${farmWall ? 1 : 0}|${on ? 1 : 0}|${adOk ? 1 : 0}|${save.cycle ? 1 : 0}|${dmg}`;
  if (key !== huntKey) {
    huntKey = key;
    let h = `<h2>🤠 Chasseurs de prime <span class="lv">${save.hunters.length}/${HUNTERS.length}</span></h2>
      <p class="note">Payé une seule fois, chacun défend toutes les nuits la zone que tu lui donnes, et court là où la palissade est attaquée.</p>`;
    HUNTERS.forEach((d, i) => {
      if (i < save.hunters.length) {
        const z = save.hunters[i];
        const farmOk = !!farmWall;
        const zb = (id: HuntZone, label: string, ok: boolean) =>
          `<button class="btn zone ${z === id || (id === 'camp' && !farmOk) ? 'on' : ''}" data-hzone="${i}" data-z="${id}" ${ok ? '' : 'disabled'}>${label}</button>`;
        h += card(d.icon, d.name, `Défend ${zoneOf(i) === 'farm' ? 'la ferme' : 'le camp'} · dégâts ${dmg} · portée ${HUNT_RANGE} m`,
          zb('camp', '🏰 Camp', true) + zb('farm', '🌾 Ferme', farmOk));
      } else if (i === save.hunters.length && i < slots) {
        h += card(d.icon, d.name, `Recrute-le une fois : il défendra le camp ou la ferme, toutes les nuits · dégâts ${dmg}`,
          `<button class="btn" data-hire="${i}"><span class="coin"></span>${fmt(HUNTER_COST[i]!)}</button>`);
      } else {
        const lvl = HUNTER_LV[i]!;
        h += card('🔒', d.name, i < slots ? 'Recrute d’abord le précédent' : `Place ouverte au camp niveau ${lvl}`,
          `<button class="btn" disabled>${i < slots ? `<span class="coin"></span>${fmt(HUNTER_COST[i]!)}` : `Camp niv. ${lvl}`}</button>`);
      }
    });
    if (!farmWall && save.hunters.length) h += `<p class="note">🌾 La ferme pourra être défendue une fois sa palissade bâtie.</p>`;
    h += `<h2>📺 Renfort</h2>`;
    h += card(MERC.icon, 'Un chasseur en renfort cette nuit',
      on ? `${MERC.name} défend le camp cette nuit` : `${MERC.name} vient défendre le camp une nuit, puis reprend la route`,
      on ? `<button class="btn" disabled>En poste</button>` : !save.cycle ? `<button class="btn ad" disabled>📺 Plus tard</button>` : adButton('hunter', 'data-merc', 'Renfort'));
    const scroll = ui.sheetBody.scrollTop;
    ui.sheetBody.innerHTML = h;
    ui.sheetBody.scrollTop = scroll;
  }
  ui.sheetBody.querySelectorAll<HTMLElement>('[data-hire]').forEach((b) => {
    b.classList.toggle('poor', save.coins < (HUNTER_COST[Number(b.dataset.hire)] ?? 0));
  });
}

ui.sheetBody.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-hire],[data-hzone],[data-merc]');
  if (!el || el.disabled || ko > 0) return;
  const d = el.dataset;
  let ok = true;
  if (d.hire !== undefined) ok = hireHunter(Number(d.hire));
  else if (d.hzone !== undefined) ok = setHuntZone(Number(d.hzone), d.z === 'farm' ? 'farm' : 'camp');
  else callMerc();
  if (!ok) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }
  renderHunters();
});

/** Etiquettes des chasseurs (nom, et une replique quand on passe), et la zone de l'armurerie. */
const huntTalks = new Map<Hunter, { el: HTMLElement; say: number; next: number }>();
function placeHunter(h: Hunter, dt: number): void {
  let t = huntTalks.get(h);
  if (!t) {
    const el = document.createElement('div');
    el.className = 'name-label';
    labels.appendChild(el);
    t = { el, say: 0, next: 4 + Math.random() * 8 };
    huntTalks.set(h, t);
  }
  const q = h.human.root.position;
  const d = Math.hypot(q.x - player.position.x, q.z - player.position.z);
  t.next -= dt;
  if (d < 4 && t.next <= 0 && t.say <= 0) {
    t.say = 3.5;
    t.next = 18 + Math.random() * 20;
    t.el.innerHTML = `<b>${h.def.name}</b><span>${h.def.lines[Math.floor(Math.random() * h.def.lines.length)]}</span>`;
    t.el.classList.add('talk');
  }
  if (t.say > 0) {
    t.say -= dt;
    if (t.say <= 0) t.el.classList.remove('talk');
  } else if (t.el.innerHTML !== `<b>${h.def.name}</b>`) t.el.innerHTML = `<b>${h.def.name}</b>`;
  if (d > 11 || !h.human.root.visible) { t.el.classList.add('off'); return; }
  placeLabel(t.el, q.x, 2.5, q.z);
}
function placeHunters(dt: number): void {
  for (const h of hunters) placeHunter(h, dt);
  if (merc) placeHunter(merc, dt);
  const open = isBuilt('armory');
  huntRing.visible = open;
  if (!open || !near(HUNT_PAD.x, HUNT_PAD.z, 12)) { huntLabel.classList.add('off'); return; }
  const html = `<span class="pl-icon">🤠</span><span class="pl-name">Chasseurs de prime</span><span class="pl-cost">${save.hunters.length}/${huntSlots()}</span>`;
  if (huntLabel.innerHTML !== html) huntLabel.innerHTML = html;
  placeLabel(huntLabel, HUNT_PAD.x, 0.3, HUNT_PAD.z - 1.4);
}

// ---------------------------------------------------------------- objectifs

/** `house` : ce recrutement demande une maison libre (sinon on guide vers l'agrandissement). */
interface Objective { icon: string; text: string; target: () => THREE.Vector3 | null; done: () => boolean; house?: string; crew?: boolean }

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
  { icon: '📦', text: 'Récupère sa récolte dans la réserve', target: () => new THREE.Vector3(reserve.zone.x, 0, reserve.zone.z), done: stat('chest'), crew: true },
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
  { icon: '🏰', text: 'Agrandis le camp vers l’est (niv. 2, près du feu)', target: () => new THREE.Vector3(CAMP_PAD.x, 0, CAMP_PAD.z), done: () => save.campLv >= 2 },
  { icon: '🧑‍🦰', text: 'Recrute un pêcheur', target: padPos('fisher'), done: () => isBuilt('fisher'), house: 'un pêcheur' },
  // ---- la station (28 a 30)
  { icon: '⛽', text: 'Dégage la route de l’est', target: padPos('eastRoad'), done: () => isBuilt('eastRoad') },
  { icon: '⛽', text: 'Siphonne du carburant à la station', target: nearestOf(pumps, (p) => p.amount > 0), done: stat('fuel') },
  { icon: '🏰', text: 'Agrandis le camp vers l’ouest (niv. 3)', target: () => new THREE.Vector3(CAMP_PAD.x, 0, CAMP_PAD.z), done: () => save.campLv >= 3 },
  { icon: '🧑‍🔧', text: 'Recrute un ferrailleur', target: padPos('scav'), done: () => isBuilt('scav'), house: 'un ferrailleur' },
  // ---- le depart (31 a 36)
  { icon: '🍅', text: 'Remets en état le dernier potager', target: padPos('bed4'), done: () => isBuilt('bed4') },
  { icon: '🌾', text: 'Remets le dernier champ en culture', target: padPos('field3'), done: () => isBuilt('field3') },
  // ---- les materiaux (33 a 37)
  { icon: '⛏️', text: 'Ouvre la carrière, au nord-est', target: padPos('quarry'), done: () => isBuilt('quarry') },
  { icon: '🧱', text: 'Extrais de la pierre à la pioche', target: nearestOf(rocks, (r) => r.amount > 0), done: stat('stone') },
  { icon: '🧱', text: 'Monte la palissade en pierre (établi)', target: at(L.benchZone), done: () => save.wallTier >= 3 },
  { icon: '🔥', text: 'Restaure la fonderie de la station', target: padPos('foundry'), done: () => isBuilt('foundry') },
  { icon: '⚙️', text: 'Fonds du métal (ferraille à la fonderie)', target: at(L.foundryIn), done: stat('metal') },
  { icon: '🛡️', text: 'Renforce la palissade à l’établi', target: at(L.benchZone), done: () => save.up.wall > 0 },
  { icon: '🏰', text: 'Fais du camp un bastion (niv. 4)', target: () => new THREE.Vector3(CAMP_PAD.x, 0, CAMP_PAD.z), done: () => save.campLv >= 4 },
  { icon: '🔧', text: 'Répare le moteur du bus', target: padPos('bus1'), done: () => isBuilt('bus1') },
  { icon: '🚌', text: 'Retape la carrosserie du bus', target: padPos('bus2'), done: () => isBuilt('bus2') },
  { icon: '⛽', text: 'Fais le plein et quitte la vallée', target: padPos('bus3'), done: () => isBuilt('bus3') },
];

function currentObjective(): Objective | null {
  return OBJECTIVES[save.obj] ?? null;
}

/** Ce qui empeche l'objectif en cours d'avancer, et ou aller pour le debloquer. */
function objectiveBlock(): { icon: string; text: string; at: THREE.Vector3 } | null {
  const o = currentObjective();
  if (!o) return null;
  if (o.house && !freeHouse()) {
    const site = EXT.find((e) => e.id.startsWith('house') && save.campLv >= e.lv && !isBuilt(e.id));
    if (site) return { icon: '🏡', text: `Bâtis une maison pour loger ${o.house}`, at: new THREE.Vector3(site.pad.x, 0, site.pad.z) };
    return { icon: '🏠', text: `Agrandis le camp (🏰 près du feu) pour loger ${o.house}`, at: new THREE.Vector3(CAMP_PAD.x, 0, CAMP_PAD.z) };
  }
  if (o.crew && isBroken('shelter')) {
    const r = repairSpot('shelter');
    return { icon: '🔨', text: 'Répare l’abri : sans toit, les survivants ne travaillent plus', at: new THREE.Vector3(r.x, 0, r.z) };
  }
  return null;
}

function renderObjective(): void {
  const o = currentObjective();
  ui.objective.classList.toggle('off', !o);
  if (!o) return;
  const b = objectiveBlock();
  ui.objIcon.textContent = b ? b.icon : o.icon;
  ui.objText.textContent = b ? b.text : o.text;
  objBlocked = b ? b.text : '';
  bump(ui.objective);
}
let objBlocked = '';

function advanceObjectives(): void {
  let moved = false;
  while (save.obj < OBJECTIVES.length && OBJECTIVES[save.obj]!.done()) {
    save.obj++;
    moved = true;
  }
  if (moved) {
    // Temps de jeu a chaque objectif : pour verifier le rythme de la partie.
    while (save.objT.length < save.obj) save.objT.push(Math.round(save.playTime));
    renderObjective();
    sfx.sfxObjective();
    checkMilestones();
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
  // L'infirmerie (niv. 3 du camp) : 40 points de vie de plus.
  player.maxHp = 100 + 30 * save.up.health + (isBuilt('infirmary') ? 40 : 0);
  player.hp = Math.min(player.hp, player.maxHp);
  // Portes renforcees (niveau 4 du camp) : un cran de solidite en plus pour toute la palissade.
  palisade.setLevel(save.up.wall + (save.campLv >= 4 ? 1 : 0));
}

let sheetOpen = false;
function renderSheet(): void {
  const levels = LEVELS.filter((d) => !d.needs || isBuilt(d.needs)).map((d) => {
    const lvl = lv(d.id);
    const max = lvl >= MAX_LEVEL;
    const cost = levelPrice(d, lvl);
    return `<div class="card">
      <div class="card-icon">${d.icon}</div>
      <div class="card-main"><div class="card-title">${d.name} <span class="lv">niv. ${lvl}/${MAX_LEVEL}</span></div>
      <div class="card-desc">${d.effect(max ? lvl : lvl + 1)}</div></div>
      <button class="btn ${!max && !canAfford(cost) ? 'poor' : ''}" data-lv="${d.id}" ${max ? 'disabled' : ''}>${max ? 'MAX' : costIcons(cost)}</button>
    </div>`;
  }).join('');
  const scroll = ui.sheetBody.scrollTop;
  ui.sheetBody.innerHTML = `<h2>🧱 Matériaux</h2>${materialCards()}<h2>🏗️ Le camp</h2>${levels}<h2>🔧 Ton équipement</h2>` + UPGRADES.map((u) => {
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
  ui.sheetBody.scrollTop = scroll;
}

// ---- reserve : on choisit ce qu'on prend

/** Ordre des objets dans le panneau (les boutons ne bougent pas sous le doigt). */
const RES_ORDER: ItemType[] = ['log', 'plank', 'scrap', 'stone', 'metal', 'fuel', 'carrot', 'tomato', 'wheat', 'soup', 'bread', 'fish'];
/** Vide quand le panneau vient d'ouvrir : la grille est alors reconstruite une fois. */
let resKey = '';
/** Types deja affiches depuis l'ouverture, dans l'ordre d'apparition (on ajoute a la fin seulement). */
let resShown: ItemType[] = [];

function resButton(t: ItemType): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'res-item';
  b.dataset.take = t;
  b.innerHTML = `<span>${ITEMS[t].icon}</span><b data-res-n></b><small>${ITEMS[t].name}</small><em hidden>chantier</em>`;
  return b;
}

function renderReserve(): void {
  if (!resKey) {
    // Construit une seule fois par ouverture ; ensuite tout se met a jour en place.
    resKey = 'built';
    resShown = [];
    ui.sheetBody.innerHTML = `<h2>📦 Réserve <span class="lv" data-res-total></span></h2>
      <p class="note" data-res-bag></p>
      <p class="note" data-res-empty>Vide pour l'instant : tes survivants y déposent ce qu'ils récoltent.</p>
      <div class="res-grid"></div>
      <div class="res-actions"><button class="btn" data-take-need>🔨 Pour les chantiers</button><button class="btn wood" data-store>⬇️ Vider mon sac</button></div>`;
  }
  const grid = ui.sheetBody.querySelector<HTMLElement>('.res-grid');
  if (!grid) return;
  const need = neededNow();
  for (const t of RES_ORDER) {
    if ((reserve.counts.get(t) ?? 0) > 0 && !resShown.includes(t)) {
      resShown.push(t);
      grid.appendChild(resButton(t));
    }
  }
  const room = freeSpace();
  let needAny = false;
  grid.querySelectorAll<HTMLButtonElement>('[data-take]').forEach((b) => {
    const t = b.dataset.take as ItemType;
    const n = reserve.counts.get(t) ?? 0;
    const needed = need.has(t) && n > 0;
    if (needed) needAny = true;
    const nEl = b.querySelector<HTMLElement>('[data-res-n]');
    if (nEl) setText(nEl, String(n));
    b.classList.toggle('need', needed);
    const em = b.querySelector<HTMLElement>('em');
    if (em) em.hidden = !needed;
    b.disabled = n === 0;
    b.classList.toggle('poor', room <= 0 || n === 0);
  });
  const empty = ui.sheetBody.querySelector<HTMLElement>('[data-res-empty]');
  if (empty) empty.hidden = resShown.length > 0;
  const total = ui.sheetBody.querySelector<HTMLElement>('[data-res-total]');
  if (total) setText(total, `${reserve.total}/${reserve.cap}`);
  const bag = ui.sheetBody.querySelector<HTMLElement>('[data-res-bag]');
  if (bag) setText(bag, room <= 0 ? `Sac plein (${player.stack.count}/${player.stack.cap})` : `Sac : ${player.stack.count}/${player.stack.cap} · touche ce que tu veux prendre`);
  const needBtn = ui.sheetBody.querySelector<HTMLButtonElement>('[data-take-need]');
  if (needBtn) needBtn.disabled = room <= 0 || !needAny;
  const store = ui.sheetBody.querySelector<HTMLButtonElement>('[data-store]');
  if (store) store.disabled = player.stack.count === 0 || reserve.total >= reserve.cap;
}

/**
 * Objets que le joueur a lui-meme deposes, par type : les reprendre ne compte pas comme une
 * recuperation (sinon deposer puis reprendre son sac validerait la quete de la reserve).
 */
const selfStored = new Map<ItemType, number>();

/** Prend dans la reserve ce qui passe le filtre, jusqu'a remplir le sac (les objets volent un par un). */
function takeFromReserve(accept: (t: ItemType) => boolean): number {
  const n = Math.max(0, freeSpace());
  let got = 0;
  for (let i = 0; i < n; i++) {
    const t = reserve.take(accept);
    if (!t) break;
    got++;
    // Le compteur ne depasse jamais ce que la reserve contenait (les chantiers et le porteur la vident aussi).
    const mine = Math.min(selfStored.get(t) ?? 0, (reserve.counts.get(t) ?? 0) + 1 + reservePending);
    const counts = mine <= 0;
    if (!counts) selfStored.set(t, mine - 1);
    // Place reservee dans le sac tout de suite : rien d'autre ne peut la prendre en attendant.
    pendingIn++;
    setTimeout(() => {
      pendingIn = Math.max(0, pendingIn - 1);
      // K.O. avant le depart : l'objet reste dans la reserve.
      if (ko > 0) { reserve.add(t); return; }
      giveToPlayer(t, reserve.topWorld(), counts ? () => { save.stats.chest++; } : undefined, () => reserve.add(t));
    }, i * 40);
  }
  return got;
}

/** Vide le sac dans la reserve (dans la limite des places). */
function storeBag(): number {
  let n = 0;
  while (reserve.total + reservePending < reserve.cap) {
    const it = player.stack.take(() => true);
    if (!it) break;
    putInReserve(it.type, it.pos);
    selfStored.set(it.type, (selfStored.get(it.type) ?? 0) + 1);
    n++;
  }
  return n;
}

function reserveAction(el: HTMLElement): void {
  if (ko > 0) return;
  const d = el.dataset;
  let n = 0;
  if (d.take) {
    const t = d.take as ItemType;
    n = takeFromReserve((x) => x === t);
  } else if (d.takeNeed !== undefined) {
    const need = neededNow();
    n = takeFromReserve((x) => need.has(x));
  } else if (d.store !== undefined) {
    n = storeBag();
    if (n) sfx.sfxDrop(reserve.total);
  }
  if (!n) {
    sfx.sfxNope();
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    if (d.store === undefined && freeSpace() <= 0) toast('🎒 Sac plein ! Va vider ton chargement');
    return;
  }
  buzz(15);
  renderReserve();
}

ui.sheetBody.addEventListener('click', (e) => {
  const rb = (e.target as HTMLElement).closest<HTMLElement>('[data-take],[data-take-need],[data-store]');
  if (rb) {
    if (!(rb as HTMLButtonElement).disabled) reserveAction(rb);
    return;
  }
  const mb = (e.target as HTMLElement).closest<HTMLElement>('[data-mat]');
  if (mb) {
    const up = materialUpgrades().find((u) => u.key === mb.dataset.mat);
    const moved = up && up.ready ? depositInto(up.pkey, up.cost) : 0;
    if (!up || !moved) {
      sfx.sfxNope();
      if (up && up.ready) toast(`Il manque : ${costText(remainingOf(up.pkey, up.cost))}`);
      mb.classList.remove('shake');
      void mb.offsetWidth;
      mb.classList.add('shake');
      return;
    }
    if (totalCost(remainingOf(up.pkey, up.cost)) === 0) {
      delete save.fixPaid[up.pkey];
      up.apply();
      sfx.sfxBuild();
      buzz(40);
      particles.burst(player.position.clone().setY(2), [0xffd84a, 0xffffff, 0x9a9890], 40, { speed: 5, up: 6, size: 0.16 });
    } else {
      sfx.sfxDrop(6);
      buzz(15);
    }
    renderSheet();
    persist();
    return;
  }
  const lb = (e.target as HTMLElement).closest<HTMLElement>('[data-lv]');
  if (lb) {
    const d = LEVELS.find((x) => x.id === lb.dataset.lv)!;
    const cost = levelPrice(d, lv(d.id));
    if (lv(d.id) >= MAX_LEVEL) return;
    if (!canAfford(cost)) {
      sfx.sfxNope();
      if (save.coins >= cost.coins) toast(`Il manque : ${costText(cost)}`);
      lb.classList.remove('shake');
      void lb.offsetWidth;
      lb.classList.add('shake');
      return;
    }
    spend(cost);
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

/** Le panneau du bas : ameliorations a l'etabli, ou choix des objets a la reserve. */
type Panel = 'bench' | 'reserve' | 'hunters' | null;
let panel: Panel = null;
function setPanel(p: Panel): void {
  if (p === panel) {
    if (p === 'bench') refreshSheetButtons();
    else if (p === 'reserve') renderReserve();
    else if (p === 'hunters') renderHunters();
    return;
  }
  panel = p;
  sheetOpen = p !== null;
  handleY = null;
  sheetRest();
  ui.sheet.classList.remove('min');
  setText(ui.sheetTitle, p === 'bench' ? '🔨 Établi' : p === 'reserve' ? '📦 Réserve' : p === 'hunters' ? '🛡️ Armurerie' : '');
  document.body.classList.toggle('sheet-open', sheetOpen);
  ui.sheetBody.scrollTop = 0;
  if (p === 'bench') renderSheet();
  else if (p === 'hunters') {
    huntKey = '';
    renderHunters();
  } else if (p === 'reserve') {
    resKey = '';
    renderReserve();
    if (!save.seen.includes('hint:reserve')) {
      save.seen.push('hint:reserve');
      toast('📦 Touche ce que tu veux prendre dans la réserve');
    }
  }
}

// Poignee du panneau : le panneau suit le doigt ; glisser vers le bas le replie, vers le haut
// (ou toucher) le deplie.
let handleY: number | null = null;
let handleBase = 0;
let handleDy = 0;
function sheetRest(): void {
  ui.sheet.style.transition = '';
  ui.sheet.style.transform = '';
}
ui.sheetHandle.addEventListener('pointerdown', (e) => {
  handleY = e.clientY;
  handleDy = 0;
  // Position de depart reelle : 0 si ouvert, le decalage du repli sinon.
  handleBase = new DOMMatrix(getComputedStyle(ui.sheet).transform).m42;
  ui.sheet.style.transition = 'none';
  ui.sheetHandle.setPointerCapture?.(e.pointerId);
});
ui.sheetHandle.addEventListener('pointermove', (e) => {
  if (handleY === null) return;
  handleDy = e.clientY - handleY;
  const y = Math.min(ui.sheet.offsetHeight - 40, Math.max(0, handleBase + handleDy));
  ui.sheet.style.transform = `translateY(${y}px)`;
});
ui.sheetHandle.addEventListener('pointerup', () => {
  if (handleY === null) return;
  handleY = null;
  sheetRest();
  const min = ui.sheet.classList.contains('min');
  if (handleDy > 25) ui.sheet.classList.add('min');
  else if (handleDy < -25) ui.sheet.classList.remove('min');
  else ui.sheet.classList.toggle('min', !min);
});
ui.sheetHandle.addEventListener('pointercancel', () => { handleY = null; sheetRest(); });

// Tirer le contenu vers le bas quand la liste est en haut replie aussi le panneau. Evenements
// tactiles passifs : le defilement (pan-y) reste intact.
let bodyY: number | null = null;
ui.sheetBody.addEventListener('touchstart', (e) => {
  bodyY = ui.sheetBody.scrollTop <= 0 && !ui.sheet.classList.contains('min') ? e.touches[0]!.clientY : null;
}, { passive: true });
ui.sheetBody.addEventListener('touchmove', (e) => {
  if (bodyY === null || ui.sheetBody.scrollTop > 0) return;
  if (e.touches[0]!.clientY - bodyY > 40) {
    ui.sheet.classList.add('min');
    bodyY = null;
  }
}, { passive: true });
ui.sheetBody.addEventListener('touchend', () => { bodyY = null; }, { passive: true });

// Replie : toucher la bande visible deplie le panneau, sans declencher le bouton dessous.
ui.sheetBody.addEventListener('click', (e) => {
  if (!ui.sheet.classList.contains('min')) return;
  e.stopPropagation();
  ui.sheet.classList.remove('min');
}, true);

function refreshSheetButtons(): void {
  ui.sheetBody.querySelectorAll<HTMLElement>('[data-up]').forEach((b) => {
    const id = b.dataset.up as UpId;
    const cost = UPGRADES.find((x) => x.id === id)!.costs[save.up[id]];
    b.classList.toggle('poor', cost !== undefined && save.coins < cost);
  });
  ui.sheetBody.querySelectorAll<HTMLElement>('[data-lv]').forEach((b) => {
    const d = LEVELS.find((x) => x.id === b.dataset.lv)!;
    b.classList.toggle('poor', lv(d.id) < MAX_LEVEL && !canAfford(levelPrice(d, lv(d.id))));
  });
}

// ---------------------------------------------------------------- meta : niveaux, boosts, quetes, boutique

const lv = (id: LevelId) => save.lv[id] ?? 0;
const owns = (id: string) => save.owned.includes(id);
const boostOn = (id: BoostId) => (save.boosts[id] ?? 0) > 0;
const ct = (id: ContractId) => save.contracts[id] ?? 0;
/** L'heure, sans retour en arriere : reculer l'horloge du telephone ne redonne rien. */
const nowT = () => Math.max(Date.now(), save.clockHigh);
const dayKey = () => todayKey(new Date(nowT()));

/**
 * Ce que rapporte une vente : niveau de l'etal, survivants sauves (+4 % chacun, jusqu'a +40 %),
 * reclame en ville (contrat), renommee (convois) et boost « ventes x2 ».
 */
const sellMul = () => (1 + 0.05 * lv('stall') + Math.min(0.4, 0.04 * save.rescued) + 0.08 * ct('reclame') + 0.03 * save.renown)
  * (boostOn('sell') ? 2 : 1);
/** Vitesse des survivants (contrat « equipe aguerrie »). */
const crewMul = () => 1 + 0.12 * ct('crew');

/** Applique niveaux et boosts aux machines, cultures, reserve et au joueur (chaque image). */
function applyMeta(dt: number): void {
  for (const b of BOOSTS) if ((save.boosts[b.id] ?? 0) > 0) save.boosts[b.id] = Math.max(0, save.boosts[b.id]! - dt);
  const grow = boostOn('grow') ? 2 : 1;
  for (const b of beds) b.growMul = grow;
  // Batiments en pierre puis en metal : +50 % de cadence a chaque palier.
  const tierK = (id: string) => 1 + 0.5 * (bt(id) - 1);
  saw.speed = (1 + 0.15 * lv('saw')) * grow * tierK('sawmill');
  cook.speed = (1 + 0.15 * lv('cook')) * grow * tierK('kitchen');
  mill.speed = (1 + 0.15 * lv('mill')) * grow * tierK('mill');
  forge.speed = grow * tierK('foundry');
  reserve.cap = 240 + 60 * lv('reserve') + 120 * (bt('shelter') - 1) + (isBuilt('warehouse') ? 200 : 0);
  player.speedMul = (1 + 0.12 * save.up.boots) * (boostOn('speed') ? 1.4 : 1);
}

/** Un boost : il se cumule, jusqu'a un plafond (15 min par les pubs, 30 min en tout). */
function startBoost(id: BoostId, max = BOOST_MAX): void {
  save.boosts[id] = Math.min(max, Math.max(save.boosts[id] ?? 0, 0) + BOOST_TIME);
  const b = BOOSTS.find((x) => x.id === id)!;
  sfx.sfxObjective();
  toast(`${b.icon} ${b.name} : encore ${Math.round(save.boosts[id]! / 60)} min`);
  persist();
}
/** Le boost a-t-il encore de la place sous ce plafond ? */
const boostRoom = (id: BoostId, max: number) => (save.boosts[id] ?? 0) + 30 <= max;

/** Pieces d'un coffre : quelques minutes de revenu, a la mesure de la progression. */
/** Coffre gratuit (toutes les 4 h, calendrier) : un coup de pouce de 2 a 3 minutes de jeu, pas plus. */
const chestCoins = () => Math.round((60 + 7 * Math.pow(save.obj, 1.4)) / 10) * 10;
/** Ce que donne vraiment un coffre (contrat « ravitailleur fidele »). */
const chestReward = () => Math.round((chestCoins() * (1 + 0.5 * ct('chest'))) / 10) * 10;
/**
 * Valeur de reference des recompenses achetees ou rares (sacs de pieces en gemmes, pack de
 * depart, caches, largages, plafond hors ligne) : l'ancien coffre, qu'on ne baisse pas.
 */
const packCoins = () => Math.round((100 + 12 * Math.pow(save.obj, 1.5)) / 10) * 10;

function gainGems(n: number): void {
  save.gems += n;
  floatText(`+${n} 💎`, player.position.x + 0.6, 3.2, player.position.z, 'gem');
  bump(ui.gemsPill);
  sfx.sfxCoin();
}

// ---- budget de pubs : chaque emplacement a son plafond du jour

function adsToday(): Record<string, number> {
  const key = dayKey();
  if (save.ads.key !== key) save.ads = { key, n: {} };
  return save.ads.n;
}
function adLeft(spot: AdSpot): number {
  const n = adsToday();
  const total = Object.values(n).reduce((a, b) => a + b, 0);
  return Math.max(0, Math.min(AD_CAPS[spot] - (n[spot] ?? 0), AD_DAY_MAX - total));
}
/** Pub recompensee, toujours au choix du joueur : plafonnee, comptee seulement si elle va au bout. */
function rewarded(spot: AdSpot, what: string): Promise<boolean> {
  if (adLeft(spot) <= 0) {
    toast('📺 C’est tout pour aujourd’hui : reviens demain !');
    return Promise.resolve(false);
  }
  return showRewarded(what, owns('noads')).then((ok) => {
    if (ok) {
      const n = adsToday();
      n[spot] = (n[spot] ?? 0) + 1;
      persist();
    }
    return ok;
  });
}
/** Bouton « pub » : grise une fois le plafond du jour atteint. */
const adButton = (spot: AdSpot, attrs: string, label: string) => adLeft(spot) > 0
  ? `<button class="btn ad" ${attrs}>📺 ${label}</button>`
  : `<button class="btn ad" disabled>📺 Demain</button>`;

// ---- quetes du jour

function ensureQuests(): void {
  const key = dayKey();
  save.quests.list = save.quests.list.filter((q) => QUESTS.some((d) => d.id === q.id));
  if (save.quests.key === key && save.quests.list.length) return;
  // Les objectifs suivent la menace (donc la progression), plafonnes : une journee reste faisable.
  save.quests = { key, list: rollQuests(key, save.obj, Math.min(20, threat()), save.stats) };
}

function questProgress(q: { id: string; base: number; goal: number }): number {
  const def = QUESTS.find((d) => d.id === q.id);
  if (!def) return 0;
  return Math.max(0, Math.min(q.goal, save.stats[def.stat] - q.base));
}

const chestReady = () => nowT() >= save.chestAt;
const questToClaim = () => save.quests.list.some((q) => !q.claimed && questProgress(q) >= q.goal);
const questBonusReady = () => save.quests.list.length >= 3 && save.quests.list.every((q) => q.claimed) && save.questBonus !== save.quests.key;
const loginReady = () => save.login.last !== dayKey();
const monthlyReady = () => save.monthly.until > nowT() && save.monthly.last !== dayKey();
/** La boutique n'apparait qu'une fois les premiers gestes appris. */
const shopUnlocked = () => save.obj >= 3;

function fmtWait(ms: number): string {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

type ShopTab = 'shop' | 'quests' | 'city';
let shopTab: ShopTab = 'shop';
let hudClock = 0;

/** Jalons de l'histoire recompenses : chaque grande etape franchie donne des gemmes. */
const MILESTONES: { at: number; text: string }[] = [
  { at: 19, text: 'Le camp tient debout' }, { at: 25, text: 'La ferme revit' }, { at: 29, text: 'L’étang est à vous' },
  { at: 33, text: 'La station est rouverte' }, { at: 38, text: 'La pierre remplace le bois' }, { at: 42, text: 'Le métal coule' },
  { at: 45, text: 'Le bus est prêt' },
];
function checkMilestones(): void {
  for (const m of MILESTONES) {
    const key = `m:${m.at}`;
    if (save.obj < m.at || save.seen.includes(key)) continue;
    save.seen.push(key);
    gainGems(10);
    toast(`🏅 ${m.text} : +10 💎`);
  }
}

/** Pub contextuelle : quand la file d'attente deborde, on propose « ventes x2 » (jamais imposee). */
let adPillFor: BoostId | null = null;
function renderAdPill(): void {
  const day = !save.cycle || save.phase === 'day';
  const waiting = market.customers.filter((c) => c.state !== 'leave').length;
  const want = shopUnlocked() && day && waiting >= 3 && !boostOn('sell') && adLeft('boost_sell') > 0 && save.obj >= 5;
  adPillFor = want ? 'sell' : null;
  ui.adPill.classList.toggle('off', !want);
  if (want) setText(ui.adPill, '📺 Ventes ×2 · 5 min');
}

function renderMetaHud(): void {
  hudClock -= 1;
  if (hudClock > 0) return;
  hudClock = 20;
  ensureQuests();
  ui.shopBtn.classList.toggle('off', !shopUnlocked());
  const cityAlert = loginReady() || monthlyReady();
  const alert = chestReady() || questToClaim() || questBonusReady() || cityAlert;
  ui.shopBtn.classList.toggle('alert', alert);
  ui.shop.querySelector('[data-tab="quests"]')!.classList.toggle('alert', questToClaim() || questBonusReady());
  ui.shop.querySelector('[data-tab="city"]')!.classList.toggle('alert', cityAlert);
  const html = BOOSTS.filter((b) => boostOn(b.id))
    .map((b) => `<span>${b.icon} ${b.name} · ${Math.ceil(save.boosts[b.id]! / 60)} min</span>`).join('')
    + (save.convoyAt > nowT() ? `<span class="convoy">🚌 Convoi · ${fmtWait(save.convoyAt - nowT())}</span>` : '');
  if (ui.boostBar.innerHTML !== html) ui.boostBar.innerHTML = html;
  boostRows = ui.boostBar.childElementCount;
  renderAdPill();
  maybeOffer();
  if (ui.shop.classList.contains('show')) renderShop();
}

const card = (icon: string, title: string, desc: string, btns: string, cls = '') =>
  `<div class="card ${cls}"><div class="card-icon">${icon}</div><div class="card-main"><div class="card-title">${title}</div><div class="card-desc">${desc}</div></div><div class="btns">${btns}</div></div>`;

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
    }).join('');
    const got = save.quests.list.filter((q) => q.claimed).length;
    const bonusTaken = save.questBonus === save.quests.key;
    h += card('🏆', 'Les trois quêtes du jour', bonusTaken ? 'Bonus pris : à demain !' : `${got} / 3 terminées`,
      `<button class="btn gem" data-qbonus ${questBonusReady() ? '' : 'disabled'}>${bonusTaken ? '✓' : '+10 💎'}</button>`, 'gold');
    h += `<p class="note">Nouvelles quêtes chaque jour à minuit.</p>`;
  } else if (shopTab === 'city') {
    h = `<h3>Calendrier du ravitailleur</h3><div class="calendar">`;
    LOGIN.forEach((d, i) => {
      const done = i < save.login.step;
      const today = i === save.login.step && loginReady();
      h += `<div class="cal ${done ? 'done' : ''} ${today ? 'today' : ''}"><b>J${i + 1}</b><span>${d.icon}</span><small>${d.label}</small></div>`;
    });
    h += `</div>`;
    h += loginReady()
      ? `<button class="btn big wide" data-login>Récupérer : ${LOGIN[save.login.step % 7]!.label}</button>`
      : `<p class="note">Reviens demain pour la case suivante. Sauter un jour ne remet rien à zéro.</p>`;
    if (save.monthly.until > nowT()) {
      const left = Math.ceil((save.monthly.until - nowT()) / 86400000);
      h += card('📦', 'Ravitaillement mensuel', `40 💎 par jour · encore ${left} j`,
        `<button class="btn gem" data-monthly ${monthlyReady() ? '' : 'disabled'}>${monthlyReady() ? '+40 💎' : '✓'}</button>`, 'gold');
    }
    h += `<h3>Contrats de la Ville · permanents</h3>`;
    for (const c of CONTRACTS) {
      const l = ct(c.id);
      const max = l >= c.costs.length;
      const cost = c.costs[l] ?? 0;
      h += card(c.icon, `${c.name} <span class="lv">${l}/${c.costs.length}</span>`, c.effect(max ? l : l + 1),
        max ? `<button class="btn" disabled>MAX</button>` : `<button class="btn gem ${save.gems < cost ? 'poor' : ''}" data-contract="${c.id}">${cost} 💎</button>`);
    }
    h += `<p class="note">Les contrats restent acquis pour toute la partie.</p>`;
  } else {
    const wait = save.chestAt - nowT();
    const gemsLeft = adLeft('gems');
    h = `<h3>Gratuit</h3>`;
    h += card('🎁', 'Coffre du ravitailleur', chestReady() ? `${chestReward()} pièces et 3 💎` : `Prochain dans ${fmtWait(wait)}`,
      chestReady() ? `<button class="btn" data-chest="free">Ouvrir</button>` : adButton('chest', 'data-chest="ad"', `Ouvrir (${adLeft('chest')})`));
    h += card('💎', 'Gemmes offertes', `+${GEMS_PER_AD} 💎 · encore ${gemsLeft} aujourd'hui`, adButton('gems', 'data-gemad', `+${GEMS_PER_AD}`));
    if (save.convoyAt > nowT()) {
      h += card('🚌', `Convoi n°${save.convoys + 1} en route`, `Retour dans ${fmtWait(save.convoyAt - nowT())}`, adButton('convoy', 'data-convoy', '−5 min'));
    }
    h += `<h3>Boosts · 5 minutes</h3>`;
    for (const b of BOOSTS) {
      const left = save.boosts[b.id] ?? 0;
      const spot = `boost_${b.id}` as AdSpot;
      const adOk = boostRoom(b.id, BOOST_MAX_AD);
      h += card(b.icon, b.name, left > 0 ? `En cours · ${Math.ceil(left / 60)} min` : b.desc,
        (adOk ? adButton(spot, `data-boost="${b.id}" data-pay="ad"`, `${adLeft(spot)}`) : `<button class="btn ad" disabled>📺 Max</button>`)
        + `<button class="btn gem" data-boost="${b.id}" data-pay="gem" ${boostRoom(b.id, BOOST_MAX) ? '' : 'disabled'}>${b.gems} 💎</button>`);
    }
    h += `<h3>Armes</h3>`;
    for (const wd of WEAPONS) {
      const owned = save.weapons.includes(wd.id);
      const on = save.weapon === wd.id;
      const btns = !owned && !isBuilt('armory') ? `<button class="btn" disabled>Bâtis l’armurerie (camp niv. 2)</button>`
        : on ? `<button class="btn" disabled>Équipée</button>`
        : owned ? `<button class="btn" data-equip="${wd.id}">Équiper</button>`
          : `<button class="btn ${save.coins < wd.coins ? 'poor' : ''}" data-weapon="${wd.id}" data-pay="coin"><span class="coin"></span>${wd.coins}</button><button class="btn gem" data-weapon="${wd.id}" data-pay="gem">${wd.gems} 💎</button>`;
      h += card(wd.icon, wd.name, wd.desc, btns);
    }
    h += `<h3>Tenues</h3>`;
    for (const o of OUTFITS) {
      const owned = save.outfits.includes(o.id);
      if (o.gems < 0 && !owned) continue;
      const on = save.outfit === o.id;
      const swatch = `<i class="swatch" style="background:#${o.jacket.toString(16).padStart(6, '0')}"></i>`;
      const btns = on ? `<button class="btn" disabled>Portée</button>`
        : owned ? `<button class="btn" data-outfit="${o.id}">Porter</button>`
          : `<button class="btn gem" data-outfit="${o.id}">${o.gems} 💎</button>`;
      h += card(o.icon, `${o.name} ${swatch}`, owned ? (o.gems < 0 ? 'Gagnée en convoi' : 'Dans ton sac') : 'Tenue', btns);
    }
    h += `<h3>Pièces</h3>`;
    h += card('💰', 'Sac de pièces', `${packCoins() * 2} pièces`, `<button class="btn gem" data-coins="1">30 💎</button>`);
    h += card('💰', 'Coffre de pièces', `${packCoins() * 10} pièces · le meilleur prix`, `<button class="btn gem" data-coins="2">120 💎</button>`);
    h += `<h3>Offres</h3>`;
    for (const p of PRODUCTS) {
      if (p.once && owns(p.id)) continue;
      const double = p.gems > 0 && !save.firstBuy;
      h += card(p.icon, `${p.name}${double ? ' <span class="tag">×2 1er achat</span>' : ''}`, p.desc,
        `<button class="btn real" data-buy="${p.id}">${p.price}</button>`, p.id === 'starter' ? 'gold' : '');
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

function openShop(tab: ShopTab = shopTab): void {
  shopTab = tab;
  renderShop();
  ui.shop.classList.add('show');
}

ui.shopBtn.addEventListener('click', () => {
  if (!shopUnlocked()) return;
  openShop(loginReady() || monthlyReady() ? 'city' : (questToClaim() || questBonusReady()) && !chestReady() ? 'quests' : 'shop');
});
ui.shop.querySelector('.shop-close')!.addEventListener('click', () => ui.shop.classList.remove('show'));
ui.shop.addEventListener('click', (e) => {
  if (e.target === ui.shop) ui.shop.classList.remove('show');
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
  if (t) { shopTab = t.dataset.tab as ShopTab; renderShop(); }
});
ui.adPill.addEventListener('click', () => {
  const id = adPillFor;
  if (!id) return;
  void rewarded(`boost_${id}` as AdSpot, 'Ventes ×2 pendant 5 minutes').then((ok) => { if (ok) startBoost(id, BOOST_MAX_AD); });
});

function grantChest(): void {
  // Ouvert par une pub : le prochain coffre gratuit reste a l'heure prevue.
  if (chestReady()) save.chestAt = nowT() + CHEST_EVERY;
  gainGems(3);
  grantCoins(chestReward(), above(), 14);
  toast(`🎁 Coffre : ${chestReward()} pièces et 3 💎`);
  persist();
}

function claimLogin(): void {
  if (!loginReady()) return;
  const step = save.login.step % LOGIN.length;
  const d = LOGIN[step]!;
  save.login = { step: step + 1 >= LOGIN.length ? 0 : step + 1, last: dayKey(), total: save.login.total + 1 };
  if (d.r.gems) gainGems(d.r.gems);
  if (d.r.chests) grantCoins(chestReward() * d.r.chests, above(), 14);
  if (d.r.boost) startBoost(d.r.boost);
  sfx.sfxVictory();
  toast(`📅 Jour ${step + 1} : ${d.label} !`);
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

/** Pas assez de gemmes : on le dit, et on montre ou en trouver (sans forcer). */
function payGems(n: number): boolean {
  if (save.gems < n) {
    sfx.sfxNope();
    toast(`💎 Il manque ${n - save.gems} gemmes : quêtes, coffre, calendrier ou offres`);
    return false;
  }
  save.gems -= n;
  return true;
}

function grantProduct(p: Product): void {
  if (p.once) save.owned.push(p.id);
  let gems = p.gems;
  // Premier achat de gemmes double : un vrai coup de pouce pour essayer.
  if (gems > 0 && !save.firstBuy) {
    gems *= 2;
    save.firstBuy = true;
  }
  if (gems > 0) gainGems(gems);
  if (p.id === 'starter') {
    grantCoins(packCoins() * 4, above(), 16);
    save.up.bag = Math.min(UPGRADES[0]!.costs.length, save.up.bag + 1);
    if (!save.outfits.includes('ranger')) save.outfits.push('ranger');
    applyUpgrades();
  } else if (p.id === 'monthly') {
    save.monthly = { until: Math.max(nowT(), save.monthly.until) + 30 * 86400000, last: '' };
  }
  toast(`${p.icon} ${p.name} obtenu${gems > 0 ? ` : +${gems} 💎` : ''} !`);
  sfx.sfxVictory();
  persist();
}

ui.shopBody.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('button');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const d = el.dataset;
  if (d.claim !== undefined) {
    const q = save.quests.list[Number(d.claim)];
    if (!q || q.claimed || questProgress(q) < q.goal) return;
    q.claimed = true;
    gainGems(QUESTS.find((x) => x.id === q.id)?.gems ?? 0);
    persist();
  } else if (d.qbonus !== undefined) {
    if (!questBonusReady()) return;
    save.questBonus = save.quests.key;
    gainGems(10);
    toast('🏆 Trois quêtes : +10 💎');
    persist();
  } else if (d.login !== undefined) claimLogin();
  else if (d.monthly !== undefined) {
    if (!monthlyReady()) return;
    save.monthly.last = dayKey();
    gainGems(40);
    persist();
  } else if (d.contract) {
    const c = CONTRACTS.find((x) => x.id === d.contract)!;
    const l = ct(c.id);
    const cost = c.costs[l];
    if (cost === undefined || !payGems(cost)) return renderShop();
    save.contracts[c.id] = l + 1;
    sfx.sfxVictory();
    toast(`${c.icon} ${c.name} : ${c.effect(l + 1)}`);
    persist();
  } else if (d.convoy !== undefined) {
    void rewarded('convoy', 'un convoi plus rapide').then((ok) => {
      if (!ok || save.convoyAt <= 0) return;
      save.convoyAt = Math.max(nowT(), save.convoyAt - 5 * 60 * 1000);
      persist();
      renderShop();
    });
  } else if (d.chest === 'free') grantChest();
  else if (d.chest === 'ad') void rewarded('chest', 'le coffre du ravitailleur').then((ok) => ok && grantChest());
  else if (d.gemad !== undefined) {
    void rewarded('gems', `${GEMS_PER_AD} gemmes`).then((ok) => {
      if (!ok) return;
      gainGems(GEMS_PER_AD);
      persist();
      renderShop();
    });
  } else if (d.boost) {
    const id = d.boost as BoostId;
    const b = BOOSTS.find((x) => x.id === id)!;
    if (d.pay === 'gem') { if (boostRoom(id, BOOST_MAX) && payGems(b.gems)) startBoost(id, BOOST_MAX); }
    else if (boostRoom(id, BOOST_MAX_AD)) void rewarded(`boost_${id}` as AdSpot, `${b.name} pendant 5 minutes`).then((ok) => ok && startBoost(id, BOOST_MAX_AD));
  } else if (d.coins) {
    const big = d.coins === '2';
    if (payGems(big ? 120 : 30)) {
      grantCoins(packCoins() * (big ? 10 : 2), above(), 16);
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
      if (o.gems < 0 || !payGems(o.gems)) return renderShop();
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

/**
 * Les offres se montrent au bon moment, une seule fois, et jamais la nuit : le pack de depart
 * apres la premiere nuit tenue, « sans pub » apres quelques pubs regardees.
 */
function maybeOffer(): void {
  if (ui.modal.classList.contains('show') || ui.shop.classList.contains('show')) return;
  if (save.cycle && save.phase === 'night') return;
  const once = (key: string) => {
    if (save.seen.includes(key)) return false;
    save.seen.push(key);
    return true;
  };
  if (!owns('starter') && save.stats.nights >= 1 && once('offer:starter')) {
    const p = PRODUCTS.find((x) => x.id === 'starter')!;
    showModal(`<div class="modal-big">${p.icon}</div><h2>${p.name}</h2><p>${p.desc}</p>
      <p class="muted">Offre unique · ${p.price}${SIMULATED ? ' · achat simulé (version de test)' : ''}</p>
      <button class="btn real" data-see>Voir l’offre</button>`);
    ui.modal.querySelector('[data-see]')!.addEventListener('click', () => { ui.modal.classList.remove('show'); openShop('shop'); });
    return;
  }
  const watched = Object.values(save.ads.n).reduce((a, b) => a + b, 0);
  if (!owns('noads') && watched >= 6 && once('offer:noads')) {
    toast('🚫 Astuce : l’offre « Sans pub » donne les récompenses sans regarder les vidéos');
  }
}

/** K.O. avec un gros chargement : une pub pour le recuperer, au choix du joueur. */
function offerKeepBag(lost: ItemType[]): void {
  if (adLeft('ko') <= 0) {
    toast(`💫 K.O. ! ${lost.length} objets perdus`);
    return;
  }
  showModal(`<div class="modal-big">💫</div><h2>K.O. !</h2>
    <p>Tu as lâché ton chargement (${lost.length} objets).</p>
    <button class="btn ad" data-keep>📺 Le récupérer</button>`);
  let busy = false;
  ui.modal.querySelector('[data-keep]')!.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void rewarded('ko', 'ton chargement').then((ok) => {
      busy = false;
      if (!ok) return;
      ui.modal.classList.remove('show');
      for (const t of lost) if (player.stack.count < player.stack.cap) player.stack.add(t);
      toast('🎒 Chargement récupéré');
    });
  });
}

// ---------------------------------------------------------------- materiaux : palissade et batiments

const bt = (id: string) => save.bt[id] ?? 1;
const BT_NAMES = ['Bois', 'Pierre', 'Métal'];
/** Batiments qu'on peut construire en dur, et leur « poids » dans le cout. */
const TIERABLE: { id: string; name: string; icon: string; w: number }[] = [
  { id: 'sawmill', name: 'Scierie', icon: '🪚', w: 1 },
  { id: 'kitchen', name: 'Cuisine', icon: '🍲', w: 1.2 },
  { id: 'tower', name: 'Tour de guet', icon: '🗼', w: 1.4 },
  { id: 'shelter', name: 'Abri', icon: '🏠', w: 1.5 },
  { id: 'mill', name: 'Moulin', icon: '🍞', w: 1.6 },
  { id: 'foundry', name: 'Fonderie', icon: '🔥', w: 1.8 },
];
const WALL_COSTS: Cost[] = [
  { coins: 0 },
  { coins: 700, log: 50 },
  { coins: 4500, stone: 150 },
  { coins: 9000, scrap: 150, stone: 40 },
  { coins: 18000, metal: 80 },
];

/** On paie avec ce qu'on porte et ce qui est dans la reserve. */
function have(t: ItemType): number {
  return player.stack.countOf(t) + (reserve.counts.get(t) ?? 0);
}
function canAfford(c: Cost): boolean {
  if (save.coins < c.coins) return false;
  return (Object.keys(ITEMS) as ItemType[]).every((t) => have(t) >= (c[t] ?? 0));
}
function spend(c: Cost): void {
  save.coins -= c.coins;
  for (const t of Object.keys(ITEMS) as ItemType[]) {
    let n = c[t] ?? 0;
    while (n > 0 && player.stack.take((x) => x === t)) n--;
    while (n > 0 && reserve.take((x) => x === t)) n--;
  }
}

interface MatUp { key: string; pkey: string; icon: string; title: string; desc: string; cost: Cost; ready: boolean; why: string; apply: () => void }

function materialUpgrades(): MatUp[] {
  const out: MatUp[] = [];
  const t = save.wallTier;
  if (t < 5) {
    const next = TIERS[t]!;
    const ready = t + 1 === 3 ? isBuilt('quarry') : t + 1 === 5 ? isBuilt('foundry') : true;
    out.push({
      key: 'wall', pkey: `mat:wall:${t + 1}`, icon: next.icon, title: `Palissade : ${next.name}`,
      desc: `Actuelle : ${TIERS[t - 1]!.name} · solidité ×${(next.mul / TIERS[t - 1]!.mul).toFixed(1)}, se répare en ${ITEMS[next.item].icon}`,
      cost: WALL_COSTS[t]!, ready, why: t + 1 === 3 ? 'Il faut la carrière' : 'Il faut la fonderie',
      apply: () => {
        save.wallTier = t + 1;
        palisade.setTier(save.wallTier);
        toast(`${next.icon} Palissade en ${next.name.toLowerCase()} !`);
      },
    });
  }
  for (const b of TIERABLE) {
    if (!isBuilt(b.id) || isBroken(b.id)) continue;
    const cur = bt(b.id);
    if (cur >= 3) continue;
    const toStone = cur === 1;
    const cost: Cost = toStone
      ? { coins: Math.round(2000 * b.w / 10) * 10, stone: Math.round(30 * b.w) }
      : { coins: Math.round(6000 * b.w / 10) * 10, metal: Math.round(15 * b.w) };
    out.push({
      key: b.id, pkey: `mat:${b.id}:${cur + 1}`, icon: b.icon, title: `${b.name} en ${BT_NAMES[cur]!.toLowerCase()}`,
      desc: `Plus grand, deux fois plus solide, cadence +50 %`,
      cost, ready: toStone ? isBuilt('quarry') : isBuilt('foundry'), why: toStone ? 'Il faut la carrière' : 'Il faut la fonderie',
      apply: () => {
        save.bt[b.id] = cur + 1;
        try { applyBuildingTier(b.id); } catch (err) { console.error(err); }
        toast(`${b.icon} ${b.name} reconstruite en ${BT_NAMES[cur]!.toLowerCase()} !`);
      },
    });
  }
  return out;
}

/** Ce qu'il reste a apporter pour un chantier paye en plusieurs fois. */
function remainingOf(key: string, cost: Cost): Cost {
  const paid = save.fixPaid[key] ?? { coins: 0 };
  const r: Cost = { coins: Math.max(0, cost.coins - paid.coins) };
  for (const t of Object.keys(ITEMS) as ItemType[]) {
    const need = cost[t];
    if (need) r[t] = Math.max(0, need - (paid[t] ?? 0));
  }
  return r;
}

/** Verse dans le chantier tout ce qu'on peut (pieces, sac puis reserve). Renvoie ce qui a ete verse. */
function depositInto(key: string, cost: Cost): number {
  const rem = remainingOf(key, cost);
  const paid = (save.fixPaid[key] ??= { coins: 0 });
  let moved = 0;
  const c = Math.min(save.coins, rem.coins);
  if (c > 0) { save.coins -= c; paid.coins += c; moved += c; }
  for (const t of Object.keys(ITEMS) as ItemType[]) {
    let n = rem[t] ?? 0;
    while (n > 0 && (player.stack.take((x) => x === t) || reserve.take((x) => x === t))) {
      n--;
      paid[t] = (paid[t] ?? 0) + 1;
      moved++;
    }
  }
  return moved;
}

function materialCards(): string {
  const ups = materialUpgrades();
  if (!ups.length) return `<p class="note">Tout est construit en dur.</p>`;
  return ups.map((u) => {
    const rem = remainingOf(u.pkey, u.cost);
    const k = 1 - totalCost(rem) / Math.max(1, totalCost(u.cost));
    const can = u.ready && (Math.min(save.coins, rem.coins) > 0 || (Object.keys(ITEMS) as ItemType[]).some((t) => (rem[t] ?? 0) > 0 && have(t) > 0));
    return `<div class="card"><div class="card-icon">${u.icon}</div>
      <div class="card-main"><div class="card-title">${u.title}</div><div class="card-desc">${u.ready ? u.desc : u.why}</div>
      <div class="card-desc">${k > 0 ? 'Reste : ' : ''}${costIcons(rem)}</div>${k > 0 ? `<div class="bar"><i style="width:${Math.round(k * 100)}%"></i></div>` : ''}</div>
      <button class="btn ${can ? '' : 'poor'}" data-mat="${u.key}">Déposer</button></div>`;
  }).join('') + `<p class="note">Dépose en plusieurs fois : tout ce que tu as dans le sac et la réserve part au chantier, rien n'est perdu.</p>`;
}

/** Un batiment en dur : un peu plus grand, sur un socle de pierre ou de fer, et plus solide. */
function applyBuildingTier(id: string): void {
  const t = bt(id);
  const g = builtOf(id);
  g.scale.setScalar(1 + 0.12 * (t - 1));
  const old = g.getObjectByName('plinth');
  if (old) g.remove(old);
  if (t > 1) {
    const r = siteOf(id).reach;
    const plinth = new THREE.Group();
    plinth.name = 'plinth';
    plinth.add(rbox(r * 1.5, 0.22, r * 1.5, t === 2 ? 0x9a9890 : 0x55595c, 0.05, 0, 0.11, 0));
    if (t === 3) for (const sx of [-1, 1]) for (const sz of [-1, 1]) plinth.add(box(0.18, 1.6, 0.18, 0x3a3d40, sx * r * 0.7, 0.8, sz * r * 0.7));
    plinth.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    g.add(plinth);
  }
  const st = STRUCTS.find((x) => x.id === id);
  if (st) {
    st.max = STRUCT_HP[id]! * t;
    st.hp = st.max;
  }
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
/** Partie effacee : plus rien ne doit etre ecrit par-dessus avant le rechargement. */
let resetting = false;
ui.reset.addEventListener('click', () => {
  if (Date.now() - resetArmed > 3000) {
    resetArmed = Date.now();
    ui.reset.textContent = 'Touche encore pour confirmer';
    setTimeout(() => { ui.reset.textContent = 'Recommencer le camp'; }, 3000);
    return;
  }
  resetting = true;
  wipeSave();
  save = freshSave();
  writeSave(save);
  location.reload();
});

// ================================================================ echanges

let pendingIn = 0;
const freeSpace = () => player.stack.cap - player.stack.count - pendingIn;

/** Un objet vole vers le dos du joueur. */
function giveToPlayer(t: ItemType, from: THREE.Vector3, onArrive?: () => void, onFail?: () => void): void {
  pendingIn++;
  flyers.launch(itemMesh(t), from, () => player.stack.topWorld(), () => {
    pendingIn = Math.max(0, pendingIn - 1);
    if (ko > 0 || !player.stack.add(t)) { onFail?.(); return; }
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

/** Une recompense : creditee tout de suite (rien ne se perd si l'appli est fermee), les pieces volent pour le plaisir. */
function grantCoins(n: number, from: THREE.Vector3, pieces = 14): void {
  if (n <= 0) return;
  floatAtPlayer(`+${fmt(n)}`);
  save.coins += n;
  save.stats.earned += n;
  flyCoins(n, from, playerChest, () => { sfx.sfxCoin(); bump(ui.moneyPill); }, pieces);
}
const above = () => player.position.clone().add(new THREE.Vector3(0, 4, 2));

const playerChest = () => player.position.clone().setY(1.3);

/** Objets en vol vers chaque bac de l'etal. */
const shelfPending = new Map<ItemType, number>();
const convPending = new Map<Converter, number>([[saw, 0], [cook, 0], [mill, 0], [forge, 0]]);

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

/** Les materiaux de construction : ils ne partent a l'etal que si aucun chantier ouvert n'en veut. */
const MATERIALS: ItemType[] = ['log', 'plank', 'scrap', 'stone', 'metal', 'fuel'];
let neededSet = new Set<ItemType>();
let neededClock = 0;
/** Ce que reclament les chantiers ouverts (zones, reparations, materiaux en cours). */
function neededNow(): Set<ItemType> {
  if (neededClock > 0) return neededSet;
  neededClock = 0.5;
  const set = new Set<ItemType>();
  const addRem = (rem: Cost) => { for (const t of Object.keys(ITEMS) as ItemType[]) if ((rem[t] ?? 0) > 0) set.add(t); };
  for (const p of pads) if (p.shown && !isBuilt(p.def.id)) addRem(remaining(p));
  for (const dp of dynPads.values()) addRem(dynRemaining(dp));
  for (const u of materialUpgrades()) if (save.fixPaid[u.pkey]) addRem(remainingOf(u.pkey, u.cost));
  neededSet = set;
  return set;
}
/** Peut-on vendre ce que porte le joueur (ou le porteur) ? Pas un materiau qu'un chantier attend. */
const sellable = (t: ItemType) => !(MATERIALS.includes(t) && neededNow().has(t));
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
/** Immobile a l'etal aussi longtemps, on vend meme les materiaux de chantier. */
const SELL_ALL = 1;
let stallHint = false;

const near = (x: number, z: number, r: number) => Math.hypot(player.position.x - x, player.position.z - z) < r;

function interact(dt: number): void {
  const p = player.position;
  actClock -= dt;
  harvestClock -= dt;
  dropClock -= dt;
  pickClock -= dt;
  payClock -= dt;
  neededClock -= dt;
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
      || scraps.some((s) => s.amount > 0 && Math.hypot(s.x - p.x, s.z - p.z) < s.radius)
      || pumps.some((u) => u.amount > 0 && near(u.x, u.z, u.radius))
      || (isBuilt('quarry') && rocks.some((r) => r.amount > 0 && near(r.x, r.z, r.radius)))
      || (isBuilt('dock') && near(L.fishSpot.x, L.fishSpot.z, 1.1))
      || (reserve.total > 0 && near(reserve.zone.x, reserve.zone.z, 1.1));
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
        const got = () => {
          save.stats.harvested++;
          if (kind === 'wheat') save.stats.wheat++;
        };
        giveToPlayer(kind, from, got);
        // Niveau « Cultures » : parfois, la plante donne double.
        if (freeSpace() > 0 && Math.random() < 0.05 * lv('crops')) giveToPlayer(kind, from.clone().setY(from.y + 0.3), got);
        particles.burst(from, [0x7fdc5a, 0x5a3a20], 4, { speed: 2, up: 3, size: 0.08, life: 0.4 });
        break;
      }
    }
  }

  // Outils : hache pres d'un arbre, marteau pres d'une epave, fusil face a un zombie.
  let tool: 'axe' | 'hammer' | 'pick' | null = null;
  let tree: ChopTree | null = null;
  let src: ScrapSource | null = null;
  let rock: StoneSource | null = null;
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
      if (!src && isBuilt('quarry')) {
        for (const r of rocks) {
          if (r.amount > 0 && Math.hypot(r.x - p.x, r.z - p.z) < r.radius) { rock = r; tool = 'pick'; break; }
        }
      }
    }
  }
  player.setTool(aimTarget ? 'gun' : tool ?? 'none');
  const toolTarget = tree ?? src ?? rock;
  if (toolTarget && !aimTarget) {
    player.faceTowards(toolTarget.x, toolTarget.z, dt);
    const interval = tool === 'axe' ? 0.5 - 0.06 * save.up.axe : 0.45;
    if (actClock <= 0 && player.strike()) {
      actClock = interval;
      const tt = tree;
      const ss = src;
      const rr = rock;
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
        } else if (rr && rr.hit()) {
          sfx.sfxClang();
          buzz(12);
          const at = new THREE.Vector3(rr.x, 0.9, rr.z);
          particles.burst(at, [0x9a9890, 0xb0aea6, 0x6f6c66], 12, { speed: 4, up: 3, size: 0.12, life: 0.5 });
          if (freeSpace() > 0) giveToPlayer('stone', at, () => { save.stats.stone++; });
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
  // Reserve : le panneau du bas s'ouvre devant le coffre, on choisit ce qu'on prend (setPanel).

  // Deposer a l'etal tout ce qui se vend. Les materiaux qu'un chantier attend sont gardes,
  // sauf si l'on reste immobile un peu plus longtemps : alors tout part a la vente.
  const atStall = near(L.shelf.x, L.shelf.z, 1.6);
  if (!atStall) stallHint = false;
  if (settled && dropClock <= 0 && atStall) {
    const sellAll = still >= SELL_ALL;
    const item = player.stack.take((t) => shelfRoom(t) > 0 && (sellAll || sellable(t)));
    if (item) {
      dropClock = 0.08;
      putOnShelf(item.type, item.pos);
      save.stats.shelved++;
      sfx.sfxDrop(market.bins.total);
    } else if (!sellAll && !stallHint && player.stack.slots.some((x) => shelfRoom(x.type) > 0 && !sellable(x.type))) {
      stallHint = true;
      toast(`🧺 Matériaux gardés pour tes chantiers : reste encore ${Math.ceil(SELL_ALL - still)} s pour les vendre aussi`);
    }
  }
  // Reparer la palissade : immobile le long d'un troncon abime, avec des rondins.
  // On ne repare pas si l'on se tient dans une autre zone (etal, chantier, machine) :
  // le bois va la ou on l'a voulu.
  const busyZone = near(L.shelf.x, L.shelf.z, 1.8) || near(reserve.zone.x, reserve.zone.z, 1.3)
    || pads.some((q) => q.shown && !isBuilt(q.def.id) && near(q.def.x, q.def.z, 1.6))
    || [saw, cook, mill, forge].some((c) => c.built && near(c.input.x, c.input.z, 1.5)) || onDynPad();
  // Le troncon abime a portee, sur la palissade du camp ou sur celle de la ferme.
  repairTarget = null;
  let repairWall = palisade;
  if (!busyZone) {
    for (const pl of allWalls()) {
      if (!player.stack.has(pl.repairItem)) continue;
      const s = pl.repairable(p.x, p.z);
      if (s) { repairTarget = s; repairWall = pl; break; }
    }
  }
  const wallItem = repairWall.repairItem;
  if (settled && dropClock <= 0 && repairTarget) {
    const s = repairTarget;
    const item = player.stack.take((t) => t === wallItem);
    if (item) {
      dropClock = 0.16;
      s.inflight++;
      const to = new THREE.Vector3(s.x, 1.1, s.z);
      flyers.launch(itemMesh(item.type), item.pos, () => to, () => repairLanded(s), 0.3, 1.3);
    }
  }
  // Nourrir les machines, ramasser ce qu'elles produisent.
  for (const c of [saw, cook, mill, forge]) {
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
    floatText(`+${fmt(n)}`, L.cash.x, 1.4, L.cash.z);
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
    // Tout est paye mais rien n'est en vol (appli fermee au mauvais moment) : on termine.
    if (dp.inflight === 0 && totalCost(dynRemaining(dp)) === 0) {
      dropDyn(dp);
      dp.done();
      persist();
      continue;
    }
    if (!dp.armed && !near(dp.x, dp.z, 1.6)) dp.armed = true;
    if (!dp.armed || !settled || payClock > 0 || !near(dp.x, dp.z, 1.45)) continue;
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
  const atBench = structAlive('bench') && near(L.benchZone.x, L.benchZone.z, 1.5);
  const atReserve = near(reserve.zone.x, reserve.zone.z, 1.3);
  // Armurerie : le panneau des chasseurs de prime.
  const atHunt = isBuilt('armory') && near(HUNT_PAD.x, HUNT_PAD.z, 1.5);
  setPanel(atBench ? 'bench' : atReserve ? 'reserve' : atHunt ? 'hunters' : null);
}

/** Le troncon que le joueur est en train de reparer (pour son etiquette). */
let repairTarget: Section | null = null;

function repairLanded(s: Section): void {
  s.inflight = Math.max(0, s.inflight - 1);
  const before = stateOf(s);
  const pl = wallOf(s);
  pl.setHp(s, s.hp + unitHp(s));
  save.stats.repairs++;
  sfx.sfxChop();
  buzz(10);
  const at = new THREE.Vector3(s.x, 1.2, s.z);
  particles.burst(at, [0xc68a4f, 0xe0b077, 0xd9b07a], 10, { speed: 3, up: 3, size: 0.12, life: 0.6 });
  if (stateOf(s) !== before) {
    pl.bump(s);
    particles.burst(at.setY(0.4), [0xb9a58a, 0x9a8a72], 12, { speed: 3, up: 2, size: 0.22, life: 0.7 });
  }
  if (s.hp >= s.max) {
    sfx.sfxBuild();
    toast(s.site === 'farm' ? `${ITEMS[pl.repairItem].icon} Palissade de la ferme consolidée` : '🪵 Palissade consolidée');
  }
}

let wallToast = 0;
/** Un coup de zombie sur la palissade : eclats de bois, et alerte si elle cede. */
function onWallHit(s: Section, at: THREE.Vector3): void {
  particles.burst(at, [0xc68a4f, 0x7a5a3a, 0xd9b07a], 5, { speed: 3, up: 2, size: 0.1, life: 0.5 });
  warn(`${s.site === 'farm' ? 'fw' : 'w'}${s.id}`, s.x, wallTop(s, 2.4, 3.6), s.z);
  // Les chasseurs de prime de cette zone accourent ; ils ne changent de troncon que si le
  // leur n'est plus frappe depuis 4 s (sinon ils courraient d'un coup a l'autre).
  const hw = hotWall[s.site === 'farm' ? 'farm' : 'camp'];
  if (hw.s === s || save.playTime - hw.t >= 4) {
    hw.s = s;
    hw.t = save.playTime;
  }
  const near0 = Math.hypot(at.x - player.position.x, at.z - player.position.z) < 14;
  if (near0) sfx.sfxChop();
  if (s.hp <= 0 && performance.now() - wallToast > 4000) {
    wallToast = performance.now();
    toast(s.site === 'farm' ? '⚠️ La palissade de la ferme a cédé !' : '⚠️ La palissade a cédé !');
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

/** Ce que le porteur sort de la reserve : pas la pierre, le metal ni le carburant, ni ce qu'un chantier attend. */
const portable = (t: ItemType) => t !== 'stone' && t !== 'metal' && t !== 'fuel' && sellable(t);

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
  reserveCount: () => { let n = 0; for (const [t, c] of reserve.counts) if (portable(t)) n += c; return n; },
  reserveTake: () => reserve.take(portable),
  porterDrop: (t) => {
    // D'abord la machine qui transforme, sinon le bac de l'etal.
    const conv = t === 'log' ? saw : t === 'carrot' || t === 'tomato' ? cook : t === 'wheat' ? mill : t === 'scrap' ? forge : null;
    if (conv && conv.built && convRoom(conv) > 0) return { at: { x: conv.input.x, z: conv.input.z }, put: (x, from) => putInConverter(conv, x, from) };
    if (shelfRoom(t) > 0) return { at: L.shelf, put: (x, from) => putOnShelf(x, from) };
    return null;
  },
  outputs: () => [cook, mill, saw, forge].filter((c) => c.built && c.output.count > 0 && shelfRoom(c.product) > 0 && sellable(c.product) && c.product !== 'metal')
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

/**
 * La menace : elle suit la progression (objectifs) plutot que le temps passe, pour qu'une
 * partie longue ne fasse pas deraper la horde. Apres le depart du bus, +1 toutes les 3 nuits.
 */
function threat(): number {
  const after = save.won ? Math.floor(Math.max(0, save.day - save.wonDay) / 3) : 0;
  return Math.max(1, Math.min(save.day, 6 + Math.floor(save.obj / 2)) + after);
}

function startNight(): void {
  save.phase = 'night';
  save.phaseT = 0;
  horde.startNight(threat());
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
  save.gems += 1;
  toast(`☀️ Jour ${save.day} : le camp a tenu ! +1 💎`);
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
const CACHE_REFILL = 15 * 60 * 1000;
caches.forEach((c, i) => { if ((save.caches[`c${i}`] ?? 0) > nowT()) c.open(); });

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

/** La caravane repart : ce qui a deja ete livre est paye (une fois et demie le prix de l'etal). */
function caravanLeaves(): void {
  if (offer && offer.got > 0 && offer.got < offer.need) {
    const n = Math.round(offer.got * ITEMS[offer.want].price * 1.5);
    grantCoins(n, new THREE.Vector3(caravan.zone.x, 1.5, caravan.zone.z), 8);
    toast(`🛒 La caravane paie ce que tu as livré : ${n} pièces`);
  } else toast('🛒 La caravane reprend la route');
  caravan.show(false);
  offer = null;
}

function endDayEvents(): void {
  if (airdrop.active) airdrop.hide();
  if (caravan.active) caravanLeaves();
  if (rescue.active) rescue.hide();
  plan.drop = plan.caravan = plan.rescue = -1;
}

/** Butin d'une cache (petit) ou d'un ravitaillement (gros). */
function giveLoot(at: THREE.Vector3, big: boolean): void {
  const coins = big ? Math.round(0.4 * packCoins()) : 20 + Math.round(0.06 * packCoins());
  grantCoins(coins, at, 10);
  const pool: ItemType[] = ['scrap', 'plank', 'log', 'scrap'];
  if (nav.eastOpen) pool.push('fuel');
  const n = big ? 5 : 2 + Math.floor(Math.random() * 2);
  let given = 0;
  for (let i = 0; i < n && freeSpace() > 0; i++) {
    const t = pool[Math.floor(Math.random() * pool.length)]!;
    giveToPlayer(t, at.clone().add(new THREE.Vector3(0, 0.3 * i, 0)));
    given++;
  }
  const gems = big ? 2 + Math.floor(Math.random() * 2) : Math.random() < 0.15 ? 1 : 0;
  if (gems) gainGems(gems);
  particles.burst(at, [0xffd84a, 0xffffff, 0x8be36b], big ? 40 : 18, { speed: 5, up: 6, size: 0.15, life: 0.9 });
  sfx.sfxBuild();
  toast(`${big ? '🪂 Ravitaillement' : '📦 Cache'} : ${coins} pièces${given ? `, ${given} objets` : ''}${gems ? `, ${gems} 💎` : ''}`);
}

/** La caravane demande un lot d'un produit qu'on sait faire, et paie bien plus que l'etal. */
function makeOffer(): Offer {
  const options = productsList().filter((t) => t !== 'carrot');
  const want = options[Math.floor(Math.random() * options.length)] ?? 'carrot';
  const need = Math.max(6, Math.round(60 / ITEMS[want].price)) + Math.min(10, threat());
  return { want, need, got: 0, pay: Math.round(need * ITEMS[want].price * 2.5), gems: 2 };
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
  if (caravan.active && offer && f > 0.85) caravanLeaves();
}

/** Fouille, ravitaillement, caravane, sauvetage : tout se fait immobile, 0,5 s. */
function interactEvents(dt: number, settled: boolean): void {
  if (!settled) rescueHold = 0;
  // Caches
  caches.forEach((c, i) => {
    if (!c.ready && (save.caches[`c${i}`] ?? 0) <= nowT()) c.ready = true;
    if (!settled || !c.ready || !zoneOpen(c.spot) || !near(c.spot.x, c.spot.z, 1.3)) return;
    c.open();
    save.caches[`c${i}`] = nowT() + CACHE_REFILL;
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
        grantCoins(o.pay, new THREE.Vector3(caravan.zone.x, 1.5, caravan.zone.z), 14);
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
      gainGems(3);
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
      planDay(0);
    }
    return;
  }
  save.phaseT += dt;
  if (save.phase === 'day' && save.phaseT >= dayLen(save.day)) startNight();
  else if (save.phase === 'night') {
    const cleared = horde.remaining === 0 && save.phaseT > 10;
    if (save.phaseT >= nightLen(save.day) || cleared) startDay();
  }
}

/**
 * Eclair au sommet des tours quand elles tirent : on voit qu'elles defendent le camp.
 * Un seul halo par tour (cle = la bouche de la tour, un vecteur cree une fois) : seuls les
 * tirs de tour l'appellent, jamais l'arme du joueur.
 */
const towerFlashes = new Map<THREE.Vector3, THREE.Sprite>();
function towerFlash(at: THREE.Vector3): void {
  let s = towerFlashes.get(at);
  if (!s) {
    s = glow(0xffd27a, 2.4);
    (s.material as THREE.SpriteMaterial).fog = false;
    scene.add(s);
    towerFlashes.set(at, s);
  }
  s.position.copy(at);
  s.visible = true;
  (s.material as THREE.SpriteMaterial).opacity = 1;
}
function fadeTowerFlashes(dt: number): void {
  for (const s of towerFlashes.values()) {
    const m = s.material as THREE.SpriteMaterial;
    if (m.opacity > 0) m.opacity = Math.max(0, m.opacity - dt * 7);
    s.visible = m.opacity > 0;
  }
}

function shoot(z: Zombie, from: THREE.Vector3, dmg: number, light = true, isTower = false): void {
  const hit = horde.damage(z, dmg, from);
  if (!hit) return;
  tracers.fire(from, hit.pos, isTower ? 0.14 : 0.09);
  if (isTower) towerFlash(from);
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
    if (z.brute) drops.spawn(hit.pos, 10, Math.min(12, 2 + Math.floor(threat() / 2)));
    else if (Math.random() < 0.5) drops.spawn(hit.pos, 1, Math.min(5, 1 + Math.floor(threat() / 4)));
  } else {
    particles.burst(hit.pos, hit.colors, 5, { speed: 3, up: 2, size: 0.12, life: 0.5 });
  }
}

function updateCombat(dt: number): void {
  fireClock -= dt;
  towerClock -= dt;
  fadeTowerFlashes(dt);
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
      shoot(tz, tower.muzzle, 1 + Math.floor(threat() / 3) + lv('tower') + 2 * (bt('tower') - 1), false, true);
    }
  }
  // Tours d'angle (niveau du camp) : elles couvrent les flancs.
  if (night) {
    corners.forEach((c, i) => {
      if (!isBuilt(c.id)) return;
      cornerClock[i] = (cornerClock[i] ?? 0) - dt;
      if (cornerClock[i]! > 0) return;
      const cz = horde.nearest(new THREE.Vector3(c.x, 0, c.z), 15);
      if (!cz) return;
      cornerClock[i] = 0.8 / (1 + 0.08 * lv('tower'));
      // Comme la grande tour, leurs degats suivent la menace (sinon elles chatouillent la horde).
      shoot(cz, c.tower.muzzle, 1 + Math.floor(threat() / 4) + lv('tower'), false, true);
    });
    // Tours de garde de la ferme : memes tirs, toute la palissade de la ferme, jamais le camp.
    for (const t of farmTowers) {
      if (!isBuilt(t.site.id)) continue;
      t.clock -= dt;
      if (t.clock > 0) continue;
      const fz = horde.nearest(t.at, FARM_TOWER_RANGE, FARM_TOWER_MAXX);
      if (!fz) continue;
      t.clock = 0.8 / (1 + 0.08 * lv('tower'));
      shoot(fz, t.tower.muzzle, 1 + Math.floor(threat() / 4) + lv('tower'), false, true);
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
      setPanel(null); // le panneau (reserve, etabli) se ferme : plus rien a toucher pendant le K.O.
      const lost = player.stack.clear();
      pendingIn = 0;
      document.body.classList.add('ko');
      buzz(120);
      if (lost.length >= 3) offerKeepBag(lost);
      else toast('💫 K.O. !');
    }
  } else if (contacts === 0) {
    player.hp = Math.min(player.maxHp, player.hp + dt * (save.phase === 'night' ? 4 : 20) * (isBuilt('infirmary') ? 2.5 : 1));
  }
}

// ================================================================ victoire et hors ligne

let victoryT = 0;
function startVictory(): void {
  save.won = true;
  save.wonDay = save.day;
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
    <p class="muted">Le camp continue : envoie des convois vers la Ville depuis l’arrêt du bus. Chacun rapporte des gemmes et de la renommée (+3 % sur les ventes).</p>`, () => {
    bus.driving = 0;
    bus.root.position.set(L.bus.x, 0, L.bus.z);
  });
  sfx.sfxVictory();
  for (let i = 0; i < 3; i++) setTimeout(() => particles.burst(player.position.clone().setY(3), [0xffd84a, 0xff8fb1, 0x8be36b, 0x6fd3ff], 60, { speed: 8, up: 9, size: 0.2, life: 1.6 }), i * 300);
}

// ---- hors ligne : une simulation de la production, pas un forfait (voir offline.ts)

/** Absence comptee au plus : 2 h, +1 h par niveau de contremaitre, +2 h avec l'entrepot, +1 h par relais radio, +15 min par niveau de reserve. */
/**
 * Hors ligne : un coup de pouce, jamais mieux que jouer. Rendement 15 % (+1,5 % par niveau de
 * contremaitre), absence comptee 1 h (+30 min par niveau, entrepot, relais radio, reserve),
 * et un plafond de pieces de l'ordre de 6 a 10 minutes de jeu actif.
 */
const maxAway = () => Math.min(12 * 3600, (1 + 0.5 * lv('foreman') + (isBuilt('warehouse') ? 1 : 0) + ct('radio')) * 3600 + 900 * lv('reserve'));
const offlineEff = () => 0.15 + 0.015 * lv('foreman');
const offlineCoinCap = () => Math.round((packCoins() * 1.5 * (1 + 0.1 * lv('foreman'))) / 10) * 10;

function fmtDur(secs: number): string {
  const m = Math.round(secs / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`;
}

/** Au retour, le monde a continue : cultures mures, epaves et roches de nouveau pleines. */
function catchUpWorld(gap: number): void {
  for (const b of beds) b.update(gap, 0);
  for (const s of scraps) s.amount = s.max;
  for (const r of rocks) r.amount = r.max;
  for (const u of pumps) u.amount = u.max;
}

function offlineGains(): void {
  const now = Date.now();
  const last = save.lastSeen;
  save.lastSeen = now;
  // Horloge du telephone reculee (ou avancee puis remise) : rien n'est compte.
  if (now < save.clockHigh - 120000 || now <= last) {
    if (save.pendingOffline) showOffline();
    return;
  }
  const gap = (now - last) / 1000;
  if (gap >= 60) catchUpWorld(gap);
  const jobs: Record<string, boolean> = {};
  for (const h of helpers) jobs[h.job] = true;
  const bins: Partial<Record<ItemType, number>> = {};
  for (const b of market.bins.bins) if (b.count > 0) bins[b.type] = b.count;
  if (gap >= 60 && (helpers.length > 0 || market.bins.total > 0)) {
    const unlocked = beds.filter((b) => b.unlocked);
    const fieldW = unlocked.filter((b) => b.kind === 'wheat').length * 2.5;
    const r = simulateOffline({
      away: gap, maxAway: maxAway(), eff: offlineEff(), jobs, shelterOk: !isBroken('shelter'),
      wheatShare: fieldW / Math.max(1, fieldW + unlocked.filter((b) => b.kind !== 'wheat').length),
      conv: { saw: saw.built, cook: cook.built, mill: mill.built, forge: forge.built },
      bins, sellMul: sellMul() / (boostOn('sell') ? 2 : 1), crewMul: crewMul(),
      cashCap: 250 + 50 * lv('stall'), reserveRoom: Math.max(0, reserve.cap - reserve.total),
      // Un rapport pas encore encaisse compte deja dans le plafond : les bacs ne se vident pas pour rien.
      coinCap: Math.max(0, offlineCoinCap() - (save.pendingOffline?.coins ?? 0)), itemCap: 40 + 8 * lv('foreman'),
      cycleLen: save.cycle ? dayLen(save.day) + nightLen(save.day) : 0,
    });
    // Les objets sont ranges tout de suite ; seules les pieces attendent qu'on les encaisse.
    for (const [t, n] of Object.entries(r.binsSold) as [ItemType, number][]) for (let i = 0; i < n; i++) market.bins.take(t);
    for (const [t, n] of Object.entries(r.items) as [ItemType, number][]) for (let i = 0; i < n; i++) reserve.add(t);
    if (r.nights > 0) {
      for (const pl of allWalls()) {
        for (const sct of pl.sections) {
          if (!sct.enabled) continue;
          const floor = Math.min(sct.hp, unitHp(sct));
          pl.setHp(sct, Math.max(floor, sct.hp - sct.max * 0.12 * r.nights));
        }
      }
    }
    const got = r.coins > 0 || Object.keys(r.items).length > 0;
    if (got) {
      const p = save.pendingOffline;
      const { binsSold: _sold, ...rep } = r;
      void _sold;
      save.pendingOffline = p ? {
        ...rep, coins: p.coins + rep.coins, secs: p.secs + rep.secs, away: p.away + rep.away, nights: p.nights + rep.nights, wear: p.wear + rep.wear,
        items: mergeItems(p.items, rep.items),
      } : rep;
    }
  }
  persist();
  if (save.pendingOffline) showOffline();
}

function mergeItems(a: Partial<Record<ItemType, number>>, b: Partial<Record<ItemType, number>>): Partial<Record<ItemType, number>> {
  const out = { ...a };
  for (const [t, n] of Object.entries(b) as [ItemType, number][]) out[t] = (out[t] ?? 0) + n;
  return out;
}

/** Encaisse les gains hors ligne (une seule fois), eventuellement doubles par une pub. */
function claimOffline(mult: number): void {
  const r = save.pendingOffline;
  if (!r) return;
  save.pendingOffline = undefined;
  const n = r.coins * mult;
  // Pas dans les statistiques : l'absence ne fait pas avancer les quetes du jour.
  save.coins += n;
  flyCoins(n, above(), playerChest, () => { sfx.sfxCoin(); bump(ui.moneyPill); }, mult > 1 ? 16 : 12);
  persist();
}

function showOffline(): void {
  const r = save.pendingOffline;
  if (!r || ui.modal.classList.contains('show')) return;
  const items = (Object.entries(r.items) as [ItemType, number][]).filter(([, n]) => n > 0)
    .map(([t, n]) => `<span>${ITEMS[t].icon}<b>${n}</b></span>`).join('');
  const canDouble = r.coins >= 100 && r.secs >= 900 && adLeft('offline') > 0;
  showModal(`
    <div class="modal-big">⛺</div>
    <h2>Bon retour !</h2>
    <p class="muted">Absent ${fmtDur(r.away)}${r.away > r.secs + 60 ? ` · ${fmtDur(r.secs)} comptées` : ''} · rendement ${Math.round(r.eff * 100)} %</p>
    ${r.coins > 0 ? `<div class="modal-gain"><span class="coin big"></span>${r.coins}</div>` : ''}
    ${items ? `<p>Rangé dans la réserve :</p><div class="offline-items">${items}</div>` : ''}
    ${r.nights > 0 ? `<p class="muted">🌙 ${r.nights} nuit${r.nights > 1 ? 's' : ''} : la palissade a tenu, mais elle est abîmée.</p>` : ''}
    ${r.tip ? `<p class="tip">${r.tip}</p>` : ''}
    ${canDouble ? `<button class="btn ad" data-double>📺 Doubler : ${r.coins * 2} pièces</button>` : ''}`, () => claimOffline(1));
  let busy = false;
  ui.modal.querySelector('[data-double]')?.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void rewarded('offline', 'gains hors ligne doublés').then((ok) => {
      busy = false;
      if (!ok || !save.pendingOffline) return;
      ui.modal.classList.remove('show');
      claimOffline(2);
    });
  });
}

// ================================================================ sauvegarde

const CONVS: Record<string, Converter> = { saw, cook, mill, forge };

function persist(): void {
  if (resetting) return;
  save.lastSeen = Date.now();
  save.clockHigh = Math.max(save.clockHigh, save.lastSeen);
  save.walls = palisade.hpList();
  if (farmWall) save.farmWalls = farmWall.hpList();
  const bins: Partial<Record<ItemType, number>> = {};
  for (const b of market.bins.bins) if (b.count > 0) bins[b.type] = b.count;
  const res: Partial<Record<ItemType, number>> = {};
  for (const [t, n] of reserve.counts) if (n > 0) res[t] = n;
  const conv: Record<string, [ItemType[], ItemType[]]> = {};
  for (const [k, c] of Object.entries(CONVS)) conv[k] = [c.input.pieces.map((x) => x.type), c.output.pieces.map((x) => x.type)];
  save.stock = { bag: player.stack.slots.map((x) => x.type), reserve: res, bins, cash: market.cash, conv };
  writeSave(save);
}

/** Au lancement : on remet le sac, la reserve, les bacs, la caisse et les machines comme on les a laisses. */
function restoreStock(): void {
  const st = save.stock;
  if (!st) return;
  const ok = (t: string): t is ItemType => t in ITEMS;
  for (const t of st.bag ?? []) if (ok(t) && player.stack.count < player.stack.cap) player.stack.add(t);
  for (const [t, n] of Object.entries(st.reserve ?? {})) if (ok(t)) for (let i = 0; i < (n ?? 0); i++) reserve.add(t);
  for (const [t, n] of Object.entries(st.bins ?? {})) if (ok(t)) for (let i = 0; i < Math.min(BIN_CAP, n ?? 0); i++) market.bins.add(t);
  if (st.cash > 0) market.addCash(Math.round(st.cash));
  for (const [k, [inp, out]] of Object.entries(st.conv ?? {})) {
    const c = CONVS[k];
    if (!c) continue;
    for (const t of inp ?? []) if (ok(t) && !c.input.full) c.input.add(t);
    for (const t of out ?? []) if (ok(t) && !c.output.full) c.output.add(t);
  }
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
  LOOK.rim.value.copy(lerpC(DAY.rim, NIGHT.rim)).lerp(DUSK_RIM, dusk * (1 - t) * 0.6);

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
  setText(ui.money, fmt(shownCoins));
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
  if (isBuilt('quarry')) list.push('stone');
  if (isBuilt('foundry')) list.push('metal');
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
  const contacts = horde.update(dt, player.position, zombieWalls, world.solids, nightK, allWalls(), onWallHit, navZombies, STRUCTS, onStructHit);
  palisade.update(dt, save.cycle && save.phase === 'night', time);
  farmWall?.update(dt, save.cycle && save.phase === 'night', time);
  hurt(dt, contacts);
  drops.update(dt, player.position, (v) => earn(v));

  for (const b of beds) b.update(dt, time);
  restorer.update(dt);
  for (const t of trees) t.update(dt);
  for (const s of scraps) s.update(dt);
  for (const u of pumps) u.update(dt);
  for (const r of rocks) r.update(dt);
  if (forge.update(dt, time)) save.stats.metal++;
  B.foundry!.anim?.(dt, time, forge.busy);
  if (saw.update(dt, time)) save.stats.planks++;
  if (cook.update(dt, time)) save.stats.soup++;
  if (mill.update(dt, time)) save.stats.bread++;
  reserve.update(dt, time);
  B.sawmill!.anim?.(dt, time, saw.busy);
  B.kitchen!.anim?.(dt, time, cook.busy);
  B.mill!.anim?.(dt, time, mill.busy);
  bus.update(dt, time);
  updateConvoy();

  const open = !save.cycle || save.phase === 'day';
  const sales = market.update(dt, open, productsList(), (from, to, t) => {
    flyers.launch(itemMesh(t), from, () => to, () => undefined, 0.3, 0.8);
  });
  for (const s of sales) {
    save.stats.sold++;
    sfx.sfxSell();
    const pay = Math.round(s.pay * sellMul());
    floatText(`+${fmt(pay)}`, s.at.x, s.at.y + 0.4, s.at.z, 'small');
    flyCoins(pay, s.at, () => market.cashWorld(), (n) => market.addCash(n), 6);
  }

  nav.northOpen = isBuilt('gate');
  helperCtx.dockReady = isBuilt('dock');
  updateEvents(dt, time);
  // Abri demoli : les survivants n'ont plus de toit et restent pres du feu.
  helperCtx.night = (save.cycle && save.phase === 'night') || isBroken('shelter');
  const cdt = dt * crewMul();
  for (const h of helpers) h.update(cdt, helperCtx);
  updateHunters(dt);
  drainHints();

  flyers.update(dt);
  particles.update(dt);
  tracers.update(dt);
  advanceObjectives();

  for (const pad of pads) {
    const show = !isBuilt(pad.def.id) && save.obj >= pad.def.after && (!HOUSED.includes(pad.def.id) || freeHouse());
    if (!show && pad.shown && !isBuilt(pad.def.id) && pad.inflight === 0) {
      // Plus de maison libre : la zone disparait (ce qui a ete paye reste acquis).
      pad.shown = false;
      pad.ring.visible = false;
      pad.fill.visible = false;
      pad.label.classList.add('off');
    }
    if (show && !pad.shown) {
      pad.shown = true;
      pad.appear = 0;
      pad.ring.visible = true;
      pad.fill.visible = true;
      renderPad(pad);
    }
    if (!pad.shown || isBuilt(pad.def.id)) continue;
    if (pad.inflight === 0 && totalCost(remaining(pad)) === 0) { build(pad); continue; }
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
/**
 * Compile d'avance tous les shaders, y compris ceux de ce qui est encore cache (batiments en
 * ruine, zombies, evenements, etats de la palissade) : sinon chaque premiere apparition
 * fige le jeu un instant sur un telephone sans compilation en parallele.
 */
function precompile(): void {
  const shown: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (o.visible || (o as THREE.Light).isLight) return;
    o.visible = true;
    shown.push(o);
  });
  try {
    renderer.compile(scene, camera);
  } catch (err) {
    console.error(err);
  }
  for (const o of shown) o.visible = false;
}

// ---- resolution adaptative : moyenne des images sur 2 s ; deux fenetres lentes de suite
// (> 19 ms, moins de 50 i/s) font baisser la resolution d'un cran, trois fenetres tres
// rapides (< 14 ms) la remontent. Rien ne change sur un telephone qui tient la cadence.
let prLevel = 0;
let perfAcc = 0;
let perfN = 0;
let perfLast = 0;
let perfSlow = 0;
let perfFast = 0;
const perfStart = performance.now();
function adaptResolution(): void {
  const now = performance.now();
  const d = now - perfLast;
  perfLast = now;
  // Pas de mesure pendant le chargement, sous une fenetre, ni apres une pause de l'appli.
  if (d <= 0 || d > 100 || now - perfStart < 5000 || paused()) return;
  perfAcc += d;
  perfN++;
  if (perfAcc < 2000) return;
  const avg = perfAcc / perfN;
  perfAcc = 0;
  perfN = 0;
  perfSlow = avg > 19 ? perfSlow + 1 : 0;
  perfFast = avg < 14 ? perfFast + 1 : 0;
  let next = prLevel;
  if (perfSlow >= 2 && prLevel < PR_STEPS.length - 1) next = prLevel + 1;
  else if (perfFast >= 3 && prLevel > 0) next = prLevel - 1;
  if (next === prLevel) return;
  prLevel = next;
  perfSlow = 0;
  perfFast = 0;
  renderer.setPixelRatio(PR_STEPS[prLevel]!);
  resize();
}

let frameErrors = 0;
function frame(): void {
  // On reprogramme d'abord : une erreur dans une image ne doit jamais figer le jeu.
  requestAnimationFrame(frame);
  try {
    drawFrame();
  } catch (err) {
    frameErrors++;
    if (frameErrors < 5) console.error(err);
    // Erreur avant la toute premiere image : on la remonte au diagnostic de demarrage.
    if (firstFrame && frameErrors === 1) setTimeout(() => { throw err; });
  }
}

/** Le jeu est en pause sous une fenetre (radio, retour, pub, boutique). */
function paused(): boolean {
  return ui.modal.classList.contains('show') || ui.shop.classList.contains('show') || !!document.querySelector('.ad-layer.show');
}

function drawFrame(): void {
  // La premiere image est notee comme une etape : si elle bloque, on le saura.
  if (firstFrame) boot('premiere image');
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;
  // Les tests automatiques peuvent accelerer la simulation.
  if (!paused()) for (let i = 0; i < SIM.scale; i++) step(dt, time);

  nightK = damp(nightK, save.cycle && save.phase === 'night' ? 1 : 0, 1.6, dt * SIM.scale);
  const dusk = save.cycle && save.phase === 'day' ? Math.max(0, (save.phaseT - (dayLen(save.day) - 20)) / 20) : 0;
  applyLighting(nightK, dusk, time);

  if (world.water?.bumpMap) world.water.bumpMap.offset.set(time * 0.018, time * 0.011);
  for (const s of world.swayers) {
    s.o.rotation.z = Math.sin(time * 1.6 + s.phase) * s.amp;
    s.o.rotation.x = Math.cos(time * 1.3 + s.phase) * s.amp * 0.6;
  }
  for (const f of world.flames) {
    f.scale.set(1 + Math.sin(time * 17) * 0.08, 1 + Math.sin(time * 11) * 0.18, 1 + Math.cos(time * 15) * 0.08);
    f.rotation.y += dt * 2;
  }

  // Guidage vers l'objectif en cours.
  // Recrutement bloque faute de maison : on guide vers l'agrandissement du camp.
  const blk = objectiveBlock();
  if ((blk?.text ?? '') !== objBlocked) renderObjective();
  const tgt = blk ? blk.at : currentObjective()?.target() ?? null;
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
  placeFloaters(dt);
  placeEventLabels();
  placeCrew(dt);
  placeHunters(dt);
  for (const dp of dynPads.values()) placeLabel(dp.label, dp.x, 0.3, dp.z - 1.4);
  // Palissade : une seule etiquette, celle du troncon abime le plus proche.
  let wallLabel: Section | null = repairTarget;
  const wl = allWalls();
  if (!wallLabel) {
    let bd = 7;
    for (const pl of wl) {
      for (const s of pl.sections) {
        if (!s.enabled || s.hp >= s.max) continue;
        const d = pl.distanceTo(s, player.position.x, player.position.z);
        if (d < bd) { bd = d; wallLabel = s; }
      }
    }
  }
  for (const pl of wl) {
    for (const s of pl.sections) {
      if (s !== wallLabel) { s.label.classList.add('off'); continue; }
      const html = `${ITEMS[pl.repairItem].icon} ${logsNeeded(s)}`;
      if (s.label.innerHTML !== html) s.label.innerHTML = html;
      s.label.classList.toggle('broken', s.hp <= 0);
      s.label.classList.toggle('active', s === repairTarget);
      placeLabel(s.label, s.x, wallTop(s, 2.2, 3.4), s.z);
    }
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

  adaptResolution();
  // Sauvegarde reguliere, en temps reel (independante de la fluidite).
  if (performance.now() - lastPersist > 4000) { lastPersist = performance.now(); persist(); }
}

// ---------------------------------------------------------------- demarrage

boot('restauration de la partie');
beds[0]!.unlock();
// Le camp a sa taille avant qu'on relise l'etat de chaque troncon.
applyCampLevel(true);
{
  palisade.setTier(save.wallTier);
  palisade.setLevel(save.up.wall + (save.campLv >= 4 ? 1 : 0));
  const full = palisade.sections.map((s) => s.max);
  // Une sauvegarde plus ancienne a moins de troncons (l'etal a ete ajoute en dernier) : on
  // reprend ce qu'elle connait, le reste est intact.
  const saved = save.walls && save.walls.length > 0 && save.walls.length <= palisade.sections.length ? save.walls : null;
  const hp = saved ? palisade.sections.map((s, i) => saved[i] ?? s.max) : save.campLv > 1 ? full : palisade.initialHp();
  palisade.sections.forEach((s, i) => palisade.setHp(s, hp[i]!));
}
for (const id of save.built) applyBuild(id, true);
// Ce que les zombies avaient demoli reste en ruine jusqu'a reparation.
for (const id of [...save.broken]) wreck(id, true);
// La ferme fortifiee et l'etat de ses troncons (une liste d'une autre longueur : intacte).
applyFarmWall(true);
{
  // (cast : l'analyse de flux ne voit pas l'affectation faite par applyFarmWall)
  const fw = farmWall as Palisade | null;
  const hp = save.farmWalls;
  if (fw && hp && hp.length === fw.sections.length) fw.sections.forEach((s, i) => fw.setHp(s, hp[i] ?? s.max));
}
for (const b of TIERABLE) {
  if (!isBuilt(b.id) || bt(b.id) <= 1) continue;
  try { applyBuildingTier(b.id); } catch (err) { console.error(err); }
}
applyUpgrades();
equipWeapon((WEAPONS.find((x) => x.id === save.weapon)?.id ?? 'rifle') as WeaponId);
wearOutfit(save.outfit);
applyMeta(0);
try { restoreStock(); } catch (err) { console.error(err); }
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
  horde.startNight(threat());
  document.body.classList.add('night');
} else if (save.cycle) planDay(save.phaseT / dayLen(save.day));
if (save.convoyAt > 0) bus.root.visible = false;
boot('gains hors ligne');
offlineGains();
boot('shaders');
precompile();
requestAnimationFrame(frame);

// Acces pour les tests automatiques.
(window as unknown as { __bastion: unknown }).__bastion = {
  player, save: () => save, SIM, market, beds, pads, horde, trees, scraps, helpers, saw, cook, palisade,
  renderer, reserve, pumps, fields, mill,
  farm: () => farmWall, farmTowers,
  hunters, merc: () => merc, hireHunter, setHuntZone, huntPost, huntDmg, renderHunters,
  give: (n: number) => { save.coins += n; },
  build: (id: string) => { const p = pads.find((x) => x.def.id === id); if (p) { save.paid[id] = { ...p.def.cost }; build(p); } },
  setObj: (n: number) => { save.obj = n; renderObjective(); },
  night: () => { save.cycle = true; save.phase = 'day'; save.phaseT = dayLen(save.day); },
};
