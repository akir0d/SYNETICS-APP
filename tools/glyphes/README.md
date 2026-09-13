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
| `croisee.py` | Validation croisee des chiffres : chaque capture lue avec les exemplaires des autres |
| `pseudos.py` | Verite terrain des pseudos, et decoupe de la bande de noms |
| `noms.py` | Reconnaissance d'un pseudo par choix dans une liste fermee |
| `croisee_noms.py` | Validation croisee des pseudos, equipe par equipe |

## Usage

```bash
python3 tools/glyphes/construire.py     # regenere le fichier de glyphes
python3 tools/glyphes/croisee.py        # justesse des chiffres
python3 tools/glyphes/croisee_noms.py   # justesse des pseudos
```

Dependances : `pillow`, `numpy`, `scipy`.

## Resultat mesure

### Les chiffres : ca marche

Validation croisee sur quatre rediffusions (une d'entrainement, trois de
league), chaque capture etant lue avec des exemplaires tires uniquement des
autres :

```
NOMBRES    : 125/128 exacts (97,7 %)
CARACTERES : 204/207 justes (98,6 %)
```

### Les pseudos : ca ne marche que pour ce qui a deja ete vu

Meme protocole, applique aux noms de joueurs. Le tableau doit etre explique par
une equipe connue : quatre cartes, quatre joueurs de la meme equipe, dans
l'ordre qui colle le mieux.

```
EQUIPE reconnue      : 4/8 (50 %)
JOUEURS bien places  : 16/32 (50 %)
  equipe deja vue    : 16/16 (100 %)
  equipe inedite     : 0/16 (0 %)
```

La moyenne ne veut rien dire ici : le resultat est binaire. Une equipe dont une
autre capture montre le rendu est reconnue sans une seule faute ; une equipe
inedite ne l'est jamais. Deux raisons se cumulent contre les lettres la ou les
chiffres passent : elles sont trois fois plus nombreuses — vingt-sept formes
contre dix — et elles sont ecrites plus petit, seize pixels de haut contre
vingt-trois. Il y a donc beaucoup plus a distinguer avec beaucoup moins de
matiere.

Ce n'est pas une question de reglage mais de quantite d'exemplaires, et
augmenter la definition n'y changera rien : ces captures ont deja l'image de
jeu en 1100 pixels de haut, soit ce que donne une rediffusion en 1080p.

La consequence est une decision de conception, pas un correctif : l'application
ne devinera pas les noms d'une equipe qu'elle n'a jamais vue. Elle montre les
huit noms decoupes en regard de l'effectif saisi, l'utilisateur confirme une
fois, et ces exemplaires-la rendent ensuite la reconnaissance sure. Le
regroupement des deux camps, lui, ne demande aucune lecture : les quatre
joueurs d'une equipe partagent le debut de leur pseudo, le tag etant colle
devant — SYNxAKIROD pour akirod de Synetics.

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
