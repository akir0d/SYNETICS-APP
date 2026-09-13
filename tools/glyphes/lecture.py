"""Decoupe et normalisation des nombres du tableau des scores."""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from structure import BlocEquipe

GLYPHE_L, GLYPHE_H = 16, 24


# Rapport mesure entre le pas de la police du HUD et la hauteur de ses glyphes.
# Il vaut 0,84 avec un ecart de moins de 5 % sur toutes les captures relevees.
PAS_SUR_HAUTEUR = 0.84


def _glyphes(lum: np.ndarray, y0: int, y1: int, x0: int, x1: int, seuil: float):
    """
    Glyphes d'une case, de gauche a droite.

    Trois precautions, chacune tiree d'une erreur constatee :

    - on part des blocs d'encre reels, et non d'une grille ancree sur le bord
      gauche : un nombre commencant par 1 decalait toute la grille, ce chiffre
      etant etroit mais centre dans sa chasse ;
    - un bloc trop large pour un seul glyphe est redecoupe, car a la definition
      d'une captation compressee deux chiffres voisins se touchent souvent par
      leur anti-crenelage ;
    - chaque glyphe est finalement cadre sur une boite de largeur constante,
      centree sur son encre. Sans cela un 1 isole, serre sur son trait, ne se
      normalisait pas comme le meme 1 pris dans un bloc de deux chiffres.
    """
    y0, x0 = max(0, y0), max(0, x0)
    case = lum[y0:y1, x0:x1]
    if case.size == 0:
        return case, []

    encre = case > seuil
    profil = encre.sum(axis=0)
    lignes = encre.any(axis=1).nonzero()[0]
    if len(lignes) == 0 or profil.sum() == 0:
        return case, []

    hy0, hy1 = int(lignes[0]), int(lignes[-1]) + 1
    hauteur = hy1 - hy0
    if hauteur < (y1 - y0) * 0.3:
        return case, []

    pas = PAS_SUR_HAUTEUR * hauteur

    blocs = []
    debut = None
    for x, total in enumerate(list(profil) + [0]):
        if total > 0 and debut is None:
            debut = x
        elif total == 0 and debut is not None:
            blocs.append((debut, x))
            debut = None

    centres = []
    for bx0, bx1 in blocs:
        largeur = bx1 - bx0
        if largeur < pas * 0.12:
            continue  # poussiere, trop etroit meme pour un 1
        nombre = max(1, round(largeur / pas + 0.19))
        for i in range(nombre):
            sx0 = bx0 + largeur * i / nombre
            sx1 = bx0 + largeur * (i + 1) / nombre
            colonne = profil[int(sx0) : max(int(sx0) + 1, int(sx1))]
            if colonne.sum() == 0:
                continue
            poids = np.arange(int(sx0), int(sx0) + len(colonne))
            centres.append(float((poids * colonne).sum() / colonne.sum()))

    demi = pas / 2
    boites = []
    for centre in centres:
        px0 = max(0, round(centre - demi))
        px1 = min(case.shape[1], round(centre + demi))
        if px1 - px0 >= 2:
            boites.append((px0, hy0, px1, hy1))

    return case, boites


def normaliser(case: np.ndarray, boite, seuil: float) -> np.ndarray:
    x0, y0, x1, y1 = boite
    encre = case[y0:y1, x0:x1] > seuil
    h, w = encre.shape
    grille = np.zeros((GLYPHE_H, GLYPHE_L))
    for gy in range(GLYPHE_H):
        ya = int(gy * h / GLYPHE_H)
        yb = max(int((gy + 1) * h / GLYPHE_H), ya + 1)
        for gx in range(GLYPHE_L):
            xa = int(gx * w / GLYPHE_L)
            xb = max(int((gx + 1) * w / GLYPHE_L), xa + 1)
            bloc = encre[ya:yb, xa:xb]
            grille[gy, gx] = float(bloc.mean()) if bloc.size else 0.0
    return grille


def cases_du_bloc(bloc: BlocEquipe):
    """
    Enumere les cases lisibles du bloc : la valeur de score de chaque carte,
    puis ses trois valeurs K, D et A.

    Chaque case est bornee par la geometrie du tableau lui-meme, jamais par des
    coordonnees absolues : un nombre a deux chiffres deborde son pictogramme,
    mais jamais la moitie de l'ecart avec le pictogramme voisin.
    """
    ecart_cartes = (
        bloc.cartes[1].centre_x - bloc.cartes[0].centre_x if len(bloc.cartes) > 1 else 254
    )
    for index, carte in enumerate(bloc.cartes):
        sy0, sy1 = bloc.bande_score
        demi = round(ecart_cartes * 0.42)
        yield ('score', index, None, sy0, sy1, carte.centre_x - demi, carte.centre_x + demi)

        centres = [(c[0] + c[1]) // 2 for c in carte.colonnes]
        ecart_icones = (centres[1] - centres[0]) if len(centres) > 1 else 60
        marge = round(ecart_icones * 0.46)
        ky0, ky1 = bloc.bande_kda
        for colonne, centre in enumerate(centres):
            yield ('kda', index, colonne, ky0, ky1, centre - marge, centre + marge)


# Part du contraste local a partir de laquelle un pixel compte comme de l'encre.
FRACTION_ENCRE = 0.55

# En deca de ce contraste, la case ne contient pas de texte : la seuiller
# reviendrait a decouper du bruit de compression en faux chiffres.
CONTRASTE_MINIMAL = 40.0


def seuil_local(case: np.ndarray) -> float | None:
    """
    Seuil d'encre propre a une case, plutot qu'une valeur unique pour l'image.

    Le jeu teinte la carte du meilleur joueur : ses chiffres restent lisibles
    mais bien plus sombres que ceux des autres cartes. Un seuil fixe les
    effacait purement et simplement, et la carte revenait vide. Le contraste
    local, lui, ne depend ni de la teinte ni de la luminosite de l'arene.
    """
    if case.size == 0:
        return None
    # Le fond, c'est la mediane : dans une case de tableau le texte est
    # toujours minoritaire. Prendre le minimum a la place ferait plonger le
    # seuil des qu'un recoin sombre borde une case posee sur un fond clair, et
    # le grain de la compression se decouperait alors en faux chiffres.
    bas = float(np.median(case))
    haut = float(np.percentile(case, 99.5))
    if haut - bas < CONTRASTE_MINIMAL:
        return None
    return bas + FRACTION_ENCRE * (haut - bas)


def lire_case(lum: np.ndarray, case_def, seuil: float | None = None):
    _, _, _, y0, y1, x0, x1 = case_def
    if seuil is None:
        seuil = seuil_local(lum[max(0, y0):y1, max(0, x0):x1])
        if seuil is None:
            return np.zeros((0, 0)), []
    return _glyphes(lum, y0, y1, x0, x1, seuil)
