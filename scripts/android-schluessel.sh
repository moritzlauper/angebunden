#!/usr/bin/env bash
#
# Erzeugt den Signierschlüssel für die Android-App und legt ihn als Secrets im
# GitHub-Repository ab. Einmal ausführen, danach signiert jeder Lauf von
# .github/workflows/android.yml mit demselben Schlüssel, und die App lässt sich
# über eine bestehende Installation aktualisieren.
#
#   scripts/android-schluessel.sh            zeigt nur, was passieren würde
#   scripts/android-schluessel.sh --los      erzeugt den Schlüssel und setzt die Secrets
#
# Braucht `keytool` (liegt im JDK, bei Android Studio unter
# "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin") und `gh`,
# angemeldet beim Repository. Der Schlüssel landet in ~/.velonavi/, nicht im
# Repository. Wer ihn verliert, kann die App nicht mehr über die alte
# Installation aktualisieren: Sicherung machen.

set -euo pipefail

ORDNER="$HOME/.velonavi"
DATEI="$ORDNER/velonavi.jks"

if [ "${1:-}" != "--los" ]; then
  echo "Würde $DATEI erzeugen und diese Secrets im Repository setzen:"
  echo "  ANDROID_KEYSTORE_BASE64, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD"
  echo "Mit --los ausführen."
  exit 0
fi

command -v keytool >/dev/null || { echo "keytool fehlt, JAVA_HOME oder PATH setzen." >&2; exit 1; }
command -v gh >/dev/null || { echo "gh fehlt." >&2; exit 1; }
[ ! -e "$DATEI" ] || { echo "$DATEI gibt es schon. Nicht überschrieben." >&2; exit 1; }

mkdir -p "$ORDNER"
chmod 700 "$ORDNER"
PASSWORT="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
keytool -genkeypair -keystore "$DATEI" -storetype PKCS12 -alias velonavi \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASSWORT" -keypass "$PASSWORT" \
  -dname "CN=Velonavi, O=angebunden, C=CH"
chmod 600 "$DATEI"

base64 < "$DATEI" | tr -d '\n' | gh secret set ANDROID_KEYSTORE_BASE64
printf '%s' "$PASSWORT" | gh secret set ANDROID_KEYSTORE_PASSWORD
printf '%s' "velonavi" | gh secret set ANDROID_KEY_ALIAS
printf '%s' "$PASSWORT" | gh secret set ANDROID_KEY_PASSWORD

echo
echo "Fertig. Schlüssel: $DATEI"
echo "Passwort (bitte sichern, etwa im Passwortmanager): $PASSWORT"
