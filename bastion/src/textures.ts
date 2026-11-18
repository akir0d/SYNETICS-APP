// Textures de detail dessinees au lancement (aucune image externe) : elles cassent l'aplat
// des couleurs du sol et de l'eau sans couter cher. Toutes se repetent sans couture.

import * as THREE from 'three';

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b9) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

/** Dessine une forme repetee aux bords, pour que la texture se raccorde sur elle-meme. */
function wrapped(size: number, x: number, y: number, r: number, draw: (x: number, y: number) => void): void {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox;
      const py = y + oy;
      if (px + r < 0 || px - r > size || py + r < 0 || py - r > size) continue;
      draw(px, py);
    }
  }
}

function blotch(ctx: CanvasRenderingContext2D, size: number, x: number, y: number, r: number, color: string): void {
  wrapped(size, x, y, r, (px, py) => {
    const g = ctx.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function finish(canvas: HTMLCanvasElement, repeat: number): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Grain fin pixel par pixel (multiplie la couleur de base de +/- amp). */
function grain(ctx: CanvasRenderingContext2D, size: number, r: () => number, amp: number): void {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = 1 + (r() - 0.5) * amp;
    d[i] = Math.min(255, d[i]! * k);
    d[i + 1] = Math.min(255, d[i + 1]! * k);
    d[i + 2] = Math.min(255, d[i + 2]! * k);
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Herbe : grandes plaques douces (seches, plus vertes), touffes de brins, grain discret.
 * Multipliee par la couleur du sol. Assez douce pour l'ombrage lisse : pas de bruit criard.
 */
export function grassTexture(repeat: number): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const r = rng(11);
  ctx.fillStyle = '#ececec';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) blotch(ctx, S, r() * S, r() * S, 24 + r() * 56, r() < 0.5 ? 'rgba(255,236,170,0.32)' : 'rgba(150,196,120,0.32)');
  for (let i = 0; i < 18; i++) blotch(ctx, S, r() * S, r() * S, 10 + r() * 20, 'rgba(110,124,70,0.22)');
  // Brins d'herbe par petites touffes : un trait sombre, un reflet clair a cote.
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const cx = r() * S;
    const cy = r() * S;
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const x = cx + (r() - 0.5) * 6;
      const y = cy + (r() - 0.5) * 3;
      const a = -Math.PI / 2 + (r() - 0.5) * 1.0;
      const l = 3 + r() * 5;
      ctx.strokeStyle = 'rgba(78,100,50,0.3)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,225,0.3)';
      ctx.beginPath();
      ctx.moveTo(x + 1, y);
      ctx.lineTo(x + 1 + Math.cos(a) * l * 0.7, y + Math.sin(a) * l * 0.7);
      ctx.stroke();
    }
  }
  grain(ctx, S, r, 0.07);
  return finish(c, repeat);
}

/** Terre battue : cailloux, ornieres claires, taches d'humidite. */
export function dirtTexture(repeat: number): THREE.CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const r = rng(23);
  ctx.fillStyle = '#ededed';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 22; i++) blotch(ctx, S, r() * S, r() * S, 20 + r() * 50, r() < 0.55 ? 'rgba(120,90,60,0.22)' : 'rgba(255,240,210,0.32)');
  for (let i = 0; i < 260; i++) {
    const x = r() * S;
    const y = r() * S;
    const rad = 0.8 + r() * 2.2;
    const light = r() < 0.5;
    wrapped(S, x, y, rad, (px, py) => {
      // Caillou arrondi : ombre portee decalee puis dessus clair (lisible de haut, sans bruit).
      const ry = rad * (0.6 + r() * 0.4);
      const rot = r() * 3;
      if (light) {
        ctx.fillStyle = 'rgba(90,70,50,0.25)';
        ctx.beginPath();
        ctx.ellipse(px + 0.6, py + 0.8, rad, ry, rot, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = light ? 'rgba(255,250,235,0.65)' : 'rgba(90,70,50,0.38)';
      ctx.beginPath();
      ctx.ellipse(px, py, rad, ry, rot, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  grain(ctx, S, r, 0.1);
  return finish(c, repeat);
}

/** Vaguelettes pour l'eau (relief : la lumiere du soleil y accroche des reflets). */
export function rippleTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  const r = rng(5);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, S, S);
  // Relief doux : de grandes ondulations puis quelques petites, sans pointes.
  for (let i = 0; i < 24; i++) {
    blotch(ctx, S, r() * S, r() * S, 14 + r() * 22, r() < 0.5 ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)');
  }
  for (let i = 0; i < 50; i++) {
    blotch(ctx, S, r() * S, r() * S, 5 + r() * 10, r() < 0.5 ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)');
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 4);
  t.needsUpdate = true;
  return t;
}

/** Coordonnees de texture tirees de la position (unites du monde), pour une echelle constante. */
export function planarUV(g: THREE.BufferGeometry, scale: number): void {
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * scale;
    uv[i * 2 + 1] = pos.getY(i) * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

let dirtMat: THREE.MeshLambertMaterial | null = null;
/**
 * Terre battue du camp (non fusionnee avec le decor : elle garde ses coordonnees de texture).
 * Materiau de sol : volontairement SANS l'ombrage d'ambiance de kit.ts (ni contact, ni lisere).
 */
export function campDirt(color: number): THREE.MeshLambertMaterial {
  if (!dirtMat) dirtMat = new THREE.MeshLambertMaterial({ color, map: dirtTexture(1) });
  return dirtMat;
}
