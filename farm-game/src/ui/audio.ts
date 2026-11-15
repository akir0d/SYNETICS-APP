// Sons synthetises a la volee (aucun fichier audio) : pops, pieces, fanfares.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

export function setSoundEnabled(on: boolean): void {
  enabled = on;
}

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Pop de recolte : monte d'un demi-ton a chaque combo. */
export function sfxHarvest(combo: number): void {
  const semis = Math.min(combo, 24);
  const f = 520 * 2 ** (semis / 12);
  tone(f, 0.09, 'sine', 0.5, 0, f * 1.8);
  tone(f * 2, 0.06, 'triangle', 0.15, 0.01);
}

export function sfxCrit(): void {
  tone(1320, 0.12, 'triangle', 0.3);
  tone(1760, 0.18, 'triangle', 0.25, 0.06);
}

export function sfxPlant(): void {
  tone(260, 0.06, 'sine', 0.3, 0, 180);
}

export function sfxBoost(): void {
  tone(700, 0.04, 'square', 0.06, 0, 900);
}

export function sfxCoin(): void {
  tone(988, 0.05, 'square', 0.08);
  tone(1319, 0.12, 'square', 0.08, 0.05);
}

export function sfxBuy(): void {
  [523, 659, 784].forEach((f, i) => tone(f, 0.1, 'triangle', 0.3, i * 0.05));
}

export function sfxLevelUp(): void {
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.32, i * 0.08));
  tone(1047, 0.5, 'sine', 0.2, 0.4);
}

export function sfxError(): void {
  tone(200, 0.12, 'sawtooth', 0.08, 0, 150);
}

export function sfxCluck(): void {
  tone(900, 0.05, 'square', 0.04, 0, 600);
}
