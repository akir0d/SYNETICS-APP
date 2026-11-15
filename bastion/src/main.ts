import '@fontsource/baloo-2/latin-600.css';
import '@fontsource/baloo-2/latin-800.css';
import './style.css';
import * as THREE from 'three';
import * as sfx from './audio';
import { Particles, Tracers } from './fx';
import { damp, easeOutBack, glow } from './kit';
import { MAX_STACK, Player } from './player';
import { bakeStatic } from './bake';
import { buildWorld, logMesh } from './world';
import { Horde } from './zombies';

// ---------------------------------------------------------------- rendu

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 200);

const DAY = {
  sky: new THREE.Color(0xa9dcf2), hemiSky: new THREE.Color(0xfff1dc), hemiGround: new THREE.Color(0x7aa04a),
  hemi: 1.7, sunColor: new THREE.Color(0xffe2b8), sun: 2.7, fogNear: 14, fogFar: 70, exposure: 1.05,
};
const NIGHT = {
  sky: new THREE.Color(0x0c1526), hemiSky: new THREE.Color(0x30487a), hemiGround: new THREE.Color(0x0b1220),
  hemi: 0.55, sunColor: new THREE.Color(0x9db8ff), sun: 0.45, fogNear: -2, fogFar: 20, exposure: 1.1,
};

scene.background = DAY.sky.clone();
scene.fog = new THREE.Fog(DAY.sky.clone(), DAY.fogNear, DAY.fogFar);
const hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
scene.add(hemi);
const sun = new THREE.DirectionalLight(DAY.sunColor, DAY.sun);
const SUN_OFFSET = new THREE.Vector3(-14, 22, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -24;
sun.shadow.camera.right = 24;
sun.shadow.camera.top = 24;
sun.shadow.camera.bottom = -24;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const world = buildWorld(scene);
{
  // Tout ce qui bouge ou s'allume reste a part ; le reste est fusionne.
  const keep = new Set<THREE.Object3D>([world.greenhouse, world.tower, world.woodPile.logs[0]!.parent!, ...world.flames, ...world.swayers.map((s) => s.o)]);
  const n = bakeStatic(scene, keep);
  console.info(`decor fusionne : ${n} maillages`);
}
const player = new Player();
player.position.set(0, 0, 6);
player.heading = Math.PI;
scene.add(player.root);
const particles = new Particles(scene);
const tracers = new Tracers(scene);
const horde = new Horde(scene, 10);
const muzzle = new THREE.PointLight(0xffc870, 0, 9, 1.8);
scene.add(muzzle);

// Lucioles : de petites lumieres qui flottent au-dessus de l'herbe la nuit.
const fireflies = Array.from({ length: 26 }, (_, i) => {
  const s = glow(0xd8ff7a, 0.45);
  const a = (i / 26) * Math.PI * 2;
  const d = 14 + (i % 5) * 3;
  s.userData = { x: Math.cos(a) * d, z: Math.sin(a) * d * 0.8, ph: i * 1.7 };
  scene.add(s);
  return s;
});

// ---------------------------------------------------------------- interface

const ui = {
  wood: document.querySelector<HTMLElement>('.wood b')!,
  woodPill: document.querySelector<HTMLElement>('.wood')!,
  toggle: document.querySelector<HTMLButtonElement>('.daynight')!,
  sound: document.querySelector<HTMLButtonElement>('.sound')!,
  toast: document.querySelector<HTMLElement>('.toast')!,
  hint: document.querySelector<HTMLElement>('.hint')!,
  joy: document.querySelector<HTMLElement>('.joy')!,
  knob: document.querySelector<HTMLElement>('.joy-knob')!,
  labels: document.querySelector<HTMLElement>('.labels')!,
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

// ---------------------------------------------------------------- zones a debloquer

interface Pad {
  name: string;
  icon: string;
  x: number;
  z: number;
  cost: number;
  paid: number;
  building: THREE.Group;
  solid: { x: number; z: number; r: number };
  built: boolean;
  buildT: number;
  ring: THREE.Mesh;
  fill: THREE.Mesh;
  label: HTMLElement;
  pulse: number;
}

const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
const fillMat = new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.85, depthWrite: false });

