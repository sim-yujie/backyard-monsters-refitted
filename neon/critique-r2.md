Below is the Round 2 UX critique across all 21 contact sheets in `r2/SHEETS/`, checked against [critique-r1.md](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/critique-r1.md) and [directions-r0.md](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/directions-r0.md).

---

## Q1: Cell Changed

**Status for recommended Option B: No HIGH or MEDIUM issues left.** All four Round 1 blockers on Option B (non-`X` dark-iron crossed-swords shield, `#A8ECFF` ice-blue shield pulse with white core, `#FFAA1D` 4 px Modern gold pulse with dark under-edge, and 3.5/4 px Classic pulses with 14% inner tint) landed cleanly across all seven sheets.

### Remaining Issues

#### HIGH
- *(None across Option B or Option A.)*
1. **Outward-expanding rings still spill across tile borders and collide in clusters (Option C; `1280x720-modern`, `390x844-modern`, `844x390-modern`, `390x844-classic`)**
   - **Seen in:** [q1-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-390x844-modern.png) (`few`), [q1-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-390x844-classic.png) (`few`), [q1-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-1280x720-modern.png) (`busy`), [q1-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-844x390-modern.png) (`busy`).
   - **Problem:** Even tightened to `1.10x`, the ring still crosses outside the hex perimeter—cutting outside Classic's heavy black-and-cyan tile frame like a misaligned border (`390x844-classic` `few`) and overlapping across shared edges between adjacent active cells (`1280x720-modern` and `844x390-modern` `busy`).
   - **Exact change:** Do not ship outward scaling (`> 1.0x`); keep all live-change strokes strictly inset inside the cell perimeter (as in Option B).

#### MEDIUM
2. **Neighbouring takeovers and shield-ups remain silent, and the inset wash reads dim at wide/cropped views (Option A; `1920x1080-modern`, `1280x720-modern`, `844x390-modern`, `1280x720-classic`)**
   - **Seen in:** [q1-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-1920x1080-modern.png) (`few`), [q1-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-844x390-modern.png) (`few`), [q1-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-1280x720-classic.png) (`few`).
   - **Problem:** Switching to a colour-coded wash + inset line fixed Round 1's pale-sand misread, but Option A still omits pulses on adjacent rival captures/shields (`agenttester`) and its thinner line is faint at `1920x1080` and mostly lost when a cell sits behind `Filter` on `844x390`.
   - **Exact change:** Prefer Option B's bolder tiered inner perimeter pulse for own and in-range neighbouring cells.

#### LOW
3. **Crossed-swords badge still floats on the upper-right roof where it kisses the inner pulse stroke and hex edge (Option B [and A/C]; `390x844-modern`, `390x844-classic`, `1280x720-classic`)**
   - **Seen in:** [q1-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-390x844-modern.png) (`few`, `busy`), [q1-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-390x844-classic.png) (`few`, `busy`), [q1-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q1-1280x720-classic.png) (`few`).
   - **Problem:** The new dark-iron shield silhouette completely solves the red-`X` close-button misread, but its upper-right roof anchor still touches the top-right inner hex pulse line (and sits right on the tile corner on cropped cells).
   - **Exact change:** When final painted art lands, nudge the badge `3–4 px` inward from the upper-right edge (or anchor it to the nameplate's right end) so it clears the inner hex pulse stroke cleanly.

---

## Q2: Open Info Panel When Its Cell Changes

**Status for recommended Option A: Still has 1 HIGH and 1 MEDIUM issue left** (plus 1 LOW Classic corner-clip artifact). Removing the inserted `"Under attack"` chip row, fixing Classic's disabled pill contrast, locking the CTA to `52 px`, fading `Kozu camp` + `Repeat attack`, and scrolling the bar into view on `844x390` all worked well—except Modern's `"Taken by X / Tap to update"` button missed the brass-gold styling, and stale metadata chips stayed unfaded.

### Remaining Issues

#### HIGH
1. **Modern's `"Taken by agenttester / Tap to update"` button is still flat slate-grey, not brass-gold (Option A; ALL 5 Modern sizes `taken`)**
   - **Seen in:** [q2-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-1280x720-modern.png), [q2-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-1920x1080-modern.png), [q2-1024x768-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-1024x768-modern.png), [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-modern.png), [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-844x390-modern.png) (Col A `taken`).
   - **Problem:** Classic Col A `taken` got the warm brass-gold fill and looks unmistakably clickable, but Modern Col A `taken` still renders as a flat cool slate-grey box (`~#5E6870`) with muted grey `"Tap to update"` text—matching the disabled grey of `Under attack`, `Repeat attack`, and `Take over` so players read it as a disabled banner rather than a primary refresh CTA.
   - **Exact change:** Apply the brass-gold interactive button treatment to Modern's morphed `taken` CTA (warm riveted gold gradient `#C68D28 -> #8F5E16` matching Modern's `View yard` / `Message` gold buttons, crisp `#FFF8E6` bold line 1 + `#FFEBC2` line 2, white/cream flag + `↻` glyph, and corner rivets) while keeping its exact `52 px` height.

