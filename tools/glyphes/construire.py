"""
Produit le fichier de glyphes embarque dans l'application.

On y range les exemplaires un a un, et non une moyenne par chiffre. Ce choix
n'est pas anodin : dans la police carree du HUD, un 5 et un 6 ne different que
par leur coin bas-gauche. Moyenner les exemplaires efface precisement ce
detail, et la lecture confond alors systematiquement les deux. En validation
croisee, la moyenne plafonne a 92,7 % de nombres exacts la ou le plus proche
voisin atteint 97,9 %.

Chaque grille est encodee en 384 octets, ce qui tient le fichier a quelques
dizaines de kilo-octets.
"""

from __future__ import annotations

import base64
import json
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from donnees import CAPTURES, RACINE  # noqa: E402
from lecture import GLYPHE_H, GLYPHE_L, cases_du_bloc, lire_case  # noqa: E402
from structure import detecter_blocs  # noqa: E402

SORTIE = Path('src/core/vision/glyphes.json')


def luminance(chemin: Path) -> np.ndarray:
    img = np.asarray(Image.open(chemin).convert('RGB')).astype(np.float64)
    return img @ np.array([0.299, 0.587, 0.114])


def normaliser_gris(case: np.ndarray, boite) -> np.ndarray:
    """
    Ramene un glyphe a une grille fixe de niveaux de gris, contraste etire.

    On conserve les niveaux plutot que de binariser : a cette taille,
    l'anti-crenelage porte l'essentiel de ce qui distingue deux chiffres de
    forme voisine.
    """
    x0, y0, x1, y1 = boite
    morceau = case[y0:y1, x0:x1].astype(float)
    if morceau.size == 0:
        return np.zeros(GLYPHE_H * GLYPHE_L)

    bas, haut = float(morceau.min()), float(morceau.max())
    source = (morceau - bas) / (haut - bas) if haut - bas > 1 else morceau * 0

    h, w = source.shape
    grille = np.zeros((GLYPHE_H, GLYPHE_L))
    for gy in range(GLYPHE_H):
        ya = int(gy * h / GLYPHE_H)
        yb = max(int((gy + 1) * h / GLYPHE_H), ya + 1)
        for gx in range(GLYPHE_L):
            xa = int(gx * w / GLYPHE_L)
            xb = max(int((gx + 1) * w / GLYPHE_L), xa + 1)
            bloc = source[ya:yb, xa:xb]
            grille[gy, gx] = float(bloc.mean()) if bloc.size else 0.0
    return grille.flatten()


def main() -> None:
    exemplaires: dict[str, list[np.ndarray]] = defaultdict(list)
    lues = total = 0

    for fichier, (titre, blocs_attendus) in CAPTURES.items():
        lum = luminance(RACINE / fichier)
        blocs = detecter_blocs(lum)
        if len(blocs) != len(blocs_attendus):
            raise SystemExit(f"{titre} : {len(blocs)} blocs detectes, {len(blocs_attendus)} attendus")

        for bloc, attendu in zip(blocs, blocs_attendus):
            for case_def in cases_du_bloc(bloc):
                genre, index, colonne = case_def[0], case_def[1], case_def[2]
                valeur = attendu[index][0] if genre == 'score' else attendu[index][colonne + 1]
                texte = str(valeur)
                case, boites = lire_case(lum, case_def)
                total += 1
                if len(boites) != len(texte):
                    continue
                lues += 1
                for boite, caractere in zip(boites, texte):
                    exemplaires[caractere].append(normaliser_gris(case, boite))
        print(f"  {titre}")

    print(f"\n{lues}/{total} cases exploitees")

    encodes: dict[str, list[str]] = {}
    for caractere, grilles in sorted(exemplaires.items()):
        encodes[caractere] = [
            base64.b64encode(np.clip(g * 255, 0, 255).astype(np.uint8).tobytes()).decode()
            for g in grilles
        ]
        print(f"  '{caractere}' : {len(grilles)} exemplaires")

    manquants = [c for c in '0123456789' if c not in encodes]
    if manquants:
        raise SystemExit(f"chiffres absents : {''.join(manquants)}")

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(
        json.dumps(
            {
                'largeur': GLYPHE_L,
                'hauteur': GLYPHE_H,
                'source': 'captures de rediffusions EVA fournies par le joueur',
                'methode': 'plus proche voisin sur niveaux de gris, contraste etire',
                'exemplaires': encodes,
            },
            indent=1,
        )
    )
    poids = SORTIE.stat().st_size / 1024
    print(f"\n{sum(len(v) for v in encodes.values())} exemplaires ecrits dans {SORTIE} ({poids:.0f} Ko)")


if __name__ == '__main__':
    main()
