# Gym Companion

A gym workout logger with a levelling character: log your sets, get double-progression targets
for next time, and watch your lifter level up as your strength improves. Strength levels use
bodyweight-relative standards per muscle group.

**Your workouts stay on your phone.** No analytics, no ads. Back up to a file whenever you like
(JSON for restore, CSV for spreadsheets). Also: 190 preset exercises, editable routines and workouts,
weekly averages and streaks, and a character with a choice of skin tone.

**Progress & charts (free):** training per week (volume / sets / workouts / time), a consistency
calendar, lifter level over time, sets per muscle vs the 10-20 range, strength by muscle, bodyweight
trend, PR timeline, and per exercise: estimated 1RM / heaviest / volume / reps charts with PRs marked,
rep maxes and recent sessions. One period filter (1M-All) scopes everything; every chart has a table view.

**Friends (optional):** add friends with a code or invite link and share workouts with progress photos;
only you and your friends see them. Runs on a small server (`server/`) for friends & family for now.

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
| `server/` | Friends API (`social.py`, stdlib + Pillow, SQLite) + `test_social.py`; run with `docker compose up -d gym-social`. |
| `tools/e2e_social.py` | Two-person friends test (iPhone + Android engines) against a throwaway server. |

## Release checklist

1. `tools/build.sh --apk` (bump `versionCode`/`versionName` in `android/app/build.gradle.kts` first).
2. `<venv with playwright>/bin/python tools/e2e.py` → `E2E OK`.
3. Commit + push (Pages redeploys `docs/`), then create a GitHub release with BOTH `release/gym-companion-<version>.apk` and `release/gym-companion.apk` (the stable link needs the second).
