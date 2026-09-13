import { readNumber, type Crop } from './glyphs';
import { boxCenterY, boxHeight, boxWidth, brightComponents, fillRatio, median } from './pixels';

/**
 * Lecture du tableau des scores de fin de manche.
 *
 * Aucune coordonnee n'est codee en dur. Le tableau se repere a ses douze
 * pictogrammes K/D/A : ce sont les seules composantes rigoureusement
 * identiques de l'image — meme largeur, meme hauteur, meme taux de
 * remplissage. Tout le reste s'en deduit, la valeur de score se trouvant juste
 * au-dessus et les trois chiffres juste en dessous, chaque carte de joueur
 * etant centree sur son triplet.
 *
 * Ce reperage vaut donc quelle que soit la definition de la captation et quel
 * que soit l'habillage qui entoure l'image de jeu, ce qui compte : les
 * rediffusions de league sont diffusees dans un cadre.
 */

export const INK_THRESHOLD = 150;

export interface PlayerCard {
  /** Abscisse du centre de la carte, dans l'image source. */
  centerX: number;
  score: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  /** Confiance du maillon faible parmi les quatre nombres lus. */
  margin: number;
}

export interface TeamBlock {
  /** Ordonnee de la rangee de pictogrammes, dans l'image source. */
  iconsY: number;
  iconsHeight: number;
  cards: PlayerCard[];
}

export interface ScoreboardReading {
  /**
   * Les deux equipes, de haut en bas. La rangee du haut est celle qui a
   * gagne la manche : le jeu place toujours le vainqueur au-dessus.
   */
  teams: TeamBlock[];
}

interface IconRow {
  iconsY: number;
  iconsHeight: number;
  /** Colonnes des pictogrammes, groupees par carte de trois. */
  cards: Array<{ centerX: number; columns: Array<[number, number]> }>;
}

/** Repere les rangees de pictogrammes K/D/A. */
function detectIconRows(luma: Float32Array, width: number, height: number): IconRow[] {
  const candidats = brightComponents(luma, width, height, INK_THRESHOLD)
    .filter((b) => {
      const h = boxHeight(b);
      const ratio = boxWidth(b) / h;
      // Un pictogramme est un hexagone : presque aussi large que haut.
      return h >= 12 && ratio >= 0.9 && ratio <= 1.35;
    })
    .map((box) => ({ box, fill: fillRatio(luma, width, box, INK_THRESHOLD) }));

  candidats.sort((a, b) => boxCenterY(a.box) - boxCenterY(b.box));

  // Regroupement par ligne de base.
  const rangees: Array<Array<(typeof candidats)[number]>> = [];
  for (const c of candidats) {
    const derniere = rangees[rangees.length - 1];
    const reference = derniere?.[0];
    if (derniere && reference && Math.abs(boxCenterY(c.box) - boxCenterY(reference.box)) < boxHeight(c.box) * 0.5) {
      derniere.push(c);
    } else {
      rangees.push([c]);
    }
  }

  const lignes: IconRow[] = [];
  for (const rangee of rangees) {
    if (rangee.length < 6) continue;

    // On ne garde que les composantes vraiment jumelles : c'est ce qui
    // distingue une rangee de pictogrammes d'une rangee de texte quelconque.
    const hauteurRef = median(rangee.map((c) => boxHeight(c.box)));
    const remplissageRef = median(rangee.map((c) => c.fill));
    const jumelles = rangee.filter(
      (c) =>
        Math.abs(boxHeight(c.box) - hauteurRef) <= Math.max(1, hauteurRef * 0.12) &&
        Math.abs(c.fill - remplissageRef) <= 0.08,
    );
    if (jumelles.length < 6 || jumelles.length % 3 !== 0) continue;

    jumelles.sort((a, b) => a.box.x0 - b.box.x0);
    const cards: IconRow['cards'] = [];
    for (let i = 0; i < jumelles.length; i += 3) {
      const triplet = jumelles.slice(i, i + 3);
      const columns = triplet.map((c) => [c.box.x0, c.box.x1] as [number, number]);
      const premier = columns[0] as [number, number];
      const dernier = columns[columns.length - 1] as [number, number];
      cards.push({ centerX: Math.round((premier[0] + dernier[1]) / 2), columns });
    }

    lignes.push({
      iconsY: Math.round(median(jumelles.map((c) => boxCenterY(c.box)))),
      iconsHeight: hauteurRef,
      cards,
    });
  }

  return lignes.filter(regularColumns);
}

