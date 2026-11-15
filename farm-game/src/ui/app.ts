// Interface du jeu : construit le DOM, gere les gestes et joue les effets.

import { COMBO_WINDOW_MS, CROPS, MAX_PLOTS, PRESTIGE_LEVEL, UPGRADES, crop, type UpgradeId } from '../game/data';
import { fmt, fmtDuration } from '../game/format';
import { saveGame, wipeSave } from '../game/save';
import {
  ORDERS_UNLOCK, applyOffline, boost, buyPlot, buyUpgrade, claimOrder, computeOffline, cropsUnlockedAt,
  discardOrder, fillOrders, harvest, idleRate, isRipe, levelUpReward, newGame, plant, plotCost, plotProgress,
  prestige, prestigeGain, sellMultiplier, tickHen, upgradeCost, xpForLevel,
  type GameState, type HarvestResult,
} from '../game/state';
import * as sfx from './audio';
import { Fx } from './fx';
import { buzz, setHapticsEnabled } from './haptics';

const CROP_COLORS: Record<string, string[]> = {
  carrot: ['#ff8c2b', '#ffb35c', '#5fbf3a'],
  wheat: ['#f2c94c', '#ffe08a', '#c9a227'],
  tomato: ['#ff4b3e', '#ff8a7a', '#4caf50'],
  corn: ['#ffd23f', '#fff07a', '#7cc04a'],
  eggplant: ['#8e44ad', '#b97ad9', '#5fbf3a'],
  pumpkin: ['#ff8a00', '#ffb347', '#6b8e23'],
  strawberry: ['#ff3d6e', '#ff8fab', '#5fbf3a'],
  sunflower: ['#ffd000', '#ffe867', '#8b5a2b'],
  melon: ['#ff5a6e', '#7ed957', '#2e8b57'],
  pineapple: ['#ffc83d', '#ffe27a', '#4caf50'],
  grape: ['#7b4bd1', '#a98af0', '#5fbf3a'],
};

