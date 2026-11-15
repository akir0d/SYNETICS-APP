// Sons synthetises (aucun fichier) : ramassage, depot, construction, tir.

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
export let muted = false;

export function setMuted(m: boolean): void {
  muted = m;
}

function ac(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(f: number, dur: number, type: OscillatorType, vol: number, delay = 0, to?: number): void {
  const a = ac();
  if (!a || !out) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function burst(dur: number, vol: number, freq: number, q = 0.8): void {
  const a = ac();
  if (!a || !out || !noise) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur);
}

/** Bruit de bois : chaque rondin monte d'un cran, c'est la recompense sonore de la pile. */
export function sfxPickup(n: number): void {
  tone(300 * 2 ** (Math.min(n, 14) / 12), 0.07, 'triangle', 0.35);
  burst(0.04, 0.15, 900, 2);
}

export function sfxDrop(n: number): void {
  tone(420 * 2 ** (Math.min(n, 14) / 14), 0.06, 'square', 0.08);
  burst(0.05, 0.2, 500, 1.5);
}

export function sfxBuild(): void {
  [392, 523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.3, i * 0.07));
  burst(0.35, 0.25, 200, 0.5);
}

export function sfxShot(): void {
  burst(0.12, 0.5, 1200, 0.6);
  tone(140, 0.1, 'sawtooth', 0.15, 0, 60);
}

export function sfxSplat(): void {
  burst(0.18, 0.35, 350, 1);
  tone(110, 0.15, 'sine', 0.25, 0, 50);
}

export function sfxToggle(night: boolean): void {
  const notes = night ? [523, 440, 349, 262] : [262, 349, 440, 523];
  notes.forEach((f, i) => tone(f, 0.35, 'sine', 0.2, i * 0.09));
}

export function sfxChop(): void {
  burst(0.09, 0.45, 700, 1.2);
  tone(180, 0.08, 'triangle', 0.3, 0, 120);
}

export function sfxClang(): void {
  tone(1250, 0.16, 'square', 0.08, 0, 1100);
  tone(1870, 0.12, 'triangle', 0.12);
  burst(0.05, 0.2, 3000, 2);
}

export function sfxSell(): void {
  tone(880, 0.07, 'triangle', 0.25);
  tone(1320, 0.12, 'triangle', 0.25, 0.06);
}

export function sfxObjective(): void {
  [659, 880, 1175].forEach((f, i) => tone(f, 0.18, 'sine', 0.25, i * 0.07));
}

export function sfxNope(): void {
  tone(220, 0.12, 'sawtooth', 0.08, 0, 160);
}

export function sfxVictory(): void {
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'triangle', 0.3, i * 0.11));
}

export function sfxCoin(): void {
  tone(1568 + Math.random() * 200, 0.06, 'square', 0.05);
  tone(2093, 0.1, 'triangle', 0.08, 0.04);
}
