# Changelog

Every release updates this file first; the download page ("What's new", `tools/site/download.html`)
and the GitHub release notes are written from it. Newest first. Dates are release dates.

## 1.19 — 28 Nov 2026: calendars, richer friend profiles, photos you choose to share

- **Training calendar** on every profile (yours and each friend's): a month grid with your gym days
  marked, ‹ › month navigation back through your whole history, workouts / gym days / sessions per week
  for the month, current and best streak (weeks in a row), 1 vs 2+ workouts a day shown by colour *and*
  dots, a legend, and a Table view (every month + every workout as text). Tap a day to see what was done.
- **Log workouts from before:** on your own calendar, tap any past day (empty or not) → *Add workout on
  <date>* opens the workout editor with that date: exercises, sets, reps, weight, cardio intervals,
  start time, duration and notes. It counts like any other workout (calendar, streaks, Progress, PRs,
  estimated 1RMs, level, weekly stats, backups). Edit or delete a day's workouts from the same place.
  Future days can't be logged. Works offline; for the owner's linked server it is written to the
  server's workout file (a backup copy is made first; Hevy imports stay read-only).
- **Friends see your full Progress** (read-only): the same tiles, training per week, workout quality,
  best workouts, consistency, level, muscles trained, muscle-group trends, training split, strength by
  muscle, PRs and exercises. Bodyweight and private photos are never part of it.
- **Share my stats** switch (on by default, like before): off = friends see only your name and level.
- **Progress photos:** add dated photos on *My profile*. Every progress photo and character picture is
  **Private** (on this phone only) until you mark it **Public**; Public uploads a resized copy with the
  location and camera details stripped, visible only to your friends. Back to Private deletes it from
  the server. A photo timeline on each profile (newest or oldest first, date labels, tap to enlarge;
  character pictures carry a badge).
- **Home screen header:** the Gym Companion logo and name, *Hi <your name>* (your Friends name, or asked
  once and kept on the phone and in backups) and the live date and time. No more "Morning / Evening".
- New download page (what's new, everything the app can do, version history), linked from Settings
  together with the privacy policy, which now explains the new sharing.
- Workout editor: duration and notes are editable on past workouts too.
- Fix: renaming a past workout in the editor now sticks (the name field clashed with another one).
- Backups carry the Public/Private flags, progress photos and your name; older backups still restore
  (their photos come back Private).

## 1.18 — 28 Nov 2026: training split
- Progress: a segmented bar of the share of your sets per muscle group (Push / Pull / Legs / Core), each
  part labelled with its %, legend, Table view, and a note when one group is above 45%.

## 1.17 — 28 Nov 2026: workout quality + best workouts
- Progress: each timed workout's duration and density (kg per minute) with a trend note; "Best workouts"
  ranks the top 5 in the period by volume, sets or length.

## 1.16 — 27 Nov 2026: muscle-group trends
- Progress: weekly sets for Push / Pull / Legs / Core as four small charts on one shared scale.

## 1.15 — 27 Nov 2026: recovery key
- Friends: a recovery key brings your account (friends, posts, profile) back on a new phone.

## 1.14 — 27 Nov 2026: login link
- A one-off login link signs the Friends account in on another device (public app too).

## 1.13 — 27 Nov 2026: owner live link
- The app's owner can link the public app to their own server (watch live link, all history).

## 1.12 — 27 Nov 2026: owner workout sync
- Owner only: workouts logged in the public app are copied to the owner's own server.

## 1.11 — 27 Nov 2026: friend profiles
- Tap a friend to see their level, muscle levels, headline stats and recent workouts.

## 1.10 — 27 Nov 2026: exercise detail upgrades
- Exercise detail: its own period filter, Table view, strength-standard lines on the estimated-1RM chart,
  and "at your recent rate you reach X kg by <date>".

## 1.9 — 27 Nov 2026: cardio on past workouts
- The workout editor adds and edits cardio intervals (Jog / Run / Sprint, minutes, km, km/h, kcal).

## 1.8 — 27 Nov 2026: compare with the previous period
- Every Progress tile shows the change vs the previous period (▲ / ▼ with %, as text).

## 1.7 — 27 Nov 2026: photo character + cardio
- Optional photo character (stays on the phone), before/after slider; cardio panel with timer, speed,
  distance and kcal; health-benefits summary.

## 1.6 — 27 Nov 2026: Progress & charts
- Progress screen with one period filter: tiles, training per week, consistency, level over time,
  muscles trained, strength by muscle, bodyweight, PRs, exercises, per-exercise charts; table views.

## 1.5 — 27 Nov 2026: friends + weekly averages
- Optional Friends: name + photo, friend codes / invite links, friends-only feed of workout posts with
  progress photos, likes and comments. "Your weeks" card: this week, averages, streak, best week.
- (There was no separate 1.4 release.)

## 1.3 — 27 Nov 2026: edit past workouts
- Edit or delete past workouts; "New version ready · Update" pill; stable APK download link.

## 1.2 — 27 Nov 2026: edit buttons + Settings
- Edit buttons on every routine; a clear Settings button.

## 1.1 — 27 Nov 2026: 190 preset exercises + skin tone
- 190 preset exercises with muscles; choice of character skin tone.

## 1.0 — 27 Nov 2026: first release
- Offline web app (iPhone / any browser) + Android app; workouts stay on the phone; JSON / CSV backups.