2. **Option B unchanged — top overlay strip slices `agenttester`'s name in half, live swap exposes an active `Attack` button on a friend's outpost, and `390x844` clips the bottom (Option B; `390x844`, `844x390`; Modern & Classic)**
   - **Seen in:** [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-modern.png), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-classic.png), [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-844x390-modern.png) (Col B).
   - **Exact change:** Remains rejected; do not ship Option B.

#### MEDIUM
3. **Stale wild-camp metadata chips (`+5%`, `In range`, `+44 m`, `Open ground`) stay at 100% brightness between the faded header and buttons (Option A; ALL sizes `taken`; Modern & Classic)**
   - **Seen in:** [q2-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-1280x720-modern.png), [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-modern.png), [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-844x390-modern.png), [q2-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-1280x720-classic.png), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-classic.png) (Col A `taken`).
   - **Problem:** Only the header and lower action buttons faded to 45% grey. The middle metadata chips remain full colour/brightness—creating a dim-bright-dim visual sandwich and presenting the dead Kozu camp's `+5%` bonus as if it were active on `agenttester`'s newly captured outpost (which actually has `+15% / -13%`, visible in Col B). Compare with Col C `taken`, where those chips fade cleanly with the rest of the frozen panel.
   - **Exact change:** Apply the same `opacity: 0.45` + grayscale desaturation to the metadata chip block (`+5%`, `In range`, `+44 m`, `Open ground`) whenever the panel is frozen in `taken` state, leaving only the brass-gold `"Taken by X / Tap to update"` CTA and the red `✕` close button at 100%.

4. **Option C's inner `Update` pill is still `< 44 px` tall on touch, and freezing on `attack` blocks valid secondary actions behind an extra tap (Option C; ALL sizes; Modern & Classic)**
   - **Seen in:** [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-modern.png), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-classic.png), [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-844x390-modern.png) (Col C).
   - **Problem:** Replacing `Attack`'s exact slot fixed Option C's layout shift and `844x390` fold clipping, but the inner `Update` pill is still only `~28–32 px` tall (below the `44 px` touch minimum), `"Taken by agenttester"` wraps awkwardly beside it on `844x390`, Classic's pale veil washes out frozen text contrast, and freezing `attack` forces an unnecessary extra tap before using `View yard`, `Message`, or `Truce`.
   - **Exact change:** Prefer Option A (or if Option C were ever used, make the entire `52 px` bar the tap target and do not freeze secondary actions on `attack`).

