"""
Verite terrain des pseudos, et decoupe de la bande de noms.

Le pseudo porte le tag de l'equipe : chez EVA on ecrit TAG + x + pseudo, ce
qui donne SYNxAKIROD pour le joueur akirod de Synetics. Les quatre joueurs
d'une equipe partagent donc un debut commun, et c'est ce debut — pas un
reglage de l'application — qui separe les deux camps sur un tableau.
"""

from __future__ import annotations

import numpy as np

from donnees import RACINE as RACINE_CAPTURES  # noqa: F401
from structure import BlocEquipe

# Bande verticale ou s'ecrivent les noms, en hauteurs de pictogramme.
# Un nom trop long passe sur deux lignes : la bande les couvre toutes deux,
# tout en s'arretant avant le libelle « SCORE » qui suit.
NOM_HAUT, NOM_BAS = -4.6, -2.9

# Une ligne de nom fait environ une demi-hauteur de pictogramme. En dessous
# c'est le libelle « SCORE », au-dessus c'est l'avatar du joueur.
LIGNE_MIN, LIGNE_MAX = 0.42, 0.65

# Demi-largeur d'une carte, en hauteurs de pictogramme.
DEMI_CARTE = 3.4

# Encombrement d'une lettre, rapporte a la hauteur de la ligne. Mesure sur les
# captures de reference : de 0,81 a 1,07 selon les lettres et la definition.
# C'est une contrainte forte et gratuite : un candidat dont la longueur
# imposerait un pas hors de cette plage ne peut pas etre le bon nom, quelle que
# soit la ressemblance des lettres prises une a une.
PAS_MIN, PAS_MAX = 0.76, 1.16


# Verite terrain, carte par carte. La barre verticale marque l'endroit ou le
# jeu a coupe un nom trop long pour la carte ; elle ne fait pas partie du
# pseudo et sert uniquement a placer les lettres pendant l'apprentissage.
PSEUDOS = {
    'cf3a69f0.jpg': [
        ['SYNXKALAS', 'SYNXAKIROD', 'SYNXSIGWOLF', 'SYNXK6'],
        ['NNXDRATZO', 'NNXKENZOY', 'NNXLENATH', 'NNXXOFOX'],
    ],
    '4df5ce74.jpg': [
        ['GTXCED', 'GTXDRONLAS', 'GTXKARIS', 'GTXOKAY.JAMES'],
        ['SYNXKALAS', 'SYNXAKIROD', 'SYNXK6', 'SYNXSIGWOLF'],
    ],
    'df7af499.jpg': [
        ['SRCLXSYROWX', 'SRCLXCAPI', 'SRCLXLYZBETH', 'SRCLXOCTOPY'],
        ['WYRMXYRONO|S', 'WYRMXWORM|BOA', 'WYRMXREYKO', 'WYRMXMRION'],
    ],
    'carolo-moux-nnx.jpg': [
        ['MOUXDARUDE', 'MOUXTWILI', 'MOUXCOURGET|TE', 'MOUXSTIQUAIR|E'],
        ['NNXKENZOY', 'NNXLENATH', 'NNXDRATZO', 'NNXXOFOX'],
    ],
}


def cellules(case: np.ndarray, seuil: float, bande, nombre: int):
    """
    Decoupe une ligne de texte en un nombre de cellules impose.

    C'est le point ou la liste fermee des pseudos change tout. Sans elle il
    faudrait deviner combien de lettres contient la ligne, et la police des
    noms est proportionnelle : estimer son pas par autocorrelation se trompe
    d'une a deux lettres une fois sur deux. Avec un candidat en main la
    longueur est connue, donc le pas vaut exactement l'etendue de l'encre
    divisee par cette longueur, et le decoupage cesse d'etre une devinette.
    """
    y0, y1 = bande
    encre = case[y0:y1] > seuil
    colonnes = encre.any(axis=0).nonzero()[0]
    if len(colonnes) == 0 or nombre <= 0:
        return []
    x0, x1 = int(colonnes[0]), int(colonnes[-1]) + 1
    pas = (x1 - x0) / nombre
    return grille_de_cellules(x0, pas, y0, y1, nombre)


def grille_de_cellules(x0: float, pas: float, y0: int, y1: int, nombre: int):
    return [(round(x0 + i * pas), y0, round(x0 + (i + 1) * pas), y1) for i in range(nombre)]


def placements(case: np.ndarray, seuil: float, bande, nombre: int):
    """
    Placements plausibles des cellules d'une ligne, du plus au moins probable.

    Diviser l'etendue de l'encre par le nombre de lettres donne un pas
    legerement trop court : cette etendue s'arrete au dernier trait encre, alors
    que l'avance de la police va au-dela. L'erreur est minuscule sur une lettre
    et se cumule jusqu'a decaler d'un cinquieme de caractere en fin de nom, ce
    qui suffit a faire echouer la reconnaissance. Plutot que de modeliser cette
    avance, on essaie quelques pas et quelques origines autour de l'estimation
    et on garde le meilleur accord.
    """
    y0, y1 = bande
    encre = case[y0:y1] > seuil
    colonnes = encre.any(axis=0).nonzero()[0]
    if len(colonnes) == 0 or nombre <= 0:
        return []
    x0, x1 = int(colonnes[0]), int(colonnes[-1]) + 1
    base = (x1 - x0) / nombre
    hauteur = y1 - y0
    if not (PAS_MIN * hauteur <= base <= PAS_MAX * hauteur):
        return []
    sorties = []
    for facteur in (1.0, 1.03, 1.06, 1.09):
        for decalage in (0, -1, -2, 1):
            sorties.append(grille_de_cellules(x0 + decalage, base * facteur, y0, y1, nombre))
    return sorties


def bande_nom(lum: np.ndarray, bloc: BlocEquipe, index: int):
    """Rend la sous-image ou s'ecrit le nom d'une carte, et son seuil d'encre."""
    h = bloc.icones_h
    y0 = bloc.icones_y + round(h * NOM_HAUT)
    y1 = bloc.icones_y + round(h * NOM_BAS)
    demi = round(h * DEMI_CARTE)
    centre = bloc.cartes[index].centre_x
    case = lum[max(0, y0) : y1, max(0, centre - demi) : centre + demi]
    if case.size == 0:
        return case, None
    fond = float(np.median(case))
    seuil = fond + 0.55 * (float(np.percentile(case, 99.5)) - fond)
    return case, seuil


def lignes_de_texte(case: np.ndarray, seuil: float, hauteur_icone: int):
    """
    Les lignes du nom, de haut en bas.

    Un pseudu trop long pour la carte est coupe par le jeu sur deux lignes ; on
    les rend separement, a charge de l'appelant de les recoller. Les traces
    trop courtes sont ecartees : ce sont le libelle « SCORE » en petites
    capitales, ou un morceau d'avatar.
    """
    encre = (case > seuil).sum(axis=1)
    bandes = []
    debut = None
    for y, valeur in enumerate(list(encre) + [0]):
        if valeur > 2 and debut is None:
            debut = y
        elif valeur <= 2 and debut is not None:
            hauteur = y - debut
            # Une trace collee au bord haut de la bande est forcement tronquee :
            # c'est un bas d'avatar, jamais un nom, que la bande encadre large.
            tronquee = debut == 0
            if not tronquee and LIGNE_MIN * hauteur_icone <= hauteur <= LIGNE_MAX * hauteur_icone:
                bandes.append((debut, y))
            debut = None
    return bandes
