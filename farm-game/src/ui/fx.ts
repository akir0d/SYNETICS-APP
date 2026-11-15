// Calque d'effets en canvas : particules, textes flottants, pieces qui volent.

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  size: number; color: string;
  kind: 'dot' | 'star' | 'leaf' | 'confetti';
  rot: number; vr: number;
}

interface FloatText {
  x: number; y: number; text: string; color: string;
  size: number; life: number; max: number;
}

interface Flyer {
  x0: number; y0: number; cx: number; cy: number;
  t: number; dur: number; glyph: string; size: number;
  target: () => { x: number; y: number };
  onArrive: () => void;
}

const MAX_PARTICLES = 500;

export class Fx {
  private readonly ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private flyers: Flyer[] = [];
  private dpr = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
  }

  burst(x: number, y: number, colors: string[], count = 14, power = 1, kind: Particle['kind'] = 'dot'): void {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 3.5) * power;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 2.2 * power,
        life: 0, max: 35 + Math.random() * 25,
        size: kind === 'star' ? 5 + Math.random() * 4 : 2.5 + Math.random() * 3.5,
        color: colors[i % colors.length]!,
        kind, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      });
    }
  }

  confetti(): void {
    const colors = ['#ffd84a', '#ff7aa8', '#6fd3ff', '#8be36b', '#ffa94d', '#c58bff'];
    const w = window.innerWidth;
    for (let i = 0; i < 140 && this.particles.length < MAX_PARTICLES; i++) {
      this.particles.push({
        x: Math.random() * w, y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
        life: 0, max: 140 + Math.random() * 60,
        size: 4 + Math.random() * 4, color: colors[i % colors.length]!,
        kind: 'confetti', rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
      });
    }
  }

  text(x: number, y: number, text: string, color = '#fff', size = 22): void {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x, y, text, color, size, life: 0, max: 55 });
  }

  fly(x: number, y: number, glyph: string, target: () => { x: number; y: number }, onArrive: () => void, size = 26): void {
    if (this.flyers.length > 60) {
      onArrive();
      return;
    }
    const t = target();
    this.flyers.push({
      x0: x, y0: y,
      cx: (x + t.x) / 2 + (Math.random() - 0.5) * 160,
      cy: Math.min(y, t.y) - 40 - Math.random() * 80,
      t: 0, dur: 32 + Math.random() * 14, glyph, size, target, onArrive,
    });
  }

  /** Avance et dessine une image ; `k` = nombre d'images a 60 Hz ecoulees. */
  frame(k: number): void {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.particles = this.particles.filter((p) => {
      p.life += k;
      if (p.kind === 'confetti') {
        p.vx += Math.sin((p.life + p.rot * 10) / 12) * 0.05 * k;
        p.vy = Math.min(p.vy + 0.02 * k, 3.5);
      } else {
        p.vy += 0.22 * k;
        p.vx *= 0.98 ** k;
      }
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.rot += p.vr * k;
      const alpha = Math.max(0, 1 - p.life / p.max);
      if (alpha <= 0) return false;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      if (p.kind === 'star') drawStar(ctx, p.size);
      else if (p.kind === 'confetti') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else if (p.kind === 'leaf') {
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.3, p.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return true;
    });

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    this.texts = this.texts.filter((t) => {
      t.life += k;
      const p = t.life / t.max;
      if (p >= 1) return false;
      const pop = p < 0.15 ? 0.6 + (p / 0.15) * 0.55 : p < 0.25 ? 1.15 - ((p - 0.15) / 0.1) * 0.15 : 1;
      ctx.globalAlpha = p > 0.7 ? 1 - (p - 0.7) / 0.3 : 1;
      ctx.font = `900 ${Math.round(t.size * pop)}px "Baloo 2", system-ui, sans-serif`;
      const y = t.y - easeOut(p) * 46;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(60, 35, 10, 0.85)';
      ctx.strokeText(t.text, t.x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, y);
      return true;
    });

    this.flyers = this.flyers.filter((f) => {
      f.t += k;
      const p = Math.min(1, f.t / f.dur);
      const e = p * p;
      const tg = f.target();
      const x = (1 - e) ** 2 * f.x0 + 2 * (1 - e) * e * f.cx + e * e * tg.x;
      const y = (1 - e) ** 2 * f.y0 + 2 * (1 - e) * e * f.cy + e * e * tg.y;
      ctx.globalAlpha = 1;
      ctx.font = `${Math.round(f.size * (1 - 0.35 * p))}px system-ui, "Noto Color Emoji", sans-serif`;
      ctx.fillText(f.glyph, x, y);
      if (p >= 1) {
        f.onArrive();
        return false;
      }
      return true;
    });
    ctx.globalAlpha = 1;
  }

  get busy(): boolean {
    return this.particles.length + this.texts.length + this.flyers.length > 0;
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function drawStar(ctx: CanvasRenderingContext2D, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}
