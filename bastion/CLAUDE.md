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
