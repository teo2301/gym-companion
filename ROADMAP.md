# Gym Companion roadmap: Progress & charts (continuing after v1.6)

Goal: the best free progress tracking of any gym app. Each item ships on its own: built, tested
(parity + e2e), released, installed. Tick the box when it is live. Work top to bottom.

- [ ] **Compare with the previous period.** Every Progress tile shows the change vs the previous
      period of the same length (e.g. "Volume 128k ▲ 12%"), with ▲/▼ text, not colour alone.
- [ ] **Exercise detail upgrades.** (a) Its own period filter (default All). (b) Strength-standard
      reference lines on the estimated-1RM chart (Novice / Intermediate / Advanced / Elite thresholds
      for your bodyweight, from coaching standards, where the lift has one), labelled directly.
      (c) A dashed-free projection: "at your recent rate you reach X kg by <date>" as text, using a
      least-squares fit of the last 8 sessions (only when the trend is positive and n >= 4).
- [ ] **Muscle-group trends (small multiples).** Weekly sets for Push / Pull / Legs / Core as four
      small single-series charts sharing one y-scale (no multi-colour lines), within the period.
- [ ] **Workout quality.** Per-workout duration and density (kg per minute) trends, plus a "best
      workouts" table (highest volume, most sets, longest) within the period.
- [ ] **Training split.** A segmented bar of the share of sets by muscle group in the period (a
      figure, labelled with %), and a short note when one group dominates (>45%).
- [ ] **Share a chart to Friends.** From any exercise detail or the Progress tiles: "Share" renders a
      card image (canvas, same chart + headline numbers) and opens the Friends post sheet with it as the
      photo. Only when the user has joined Friends.
- [ ] **Monthly report card.** On the 1st of a month (or from Progress), a summary sheet of last
      month: workouts, volume, PRs, level change, most-improved lift, top muscle; shareable like above.
