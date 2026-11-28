# Gym Companion

A gym workout logger with a levelling character: log your sets, get double-progression targets
for next time, and watch your lifter level up as your strength improves. Strength levels use
bodyweight-relative standards per muscle group.

**Your workouts stay on your phone.** No analytics, no ads. Back up to a file whenever you like
(JSON for restore, CSV for spreadsheets). Also: 190 preset exercises, editable routines and workouts,
weekly averages and streaks, and a character with a choice of skin tone.

**Photo character (optional):** choose a full-body photo once and position it in the frame; it stays on the phone unless you mark it Public for friends. It gets a tier-coloured frame and LV badge, and Progress has a before/after slider. Photos stay in app storage and are only included if you download a JSON backup. The watch keeps the cartoon.

**Calendar & profile:** a training calendar (gym days month by month, streaks, 1 vs 2+ workouts a day, Table view) where you can also add, edit or delete workouts on any past day, plus a dated progress-photo timeline. Every photo is Private (phone only) until you mark it Public for friends.

**Progress & charts (free):** training per week (volume / sets / workouts / time), a consistency
calendar, lifter level over time, sets per muscle vs the 10-20 range, strength by muscle, bodyweight
trend, PR timeline, and per exercise: estimated 1RM / heaviest / volume / reps charts with PRs marked,
rep maxes and recent sessions. One period filter (1M-All) scopes everything; every chart has a table view.

**Friends (optional):** add friends with a code or invite link and share workouts with progress photos;
only you and your friends see them. Friends can open your profile: calendar and full Progress, read-only (turn off **Share my stats** to show only your name and level). Runs on a small server (`server/`) for friends & family for now.

## Get it

- **iPhone (and any browser):** open <https://teo2301.github.io/gym-companion/> in Safari, then
  **Share → Add to Home Screen**. It runs full-screen and works offline.
- **Android:** download the latest APK: <https://github.com/teo2301/gym-companion/releases/latest/download/gym-companion.apk>
  (this link always gives the newest version; install it over the old one to update, your data is kept).

Download page, what's new and the full feature list: <https://teo2301.github.io/gym-companion/download.html>

Privacy policy: <https://teo2301.github.io/gym-companion/privacy.html>

## Layout

| Path | What |
|---|---|
| `docs/` | The web app, served by GitHub Pages. **Generated** by `tools/build.sh`, don't edit by hand. |
| `android/` | Android app: a WebView shell that bundles the same web app (`app/src/main/assets/gym/`, also generated). |
| `tools/build.sh` | Builds `docs/` + the Android assets from the shared source, runs a leak check, `--apk` also builds the signed release APK. |
| `tools/e2e.py` | End-to-end test in WebKit (iPhone) and Chromium (Android) via Playwright, including offline. |
| `tools/site/` | Extra site pages: privacy policy, download page (`download.html`). |
| `server/` | Friends API (`social.py`, stdlib + Pillow, SQLite), owner `admin.py` + `test_social.py`; run with `docker compose up -d gym-social`. |
| `tools/e2e_social.py` | Two-person friends test (iPhone + Android engines) against a throwaway server. |

## Friends server admin (owner only)

`server/admin.py` runs on the server only; it has no HTTP endpoint, so it can't be reached through `/gs`.
`docker exec gym-social python /app/admin.py list` shows every user (id, name, created, last seen,
friend count; no secrets). `docker exec gym-social python /app/admin.py reissue <name-or-id>` gives a
user who lost their login a new one, the same way the recovery key does: friends, posts, profile, photos
and their recovery key are kept, the old login stops working, and it prints a one-off
`…/gym-companion/#social-login=<token>` link to send them privately (anyone holding it can sign in as
them). Each reissue is recorded (who, when) in the `admin_audit` table; tokens and recovery keys are
never printed or logged.

## Release checklist

1. `tools/build.sh --apk` (bump `versionCode`/`versionName` in `android/app/build.gradle.kts` first).
2. `<venv with playwright>/bin/python tools/e2e.py` → `E2E OK`.
3. Commit + push (Pages redeploys `docs/`), then create the GitHub release with ONE file, `"release/gym-companion.apk#Gym Companion (v<version>, released <date>)"` (fixed name for the permanent link, label shows version + date), and delete the previous release (only after the new one is up, so the permanent link never breaks).
4. Every release updates `CHANGELOG.md` first, then the "What's new" (and, if features changed, "Everything it can do" + version history) on `tools/site/download.html`, and uses the same text for the GitHub release notes (`gh release create --notes-file`).
