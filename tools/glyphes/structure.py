"""
Detection de la structure du tableau des scores d'EVA.

Aucune coordonnee en dur : le tableau se repere a ses douze pictogrammes
K/D/A, qui forment deux rangees de composantes rigoureusement identiques —
meme largeur, meme hauteur, meme taux de remplissage. Une fois ces rangees
trouvees, tout le reste se deduit : la valeur de score est juste au-dessus, les
trois chiffres K/D/A juste en dessous, et chaque carte de joueur est centree
sur son triplet d'icones.

Ce reperage vaut donc quelle que soit la definition de la captation et quel que
soit l'habillage autour de l'image de jeu.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

# Une equipe d'EVA aligne toujours quatre joueurs.
CARTES_PAR_EQUIPE = 4


@dataclass
class Carte:
    """Une carte de joueur : sa colonne, et les trois colonnes K, D, A."""

    centre_x: int
    colonnes: list[tuple[int, int]]


@dataclass
class BlocEquipe:
    """Une des deux equipes du tableau."""

    icones_y: int
    icones_h: int
    cartes: list[Carte]

    @property
    def bande_score(self) -> tuple[int, int]:
        """Bande verticale ou se lit la valeur de score."""
        # Mesure sur les captures : la valeur est centree a 1,6 hauteur
        # d'icone au-dessus des pictogrammes, et fait environ 0,7 hauteur.
        return (
            self.icones_y - round(self.icones_h * 2.15),
            self.icones_y - round(self.icones_h * 1.0),
        )

    @property
    def bande_kda(self) -> tuple[int, int]:
        """Bande verticale ou se lisent les trois chiffres K, D et A."""
        # Les pictogrammes s'arretent a une demi-hauteur sous leur centre ; les
        # chiffres suivent immediatement et font environ 0,8 hauteur d'icone.
        return (
            self.icones_y + round(self.icones_h * 0.58),
            self.icones_y + round(self.icones_h * 1.62),
        )


def composantes(lum: np.ndarray, seuil: float = 150):
    lab, _ = ndimage.label(lum > seuil)
    boites = []
    for sl in ndimage.find_objects(lab):
        y0, y1 = sl[0].start, sl[0].stop
        x0, x1 = sl[1].start, sl[1].stop
        boites.append((x0, y0, x1, y1))
    return boites


def _remplissage(lum: np.ndarray, boite, seuil: float) -> float:
    x0, y0, x1, y1 = boite
    return float((lum[y0:y1, x0:x1] > seuil).mean())


def detecter_blocs(lum: np.ndarray, seuil: float = 150) -> list[BlocEquipe]:
    """Retrouve les deux rangees d'icones K/D/A, et en deduit les cartes."""
    boites = composantes(lum, seuil)

    # Les icones sont des hexagones : hauteur moderee, presque aussi larges que
    # hautes, et un remplissage tres stable d'une icone a l'autre.
    candidats = []
    for b in boites:
        h, w = b[3] - b[1], b[2] - b[0]
        if h < 12 or not (0.9 <= w / h <= 1.35):
            continue
        candidats.append((b, h, w, _remplissage(lum, b, seuil)))

    # Regroupement par ligne de base.
    candidats.sort(key=lambda c: (c[0][1] + c[0][3]) / 2)
    rangees: list[list] = []
    for c in candidats:
        centre = (c[0][1] + c[0][3]) / 2
        if rangees and abs(centre - (rangees[-1][0][0][1] + rangees[-1][0][0][3]) / 2) < c[1] * 0.5:
            rangees[-1].append(c)
        else:
            rangees.append([c])

    blocs: list[BlocEquipe] = []
    for rangee in rangees:
        if len(rangee) < 6:
            continue
        # On ne garde que les composantes vraiment jumelles : c'est ce qui
        # distingue une rangee d'icones d'une rangee de texte quelconque.
        hauteurs = sorted(c[1] for c in rangee)
        h_ref = hauteurs[len(hauteurs) // 2]
        remplissages = sorted(c[3] for c in rangee)
        r_ref = remplissages[len(remplissages) // 2]
        jumelles = [
            c
            for c in rangee
            if abs(c[1] - h_ref) <= max(1, h_ref * 0.12) and abs(c[3] - r_ref) <= 0.08
        ]
        if len(jumelles) < 6:
            continue

        jumelles.sort(key=lambda c: c[0][0])
        cartes = _cartes_sur_grille(jumelles)
        if cartes is None:
            continue

        y_centre = round(sum((c[0][1] + c[0][3]) / 2 for c in jumelles) / len(jumelles))
        blocs.append(BlocEquipe(icones_y=y_centre, icones_h=h_ref, cartes=cartes))

    return blocs


def _cartes_sur_grille(jumelles) -> list[Carte] | None:
    """
    Retient les icones posees sur la grille du tableau, et rien d'autre.

    Compter les icones ne suffit pas. Une capture reelle en donne trop — un
    badge d'equipe, un pictogramme de zone tombent dans le meme gabarit — ou
    trop peu : la carte du meilleur joueur est teintee par le jeu et ses icones
    n'atteignent pas le seuil. Dans les deux cas un simple decompte se trompe,
    et sans bruit : douze icones plus un intrus fait treize, donc la rangee est
    jetee ; neuf icones font trois cartes credibles, donc les valeurs sont lues
    une carte a cote.

    L'invariant solide est ailleurs : les icones d'un tableau forment une grille
    reguliere, trois par carte et un pas constant entre cartes. On s'appuie donc
    sur les ecarts. Les icones d'une meme carte sont bien plus proches entre
    elles que deux cartes voisines, ce qui decoupe les groupes sans seuil
    absolu ; on ne retient que les groupes de trois ; puis on verifie que leurs
    centres sont equidistants, et on rebouche les trous de la grille. Un intrus
    isole forme un groupe de un et disparait ; une carte eteinte laisse un trou
    que le pas permet de retrouver.
    """
    if len(jumelles) < 3:
        return None

    centres = [(c[0][0] + c[0][2]) / 2 for c in jumelles]
    ecarts = sorted(centres[i + 1] - centres[i] for i in range(len(centres) - 1))
    if not ecarts:
        return None
    pas_icone = ecarts[len(ecarts) // 2]
    if pas_icone <= 0:
        return None

    groupes: list[list] = [[jumelles[0]]]
    for precedent, courant, c in zip(centres, centres[1:], jumelles[1:]):
        if courant - precedent <= pas_icone * 1.5:
            groupes[-1].append(c)
        else:
            groupes.append([c])

    triplets = [g for g in groupes if len(g) == 3]
    if len(triplets) < 2:
        return None

    cartes = [
        Carte(
            centre_x=(g[0][0][0] + g[-1][0][2]) // 2,
            colonnes=[(c[0][0], c[0][2]) for c in g],
        )
        for g in triplets
    ]

    pas_carte = _pas_regulier([c.centre_x for c in cartes])
    if pas_carte is None:
        return None
    return _reboucher(cartes, pas_carte)


def _pas_regulier(centres: list[int]) -> int | None:
    """
    Pas constant entre cartes, ou None si elles ne sont pas alignees.

    Une carte eteinte laisse un ecart double : on l'admet, c'est justement le
    trou qu'on cherche a reboucher. Tout autre ecart trahit un faux positif.
    """
    if len(centres) < 2:
        return None
    ecarts = [centres[i + 1] - centres[i] for i in range(len(centres) - 1)]
    pas = min(ecarts)
    if pas <= 0:
        return None
    for e in ecarts:
        multiple = round(e / pas)
        if multiple < 1 or abs(e - multiple * pas) > pas * 0.15:
            return None
    return pas


def _reboucher(cartes: list[Carte], pas: int) -> list[Carte]:
    """
    Recree les cartes absentes, dans les trous et aux deux bords.

    Les colonnes d'une carte manquante sont celles de sa voisine, translatees :
    toutes les cartes partagent le meme gabarit.
    """
    modele = cartes[0]
    largeurs = [(c[0] - modele.centre_x, c[1] - modele.centre_x) for c in modele.colonnes]

    def fabriquer(centre_x: int) -> Carte:
        return Carte(
            centre_x=centre_x,
            colonnes=[(centre_x + a, centre_x + b) for a, b in largeurs],
        )

    complet = [cartes[0]]
    for precedente, carte in zip(cartes, cartes[1:]):
        manquantes = round((carte.centre_x - precedente.centre_x) / pas) - 1
        for i in range(1, manquantes + 1):
            complet.append(fabriquer(precedente.centre_x + i * pas))
        complet.append(carte)

    # Un tableau d'EVA compte quatre cartes par equipe. Si la grille en montre
    # moins, les manquantes sont forcement aux extremites : on les prolonge tant
    # qu'elles tiennent dans l'image, en partant du bord le plus proche.
    while len(complet) < CARTES_PAR_EQUIPE:
        gauche = complet[0].centre_x - pas
        if gauche - pas // 2 > 0:
            complet.insert(0, fabriquer(gauche))
        else:
            complet.append(fabriquer(complet[-1].centre_x + pas))
    return complet
