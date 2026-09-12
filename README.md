# SYNETICS — Analyse IA de matchs EVA

Application d'analyse video pour les joueurs d'[EVA](https://www.eva.gg) (Esports Virtual Arenas),
les arenes de tir en realite virtuelle en free roaming.

Vous chargez l'enregistrement d'un match, l'application le decode sur l'appareil, en extrait le
rythme de jeu, et — si vous le souhaitez — fait analyser les images cles par Claude pour en tirer
une synthese de coach.

Une seule base de code, trois cibles : **Android**, **PC** (Windows / macOS / Linux) et navigateur.

---

## Ce que fait l'application

### 1. Analyse locale, hors-ligne, sans cle API

Le moteur echantillonne la video et mesure, image par image, quatre signaux : luminance, dominance
du rouge, difference avec l'image precedente, et part de pixels satures. Il en deduit :

- **les phases d'action** (debut, fin, intensite), via un seuil a hysteresis ;
- **les expositions** : les voiles rouges brefs, compatibles avec des degats subis ;
- **les coupures franches** : mort, reapparition ou changement de camera ;
- des **mesures de rythme** : temps passe en action, duree moyenne d'un engagement, plus longue
  accalmie, engagements par minute ;
- quatre **scores de lecture** : agressivite, tempo, regularite, discipline.

Tout cela fonctionne sans reseau et sans compte.

### 2. Marquage manuel

Pendant la relecture, vous posez vos propres reperes (elimination, mort, objectif, reapparition,
note) au clavier ou au doigt. Ces marquages alimentent les compteurs et servent de verite terrain
transmise a l'IA.

### 3. Analyse IA, facultative

Les images cles — les pics d'action, completes par une grille couvrant les phases calmes — sont
envoyees a Claude, qui renvoie une analyse **structuree** : synthese, points forts, axes de
progres, exercices concrets, et une timeline des moments marquants rattachee aux horodatages de la
video.

---

## Honnetete sur ce que l'application ne fait pas

Ces limites sont assumees et visibles dans l'interface ; mieux vaut les connaitre avant d'installer.

- **Aucune connexion a un compte eva.gg.** EVA ne publie pas d'API ouverte. Le seul schema public
  est celui de leur [test de recrutement front](https://github.com/eva-gg/frontend-developer-recruitment-test).
  L'analyse part donc de **vos propres enregistrements**, pas de vos statistiques officielles.
- **Le moteur local lit un signal visuel, pas le jeu.** Il ne sait pas ce qu'est une elimination.
  Ses evenements sont des *candidats*, marques comme tels, a confirmer par vous ou par l'IA. C'est
  pourquoi les compteurs d'eliminations, de morts et d'objectifs ne se remplissent **jamais** a
  partir des heuristiques seules.
- **L'echantillonnage a une resolution.** Un voile de degats dure 0,3 a 0,5 s. En dessous de
  3 images analysees par seconde, l'intervalle entre deux mesures depasse cette duree et des
  expositions passent entre les images. L'application le signale dans les Reglages.
- **Les scores sont des reperes de lecture**, calcules sur votre propre video. Ils servent a
  comparer vos matchs entre eux, pas a vous situer dans un classement EVA.
- **L'IA ne voit que des images fixes**, pas la partie en continu. Elle doit le dire elle-meme dans
  la section « limites » de son rapport, et son niveau de confiance est affiche pour chaque
  observation.

---

## Confidentialite

- La video **ne quitte jamais l'appareil**. Elle est decodee localement par le lecteur de la
  plateforme.
- Elle n'est pas non plus **stockee** par l'application : seuls le signal extrait, la timeline et
  le rapport sont conserves (quelques centaines de kilo-octets par match). A la reouverture d'une
  analyse, l'application vous propose de rattacher le fichier pour revoir les moments cles.
- Si et seulement si vous lancez l'analyse IA, **quelques images cles** (24 par defaut) partent
  vers l'API Anthropic, avec votre propre cle.
- La cle API reste dans le stockage local de l'appareil. Aucune synchronisation, aucun serveur
  intermediaire.

---

## Installation

Pre-requis : **Node.js 20+**.

```bash
npm install
```

### Version PC (Electron)

```bash
npm run electron:start        # compile puis lance l'application
npm run electron:dev          # mode developpement (serveur Vite + rechargement a chaud)
npm run electron:dist         # genere les installeurs dans release/
```

`electron:dev` suppose un `npm run dev` lance en parallele.

Les cibles produites sont definies dans `electron-builder.yml` : NSIS et portable pour Windows,
AppImage et deb pour Linux, dmg pour macOS.

### Version Android (Capacitor)

Pre-requis : **Android Studio** et un JDK 17.

```bash
npm run android:sync          # compile le web puis synchronise le projet natif
npm run android:open          # ouvre le projet dans Android Studio
```

Depuis Android Studio : `Run` pour installer sur un appareil, ou
`Build > Generate Signed Bundle / APK` pour produire un APK distribuable.

Le projet natif est versionne dans `android/`. Apres chaque modification du code web, relancez
`npm run android:sync`.

### Version navigateur

```bash
npm run dev                   # http://localhost:5173
npm run build && npm run preview
```

---

## Tests

```bash
npm test                      # tests unitaires du moteur (vitest)
npm run test:e2e              # controle bout en bout dans un vrai moteur de rendu
npm run test:all              # les deux
```

Le **controle bout en bout** merite une explication : il genere une vraie video encodee
(canvas + MediaRecorder), avec des phases d'action et des voiles de degats a des instants connus,
puis la fait traverser le code de production — decodage, recherche d'instant, lecture de pixels,
detection, extraction des images cles — et verifie que le moteur retrouve la structure injectee.
C'est le seul moyen de valider ce que les tests unitaires ne peuvent pas voir : il a deja rattrape
deux defauts reels, une detection aveugle sur fond stable et un echantillonnage trente fois trop
lent.

Sur une machine Linux sans serveur graphique : `npm run test:e2e:headless`.

---

## Architecture

```
src/
├─ core/                 Logique pure, sans dependance a l'interface
│  ├─ types.ts           Modele de donnees partage
│  ├─ pipeline.ts        Orchestration d'une analyse complete
│  ├─ export.ts          Exports JSON / CSV / Markdown
│  ├─ video/sampler.ts   Decodage, echantillonnage, extraction d'images cles
│  ├─ analysis/          Statistiques robustes, heuristiques, mesures
│  ├─ ai/                Schema de sortie, prompts, client Claude
│  └─ storage/           Persistance locale (IndexedDB, reglages)
├─ ui/                   Composants et ecrans React
└─ platform/             Adaptation navigateur / Electron / Android

electron/                Processus principal et pont IPC de la version PC
android/                 Projet natif Capacitor
tools/e2e/               Controle bout en bout
```

Le dossier `core/` ne connait ni React, ni Electron, ni Capacitor : c'est lui qui porte les tests.

### Reglages du moteur

| Reglage | Defaut | Effet |
| --- | --- | --- |
| Images analysees par seconde | 3 | Finesse de detection. Sous 3, des expositions sont manquees. |
| Images cles envoyees a l'IA | 24 | Qualite de l'analyse IA, et son cout. |
| Modele | `claude-opus-5` | `claude-sonnet-5` et `claude-haiku-4-5` sont proposes, moins chers. |

Comptez environ 180 lectures d'image par minute de video aux reglages par defaut. Une manche de
10 minutes represente donc environ 1800 mesures.

---

## Configurer l'analyse IA

1. Creez une cle sur [console.anthropic.com](https://console.anthropic.com).
2. Reglages → collez la cle, activez l'analyse IA, choisissez le modele.
3. Ouvrez une analyse, puis « Lancer l'analyse IA ».

Les appels sont factures sur votre compte Anthropic. Le nombre d'images cles est le principal
levier de cout : 24 images de 768 px representent un appel modeste, 60 images le multiplient par
plus de deux.

L'application appelle l'API directement depuis l'appareil, avec votre cle — il n'y a pas de serveur
intermediaire a heberger. C'est le compromis d'une application 100 % locale : la cle vit sur votre
machine et n'est aussi bien protegee que celle-ci.
