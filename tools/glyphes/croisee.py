"""
Validation croisee de la lecture des chiffres.

Chaque capture est lue avec des exemplaires tires uniquement des *autres*.
C'est la seule mesure honnete : apprendre et tester sur la meme image ne dit
rien de ce que l'application fera sur une rediffusion inconnue.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from construire import luminance, normaliser_gris  # noqa: E402
from donnees import CAPTURES, RACINE  # noqa: E402
from lecture import cases_du_bloc, lire_case  # noqa: E402
from structure import detecter_blocs  # noqa: E402


def glyphes_etiquetes(fichier: str):
    """Rend, pour une capture, ses cases et leurs glyphes normalises."""
    _, blocs_attendus = CAPTURES[fichier]
    lum = luminance(RACINE / fichier)
    blocs = detecter_blocs(lum)
    cases = []
    if len(blocs) != len(blocs_attendus):
        return cases
    for bloc, attendu in zip(blocs, blocs_attendus):
        for case_def in cases_du_bloc(bloc):
            genre, index, colonne = case_def[0], case_def[1], case_def[2]
            valeur = attendu[index][0] if genre == 'score' else attendu[index][colonne + 1]
            case, boites = lire_case(lum, case_def)
            cases.append((str(valeur), [normaliser_gris(case, b) for b in boites]))
    return cases


def main() -> None:
    par_capture = {f: glyphes_etiquetes(f) for f in CAPTURES}

    justes = total = 0
    car_justes = car_total = 0
    for cible in CAPTURES:
        pile, etiquettes = [], []
        for autre, cases in par_capture.items():
            if autre == cible:
                continue
            for texte, grilles in cases:
                if len(grilles) != len(texte):
                    continue
                for grille, caractere in zip(grilles, texte):
                    pile.append(grille)
                    etiquettes.append(caractere)
        appris = np.stack(pile)

        erreurs = []
        for texte, grilles in par_capture[cible]:
            lu = ''
            for grille in grilles:
                distances = ((appris - grille) ** 2).mean(axis=1)
                lu += etiquettes[int(np.argmin(distances))]
            total += 1
            car_total += len(texte)
            car_justes += sum(1 for a, b in zip(lu, texte) if a == b)
            if lu == texte:
                justes += 1
            else:
                erreurs.append(f"«{lu}» au lieu de «{texte}»")

        titre = CAPTURES[cible][0]
        marque = 'OK' if not erreurs else f"{len(erreurs)} erreur(s)"
        print(f"  {marque:12s} {titre}  ({len(appris)} exemplaires appris ailleurs)")
        for e in erreurs:
            print(f"        {e}")

    print(f"\nNOMBRES    : {justes}/{total} exacts ({100 * justes / max(1, total):.1f} %)")
    print(f"CARACTERES : {car_justes}/{car_total} justes ({100 * car_justes / max(1, car_total):.1f} %)")


if __name__ == '__main__':
    main()
