"""
Valeurs relevees a l'oeil sur les captures de rediffusions.

Chaque bloc d'equipe est decrit carte par carte : (score, K, D, A), dans
l'ordre d'affichage. C'est la seule verite terrain du projet : tout le reste
en decoule.
"""

from pathlib import Path

# Les captures de reference sont versionnees avec l'outil : sans elles, le
# fichier de glyphes ne serait pas reproductible.
RACINE = Path(__file__).parent / 'captures'

CAPTURES = {
    'cf3a69f0.jpg': (
        'Atlantis — entrainement',
        [
            [(700, 11, 3, 1), (625, 9, 8, 5), (475, 8, 6, 3), (400, 6, 4, 4)],
            [(375, 6, 9, 0), (475, 8, 11, 2), (125, 1, 9, 2), (275, 5, 5, 1)],
        ],
    ),
    '4df5ce74.jpg': (
        'The Cliff — league',
        [
            [(1200, 20, 7, 0), (800, 10, 8, 7), (575, 6, 9, 4), (400, 5, 9, 2)],
            [(725, 9, 11, 4), (700, 9, 8, 5), (575, 6, 14, 7), (550, 8, 9, 0)],
        ],
    ),
    'df7af499.jpg': (
        'Atlantis — league',
        [
            [(900, 13, 5, 2), (775, 11, 8, 3), (775, 8, 4, 1), (700, 8, 4, 3)],
            [(750, 10, 11, 1), (350, 6, 11, 2), (250, 2, 11, 3), (225, 2, 9, 1)],
        ],
    ),
}
