// Les batiments qui s'ameliorent eux-memes (on les touche, pas besoin de l'etabli) :
// dix niveaux chacun, un nouvel aspect tous les deux niveaux, un bonus a chaque niveau.
// Le niveau du camp plafonne tout (comme un hotel de ville) : 4, 6, 8 puis 10.

import type { Cost } from './progress';

export type BId = 'bed1' | 'bed2' | 'bed3' | 'bed4' | 'field1' | 'field2' | 'field3' | 'sawmill' | 'kitchen' | 'armory';
type Kind = 'bed' | 'field' | 'saw' | 'cook' | 'arm';

export const BMAX = 10;

export interface BDef {
  id: BId;
  kind: Kind;
  name: string;
  icon: string;
  /** Pieces du niveau 2 (chaque niveau coute ensuite 60 % de plus). */
  base: number;
}

export const BDEFS: BDef[] = [
  { id: 'bed1', kind: 'bed', name: 'Potager de carottes', icon: '🥕', base: 150 },
  { id: 'bed2', kind: 'bed', name: 'Potager de carottes', icon: '🥕', base: 150 },
  { id: 'bed3', kind: 'bed', name: 'Potager de tomates', icon: '🍅', base: 170 },
  { id: 'bed4', kind: 'bed', name: 'Potager de tomates', icon: '🍅', base: 170 },
  { id: 'field1', kind: 'field', name: 'Champ de blé', icon: '🌾', base: 260 },
  { id: 'field2', kind: 'field', name: 'Champ de blé', icon: '🌾', base: 260 },
  { id: 'field3', kind: 'field', name: 'Champ de blé', icon: '🌾', base: 260 },
  { id: 'sawmill', kind: 'saw', name: 'Scierie', icon: '🪚', base: 320 },
  { id: 'kitchen', kind: 'cook', name: 'Cuisine', icon: '🍲', base: 420 },
  { id: 'armory', kind: 'arm', name: 'Armurerie', icon: '🛡️', base: 900 },
];
export const bdef = (id: string): BDef | undefined => BDEFS.find((d) => d.id === id);

/** Les cinq aspects, du plus rudimentaire au plus abouti. */
const STAGES: Record<Kind, string[]> = {
  bed: ['Terre retournée', 'Bordure de planches', 'Bac en bois', 'Bac surélevé arrosé', 'Serre en verre'],
  field: ['Champ défriché', 'Bordure de planches', 'Champ clôturé', 'Champ irrigué', 'Tunnel de culture'],
  saw: ['Chevalet de fortune', 'Scie sous bâche', 'Scierie à moteur', 'Atelier en dur', 'Scierie industrielle'],
  cook: ['Feu de camp', 'Poêle sous bâche', 'Cuisine couverte', 'Cuisine en dur', 'Cantine équipée'],
  arm: ['Caisse d’armes', 'Cabane renforcée', 'Blockhaus', 'Blockhaus fortifié', 'Bunker'],
};

/** Aspect (1 a 5) d'un niveau : il change aux niveaux 3, 5, 7 et 9. */
export const stageOf = (lv: number): number => Math.max(1, Math.min(5, Math.ceil(lv / 2)));
export const stageName = (d: BDef, lv: number): string => STAGES[d.kind][stageOf(lv) - 1]!;

/** Niveau le plus haut permis par le niveau du camp. */
export const capOf = (campLv: number): number => Math.min(BMAX, 2 + 2 * Math.max(1, campLv));

