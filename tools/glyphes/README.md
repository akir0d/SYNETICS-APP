# Lecture des chiffres du HUD d'EVA

Le tableau des scores d'EVA est ecrit dans une police carree que les moteurs
d'OCR generalistes lisent tres mal : Tesseract y produit du charabia. Mais
cette police ne varie jamais — le jeu dessine les memes formes, a la meme
taille relative, a chaque partie. On la reconnait donc par comparaison de
formes, ce qui est a la fois exact, instantane et entierement hors ligne.

## Ce que contient ce dossier

| Fichier | Role |
| --- | --- |
| `captures/` | Rediffusions de reference, versionnees pour que tout soit reproductible |
| `donnees.py` | Valeurs relevees a l'oeil sur ces captures : la seule verite terrain |
| `structure.py` | Reperage du tableau des scores a partir de ses pictogrammes K/D/A |
| `lecture.py` | Decoupage d'une case en glyphes, au pas de la police |
| `construire.py` | Produit `src/core/vision/glyphes.json`, embarque dans l'application |
| `croisee.py` | Validation croisee : chaque capture lue avec les exemplaires des autres |

## Usage

```bash
python3 tools/glyphes/construire.py   # regenere le fichier de glyphes
python3 tools/glyphes/croisee.py      # mesure la justesse honnetement
```

Dependances : `pillow`, `numpy`, `scipy`.

## Resultat mesure

Validation croisee sur trois rediffusions (une d'entrainement, deux de league),
chaque capture etant lue avec des exemplaires tires uniquement des autres :

```
NOMBRES    : 93/96 exacts (96,9 %)
CARACTERES : 154/157 justes (98,1 %)
```

## Deux choix qui ne sont pas evidents

**Aucune coordonnee en dur.** Le tableau se repere a ses douze pictogrammes
K/D/A, seules composantes rigoureusement identiques de l'image. Tout le reste
en decoule : le score est juste au-dessus, les chiffres juste en dessous. Le
reperage vaut donc quelle que soit la definition, et quel que soit l'habillage
autour de l'image de jeu — ce qui compte, les rediffusions de league etant
diffusees dans un cadre.

**Des exemplaires, pas des moyennes.** Dans cette police, un 5 et un 6 ne
different que par leur coin bas-gauche. Moyenner les exemplaires d'un chiffre
efface ce detail et la lecture confond les deux systematiquement : 92,7 % de
nombres exacts contre 96,9 % en gardant les exemplaires. Le fichier pese
80 Ko, ce qui rend la question sans enjeu.

## Ajouter des captures

Deposez l'image dans `captures/`, relevez ses valeurs dans `donnees.py`, puis
relancez les deux scripts. La validation croisee dira si la lecture s'ameliore.
