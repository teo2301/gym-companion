# Gym Companion

A gym workout logger with a levelling character: log your sets, get double-progression targets
for next time, and watch your lifter level up as your strength improves. Strength levels use
bodyweight-relative standards per muscle group.

**Everything stays on your phone.** No account, no server, no analytics. Back up to a file
whenever you like (JSON for restore, CSV for spreadsheets).

## Get it

- **iPhone (and any browser):** open <https://teo2301.github.io/gym-companion/> in Safari, then
  **Share → Add to Home Screen**. It runs full-screen and works offline.
- **Android:** download the latest APK: <https://github.com/teo2301/gym-companion/releases/latest/download/gym-companion.apk>
  (this link always gives the newest version; install it over the old one to update, your data is kept).

Privacy policy: <https://teo2301.github.io/gym-companion/privacy.html>

## Layout

| Path | What |
|---|---|
| `docs/` | The web app, served by GitHub Pages. **Generated** by `tools/build.sh`, don't edit by hand. |
| `android/` | Android app: a WebView shell that bundles the same web app (`app/src/main/assets/gym/`, also generated). |
| `tools/build.sh` | Builds `docs/` + the Android assets from the shared source, runs a leak check, `--apk` also builds the signed release APK. |
| `tools/e2e.py` | End-to-end test in WebKit (iPhone) and Chromium (Android) via Playwright, including offline. |
| `tools/site/` | Extra site pages (privacy policy). |

## Release checklist

1. `tools/build.sh --apk` (bump `versionCode`/`versionName` in `android/app/build.gradle.kts` first).
2. `<venv with playwright>/bin/python tools/e2e.py` → `E2E OK`.
3. Commit + push (Pages redeploys `docs/`), then create a GitHub release with BOTH `release/gym-companion-<version>.apk` and `release/gym-companion.apk` (the stable link needs the second).
