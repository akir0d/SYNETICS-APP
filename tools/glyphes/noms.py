"""
Reconnaissance des pseudos du tableau, par choix dans une liste fermee.

On ne cherche pas a lire un nom lettre a lettre pour le comparer ensuite : a
cette definition la police des noms est proportionnelle et les lettres se
touchent, si bien qu'on ne sait meme pas combien il y en a. On procede a
l'envers. Chaque pseudo connu — ceux que l'utilisateur a saisis — est
essaye : sa longueur fixe le decoupage, et on mesure a quel point les
lettres obtenues ressemblent a celles attendues. Le meilleur candidat gagne.

Une lecture mediocre suffit alors, puisqu'il ne s'agit plus d'etre exact mais
d'etre plus proche du bon nom que de tous les autres.
"""

from __future__ import annotations

import numpy as np

from construire import normaliser_gris
from pseudos import bande_nom, cellules, lignes_de_texte, placements


def _decoupes(nombre_lignes: int, longueur: int):
    """Repartitions possibles des lettres d'un candidat sur les lignes vues."""
    if nombre_lignes == 1:
        return [(longueur,)]
    if nombre_lignes != 2:
        return []
    return [(k, longueur - k) for k in range(1, longueur)]


def grilles_du_candidat(case, seuil, bandes, longueur: int):
    """Rend, pour chaque decoupe plausible, les grilles normalisees des lettres."""
    sorties = []
    for decoupe in _decoupes(len(bandes), longueur):
        # Chaque ligne a ses propres placements plausibles ; on les combine.
        par_ligne = [placements(case, seuil, bande, n) for bande, n in zip(bandes, decoupe)]
        if any(not p for p in par_ligne):
            continue
        for essai in range(max(len(p) for p in par_ligne)):
            grilles = []
            for choix in par_ligne:
                for boite in choix[min(essai, len(choix) - 1)]:
                    grilles.append(normaliser_gris(case, boite))
            sorties.append(grilles)
    return sorties


def lettres_etiquetees(lum, bloc, index: int, verite: str):
    """Exemplaires tires d'une carte dont on connait le pseudo."""
    case, seuil = bande_nom(lum, bloc, index)
    if seuil is None:
        return []
    bandes = lignes_de_texte(case, seuil, bloc.icones_h)
    morceaux = verite.split('|')
    if len(bandes) != len(morceaux):
        return []
    paires = []
    for bande, morceau in zip(bandes, morceaux):
        boites = cellules(case, seuil, bande, len(morceau))
        if len(boites) != len(morceau):
            return []
        for boite, lettre in zip(boites, morceau):
            paires.append((lettre, normaliser_gris(case, boite)))
    return paires


def identifier(lum, bloc, index: int, candidats, appris, etiquettes):
    """
    Rend le candidat le plus vraisemblable pour une carte, et sa marge.

    La marge est l'ecart entre le meilleur candidat et le suivant : c'est elle,
    et non la distance absolue, qui dit si la reconnaissance est sure. Une carte
    dont la marge est faible est signalee plutot que devinee.
    """
    case, seuil = bande_nom(lum, bloc, index)
    if seuil is None:
        return None, 0.0
    bandes = lignes_de_texte(case, seuil, bloc.icones_h)
    if not bandes:
        return None, 0.0

    par_lettre: dict[str, np.ndarray] = {}
    for lettre in set(etiquettes):
        par_lettre[lettre] = appris[[i for i, e in enumerate(etiquettes) if e == lettre]]

    scores = []
    for candidat in candidats:
        if any(c not in par_lettre for c in candidat):
            continue
        meilleur = None
        for grilles in grilles_du_candidat(case, seuil, bandes, len(candidat)):
            total = sum(
                float(((par_lettre[lettre] - grille) ** 2).mean(axis=1).min())
                for lettre, grille in zip(candidat, grilles)
            )
            moyenne = total / len(candidat)
            if meilleur is None or moyenne < meilleur:
                meilleur = moyenne
        if meilleur is not None:
            scores.append((meilleur, candidat))

    if not scores:
        return None, 0.0
    scores.sort()
    marge = (scores[1][0] - scores[0][0]) if len(scores) > 1 else 1.0
    return scores[0][1], marge
