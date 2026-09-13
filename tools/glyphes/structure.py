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
        if len(jumelles) < 6 or len(jumelles) % 3 != 0:
            continue

        jumelles.sort(key=lambda c: c[0][0])
        cartes = []
        for i in range(0, len(jumelles), 3):
            triplet = jumelles[i : i + 3]
            colonnes = [(c[0][0], c[0][2]) for c in triplet]
            centre = (colonnes[0][0] + colonnes[-1][1]) // 2
            cartes.append(Carte(centre_x=centre, colonnes=colonnes))

        y_centre = round(sum((c[0][1] + c[0][3]) / 2 for c in jumelles) / len(jumelles))
        blocs.append(BlocEquipe(icones_y=y_centre, icones_h=h_ref, cartes=cartes))

    blocs = [b for b in blocs if _colonnes_regulieres(b)]
    _completer_grille(blocs)
    return blocs


def _colonnes_regulieres(bloc: BlocEquipe) -> bool:
    """
    Les cartes d'un tableau sont alignees a intervalle constant.

    Ce controle ecarte les rangees de pictogrammes fortuites — un HUD en
    contient d'autres — sans rien exiger de la position absolue.
    """
    if len(bloc.cartes) < 2:
        return False
    if len(bloc.cartes) == 2:
        return True
    ecarts = [
        bloc.cartes[i + 1].centre_x - bloc.cartes[i].centre_x
        for i in range(len(bloc.cartes) - 1)
    ]
    median = sorted(ecarts)[len(ecarts) // 2]
    return median > 0 and all(abs(e - median) <= median * 0.15 for e in ecarts)


def _completer_grille(blocs: list[BlocEquipe]) -> None:
    """
    Retablit les cartes manquantes d'un bloc.

    La carte du meilleur joueur est teintee par le jeu : son texte n'atteint pas
    le meme contraste et ses pictogrammes echappent au seuil. Comme les deux
    equipes partagent exactement les memes colonnes, on complete le bloc
    incomplet a partir de l'autre plutot que de perdre un joueur.
    """
    if len(blocs) < 2:
        return
    complet = max(blocs, key=lambda b: len(b.cartes))
    for bloc in blocs:
        if len(bloc.cartes) >= len(complet.cartes):
            continue
        connus = {c.centre_x: c for c in bloc.cartes}
        tolerance = max(8, complet.icones_h)
        cartes = []
        for reference in complet.cartes:
            proche = next(
                (c for x, c in connus.items() if abs(x - reference.centre_x) <= tolerance),
                None,
            )
            cartes.append(proche or Carte(centre_x=reference.centre_x, colonnes=list(reference.colonnes)))
        bloc.cartes = cartes
