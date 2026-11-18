# Dernier Bastion — conventions de travail

Jeu web (Three.js + Vite) empaqueté pour Android avec Capacitor 7 (`android/`).

## Numérotation des versions

Dans `android/app/build.gradle` (`versionName` et `versionCode`) :

- **Grande avancée** : le deuxième chiffre monte de **0.1** (0.1.0 → 0.2.0).
- **Correctif** : le troisième chiffre monte de **0.0.1** (0.1.0 → 0.1.1).
- `versionCode` : **+1 à chaque version**, quelle qu'elle soit.

## Livrer un APK testable

- `npm run apk` : compile le jeu, synchronise Capacitor, construit l'APK **fast** et le dépose à
  la racine de `bastion/` sous `dernier-bastion-<version>-fast.apk` (l'ancien est supprimé).
- **Fast** : non débogable comme une release, mais même identifiant (`com.dernierbastion.jeu.debug`)
  et même signature que le debug : il s'installe par-dessus le précédent **en gardant la partie**.
- La signature vient de `android/keystore/bastion-debug.keystore`, versionnée volontairement
  (mot de passe public `android`). Ne jamais la remplacer : sinon l'APK suivant refuse de
  s'installer par-dessus et il faut désinstaller, ce qui efface la sauvegarde.
- Besoin d'un SDK Android : `android/local.properties` (ignoré) contient `sdk.dir=…`.
- Committer l'APK et pousser sur la branche de travail.

## Icône

Source unique : `design/icon.svg`. `npm run icons` régénère toutes les icônes Android.

## Monétisation

- Modèle : pubs récompensées (toujours au choix du joueur) + achats intégrés.
- `src/monetize.ts` est le seul point de contact : `showRewarded()` et `purchase()`. Ils sont
  **simulés** (`SIMULATED = true`) tant qu'AdMob et Google Play Billing ne sont pas branchés ;
  la boutique l'affiche au joueur. Ne jamais présenter un achat simulé comme réel.
- Méta (quêtes du jour, coffre toutes les 4 h, boosts, niveaux de bâtiments, contrats, calendrier) : `src/meta.ts`.
- Toute pub passe par `rewarded(emplacement, …)` dans `main.ts` : plafonds par jour et par
  emplacement (`AD_CAPS`, `AD_DAY_MAX`). « Sans pub » saute la vidéo mais garde les plafonds.
- L'heure de référence est `nowT()` (jamais avant la plus grande heure déjà vue) : reculer
  l'horloge du téléphone ne redonne ni coffre, ni pubs, ni gains hors ligne.
- Hors ligne : `src/offline.ts` simule la production (récolte, porteur, clients, caissière) ;
  les pièces attendent dans `save.pendingOffline` jusqu'à ce que le joueur les encaisse.
- Les tests de jeu sont faits par le propriétaire : vérifier la compilation (`npx tsc --noEmit`),
  ne pas lancer de serveur ni de navigateur de test.
