"""
Validation croisee de la reconnaissance des pseudos.

Chaque capture est lue avec des exemplaires de lettres tires uniquement des
*autres*, et le tableau doit etre explique par une des equipes connues : quatre
cartes, quatre joueurs de la meme equipe, dans l'ordre qui colle le mieux.

Ce script existe pour repondre a une question precise : peut-on nommer les
joueurs d'une equipe que l'application n'a jamais vue ? Sa reponse est non, et
elle est nette. Le garder permet de la reverifier des que de nouvelles captures
arrivent, plutot que de rediscuter de memoire.
"""

from __future__ import annotations

import sys
from itertools import permutations
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from construire import luminance  # noqa: E402
from noms import grilles_du_candidat, lettres_etiquetees  # noqa: E402
from pseudos import PSEUDOS, RACINE_CAPTURES, bande_nom, lignes_de_texte  # noqa: E402
from structure import detecter_blocs  # noqa: E402


def equipes_connues() -> dict[str, list[str]]:
    """Regroupe les pseudos par debut commun : le tag colle devant le pseudo."""
    tous = sorted({n.replace('|', '') for c in PSEUDOS.values() for e in c for n in e})
    groupes: dict[str, list[str]] = {}
    for capture in PSEUDOS.values():
        for equipe in capture:
            membres = sorted({n.replace('|', '') for n in equipe})
            groupes[prefixe_commun(membres)] = membres
    assert sum(len(m) for m in groupes.values()) == len(tous)
    return groupes


def prefixe_commun(noms: list[str]) -> str:
    commun = noms[0]
    for n in noms[1:]:
        while not n.startswith(commun):
            commun = commun[:-1]
    return commun


def score_carte(lum, bloc, index: int, candidat: str, par_lettre) -> float:
    case, seuil = bande_nom(lum, bloc, index)
    if seuil is None:
        return float('inf')
    bandes = lignes_de_texte(case, seuil, bloc.icones_h)
    if not bandes or any(c not in par_lettre for c in candidat):
        return float('inf')
    meilleur = float('inf')
    for grilles in grilles_du_candidat(case, seuil, bandes, len(candidat)):
        total = sum(
            float(((par_lettre[lettre] - grille) ** 2).mean(axis=1).min())
            for lettre, grille in zip(candidat, grilles)
        )
        meilleur = min(meilleur, total / len(candidat))
    return meilleur


def main() -> None:
    equipes = equipes_connues()
    tous = [n for membres in equipes.values() for n in membres]
    print(f"{len(equipes)} equipes connues, {len(tous)} pseudos\n")

    appris_par_capture = {}
    for nom, attendu in PSEUDOS.items():
        lum = luminance(RACINE_CAPTURES / nom)
        paires = []
        for bloc, noms in zip(detecter_blocs(lum), attendu):
            for i, verite in enumerate(noms):
                paires += lettres_etiquetees(lum, bloc, i, verite)
        appris_par_capture[nom] = paires

    joueurs_justes = joueurs_total = 0
    equipes_justes = equipes_total = 0
    vus_justes = vus_total = 0
    inedits_justes = inedits_total = 0

    for cible, attendu in PSEUDOS.items():
        pile, etiquettes = [], []
        for autre, paires in appris_par_capture.items():
            if autre == cible:
                continue
            for lettre, grille in paires:
                pile.append(grille)
                etiquettes.append(lettre)
        appris = np.stack(pile)
        par_lettre = {
            l: appris[[i for i, e in enumerate(etiquettes) if e == l]] for l in set(etiquettes)
        }
        # Une equipe est « inedite » si aucune autre capture ne la montre :
        # l'application decouvre alors son rendu en meme temps qu'elle le lit.
        deja_vues = {
            prefixe_commun(sorted({n.replace('|', '') for n in equipe}))
            for autre, capture in PSEUDOS.items()
            if autre != cible
            for equipe in capture
        }

        lum = luminance(RACINE_CAPTURES / cible)
        print(f"{cible}")
        for bloc, noms in zip(detecter_blocs(lum), attendu):
            vrais = [v.replace('|', '') for v in noms]
            tag = prefixe_commun(sorted(set(vrais)))
            inedite = tag not in deja_vues

            matrice = {c: [score_carte(lum, bloc, i, c, par_lettre) for i in range(4)] for c in tous}
            meilleur = None
            for membres in equipes.values():
                for perm in permutations(membres):
                    s = sum(matrice[perm[i]][i] for i in range(4)) / 4
                    if meilleur is None or s < meilleur[0]:
                        meilleur = (s, list(perm))
            lu = meilleur[1]

            bonne_equipe = set(lu) == set(vrais)
            equipes_total += 1
            equipes_justes += bonne_equipe
            places = sum(a == b for a, b in zip(lu, vrais))
            joueurs_total += 4
            joueurs_justes += places
            if inedite:
                inedits_total += 4
                inedits_justes += places
            else:
                vus_total += 4
                vus_justes += places

            etat = 'OK' if lu == vrais else ('equipe OK, ordre faux' if bonne_equipe else 'MAUVAISE EQUIPE')
            print(f"   {tag + (' (inedite)' if inedite else ''):18s} {etat}")
            if lu != vrais:
                print(f"   {'':18s} lu   {lu}")
                print(f"   {'':18s} vrai {vrais}")

    def part(j, t):
        return f"{j}/{t} ({100 * j / t:.0f} %)" if t else "aucun cas"

    print(f"\nEQUIPE reconnue      : {part(equipes_justes, equipes_total)}")
    print(f"JOUEURS bien places  : {part(joueurs_justes, joueurs_total)}")
    print(f"  equipe deja vue    : {part(vus_justes, vus_total)}")
    print(f"  equipe inedite     : {part(inedits_justes, inedits_total)}")


if __name__ == '__main__':
    main()