#### LOW
5. **Classic `Under attack` pill still has a faint square grey rectangle peeking behind its four rounded corners (Option A [and B]; `1280x720-classic`, `390x844-classic` `attack`)**
   - **Seen in:** [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-390x844-classic.png) (`attack`), [q2-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q2-1280x720-classic.png) (`attack`).
   - **Problem:** Text contrast is now crisp and native (white outlined text on Classic's grey plate), but a sharp-cornered grey box border still extends outside the pill's rounded ends (compare the clean transparent corners on `View yard` right below it).
   - **Exact change:** Remove the outer rectangular grey fill/outline or clip the wrapper to `border-radius: 999px` with `overflow: hidden`.

---

## Q3: Connection Lost

**Status for recommended Option A: No HIGH or MEDIUM issues left.** The radio-arcs-with-`!` icon, `#4CE082` `Live` colour, `44 px` touch hit-area, Classic gold/green bevel, and landscape top-band placement beside `Find bookmarks, outposts` resolved every Round 1 issue on Option A cleanly across all seven sheets.

### Remaining Issues

#### HIGH
1. **Option B remains unlabelled icon-only on phone, cramps Modern's 6-button toolbar, teleports to the bottom bar in landscape, and sits `< 44 px` tall on iPad (Option B; `1024x768-modern`, `390x844-modern`, `390x844-classic`, `844x390-modern`)**
   - **Seen in:** [q3-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-390x844-modern.png), [q3-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-390x844-classic.png), [q3-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-844x390-modern.png), [q3-1024x768-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-1024x768-modern.png) (Col B).
   - **Problem:** None of Option B's phone/tablet structural problems changed—it still wedges an unlabelled, style-mismatched 7th button into `390x844` Modern, moves from top toolbar to bottom bar left of `Mail` on `844x390` (where green `live` reads like a persistent toggle), and stays `~24–26 px` tall in the `1024x768` iPad top bar.
   - **Exact change:** Do not dock live status inside the phone toolbars or thin top resource bar.

#### MEDIUM
2. **Newly introduced: Option C's full-text phone pill covers the left `yardtester` nameplate in landscape and crowds `Find`/`?`, while staying tucked in the far-left corner at `1920x1080` (Option C; `844x390-modern`, `1920x1080-modern`)**
   - **Seen in:** [q3-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-844x390-modern.png) (Col C `down` & `live`), [q3-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-1920x1080-modern.png) (Col C).
   - **Problem:** Keeping `"Not live ↻"` / `"Live"` on phone fixed `390x844`, but on `844x390` landscape the wider pill underneath `?`/`Find` now directly obscures the left `yardtester` outpost nameplate (`...ester` peeking out) and sits only a few pixels below `Find` (mis-tap risk). On `1920x1080`, it still sits in the far top-left void paired with Help `?`.
   - **Exact change:** Use Option A's centred top-band placement, which sits in the open lane beside `Find` on `844x390` without covering any outpost or crowding `Find`/`?`.

#### LOW
3. **Radio-arcs-with-`!` glyph strokes look slightly delicate at 1x desktop scale (Option A [and B/C]; `1280x720-modern`, `1920x1080-modern`, `1280x720-classic` `down`)**
   - **Seen in:** [q3-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-1280x720-modern.png), [q3-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-1920x1080-modern.png), [q3-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r2/SHEETS/q3-1280x720-classic.png) (Col A `down`).
   - **Problem:** The icon reads cleanly on phone, but on desktop `1280x720`/`1920x1080` the outer radio arcs and tiny center `!` are slightly faint/thin.
   - **Exact change:** Bump the `down` icon's stroke weight by `~0.5 px` (or increase the SVG box from `14–15 px` to `17–18 px` with a bolder center `!`) so it matches the crisp visual weight of the `#4CE082` `live` icon.

---

## Restated Recommendations

- **Q1 — Recommend Option B (Tiered inner hex pulse):** Ready to ship as-is (no HIGH/MEDIUM issues left)—it is the only option that clearly codes attack, capture, and shield across every size and both skins while staying strictly inside each hex footprint with zero border spill.
- **Q2 — Recommend Option A (In-place CTA morph, zero layout shift):** Ship Option A once Modern's `"Taken by X / Tap to update"` button gets its missing brass-gold styling and the stale `taken` metadata chips fade to 45% grey along with the frozen header and buttons.
- **Q3 — Recommend Option A (Top-centre floating notice chip):** Ready to ship as-is (no HIGH/MEDIUM issues left)—it delivers full readable text, a `44 px` tap target, native Modern/Classic framing, and clean, collision-free placement across desktop, iPad, portrait phone, and landscape phone.