function makePad(name: string, icon: string, x: number, z: number, cost: number, building: THREE.Group, solidR: number): Pad {
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.4, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.04, z);
  scene.add(ring);
  const fill = new THREE.Mesh(new THREE.RingGeometry(0.2, 1.1, 48, 1, Math.PI / 2, 0.0001), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.set(x, 0.045, z);
  scene.add(fill);
  const label = document.createElement('div');
  label.className = 'pad-label';
  ui.labels.appendChild(label);
  const pad: Pad = { name, icon, x, z, cost, paid: 0, building, solid: { x: building.position.x, z: building.position.z, r: solidR }, built: false, buildT: 0, ring, fill, label, pulse: 0 };
  renderPadLabel(pad);
  return pad;
}

function renderPadLabel(p: Pad): void {
  p.label.innerHTML = `<span class="pl-icon">${p.icon}</span><span class="pl-name">${p.name}</span><span class="pl-cost">🪵 ${p.paid}/${p.cost}</span>`;
  p.fill.geometry.dispose();
  p.fill.geometry = new THREE.RingGeometry(0.2, 1.1, 48, 1, Math.PI / 2, Math.max(0.0001, (p.paid / p.cost) * Math.PI * 2));
}

const pads: Pad[] = [
  makePad('Serre', '🌱', 6.5, -6, 8, world.greenhouse, 2.4),
  makePad('Tour de guet', '🔦', 9.4, 6, 12, world.tower, 1.5),
];

const pileRing = new THREE.Mesh(new THREE.RingGeometry(1.75, 2.0, 48), ringMat);
pileRing.rotation.x = -Math.PI / 2;
pileRing.position.set(world.woodPile.x, 0.04, world.woodPile.z);
scene.add(pileRing);
const pileLabel = document.createElement('div');
pileLabel.className = 'pad-label small';
pileLabel.innerHTML = '<span class="pl-icon">🪵</span><span class="pl-name">Bois</span>';
ui.labels.appendChild(pileLabel);

// Objets en vol : rondins qui passent du tas au dos, puis du dos au chantier.
interface Flyer { obj: THREE.Object3D; from: THREE.Vector3; to: () => THREE.Vector3; t: number; dur: number; spin: number; done: () => void }
const flyers: Flyer[] = [];

function fly(from: THREE.Vector3, to: () => THREE.Vector3, dur: number, done: () => void): void {
  const obj = logMesh();
  obj.scale.setScalar(0.62);
  obj.position.copy(from);
  scene.add(obj);
  flyers.push({ obj, from: from.clone(), to, t: 0, dur, spin: (Math.random() - 0.5) * 8, done });
}

function updateFlyers(dt: number): void {
  for (let i = flyers.length - 1; i >= 0; i--) {
    const f = flyers[i]!;
    f.t += dt;
    const k = Math.min(1, f.t / f.dur);
    const to = f.to();
    f.obj.position.lerpVectors(f.from, to, k);
    f.obj.position.y += Math.sin(k * Math.PI) * 1.4;
    f.obj.rotation.y += f.spin * dt;
    if (k >= 1) {
      scene.remove(f.obj);
      flyers.splice(i, 1);
      f.done();
    }
  }
}

let pending = 0; // rondins en vol vers le dos
let pickupClock = 0;
let dropClock = 0;

function stackTop(): THREE.Vector3 {
  const v = new THREE.Vector3(0, 1.45 + (player.stack.length + pending) * 0.25 * 0.62, -0.42);
  v.applyAxisAngle(new THREE.Vector3(0, 1, 0), player.heading);
  return v.add(player.position);
}

