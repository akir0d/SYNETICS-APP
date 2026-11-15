#!/usr/bin/env bash
# Construit l'APK "fast" et le depose a la racine de bastion/ (voir CLAUDE.md).
set -euo pipefail
cd "$(dirname "$0")/.."

npm run build
npx cap sync android

VERSION=$(grep -m1 'versionName' android/app/build.gradle | sed -E 's/.*"(.*)".*/\1/')
# Un seul telechargement a la fois : Maven Central renvoie 429 aux rafales.
(cd android && ./gradlew --no-daemon -q --max-workers=1 assembleFast \
  -x lintVitalAnalyzeFast -x lintVitalReportFast -x lintVitalFast)

rm -f dernier-bastion-*-fast.apk
cp android/app/build/outputs/apk/fast/app-fast.apk "dernier-bastion-$VERSION-fast.apk"
echo "dernier-bastion-$VERSION-fast.apk"
