// Publicites recompensees et achats integres.
//
// Version de test : tout est SIMULE. Une « publicite » est un ecran de quelques secondes,
// un « achat » une simple confirmation, et rien n'est jamais debite. Le jeu n'appelle que
// `showRewarded` et `purchase` : pour publier, on remplacera leur contenu par AdMob et
// Google Play Billing, sans toucher au reste du jeu.

export const SIMULATED = true;

export interface Product {
  id: 'noads' | 'starter' | 'monthly' | 'gems_s' | 'gems_m' | 'gems_l' | 'gems_xl';
  name: string;
  icon: string;
  desc: string;
  /** Prix affiche (indicatif : fixe dans la console Google Play a la publication). */
  price: string;
  /** Achat unique (sans pub, pack de depart) ou rachetable (gemmes). */
  once: boolean;
  /** Gemmes donnees tout de suite (doublees au tout premier achat qui en donne). */
  gems: number;
}

export const PRODUCTS: Product[] = [
  { id: 'starter', name: 'Pack du survivant', icon: '🎁', desc: '150 💎, 4 coffres de pièces, un sac plus grand et la tenue de garde forestier', price: '1,99 €', once: true, gems: 150 },
  { id: 'monthly', name: 'Ravitaillement mensuel', icon: '📦', desc: '300 💎 tout de suite, puis 40 💎 chaque jour pendant 30 jours', price: '4,99 €', once: false, gems: 300 },
  { id: 'noads', name: 'Sans pub', icon: '🚫', desc: 'Les récompenses « pub » sans regarder de vidéo (mêmes limites par jour)', price: '3,99 €', once: true, gems: 0 },
  { id: 'gems_s', name: 'Bourse de gemmes', icon: '💎', desc: '80 gemmes', price: '0,99 €', once: false, gems: 80 },
  { id: 'gems_m', name: 'Coffret de gemmes', icon: '💎', desc: '500 gemmes (+25 %)', price: '4,99 €', once: false, gems: 500 },
  { id: 'gems_l', name: 'Malle de gemmes', icon: '💎', desc: '1 200 gemmes (+50 %)', price: '9,99 €', once: false, gems: 1200 },
  { id: 'gems_xl', name: 'Trésor de gemmes', icon: '💎', desc: '2 800 gemmes (+75 %)', price: '19,99 €', once: false, gems: 2800 },
];

let overlay: HTMLElement | null = null;
function layer(): HTMLElement {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'ad-layer';
    document.body.appendChild(overlay);
  }
  return overlay;
}

/**
 * Publicite recompensee, toujours a l'initiative du joueur. Resout `true` si la
 * recompense est acquise. Avec « Sans pub », la recompense est donnee directement.
 */
export function showRewarded(what: string, noAds: boolean): Promise<boolean> {
  if (noAds) return Promise.resolve(true);
  return new Promise((resolve) => {
    const el = layer();
    let left = 4;
    el.innerHTML = `<div class="ad-card"><div class="ad-tag">Publicité (simulation)</div>
      <div class="ad-big">📺</div><p>Récompense : <b>${what}</b></p>
      <div class="ad-count">${left}</div><button class="btn ghost" data-ad-cancel>Annuler</button></div>`;
    el.classList.add('show');
    const timer = setInterval(() => {
      left--;
      const c = el.querySelector('.ad-count');
      if (c) c.textContent = String(left);
      if (left <= 0) done(true);
    }, 1000);
    const done = (ok: boolean) => {
      clearInterval(timer);
      el.classList.remove('show');
      resolve(ok);
    };
    el.querySelector('[data-ad-cancel]')!.addEventListener('click', () => done(false), { once: true });
  });
}

/** Achat integre (simule : une confirmation, aucun paiement). */
export function purchase(p: Product): Promise<boolean> {
  return new Promise((resolve) => {
    const el = layer();
    el.innerHTML = `<div class="ad-card"><div class="ad-tag">Achat simulé · version de test</div>
      <div class="ad-big">${p.icon}</div><h3>${p.name}</h3><p>${p.desc}</p>
      <p class="muted">Rien n'est débité : les vrais paiements passeront par Google Play.</p>
      <button class="btn big" data-buy>Obtenir (${p.price})</button><button class="btn ghost" data-ad-cancel>Annuler</button></div>`;
    el.classList.add('show');
    const done = (ok: boolean) => {
      el.classList.remove('show');
      resolve(ok);
    };
    el.querySelector('[data-buy]')!.addEventListener('click', () => done(true), { once: true });
    el.querySelector('[data-ad-cancel]')!.addEventListener('click', () => done(false), { once: true });
  });
}