/** Ce que coute le passage au niveau `next` (2 a 10) : du bois, puis de la pierre, puis du metal. */
export function bCost(d: BDef, next: number): Cost {
  const c: Cost = { coins: Math.round((d.base * Math.pow(1.6, next - 2)) / 10) * 10 };
  const k = d.kind;
  if (next <= 4) {
    if (k === 'saw') c.log = 8 * (next - 1);
    else if (k === 'arm') { c.scrap = 10 * (next - 1); c.plank = 10; }
    else c.plank = (k === 'cook' ? 5 : k === 'field' ? 6 : 4) * (next - 1);
  } else if (next <= 6) {
    c.plank = k === 'arm' ? 0 : 10;
    c.stone = (k === 'bed' ? 6 : k === 'arm' ? 10 : 8) * (next - 4);
    if (k === 'arm') c.scrap = 20;
  } else if (next <= 8) {
    c.stone = (k === 'bed' ? 10 : 12) * (next - 6);
    c.scrap = k === 'arm' ? 25 : k === 'bed' ? 8 : 10;
    if (k === 'arm') c.metal = 4 * (next - 6);
  } else {
    // La serre et les machines : du metal (et de la ferraille pour le verre).
    c.metal = (k === 'bed' ? 4 : k === 'arm' ? 8 : 5) * (next - 8);
    c.scrap = k === 'bed' ? 12 : 15;
    if (k === 'arm') c.stone = 20;
  }
  for (const key of Object.keys(c) as (keyof Cost)[]) if (c[key] === 0 && key !== 'coins') delete c[key];
  return c;
}

/** Il faut la carriere pour la pierre (niveaux 5 a 8), la fonderie pour le metal (9 et 10). */
export const needOf = (d: BDef, next: number): 'quarry' | 'foundry' | null => {
  const c = bCost(d, next);
  return c.metal ? 'foundry' : c.stone ? 'quarry' : null;
};

// ---- les bonus

/** Croissance des cultures : +10 % par niveau. */
export const growOf = (lv: number): number => 1 + 0.1 * (lv - 1);
/** Chance de recolte double : 4 % par niveau. */
export const doubleOf = (lv: number): number => 0.04 * (lv - 1);
/** Cadence des machines : +25 % par niveau. */
export const speedOf = (lv: number): number => 1 + 0.25 * (lv - 1);
/** Chance d'un produit en plus a chaque fournee : 3 % par niveau. */
export const extraOf = (lv: number): number => 0.03 * (lv - 1);
/** Armurerie : les chasseurs de prime frappent plus fort (+1 tous les deux niveaux). */
export const huntBonusOf = (lv: number): number => Math.floor((lv - 1) / 2);

/** Ce que l'armurerie debloque : le fusil a pompe au niveau 3, l'arbalete au niveau 5. */
export const WEAPON_NEED: Record<string, number> = { rifle: 1, shotgun: 3, crossbow: 5 };

export function bonusText(d: BDef, lv: number): string {
  switch (d.kind) {
    case 'bed':
    case 'field':
      return `Pousse +${Math.round(100 * (growOf(lv) - 1))} % · récolte double ${Math.round(100 * doubleOf(lv))} %`;
    case 'saw':
      return `Cadence +${Math.round(100 * (speedOf(lv) - 1))} % · planche en plus ${Math.round(100 * extraOf(lv))} %`;
    case 'cook':
      return `Cadence +${Math.round(100 * (speedOf(lv) - 1))} % · bol en plus ${Math.round(100 * extraOf(lv))} %`;
    case 'arm': {
      const un = lv >= 5 ? 'pompe et arbalète' : lv >= 3 ? 'fusil à pompe' : 'fusil';
      return `Armes jusqu’au niv. ${lv} · ${un} · chasseurs +${huntBonusOf(lv)} dégâts`;
    }
  }
}

// ---- les armes : chacune a son niveau (1 a 10), plafonne par celui de l'armurerie

const W_BASE: Record<string, number> = { rifle: 300, shotgun: 900, crossbow: 1500 };

/** Passage de l'arme au niveau `next` (2 a 10) : pieces, ferraille, puis metal. */
export function wCost(id: string, next: number): Cost {
  const c: Cost = { coins: Math.round(((W_BASE[id] ?? 500) * Math.pow(1.55, next - 2)) / 10) * 10, scrap: 5 * (next - 1) };
  if (next >= 6) c.metal = 2 * (next - 5);
  return c;
}
