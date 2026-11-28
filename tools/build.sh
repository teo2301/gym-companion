#!/usr/bin/env bash
# Build the public Gym Companion from the shared PWA source.
#
#   source  : $GYM_SRC (default ~/projects/services/serverchat/static/gym): the one copy of the app,
#             which a private server build also serves directly with live APIs
#   outputs : docs/                       GitHub Pages site (iPhone / any browser, installable PWA)
#             android/app/src/main/assets/gym/   files bundled into the Android app
#
# Both outputs get config.js with GYM_PUBLIC = true (offline, on-device data, no owner name).
# Fails if anything private (names, hostnames, LAN/tailnet IPs, server API paths in use) leaks in.
#
# Usage: tools/build.sh            build docs/ + android assets
#        tools/build.sh --apk      also build the signed release APK into release/
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=${GYM_SRC:-$HOME/projects/services/serverchat/static/gym}
DOCS="$ROOT/docs"
ASSETS="$ROOT/android/app/src/main/assets/gym"
APP_FILES=(index.html body.js character.js gymcore.js gymstore.js backup.js pwa.js photo.js social.js charts.js progress.js calendar.js profile.js cardio.js exercises.json manifest.json
           icon-180.png icon-192.png icon-512.png)

SOCIAL_API=${GYM_SOCIAL_API:-$(cat "$HOME/.config/gym-companion/social-api.txt" 2>/dev/null)}
PUBLIC_CONFIG="// Public build: offline, workouts stay on this device. Friends & feed (opt-in) use the API below.
window.GYM_PUBLIC = true;
window.GYM_SOCIAL_API = '$SOCIAL_API';
"

for f in "${APP_FILES[@]}" sw-public.js; do [ -f "$SRC/$f" ] || { echo "missing $SRC/$f" >&2; exit 1; }; done
for f in "${APP_FILES[@]}"; do node --check "$SRC/$f" 2>/dev/null || [[ $f != *.js ]] || { echo "syntax error in $f" >&2; exit 1; }; done

# Android assets: the app files + public config (no service worker: assets are already local)
mkdir -p "$ASSETS"
find "$ASSETS" -mindepth 1 -maxdepth 1 -type f -delete
for f in "${APP_FILES[@]}"; do cp "$SRC/$f" "$ASSETS/"; done
rm -rf "$ASSETS/mp"   # old background-removal engine (removed in 1.7)
printf '%s' "$PUBLIC_CONFIG" > "$ASSETS/config.js"

# Pages site: same files + offline service worker (cache name = content hash) + site pages
mkdir -p "$DOCS"
for f in "${APP_FILES[@]}"; do cp "$SRC/$f" "$DOCS/"; done
rm -rf "$DOCS/mp"
printf '%s' "$PUBLIC_CONFIG" > "$DOCS/config.js"
BUILD=$(cd "$DOCS" && cat "${APP_FILES[@]}" config.js | sha256sum | cut -c1-12)
sed "s/__BUILD__/$BUILD/" "$SRC/sw-public.js" > "$DOCS/sw-public.js"
cp "$ROOT/tools/site/privacy.html" "$DOCS/privacy.html"
cp "$ROOT/tools/site/download.html" "$DOCS/download.html"
touch "$DOCS/.nojekyll"
rm -f "$DOCS/sw.js"   # the private no-cache worker must never ship publicly

# Leak check on everything that goes public. The patterns (names, hostnames, private IPs) live
# outside the repo so the check itself doesn't publish them.
LEAKS_FILE=${GYM_LEAK_PATTERNS:-$HOME/.config/gym-companion/leak-patterns.txt}
[ -f "$LEAKS_FILE" ] || { echo "missing leak patterns file $LEAKS_FILE" >&2; exit 1; }
# The one deliberately public value (the social API URL) is allow-listed in a file next to the patterns.
ALLOW_FILE=${GYM_LEAK_ALLOW:-$HOME/.config/gym-companion/leak-allow.txt}
if grep -rIEn --exclude=*.log --exclude-dir=shots -f "$LEAKS_FILE" "$DOCS" "$ASSETS" "$ROOT/android/app/src" "$ROOT/README.md" "$ROOT/tools" \
   | { if [ -s "$ALLOW_FILE" ]; then grep -vF -f "$ALLOW_FILE"; else cat; fi; } | grep .; then
  echo "LEAK CHECK FAILED: private strings above" >&2; exit 1
fi

echo "built docs/ + android assets (cache gym-public-$BUILD)"

if [ "${1:-}" = "--apk" ]; then
  cd "$ROOT/android"
  VERSION=$(sed -n 's/.*versionName = "\(.*\)"/\1/p' app/build.gradle.kts)
  JAVA_HOME=$HOME/android-sdk/jdk21 ANDROID_HOME=$HOME/android-sdk \
    ./gradlew --no-daemon -q assembleRelease lintRelease
  mkdir -p "$ROOT/release"
  cp app/build/outputs/apk/release/app-release.apk "$ROOT/release/gym-companion-$VERSION.apk"
  APKSIGNER=$(ls -d $HOME/android-sdk/build-tools/*/ | sort -V | tail -1)apksigner
  "$APKSIGNER" verify --print-certs "$ROOT/release/gym-companion-$VERSION.apk" 2>/dev/null \
    | grep -m1 'SHA-256' || { echo "APK NOT SIGNED" >&2; exit 1; }
  # Stable name too: https://github.com/teo2301/gym-companion/releases/latest/download/gym-companion.apk
  # always serves the newest release, as long as every release also uploads this file.
  cp "$ROOT/release/gym-companion-$VERSION.apk" "$ROOT/release/gym-companion.apk"
  echo "apk: release/gym-companion-$VERSION.apk (+ release/gym-companion.apk)"
fi