/**
 * Les cartes d'un tableau sont alignees a intervalle constant.
 *
 * Ce controle ecarte les rangees de pictogrammes fortuites — un HUD en
 * contient d'autres — sans rien exiger de leur position absolue.
 */
function regularColumns(row: IconRow): boolean {
  if (row.cards.length < 2) return false;
  if (row.cards.length === 2) return true;
  const ecarts: number[] = [];
  for (let i = 1; i < row.cards.length; i++) {
    ecarts.push((row.cards[i] as { centerX: number }).centerX - (row.cards[i - 1] as { centerX: number }).centerX);
  }
  const reference = median(ecarts);
  return reference > 0 && ecarts.every((e) => Math.abs(e - reference) <= reference * 0.15);
}

/**
 * Retablit les cartes manquantes d'une rangee.
 *
 * Le jeu teinte la carte du meilleur joueur : son texte n'atteint pas le meme
 * contraste et ses pictogrammes echappent au seuil. Comme les deux equipes
 * partagent exactement les memes colonnes, on complete la rangee incomplete a
 * partir de l'autre plutot que de perdre un joueur.
 */
function completeGrid(rows: IconRow[]): void {
  if (rows.length < 2) return;
  const complete = rows.reduce((a, b) => (b.cards.length > a.cards.length ? b : a));
  for (const row of rows) {
    if (row.cards.length >= complete.cards.length) continue;
    const tolerance = Math.max(8, complete.iconsHeight);
    row.cards = complete.cards.map((reference) => {
      const proche = row.cards.find((c) => Math.abs(c.centerX - reference.centerX) <= tolerance);
      return proche ?? { centerX: reference.centerX, columns: [...reference.columns] };
    });
  }
}

function subCrop(luma: Float32Array, width: number, y0: number, y1: number, x0: number, x1: number): Crop {
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const w = Math.max(1, x1 - cx0);
  const h = Math.max(1, y1 - cy0);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] = luma[(cy0 + y) * width + (cx0 + x)] as number;
    }
  }
  return { luma: out, width: w, height: h };
}

/**
 * Lit le tableau des scores d'une image de fin de manche.
 *
 * Rend `null` quand la structure n'est pas reconnue : mieux vaut ne rien
 * annoncer qu'annoncer des chiffres tires d'un ecran qui n'est pas un tableau.
 */
export function readScoreboard(luma: Float32Array, width: number, height: number): ScoreboardReading | null {
  const rows = detectIconRows(luma, width, height);
  if (rows.length < 2) return null;
  completeGrid(rows);

  const teams: TeamBlock[] = [];
  for (const row of rows) {
    const h = row.iconsHeight;
    // Mesure sur captures : la valeur de score est centree a 1,6 hauteur de
    // pictogramme au-dessus, les chiffres K/D/A juste en dessous.
    const scoreY0 = row.iconsY - Math.round(h * 2.15);
    const scoreY1 = row.iconsY - Math.round(h * 1.0);
    const kdaY0 = row.iconsY + Math.round(h * 0.58);
    const kdaY1 = row.iconsY + Math.round(h * 1.62);

    const ecartCartes =
      row.cards.length > 1
        ? (row.cards[1] as { centerX: number }).centerX - (row.cards[0] as { centerX: number }).centerX
        : Math.round(h * 8.7);

    const cards: PlayerCard[] = row.cards.map((carte) => {
      const demi = Math.round(ecartCartes * 0.42);
      const score = readNumber(
        subCrop(luma, width, scoreY0, scoreY1, carte.centerX - demi, carte.centerX + demi),
        INK_THRESHOLD,
      );

      const centres = carte.columns.map(([a, b]) => Math.round((a + b) / 2));
      const ecartIcones = centres.length > 1 ? (centres[1] as number) - (centres[0] as number) : Math.round(h * 2);
      const marge = Math.round(ecartIcones * 0.46);
      const valeurs = centres.map((centre) =>
        readNumber(subCrop(luma, width, kdaY0, kdaY1, centre - marge, centre + marge), INK_THRESHOLD),
      );

      const toutes = [score, ...valeurs];
      return {
        centerX: carte.centerX,
        score: score.value,
        kills: valeurs[0]?.value ?? null,
        deaths: valeurs[1]?.value ?? null,
        assists: valeurs[2]?.value ?? null,
        margin: Math.min(...toutes.map((v) => v.margin)),
      };
    });

    teams.push({ iconsY: row.iconsY, iconsHeight: h, cards });
  }

  return { teams };
}
