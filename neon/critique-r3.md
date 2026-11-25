Round 3 (final) review across `r3/SHEETS/` — **all three recommended options are ready to ship with zero remaining HIGH or MEDIUM issues.**

---

## Q1: Cell Changed — Option B (Tiered Inner Hex Pulse)

- **HIGH:** None.
- **MEDIUM:** None.
- **LOW:**
  - Crossed-swords shield badge still kisses the top-right inner hex pulse stroke on [q1-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q1-390x844-modern.png), [q1-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q1-390x844-classic.png), and [q1-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q1-1280x720-classic.png) — nudge 3–4 px inward (or anchor to the nameplate's right end) when final art lands.

---

## Q2: Open Info Panel When Its Cell Changes — Option A (In-Place CTA Morph)

Verified fixes: Modern's `"Taken by agenttester / Tap to update"` CTA now renders with the warm brass-gold gradient across all five Modern sheets ([q2-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-1280x720-modern.png), [q2-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-1920x1080-modern.png), [q2-1024x768-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-1024x768-modern.png), [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-390x844-modern.png), [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-844x390-modern.png)), and the stale camp's metadata chips now fade uniformly to 45% grey alongside the header and lower buttons in both Modern and Classic ([q2-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-1280x720-classic.png), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-390x844-classic.png)).

- **HIGH:** None.
- **MEDIUM:** None.
- **LOW:**
  - Classic's `Under attack` pill still shows a faint square grey rectangle peeking outside its four rounded ends ([q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-390x844-classic.png), [q2-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-1280x720-classic.png)) — clip the wrapper to `border-radius: 999px; overflow: hidden` or remove the outer fill.
  - On landscape phone `taken` ([q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q2-844x390-modern.png)), the panel's bottom scroll-fade scrim slightly dims the bottom edge of `"Tap to update"` — scroll ~8–10 px further (or tighten the scrim) so the full brass-gold CTA stays at 100% brightness.

---

## Q3: Connection Lost — Option A (Top-Centre Floating Notice Chip)

Verified fix: the 20 px heavier-stroke amber radio-arcs-with-`!` icon now reads crisply at 1x desktop ([q3-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q3-1280x720-modern.png), [q3-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q3-1920x1080-modern.png), [q3-1024x768-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q3-1024x768-modern.png), [q3-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q3-1280x720-classic.png)) and phone ([q3-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q3-390x844-modern.png), [q3-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q3-844x390-modern.png), [q3-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r3/SHEETS/q3-390x844-classic.png)), matching the visual weight of the `#4CE082` `Live` icon.

- **HIGH:** None.
- **MEDIUM:** None.
- **LOW:** None.

---

## Final Recommendations

- **Q1 — Option B:** It clearly colour-codes attacks, captures, and shields across every screen size and both themes while staying strictly inside each hex boundary and remaining calm during dense bursts.
- **Q2 — Option A:** It prevents mis-taps with zero layout shift, keeps secondary actions live during attacks, and unmistakably separates the clickable brass-gold `"Taken by X / Tap to update"` button from the uniformly dimmed stale camp.
- **Q3 — Option A:** It keeps full `"Not live ↻"` / `"Live"` clarity, a 44 px tap target, and native Modern/Classic styling in one consistent, collision-free top-centre slot from `1920x1080` down to `844x390` landscape.