function updateZones(dt: number): void {
  const p = player.position;
  const nearPile = Math.hypot(p.x - world.woodPile.x, p.z - world.woodPile.z) < 2.25;
  pickupClock -= dt;
  if (nearPile && pickupClock <= 0 && player.stack.length + pending < MAX_STACK) {
    pickupClock = 0.11;
    pending++;
    const top = world.woodPile.logs[world.woodPile.logs.length - 1]!;
    const from = new THREE.Vector3();
    top.getWorldPosition(from);
    top.parent!.scale.setScalar(0.92);
    fly(from, stackTop, 0.22, () => {
      pending--;
      const log = player.pushLog();
      if (log) {
        log.scale.setScalar(0.85);
        sfx.sfxPickup(player.stack.length);
        buzz(6);
        bump(ui.woodPill);
      }
    });
  }
  const pile = world.woodPile.logs[0]!.parent!;
  pile.scale.setScalar(damp(pile.scale.x, 1, 14, dt));
  for (const log of player.stack) log.scale.setScalar(damp(log.scale.x, 0.62, 18, dt));

  dropClock -= dt;
  for (const pad of pads) {
    if (pad.built) continue;
    const on = Math.hypot(p.x - pad.x, p.z - pad.z) < 1.5;
    if (on && dropClock <= 0 && player.stack.length > 0 && pad.paid < pad.cost) {
      dropClock = 0.09;
      const from = player.popLog();
      if (from) {
        const target = new THREE.Vector3(pad.x, 0.2, pad.z);
        const pd = pad;
        pd.paid++;
        const n = pd.paid;
        fly(from, () => target, 0.26, () => {
          renderPadLabel(pd);
          pd.pulse = 1;
          sfx.sfxDrop(n);
          buzz(5);
          if (n >= pd.cost) build(pd);
        });
      }
    }
    pad.pulse = Math.max(0, pad.pulse - dt * 4);
    const s = 1 + pad.pulse * 0.12 + (on ? 0.05 : 0);
    pad.ring.scale.set(s, s, s);
    pad.fill.scale.set(s, s, s);
  }
  ui.wood.textContent = `${player.stack.length}/${MAX_STACK}`;
}

let shake = 0;

function build(pad: Pad): void {
  pad.built = true;
  pad.buildT = 0;
  pad.building.visible = true;
  pad.label.style.display = 'none';
  scene.remove(pad.ring, pad.fill);
  world.solids.push(pad.solid);
  sfx.sfxBuild();
  buzz(40);
  shake = 0.35;
  const at = new THREE.Vector3(pad.building.position.x, 1.5, pad.building.position.z);
  particles.burst(at, [0xffd84a, 0xffffff, 0x8be36b, 0xff8fb1], 70, { speed: 7, up: 7, size: 0.18, life: 1.1 });
  toast(`${pad.icon} ${pad.name} construite !`);
}

function updateBuildings(dt: number): void {
  for (const pad of pads) {
    if (!pad.built || pad.buildT >= 1) continue;
    pad.buildT = Math.min(1, pad.buildT + dt * 1.5);
    const k = easeOutBack(pad.buildT);
    pad.building.scale.set(1 + (1 - k) * 0.3, Math.max(0.001, k), 1 + (1 - k) * 0.3);
  }
}

// ---------------------------------------------------------------- jour / nuit

let night = false;
let nightK = 0;

ui.toggle.addEventListener('click', () => {
  night = !night;
  ui.toggle.textContent = night ? '☀️' : '🌙';
  ui.toggle.classList.toggle('is-night', night);
  document.body.classList.toggle('night', night);
  horde.setActive(night);
  player.armed = night;
  sfx.sfxToggle(night);
  toast(night ? '🌙 La nuit tombe… ils arrivent' : '☀️ Le jour se lève');
});

ui.sound.addEventListener('click', () => {
  sfx.setMuted(!sfx.muted);
  ui.sound.textContent = sfx.muted ? '🔇' : '🔊';
});

