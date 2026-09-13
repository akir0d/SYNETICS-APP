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
   * Les deux equipes, de haut en bas.
   *
   * L'ordre suit le camp — Alliance au-dessus, Rebels en dessous — et non le
   * resultat. Une capture de Carolo League le montre sans ambiguite : Alliance
   * est en haut avec 24 %, Rebels en dessous avec 100 %, et c'est Rebels qui
   * remporte la manche. Le vainqueur se lit au pourcentage, jamais a la
   * position de la rangee.
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
    if (jumelles.length < 6) continue;

    jumelles.sort((a, b) => a.box.x0 - b.box.x0);
    const cards = cardsOnLattice(jumelles.map((c) => [c.box.x0, c.box.x1] as [number, number]));
    if (!cards) continue;

    lignes.push({
      iconsY: Math.round(median(jumelles.map((c) => boxCenterY(c.box)))),
      iconsHeight: hauteurRef,
      cards,
    });
  }

  return lignes;
}

/** Une equipe d'EVA aligne toujours quatre joueurs. */
const CARDS_PER_TEAM = 4;

/**
 * Retient les pictogrammes poses sur la grille du tableau, et rien d'autre.
 *
 * Les compter ne suffit pas. Une capture reelle en donne trop — un badge
 * d'equipe, un pictogramme de zone tombent dans le meme gabarit — ou trop peu :
 * le jeu teinte la carte du meilleur joueur et ses pictogrammes echappent au
 * seuil. Dans les deux cas un simple decompte se trompe, et sans bruit : douze
 * pictogrammes plus un intrus font treize, donc la rangee entiere est jetee ;
 * neuf font trois cartes credibles, donc les valeurs sont lues une carte a
 * cote.
 *
 * L'invariant solide est ailleurs : les pictogrammes forment une grille
 * reguliere, trois par carte et un pas constant entre cartes. On s'appuie donc
 * sur les ecarts. Ceux d'une meme carte sont bien plus courts que l'ecart entre
 * deux cartes voisines, ce qui decoupe les groupes sans seuil absolu ; on ne
 * retient que les groupes de trois ; puis on verifie que leurs centres sont
 * equidistants, et on rebouche les trous. Un intrus isole forme un groupe de un
 * et disparait ; une carte eteinte laisse un trou que le pas permet de
 * retrouver.
 */
function cardsOnLattice(colonnes: Array<[number, number]>): IconRow['cards'] | null {
  if (colonnes.length < 3) return null;

  const centres = colonnes.map(([a, b]) => (a + b) / 2);
  const ecarts: number[] = [];
  for (let i = 1; i < centres.length; i++) {
    ecarts.push((centres[i] as number) - (centres[i - 1] as number));
  }
  const pasIcone = median(ecarts);
  if (!(pasIcone > 0)) return null;

  const groupes: Array<Array<[number, number]>> = [[colonnes[0] as [number, number]]];
  for (let i = 1; i < colonnes.length; i++) {
    const saut = (centres[i] as number) - (centres[i - 1] as number);
    if (saut <= pasIcone * 1.5) {
      (groupes[groupes.length - 1] as Array<[number, number]>).push(colonnes[i] as [number, number]);
    } else {
      groupes.push([colonnes[i] as [number, number]]);
    }
  }

  const triplets = groupes.filter((g) => g.length === 3);
  if (triplets.length < 2) return null;

  const cartes = triplets.map((g) => ({
    centerX: Math.round(((g[0] as [number, number])[0] + (g[2] as [number, number])[1]) / 2),
    columns: g,
  }));

  const pas = regularPitch(cartes.map((c) => c.centerX));
  if (pas === null) return null;
  return fillGaps(cartes, pas);
}

/**
 * Pas constant entre cartes, ou `null` si elles ne sont pas alignees.
 *
 * Une carte eteinte laisse un ecart double : on l'admet, c'est justement le
 * trou qu'on cherche a reboucher. Tout autre ecart trahit un faux positif.
 */
function regularPitch(centres: number[]): number | null {
  if (centres.length < 2) return null;
  const ecarts: number[] = [];
  for (let i = 1; i < centres.length; i++) {
    ecarts.push((centres[i] as number) - (centres[i - 1] as number));
  }
  const pas = Math.min(...ecarts);
  if (!(pas > 0)) return null;
  for (const e of ecarts) {
    const multiple = Math.round(e / pas);
    if (multiple < 1 || Math.abs(e - multiple * pas) > pas * 0.15) return null;
  }
  return pas;
}

/**
 * Recree les cartes absentes, dans les trous et aux deux bords.
 *
 * Les colonnes d'une carte manquante sont celles d'une voisine, translatees :
 * toutes les cartes partagent le meme gabarit.
 */
function fillGaps(cartes: IconRow['cards'], pas: number): IconRow['cards'] {
  const modele = cartes[0] as IconRow['cards'][number];
  const largeurs = modele.columns.map(
    ([a, b]) => [a - modele.centerX, b - modele.centerX] as [number, number],
  );
  const fabriquer = (centerX: number) => ({
    centerX,
    columns: largeurs.map(([a, b]) => [centerX + a, centerX + b] as [number, number]),
  });

  const complet: IconRow['cards'] = [modele];
  for (let i = 1; i < cartes.length; i++) {
    const precedente = cartes[i - 1] as IconRow['cards'][number];
    const carte = cartes[i] as IconRow['cards'][number];
    const manquantes = Math.round((carte.centerX - precedente.centerX) / pas) - 1;
    for (let k = 1; k <= manquantes; k++) complet.push(fabriquer(precedente.centerX + k * pas));
    complet.push(carte);
  }

  // Si la grille montre moins de quatre cartes, les manquantes sont forcement
  // aux extremites : on prolonge tant qu'elles tiennent dans l'image.
  while (complet.length < CARDS_PER_TEAM) {
    const gauche = (complet[0] as IconRow['cards'][number]).centerX - pas;
    if (gauche - pas / 2 > 0) complet.unshift(fabriquer(gauche));
    else complet.push(fabriquer((complet[complet.length - 1] as IconRow['cards'][number]).centerX + pas));
  }
  return complet;
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
      );

      const centres = carte.columns.map(([a, b]) => Math.round((a + b) / 2));
      const ecartIcones = centres.length > 1 ? (centres[1] as number) - (centres[0] as number) : Math.round(h * 2);
      const marge = Math.round(ecartIcones * 0.46);
      const valeurs = centres.map((centre) =>
        readNumber(subCrop(luma, width, kdaY0, kdaY1, centre - marge, centre + marge)),
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
