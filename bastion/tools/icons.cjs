// Genere les icones Android a partir de design/icon.svg.
// Usage (depuis bastion/) : node tools/icons.cjs   (necessite Playwright)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'design/icon.svg'), 'utf8');
const res = path.join(root, 'android/app/src/main/res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// part : 'bg', 'fg' ou 'all'. crop : zone du carre de 108 a montrer. shape : forme du masque.
function page(px, part, crop, shape) {
  const [x0, size] = crop;
  const hide = part === 'bg' ? '#fg{display:none}' : part === 'fg' ? '#bg{display:none}' : '';
  const radius = shape === 'round' ? '50%' : shape === 'square' ? '18%' : '0';
  const s = svg.replace('viewBox="0 0 108 108"', `viewBox="${x0} ${x0} ${size} ${size}" width="${px}" height="${px}"`);
  return `<html><body style="margin:0;background:transparent"><style>${hide}</style>
    <div style="width:${px}px;height:${px}px;border-radius:${radius};overflow:hidden">${s}</div></body></html>`;
}

(async () => {
  const browser = await chromium.launch();
  const p = await browser.newPage({ deviceScaleFactor: 1 });
  const shot = async (file, px, part, crop, shape) => {
    await p.setViewportSize({ width: px, height: px });
    await p.setContent(page(px, part, crop, shape));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await p.screenshot({ path: file, omitBackground: true });
  };
  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = path.join(res, `mipmap-${d}`);
    // Icone adaptative (Android 8+) : calques de 108 dp.
    await shot(path.join(dir, 'ic_launcher_foreground.png'), Math.round(108 * k), 'fg', [0, 108], 'none');
    await shot(path.join(dir, 'ic_launcher_background.png'), Math.round(108 * k), 'bg', [0, 108], 'none');
    // Anciennes icones (48 dp) : on recadre sur le dessin pour qu'il remplisse l'icone.
    await shot(path.join(dir, 'ic_launcher.png'), Math.round(48 * k), 'all', [18, 72], 'square');
    await shot(path.join(dir, 'ic_launcher_round.png'), Math.round(48 * k), 'all', [18, 72], 'round');
  }
  await shot(path.join(root, 'design/icon-512.png'), 512, 'all', [18, 72], 'square');
  await browser.close();
  console.log('Icones generees.');
})();