const tmpC = new THREE.Color();
function applyLighting(t: number, time: number): void {
  const lerpC = (a: THREE.Color, b: THREE.Color) => tmpC.copy(a).lerp(b, t);
  (scene.background as THREE.Color).copy(lerpC(DAY.sky, NIGHT.sky));
  const fog = scene.fog as THREE.Fog;
  fog.color.copy(scene.background as THREE.Color);
  // Le brouillard se mesure depuis la camera : on le cale sur sa distance au joueur.
  fog.near = camDist + DAY.fogNear + (NIGHT.fogNear - DAY.fogNear) * t;
  fog.far = camDist + DAY.fogFar + (NIGHT.fogFar - DAY.fogFar) * t;
  hemi.color.copy(lerpC(DAY.hemiSky, NIGHT.hemiSky));
  hemi.groundColor.copy(lerpC(DAY.hemiGround, NIGHT.hemiGround));
  hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * t;
  sun.color.copy(lerpC(DAY.sunColor, NIGHT.sunColor));
  sun.intensity = DAY.sun + (NIGHT.sun - DAY.sun) * t;
  renderer.toneMappingExposure = DAY.exposure + (NIGHT.exposure - DAY.exposure) * t;

  for (const nl of world.nightLights) {
    const flick = nl.flicker ? 1 + Math.sin(time * 13) * nl.flicker * 0.5 + Math.sin(time * 29) * nl.flicker * 0.3 : 1;
    nl.light.intensity = (nl.day + (nl.night - nl.day) * t) * flick;
  }
  for (const g of world.glows) (g.s.material as THREE.SpriteMaterial).opacity = g.day + (g.night - g.day) * t;
  for (const m of world.bulbMats) m.emissiveIntensity = 0.15 + t * 2.2;
  const towerBuilt = pads[1]!.built;
  for (const m of world.windowMats) m.emissiveIntensity = t * 2;
  world.towerLight.intensity = towerBuilt ? t * 45 : 0;
  player.flashlight.intensity = t * 48;
  fireflies.forEach((f) => {
    const d = f.userData as { x: number; z: number; ph: number };
    f.position.set(d.x + Math.sin(time * 0.6 + d.ph) * 1.5, 0.8 + Math.sin(time * 1.7 + d.ph) * 0.4, d.z + Math.cos(time * 0.5 + d.ph) * 1.5);
    (f.material as THREE.SpriteMaterial).opacity = t * (0.5 + 0.5 * Math.sin(time * 3 + d.ph));
  });
}

// ---------------------------------------------------------------- combat

let fireClock = 0;
const gunPos = new THREE.Vector3();

function updateCombat(dt: number): void {
  fireClock -= dt;
  muzzle.intensity = Math.max(0, muzzle.intensity - dt * 400);
  const target = night ? horde.nearest(player.position, 11) : null;
  player.aiming = target;
  if (!target || fireClock > 0) return;
  fireClock = 0.3;
  const fwd = new THREE.Vector3(Math.sin(player.heading), 0, Math.cos(player.heading));
  gunPos.copy(player.position).addScaledVector(fwd, 0.9).setY(1.2);
  const hit = horde.shoot(target, player.position);
  if (!hit) return;
  tracers.fire(gunPos, hit.pos);
  muzzle.position.copy(gunPos);
  muzzle.intensity = 45;
  particles.burst(gunPos, [0xfff1a8, 0xffc870], 4, { speed: 2, up: 1, size: 0.07, life: 0.15, gravity: 0 });
  sfx.sfxShot();
  if (hit.killed) {
    particles.burst(hit.pos, hit.colors, 26, { speed: 5, up: 5, size: 0.2, life: 1.2 });
    sfx.sfxSplat();
    buzz(25);
    shake = Math.max(shake, 0.15);
  } else {
    particles.burst(hit.pos, hit.colors, 6, { speed: 3, up: 2, size: 0.12, life: 0.5 });
  }
}

// ---------------------------------------------------------------- commandes