type Panel = 'shop' | 'orders' | 'season' | 'settings' | null;

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export class App {
  private s: GameState;
  private readonly fx: Fx;
  private readonly root: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly hen: HTMLElement;
  private plotEls: HTMLElement[] = [];
  private plotCache: { key: string; label: string }[] = [];
  private panel: Panel = null;
  private shownCoins = 0;
  private inFlight = 0;
  private combo = 0;
  private lastHarvestAt = 0;
  private dragging = false;
  private visited = new Set<number>();
  private lastFrame = performance.now();
  private lastSave = 0;
  private lastPanelRefresh = 0;
  private bannerTimer = 0;

  constructor(root: HTMLElement, state: GameState) {
    this.root = root;
    this.s = state;
    root.innerHTML = TEMPLATE;
    this.grid = $(root, '.grid');
    this.hen = $(root, '.hen');
    this.fx = new Fx($(root, 'canvas.fx'));
    this.shownCoins = state.coins;
    this.applySettings();
    fillOrders(this.s, Math.random);
    this.buildGrid();
    this.buildSeedBar();
    this.bindEvents();
    this.checkOffline(true);
    requestAnimationFrame((t) => this.loop(t));
  }

  // ------------------------------------------------------------ construction

  private buildGrid(): void {
    this.grid.querySelectorAll('.plot, .buy-plot').forEach((e) => e.remove());
    this.plotEls = this.s.plots.map((_, i) => {
      const el = document.createElement('div');
      el.className = 'plot';
      el.dataset.i = String(i);
      el.innerHTML = '<div class="soil"></div><div class="ring"></div><div class="crop"></div><div class="timer"></div>';
      this.grid.appendChild(el);
      return el;
    });
    this.plotCache = this.s.plots.map(() => ({ key: '', label: '' }));
    // La ferme s'agrandit : peu de champs = grosses tuiles, puis on resserre.
    const n = this.s.plots.length + (this.s.plots.length < MAX_PLOTS ? 1 : 0);
    this.grid.dataset.cols = String(n <= 6 ? 2 : n <= 12 ? 3 : 4);
    if (this.s.plots.length < MAX_PLOTS) {
      const buy = document.createElement('button');
      buy.className = 'buy-plot';
      buy.innerHTML = '<span class="plus">+</span><span class="price"></span>';
      this.grid.appendChild(buy);
    }
    this.grid.appendChild(this.hen);
  }

  private buildSeedBar(): void {
    const bar = $(this.root, '.seedbar');
    bar.innerHTML = CROPS.map((c) => `
      <button class="seed" data-crop="${c.id}">
        <span class="emoji">${c.emoji}</span>
        <span class="name">${c.name}</span>
        <span class="meta"></span>
      </button>`).join('');
    this.refreshSeedBar();
  }

  private refreshSeedBar(): void {
    const sell = sellMultiplier(this.s);
    this.root.querySelectorAll<HTMLElement>('.seed').forEach((el) => {
      const c = crop(el.dataset.crop!);
      const locked = c.unlockLevel > this.s.level;
      el.classList.toggle('locked', locked);
      el.classList.toggle('selected', c.id === this.s.selectedCrop);
      const meta = $(el, '.meta');
      meta.textContent = locked ? `🔒 Niv. ${c.unlockLevel}` : `🪙${fmt(c.value * sell)} · ${fmtDuration(c.growMs * 0.94 ** this.s.upgrades.fertilizer)}`;
    });
  }

  // ------------------------------------------------------------ evenements

  private bindEvents(): void {
    this.grid.addEventListener('pointerdown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('.buy-plot')) {
        this.onBuyPlot();
        return;
      }
      this.dragging = true;
      this.visited.clear();
      this.actAt(e.clientX, e.clientY, true);
    });
    window.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      // Les evenements fusionnes evitent de "sauter" un champ quand le doigt va vite.
      const events = e.getCoalescedEvents?.() ?? [e];
      for (const ev of events.length ? events : [e]) this.actAt(ev.clientX, ev.clientY, false);
    });
    const stop = () => { this.dragging = false; };
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);

    $(this.root, '.seedbar').addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.seed');
      if (!el) return;
      const c = crop(el.dataset.crop!);
      if (c.unlockLevel > this.s.level) {
        sfx.sfxError();
        this.toast(`${c.emoji} ${c.name} se débloque au niveau ${c.unlockLevel}`);
        return;
      }
      this.s.selectedCrop = c.id;
      sfx.sfxPlant();
      buzz();
      this.refreshSeedBar();
    });

    this.root.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
      t.addEventListener('click', () => this.openPanel(t.dataset.panel as Panel));
    });
    $(this.root, '.sheet-backdrop').addEventListener('click', () => this.openPanel(null));
    $(this.root, '.sheet').addEventListener('click', (e) => this.onPanelClick(e));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.s.lastSeen = Date.now();
        saveGame(this.s);
      } else {
        this.lastFrame = performance.now();
        this.checkOffline(false);
      }
    });
    window.addEventListener('pagehide', () => saveGame(this.s));
  }

  private actAt(x: number, y: number, isTap: boolean): void {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.plot');
    if (!el) return;
    const i = Number(el.dataset.i);
    if (this.visited.has(i)) return;
    this.visited.add(i);
    const now = Date.now();
    const p = this.s.plots[i]!;
    if (isRipe(p, now)) {
      this.combo = now - this.lastHarvestAt < COMBO_WINDOW_MS ? this.combo + 1 : 0;
      this.lastHarvestAt = now;
      const r = harvest(this.s, i, now, Math.random, this.combo);
      if (r) this.onHarvest(r, false);
    } else if (!p.crop) {
      if (plant(this.s, i, now)) {
        sfx.sfxPlant();
        buzz();
        this.squish(el);
        const r = el.getBoundingClientRect();
        this.fx.burst(r.left + r.width / 2, r.top + r.height * 0.7, ['#8a5a32', '#a8743f', '#6b4423'], 8, 0.6);
      }
    } else if (isTap && boost(this.s, i, now)) {
      sfx.sfxBoost();
      buzz();
      this.squish(el);
      const r = el.getBoundingClientRect();
      this.fx.burst(r.left + r.width / 2, r.top + r.height / 2, ['#7fdc5a', '#b6f08f'], 5, 0.5, 'leaf');
    }
  }

  private onHarvest(r: HarvestResult, byHen: boolean): void {
    const el = this.plotEls[r.index];
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const colors = CROP_COLORS[r.crop.id] ?? ['#ffd84a'];

    this.fx.burst(cx, cy, colors, r.crit ? 26 : 14, r.crit ? 1.4 : 1);
    if (r.crit) this.fx.burst(cx, cy, ['#fff6a8', '#ffd84a'], 8, 1.2, 'star');
    this.fx.text(cx, cy - 10, `+${fmt(r.coins)}`, r.crit ? '#ffe14d' : '#ffffff', r.crit ? 30 : 22);
    if (r.crit) this.fx.text(cx, cy - 40, 'DOUBLE !', '#ff9f43', 18);

    this.inFlight += r.coins;
    const pieces = r.crit ? 2 : 1;
    for (let k = 0; k < pieces; k++) {
      const share = k === pieces - 1 ? r.coins - Math.floor(r.coins / pieces) * (pieces - 1) : Math.floor(r.coins / pieces);
      this.fx.fly(cx, cy, '🪙', () => this.coinTarget(), () => {
        this.inFlight -= share;
        this.bump('.coins');
        if (!byHen) sfx.sfxCoin();
      }, byHen ? 20 : 26);
    }

    this.pop(el);
    if (byHen) {
      this.moveHen(el);
      sfx.sfxCluck();
    } else {
      sfx.sfxHarvest(this.combo);
      if (r.crit) sfx.sfxCrit();
      buzz(r.crit ? 'medium' : 'light');
      if (this.combo >= 2) this.showCombo();
      this.s.stats.bestCombo = Math.max(this.s.stats.bestCombo, this.combo + 1);
    }
    if (r.ordersFilled.length) this.onOrderReady();
    if (r.levelsGained.length) this.onLevelUp(r.levelsGained);
  }

  private onBuyPlot(): void {
    if (buyPlot(this.s)) {
      sfx.sfxBuy();
      buzz('medium');
      this.buildGrid();
      const el = this.plotEls[this.plotEls.length - 1]!;
      el.classList.add('new');
      const r = el.getBoundingClientRect();
      this.fx.burst(r.left + r.width / 2, r.top + r.height / 2, ['#8be36b', '#ffd84a', '#ffffff'], 24, 1.2, 'star');
      saveGame(this.s);
    } else {
      sfx.sfxError();
      this.shake($(this.grid, '.buy-plot'));
    }
  }

  private onLevelUp(levels: number[]): void {
    const level = levels[levels.length - 1]!;
    const unlocked = levels.flatMap((l) => cropsUnlockedAt(l));
    const newUpgrades = UPGRADES.filter((u) => levels.includes(u.unlockLevel));
    const reward = levels.reduce((sum, l) => sum + levelUpReward(l), 0);
    if (unlocked.length) this.s.selectedCrop = unlocked[unlocked.length - 1]!.id;

    const lines = [
      ...unlocked.map((c) => `${c.emoji} ${c.name} débloqué !`),
      ...newUpgrades.map((u) => `${u.emoji} ${u.name} en boutique`),
      ...(levels.includes(ORDERS_UNLOCK) ? ['📜 Commandes ouvertes'] : []),
      ...(levels.includes(PRESTIGE_LEVEL) ? ['🌟 Nouvelle saison disponible'] : []),
    ];
    const banner = $(this.root, '.banner');
    banner.innerHTML = `
      <div class="banner-title">NIVEAU ${level} !</div>
      <div class="banner-reward">+${fmt(reward)} 🪙</div>
      ${lines.map((l) => `<div class="banner-line">${l}</div>`).join('')}`;
    banner.classList.remove('show');
    void banner.offsetWidth;
    banner.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => banner.classList.remove('show'), 2800);

    this.fx.confetti();
    sfx.sfxLevelUp();
    buzz('heavy');
    this.bump('.lvl-badge');
    this.refreshSeedBar();
    this.refreshTabs();
    if (this.panel) this.renderPanel();
    saveGame(this.s);
  }

  private onOrderReady(): void {
    this.bump('.tab[data-panel="orders"]');
    this.refreshTabs();
    if (this.panel === 'orders') this.renderPanel();
  }

  // ------------------------------------------------------------ panneaux

  private openPanel(p: Panel): void {
    this.panel = this.panel === p ? null : p;
    this.root.classList.toggle('sheet-open', this.panel !== null);
    this.root.querySelectorAll<HTMLElement>('.tab').forEach((t) => t.classList.toggle('active', t.dataset.panel === this.panel));
    if (this.panel) this.renderPanel();
    sfx.sfxPlant();
  }

  private renderPanel(): void {
    const body = $(this.root, '.sheet-body');
    const s = this.s;
    if (this.panel === 'shop') {
      body.innerHTML = `<h2>🧺 Boutique</h2>` + UPGRADES.map((u) => `
        <div class="card upgrade" data-up="${u.id}">
          <div class="card-icon">${u.emoji}</div>
          <div class="card-main">
            <div class="card-title">${u.name} <span class="lv"></span></div>
            <div class="card-desc"></div>
          </div>
          <button class="btn buy" data-buy="${u.id}"></button>
        </div>`).join('');
    } else if (this.panel === 'orders') {
      if (s.level < ORDERS_UNLOCK) {
        body.innerHTML = `<h2>📜 Commandes</h2><p class="hint">Les villageois passeront commande dès le niveau ${ORDERS_UNLOCK}.</p>`;
      } else {
        body.innerHTML = `<h2>📜 Commandes</h2><p class="hint">Récolte ce qui est demandé : les récoltes doubles comptent deux fois.</p>` +
          s.orders.map((o) => {
            const c = crop(o.crop);
            const done = o.progress >= o.qty;
            return `
            <div class="card order ${done ? 'done' : ''}">
              <div class="card-icon">${c.emoji}</div>
              <div class="card-main">
                <div class="card-title">${o.qty} × ${c.name}</div>
                <div class="progress"><div style="width:${(o.progress / o.qty) * 100}%"></div><span>${o.progress}/${o.qty}</span></div>
                <div class="card-desc">Récompense : 🪙 ${fmt(o.coins)} · ⭐ ${fmt(o.xp)} XP</div>
              </div>
              ${done
                ? `<button class="btn claim" data-claim="${o.id}">Livrer</button>`
                : `<button class="btn ghost" data-discard="${o.id}" title="Remplacer">🗑️</button>`}
            </div>`;
          }).join('');
      }
    } else if (this.panel === 'season') {
      const gain = prestigeGain(s);
      body.innerHTML = `
        <h2>🌟 Nouvelle saison</h2>
        <p class="hint">Recommence ta ferme à zéro et reçois des <b>graines d'or</b>. Chaque graine d'or augmente
        <b>définitivement</b> tous tes gains de 10 %.</p>
        <div class="season-box">
          <div>Saison actuelle : <b>${s.season}</b></div>
          <div>Graines d'or : <b>🌟 ${fmt(s.goldenSeeds)}</b> (×${(1 + s.goldenSeeds * 0.1).toFixed(1)})</div>
          <div>Pièces cette saison : <b>🪙 ${fmt(s.seasonCoins)}</b></div>
        </div>
        ${s.level < PRESTIGE_LEVEL
          ? `<p class="hint">Disponible au niveau ${PRESTIGE_LEVEL}.</p>`
          : `<button class="btn big prestige" data-prestige ${gain < 1 ? 'disabled' : ''}>
               ${gain < 1 ? 'Récolte encore un peu…' : `Nouvelle saison : +${fmt(gain)} 🌟`}</button>`}`;
    } else if (this.panel === 'settings') {
      body.innerHTML = `
        <h2>⚙️ Réglages</h2>
        <label class="toggle"><input type="checkbox" data-set="sound" ${s.settings.sound ? 'checked' : ''}> Sons</label>
        <label class="toggle"><input type="checkbox" data-set="haptics" ${s.settings.haptics ? 'checked' : ''}> Vibrations</label>
        <div class="season-box">
          <div>Récoltes : <b>${fmt(s.stats.harvests)}</b></div>
          <div>Pièces gagnées au total : <b>🪙 ${fmt(s.stats.totalCoins)}</b></div>
          <div>Meilleur combo : <b>×${s.stats.bestCombo}</b></div>
        </div>
        <p class="hint">Astuce : glisse le doigt sur plusieurs champs pour tout récolter d'un geste, et tapote un champ
        qui pousse pour l'accélérer.</p>
        <button class="btn danger" data-wipe>Effacer la partie</button>`;
    }
    this.refreshPanel();
  }

  /** Met a jour les parties qui changent sans reconstruire le panneau (le doigt ne perd pas son bouton). */
  private refreshPanel(): void {
    if (this.panel !== 'shop') return;
    const s = this.s;
    this.root.querySelectorAll<HTMLElement>('.upgrade').forEach((card) => {
      const id = card.dataset.up as UpgradeId;
      const u = UPGRADES.find((x) => x.id === id)!;
      const lvl = s.upgrades[id];
      const locked = s.level < u.unlockLevel;
      const maxed = lvl >= u.max;
      const cost = upgradeCost(id, lvl);
      card.classList.toggle('locked', locked);
      $(card, '.lv').textContent = u.max > 1 ? `niv. ${lvl}/${u.max}` : lvl ? '✔' : '';
      const desc = locked ? `Se débloque au niveau ${u.unlockLevel}` : maxed ? u.effect(lvl) : `${lvl ? u.effect(lvl) + ' → ' : ''}${u.effect(lvl + 1)}`;
      const d = $(card, '.card-desc');
      if (d.textContent !== desc) d.textContent = desc;
      const btn = $<HTMLButtonElement>(card, '.buy');
      const label = locked ? '🔒' : maxed ? 'MAX' : `🪙 ${fmt(cost)}`;
      if (btn.textContent !== label) btn.textContent = label;
      btn.disabled = locked || maxed;
      btn.classList.toggle('poor', !locked && !maxed && s.coins < cost);
    });
  }

  private onPanelClick(e: Event): void {
    const t = e.target as HTMLElement;
    const buy = t.closest<HTMLElement>('[data-buy]');
    const claim = t.closest<HTMLElement>('[data-claim]');
    const discard = t.closest<HTMLElement>('[data-discard]');
    const set = t.closest<HTMLInputElement>('[data-set]');
    if (buy) {
      const id = buy.dataset.buy as UpgradeId;
      if (buyUpgrade(this.s, id)) {
        sfx.sfxBuy();
        buzz('medium');
        const r = buy.getBoundingClientRect();
        this.fx.burst(r.left + r.width / 2, r.top + r.height / 2, ['#ffd84a', '#8be36b', '#fff'], 18, 1, 'star');
        this.pop(buy.closest('.card')!);
        this.refreshSeedBar();
        this.refreshPanel();
        saveGame(this.s);
      } else {
        sfx.sfxError();
        this.shake(buy);
      }
    } else if (claim) {
      const r0 = claim.getBoundingClientRect();
      const res = claimOrder(this.s, Number(claim.dataset.claim), Math.random);
      if (!res) return;
      sfx.sfxBuy();
      buzz('medium');
      this.inFlight += res.coins;
      const n = 6;
      for (let k = 0; k < n; k++) {
        const share = k === n - 1 ? res.coins - Math.floor(res.coins / n) * (n - 1) : Math.floor(res.coins / n);
        window.setTimeout(() => this.fx.fly(r0.left + r0.width / 2, r0.top + r0.height / 2, '🪙', () => this.coinTarget(), () => {
          this.inFlight -= share;
          this.bump('.coins');
          sfx.sfxCoin();
        }), k * 60);
      }
      this.fx.burst(r0.left + r0.width / 2, r0.top, ['#ffd84a', '#fff6a8'], 20, 1.2, 'star');
      this.renderPanel();
      this.refreshTabs();
      if (res.levelsGained.length) this.onLevelUp(res.levelsGained);
      saveGame(this.s);
    } else if (discard) {
      discardOrder(this.s, Number(discard.dataset.discard), Math.random);
      sfx.sfxPlant();
      this.renderPanel();
    } else if (t.closest('[data-prestige]')) {
      const gain = prestigeGain(this.s);
      if (gain < 1) return;
      if (!window.confirm(`Commencer une nouvelle saison ? Ta ferme repart de zéro, tu gagnes ${gain} graine(s) d'or.`)) return;
      const next = prestige(this.s, Date.now());
      if (!next) return;
      this.s = next;
      this.afterReset();
      this.toast(`🌟 Saison ${this.s.season} ! Tes gains sont multipliés par ${(1 + this.s.goldenSeeds * 0.1).toFixed(1)}`);
    } else if (t.closest('[data-wipe]')) {
      if (!window.confirm('Effacer définitivement la partie ?')) return;
      wipeSave();
      this.s = newGame(Date.now());
      this.afterReset();
    } else if (set && e.type === 'click' && set.tagName === 'INPUT') {
      const key = set.dataset.set as 'sound' | 'haptics';
      this.s.settings[key] = set.checked;
      this.applySettings();
      saveGame(this.s);
    }
  }

  private afterReset(): void {
    this.shownCoins = this.s.coins;
    this.inFlight = 0;
    fillOrders(this.s, Math.random);
    this.buildGrid();
    this.refreshSeedBar();
    this.refreshTabs();
    this.openPanel(null);
    this.fx.confetti();
    sfx.sfxLevelUp();
    saveGame(this.s);
  }

  private applySettings(): void {
    sfx.setSoundEnabled(this.s.settings.sound);
    setHapticsEnabled(this.s.settings.haptics);
  }

  private refreshTabs(): void {
    const ready = this.s.orders.filter((o) => o.progress >= o.qty).length;
    const badge = $(this.root, '.tab[data-panel="orders"] .badge');
    badge.textContent = ready ? String(ready) : '';
    badge.classList.toggle('on', ready > 0);
    const seasonTab = $(this.root, '.tab[data-panel="season"] .badge');
    const canPrestige = prestigeGain(this.s) >= 1;
    seasonTab.textContent = canPrestige ? '!' : '';
    seasonTab.classList.toggle('on', canPrestige);
  }

  // ------------------------------------------------------------ hors ligne

  private checkOffline(atStart: boolean): void {
    const now = Date.now();
    const gains = computeOffline(this.s, now);
    if (gains.ms < 30_000 || gains.coins <= 0) {
      this.s.lastSeen = now;
      return;
    }
    const modal = $(this.root, '.modal');
    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-hen">🐔</div>
        <h2>${atStart ? 'Bon retour !' : 'Te revoilà !'}</h2>
        <p>Pendant ${fmtDuration(gains.ms)}, tes poules ont travaillé :</p>
        <div class="modal-gain">🪙 ${fmt(gains.coins)}</div>
        <div class="modal-sub">⭐ ${fmt(gains.xp)} XP</div>
        <button class="btn big claim">Récupérer</button>
      </div>`;
    modal.classList.add('show');
    $(modal, '.claim').addEventListener('click', () => {
      const btn = $(modal, '.claim').getBoundingClientRect();
      const levels = applyOffline(this.s, gains, Date.now());
      this.inFlight += gains.coins;
      const n = 10;
      for (let k = 0; k < n; k++) {
        const share = k === n - 1 ? gains.coins - Math.floor(gains.coins / n) * (n - 1) : Math.floor(gains.coins / n);
        window.setTimeout(() => this.fx.fly(btn.left + btn.width / 2, btn.top, '🪙', () => this.coinTarget(), () => {
          this.inFlight -= share;
          this.bump('.coins');
          sfx.sfxCoin();
        }), k * 50);
      }
      modal.classList.remove('show');
      buzz('heavy');
      if (levels.length) this.onLevelUp(levels);
      saveGame(this.s);
    }, { once: true });
  }

  // ------------------------------------------------------------ boucle

  private loop(t: number): void {
    const dt = Math.min(250, t - this.lastFrame);
    this.lastFrame = t;
    const now = Date.now();

    for (const r of tickHen(this.s, now, dt, Math.random)) this.onHarvest(r, true);
    if (this.combo > 0 && now - this.lastHarvestAt > COMBO_WINDOW_MS) {
      this.combo = 0;
      $(this.root, '.combo').classList.remove('show');
    }

    this.renderPlots(now);
    this.renderHud(dt);
    this.fx.frame(dt / (1000 / 60));

    if (now - this.lastPanelRefresh > 300) {
      this.lastPanelRefresh = now;
      this.refreshPanel();
      const buy = this.grid.querySelector<HTMLElement>('.buy-plot');
      if (buy) {
        const cost = plotCost(this.s.plots.length);
        $(buy, '.price').textContent = `🪙 ${fmt(cost)}`;
        buy.classList.toggle('poor', this.s.coins < cost);
      }
    }
    if (!document.hidden) this.s.lastSeen = now;
    if (now - this.lastSave > 5_000) {
      this.lastSave = now;
      saveGame(this.s);
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }

  private renderPlots(now: number): void {
    const ghost = crop(this.s.selectedCrop).emoji;
    this.s.plots.forEach((p, i) => {
      const el = this.plotEls[i];
      if (!el) return;
      const cache = this.plotCache[i]!;
      const prog = plotProgress(p, now);
      const ripe = p.crop !== null && prog >= 1;
      const stage = !p.crop ? 'empty' : ripe ? 'ripe' : prog < 0.35 ? 'sprout' : 'grow';
      const emoji = !p.crop ? ghost : stage === 'sprout' ? '🌱' : crop(p.crop).emoji;
      const key = `${stage}|${emoji}`;
      const cropEl = el.children[2] as HTMLElement;
      if (cache.key !== key) {
        cache.key = key;
        el.dataset.stage = stage;
        cropEl.textContent = emoji;
        if (stage === 'ripe') this.pop(el);
      }
      if (stage === 'sprout' || stage === 'grow') {
        const scale = stage === 'sprout' ? 0.45 + prog * 0.9 : 0.5 + prog * 0.5;
        cropEl.style.transform = `scale(${scale.toFixed(3)})`;
        el.style.setProperty('--p', prog.toFixed(3));
      } else if (cropEl.style.transform) {
        cropEl.style.transform = '';
      }
      const showTimer = !!p.crop && !ripe && p.growMs >= 8_000;
      const label = showTimer ? fmtDuration(p.plantedAt + p.growMs - now) : '';
      if (cache.label !== label) {
        cache.label = label;
        (el.children[3] as HTMLElement).textContent = label;
      }
    });
  }

  private renderHud(dt: number): void {
    const s = this.s;
    const target = Math.max(0, s.coins - this.inFlight);
    const diff = target - this.shownCoins;
    this.shownCoins = Math.abs(diff) < 0.5 ? target : this.shownCoins + diff * Math.min(1, dt / 90);
    setText($(this.root, '.coins .value'), fmt(this.shownCoins));
    setText($(this.root, '.lvl-badge span'), String(s.level));
    const need = xpForLevel(s.level);
    $(this.root, '.xpfill').style.width = `${Math.min(100, (s.xp / need) * 100)}%`;
    setText($(this.root, '.xptext'), `${fmt(s.xp)} / ${fmt(need)} XP`);
    const seeds = $(this.root, '.gold');
    seeds.classList.toggle('on', s.goldenSeeds > 0);
    setText($(seeds, '.value'), fmt(s.goldenSeeds));
    const rate = idleRate(s).coins * 1000;
    setText($(this.root, '.rate'), rate > 0 ? `🐔 +${fmt(rate)} 🪙/s` : '');
  }

  // ------------------------------------------------------------ petits effets

  private coinTarget(): { x: number; y: number } {
    const r = $(this.root, '.coins .icon').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  private moveHen(el: HTMLElement): void {
    this.hen.classList.add('visible');
    this.hen.style.transform = `translate(${el.offsetLeft + el.offsetWidth * 0.55}px, ${el.offsetTop + el.offsetHeight * 0.35}px)`;
    this.hen.classList.remove('peck');
    void this.hen.offsetWidth;
    this.hen.classList.add('peck');
  }

  private showCombo(): void {
    const el = $(this.root, '.combo');
    el.textContent = `Combo ×${this.combo + 1}`;
    el.classList.remove('show', 'pulse');
    void el.offsetWidth;
    el.classList.add('show', 'pulse');
  }

  private toast(msg: string): void {
    const el = $(this.root, '.toast');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  private pop(el: Element): void { this.restartAnim(el, 'pop'); }
  private squish(el: Element): void { this.restartAnim(el, 'squish'); }
  private shake(el: Element | null): void { if (el) this.restartAnim(el, 'shake'); }
  private bump(sel: string): void { this.restartAnim($(this.root, sel), 'bump'); }

  private restartAnim(el: Element, cls: string): void {
    el.classList.remove(cls);
    void (el as HTMLElement).offsetWidth;
    el.classList.add(cls);
  }
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

const TEMPLATE = `
  <div class="sky"><div class="sun"></div><div class="cloud c1"></div><div class="cloud c2"></div></div>
  <header class="hud">
    <div class="lvl">
      <div class="lvl-badge"><span>1</span></div>
      <div class="xpbar"><div class="xpfill"></div><span class="xptext"></span></div>
    </div>
    <div class="wallet">
      <div class="coins"><span class="icon">🪙</span><span class="value">0</span></div>
      <div class="gold"><span class="icon">🌟</span><span class="value">0</span></div>
    </div>
  </header>
  <div class="rate"></div>
  <main class="field">
    <div class="combo"></div>
    <div class="grid"><div class="hen">🐔</div></div>
  </main>
  <div class="seedbar"></div>
  <nav class="tabs">
    <button class="tab" data-panel="shop"><span class="ti">🧺</span>Boutique<span class="badge"></span></button>
    <button class="tab" data-panel="orders"><span class="ti">📜</span>Commandes<span class="badge"></span></button>
    <button class="tab" data-panel="season"><span class="ti">🌟</span>Saison<span class="badge"></span></button>
    <button class="tab" data-panel="settings"><span class="ti">⚙️</span>Réglages<span class="badge"></span></button>
  </nav>
  <div class="sheet-backdrop"></div>
  <section class="sheet"><div class="sheet-handle"></div><div class="sheet-body"></div></section>
  <div class="banner"></div>
  <div class="toast"></div>
  <div class="modal"></div>
  <canvas class="fx"></canvas>
`;