const move = new THREE.Vector2();
const keys = new Set<string>();
let joyId: number | null = null;
const joyOrigin = new THREE.Vector2();
const joyVec = new THREE.Vector2();

window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (joyId !== null) return;
  joyId = e.pointerId;
  joyOrigin.set(e.clientX, e.clientY);
  joyVec.set(0, 0);
  ui.joy.style.left = `${e.clientX}px`;
  ui.joy.style.top = `${e.clientY}px`;
  ui.joy.classList.add('on');
  ui.knob.style.transform = 'translate(-50%, -50%)';
  ui.hint.classList.add('gone');
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
      ui.hint.classList.add('gone');
    }
  }
  if (move.length() < 0.12) move.set(0, 0);
}

// ---------------------------------------------------------------- camera et boucle

const camTarget = new THREE.Vector3();
let camDist = 30;

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // En portrait on recule la camera pour voir assez large autour du perso.
  const wantWidth = 14;
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  camDist = Math.max(22, Math.min(42, wantWidth / (2 * Math.tan(fovRad / 2) * camera.aspect)));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const CAM_DIR = new THREE.Vector3(0, 1, 0.78).normalize();
camTarget.copy(player.position);
const projected = new THREE.Vector3();

function placeLabel(el: HTMLElement, x: number, y: number, z: number): void {
  projected.set(x, y, z).project(camera);
  if (projected.z > 1) {
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  const sx = (projected.x * 0.5 + 0.5) * window.innerWidth;
  const sy = (-projected.y * 0.5 + 0.5) * window.innerHeight;
  el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
}

const clock = new THREE.Clock();
function frame(): void {
  const dt = Math.min(0.05, clock.getDelta());
  const time = clock.elapsedTime;

  readMove();
  player.update(dt, move, world.walls, world.solids, world.bounds, time);
  updateZones(dt);
  updateFlyers(dt);
  updateBuildings(dt);
  updateCombat(dt);
  const contact = horde.update(dt, player.position, world.walls, nightK);
  if (contact > 0) shake = Math.max(shake, 0.08);
  particles.update(dt);
  tracers.update(dt);

  nightK = damp(nightK, night ? 1 : 0, 2.2, dt);
  applyLighting(nightK, time);

  for (const s of world.swayers) {
    s.o.rotation.z = Math.sin(time * 1.6 + s.phase) * s.amp;
    s.o.rotation.x = Math.cos(time * 1.3 + s.phase) * s.amp * 0.6;
  }
  for (const f of world.flames) {
    f.scale.set(1 + Math.sin(time * 17) * 0.08, 1 + Math.sin(time * 11) * 0.18, 1 + Math.cos(time * 15) * 0.08);
    f.rotation.y += dt * 2;
  }
  pileRing.scale.setScalar(1 + Math.sin(time * 3) * 0.03);

  // Camera qui suit en douceur, avec un leger tremblement sur les gros evenements.
  camTarget.x = damp(camTarget.x, player.position.x, 5, dt);
  camTarget.z = damp(camTarget.z, player.position.z, 5, dt);
  shake = Math.max(0, shake - dt);
  camera.position.copy(camTarget).addScaledVector(CAM_DIR, camDist);
  camera.position.x += (Math.random() - 0.5) * shake * 0.8;
  camera.position.y += (Math.random() - 0.5) * shake * 0.8;
  camera.lookAt(camTarget.x, 0.8, camTarget.z);

  sun.position.copy(camTarget).add(SUN_OFFSET);
  sun.target.position.copy(camTarget);

  for (const pad of pads) if (!pad.built) placeLabel(pad.label, pad.x, 0.3, pad.z - 1.5);
  placeLabel(pileLabel, world.woodPile.x, 2.3, world.woodPile.z);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Pour les captures automatiques.
(window as unknown as { __bastion: unknown }).__bastion = { player, toggle: () => ui.toggle.click(), build: (i: number) => { const p = pads[i]!; p.paid = p.cost; renderPadLabel(p); build(p); } };
