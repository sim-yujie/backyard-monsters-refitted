Below is a screenshot-by-screenshot UX critique across all 21 contact sheets in `r1/SHEETS/` compared against [directions-r0.md](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/directions-r0.md).

---

## Q1: Cell Changed

### Severity-Ranked Issues

#### HIGH
1. **Crossed-swords badge reads as a red `✕` close/error icon (All options A/B/C; all sizes; Modern & Classic)**
   - **Seen in:** [q1-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1280x720-modern.png), [q1-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1920x1080-modern.png), [q1-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-390x844-classic.png).
   - **Problem (first-time player misread / consistency):** The placeholder red-orange circle with two white diagonal lines sits on the building's upper-right shoulder and looks almost identical to the game's red-circle white-`X` panel close button (seen in Q2). At `1280x720` and `1920x1080` it reads as "error / invalid / delete" rather than "battle active."
   - **Change:** When replacing the placeholder art, break the red-circle-with-white-X silhouette completely: use a dark-iron/charcoal shield or badge (`#2B1C16` fill, `1.5 px` ember-gold rim `#FF8A2B`, `18 px` desktop / `20 px` phone) with distinct bright-steel sword blades + wide crossguards (or a small flame crest), and anchor it cleanly on the nameplate's right end rather than floating on the building roof where it competes with top-right hex borders in Classic. Keep it `pointer-events: none` so it never looks like a sub-44 px tappable button.

2. **Mint-cyan shield pulse collides with territory borders (Option B; all sizes; Modern & Classic)**
   - **Seen in:** [q1-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1280x720-modern.png), [q1-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-390x844-modern.png), [q1-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1280x720-classic.png) (`few`, upper-right shielded `agenttester` yard).
   - **Problem (clarity / first-time player misread):** Player territory is already bright cyan (`yardtester`) and rival territory is bright mint-green (`agenttester`). A `#38E09B` mint-cyan inner pulse visually merges with both border colours—players either miss it entirely or misread it as a territory colour change.
   - **Change:** Shift the shield-up pulse hue out of the cyan/green family to **ice-blue/sky-white (`#A8ECFF` stroke with `#FFFFFF` 1 px inner core)** so it matches the existing translucent glass-dome art without colliding with green/cyan ownership borders.

3. **Expanding rings spill across neighbouring borders and tangle in busy clusters (Option C; `1280x720`, `1024x768`, `390x844`, `844x390`; Modern & Classic)**
   - **Seen in:** [q1-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1280x720-modern.png) (`busy`), [q1-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-844x390-modern.png) (`busy`), [q1-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-390x844-classic.png) (`few`).
   - **Problem (calm-at-scale / Classic consistency):** Because Option C expands to `1.18x`, adjacent attacked `yardtester` cells overlap rings across their shared border, creating double-line visual noise. In Classic (`390x844`, `1280x720`), rings outside the heavy black/cyan tile edge look like misaligned border glitches.
   - **Change:** Do not ship outward-expanding rings; keep all live-change strokes strictly inset (`<= 1.0x`) inside the cell boundary.

4. **Classic inner hex pulses are too thin and muddy inside heavy territory frames (Option B; `1280x720-classic`, `390x844-classic`)**
   - **Seen in:** [q1-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1280x720-classic.png), [q1-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-390x844-classic.png).
   - **Problem (Modern vs Classic / contrast):** Classic tiles already have thick double black + neon-cyan/green outlines. Option B's ~2 px muted orange/gold inner stroke disappears against the dark olive grass and bright cyan frame (compare the vivid orange hex in `q1-390x844-modern` vs the dull brownish-rust line in `q1-390x844-classic`).
   - **Change:** In Classic, inset the pulse `3 px` inside the black border, bump stroke width to `3.5 px` desktop / `4 px` phone, brighten peak colours (`#FF5A26` attack, `#FFD23F` taken), and add a subtle `12–15%` matching inner tint fill at peak so it holds its own against Classic's saturated borders.

#### MEDIUM
5. **Gold "taken" pulse loses contrast on sunlit yellow-green grass (Option B; `1280x720-modern`, `1920x1080-modern`, `1024x768-modern`)**
   - **Seen in:** [q1-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1280x720-modern.png) (`few`, right `agenttester` cell), [q1-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1920x1080-modern.png).
   - **Problem (contrast / reading order):** Warm gold (`#F5B82E`) has very similar luminance and yellow hue to the sunlit meadow terrain and sits flush against the green territory stroke, making taken cells nearly invisible at `1920x1080`.
   - **Change:** Add a `1 px` dark-amber outer shadow (`rgba(40, 22, 0, 0.55)`) beneath the gold inner stroke, bump peak stroke width from `3 px` to `4 px` (with a `10%` warm-gold inner wash at peak), and shift hue slightly warmer (`#FFAA1D`).

6. **Pale interior fill wash reads as a selected cell or sand terrain, and leaves map activity too silent (Option A; all sizes)**
   - **Seen in:** [q1-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1280x720-classic.png) (`few`), [q1-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-390x844-classic.png) (`few`), [q1-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-1920x1080-modern.png).
   - **Problem (clarity / first-time player misread):** In Classic, Option A's translucent fill wash turns the attacked grass tile pale frosty beige/grey—indistinguishable from a selected hex or sandy ground—and gives zero event colour distinction. In `1920x1080` Modern and `844x390` `few` (where the attacked cell is partially covered by the bottom bar), Option A looks almost completely static, and silent neighbouring takeovers leave players unaware their border is shifting.
   - **Change:** Prefer Option B's colour-coded inner perimeter stroke over A's full-hex pale wash.

#### LOW
7. **Partially HUD-occluded cells lose edge cues on phone landscape (All options; `844x390-modern` `few`)**
   - **Seen in:** [q1-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q1-844x390-modern.png) (`few`, attacked `yardtester` cell behind `Filter`).
   - **Problem (fit / reading order):** Only the top vertex of the attacked hex clears the bottom toolbar. Option B's upper-edge orange stroke is still visible there while A's interior wash is hidden.
   - **Change:** No special Q1 chrome change needed—reinforces choosing Option B's perimeter stroke (with `4 px` phone stroke weight) so even partially visible cells stay readable.

### Q1 Recommendation
**Recommend Option B (Tiered inner hex pulse).** In the screenshots, Option B is the only option that stays strictly inside each hex footprint and stays calm in `busy` across all five viewports while still reading clearly at zoomed-out `1920x1080` and cropped `844x390`—unlike Option C's overlapping expanding rings in `1280x720`/`844x390` `busy` and Option A's pale wash that looks like sand/selection in Classic and misses neighbouring captures. Apply the four targeted polish fixes above (ice-blue shield hue, stronger Classic stroke + subtle inner fill, darker backing under Modern gold, and a non-`X` crossed-swords badge).

---

## Q2: Open Info Panel When Its Cell Changes

### Severity-Ranked Issues

#### HIGH
1. **Top overlay strip decapitates the player name and overflows the panel bottom (Option B; `390x844`, `844x390`; Modern & Classic)**
   - **Seen in:** [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-modern.png), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-classic.png), [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-844x390-modern.png) (both `taken` and `attack`).
   - **Problem (fit without scrolling / reading order):** The floating strip sits directly across the top half of `agenttester`'s name and guild icon, making the header unreadable. Worse, live-swapping `taken` into the taller player-outpost layout clips `"More about this yard"` right through the bottom frame on `390x844` (Modern & Classic), and immediately exposes a live orange **`Attack`** button on a friend's newly taken outpost (a serious mis-tap hazard for a finger poised to attack the wild Kozu camp).
   - **Change:** Reject Option B's live layout swap + top-edge overlay strip.

2. **Prompt bar is inserted above Attack instead of replacing it, causing layout shift and severe clipping (Option C; ALL sizes; Modern & Classic)**
   - **Seen in:** [q2-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1280x720-modern.png), [q2-1024x768-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1024x768-modern.png), [q2-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1280x720-classic.png), [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-modern.png), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-classic.png), [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-844x390-modern.png).
   - **Problem (fit without scrolling / tap targets / first-time player misread):** Option C pushes every button down by ~54 px, completely clipping `Look inside` off `1280x720`/`1024x768`/`390x844` (`taken`), growing the `390x844` `attack` sheet taller, and pushing the **`Taken by agenttester [Update]` bar itself below the fold on `844x390`** so it cannot be read or tapped without scrolling. Additionally, the inner `Update` pill is only ~28–32 px tall (below the `44 px` touch minimum), showing both `[Under attack | Update]` and a disabled `Attack` button beneath it creates redundant competing action rows, and freezing `attack` forces an unnecessary tap just to inspect or message the player.
   - **Change:** Reject Option C (or if ever reused, overlay the exact Attack slot height instead of inserting a row, and make the whole `>= 48 px` bar the tap target).

3. **Classic `Under attack` morphed button has unreadable dark-on-grey text and a square corner artifact (Option A; `1280x720-classic`, `390x844-classic` `attack`)**
   - **Seen in:** [q2-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1280x720-classic.png) (`attack`), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-classic.png) (`attack`).
   - **Problem (text contrast / HUD consistency):** Dark-brown/black text with heavy drop shadow sits on medium slate-grey (`#8D9196`), looking muddy and failing WCAG AA contrast (contrast looks ~2.5:1; compare Option B Classic's crisp white outlined text on the same grey pill). Also, a rectangular grey box bleeds outside the pill's four rounded corners.
   - **Change:** Clip the background to `border-radius: 999px` (remove the outer grey wrapper fill) and use **white `#FFFFFF` bold text with a `1 px` `#3B3F44` stroke** (matching Classic's native disabled grey pill in Option B) OR `#3A2B1D` dark brown with **zero** text shadow on a lighter `#D4C9B6` parchment-grey fill (`>= 7:1` contrast).

4. **Inserting a new `"Under attack"` chip row in Classic shifts the Attack button down (Option A & B; `1280x720-classic`, `390x844-classic` `attack`)**
   - **Seen in:** [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-classic.png) (`attack`, compare Col C's original layout vs Col A's added chip row).
   - **Problem (zero-layout-shift violation / redundancy):** Unlike Modern (which already has a `+56 m` chip row), Classic has no chip row below `"In range · next to your outpost"`. Adding a new `"Under attack"` chip row pushes the Attack slot down ~34 px—breaking Option A's core anti-misclick promise—and repeats `"Under attack"` twice stacked 10 px apart.
   - **Change:** In Option A, **never create a new chip row** above `Attack` when busy/shielded starts. Let the morphed `Attack` button alone carry `[swords] Under attack` (and only highlight an *already-existing* chip in place when one is present, e.g., shield or damage). That preserves 0 px layout shift in Classic and removes the duplicate label in Modern too.

5. **Phone landscape `taken` clips the morphed `"Taken by agenttester / Tap to update"` CTA off the bottom (Option A; `844x390-modern` `taken`)**
   - **Seen in:** [q2-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-844x390-modern.png) (`taken`).
   - **Problem (fit without scrolling / tap target):** Because the wild-camp header + 3 metadata rows (`+5%`, `In range`, `+44 m | Open ground`) take ~240 px of the short landscape sheet, `"Taken by agenttester"` is half-sliced off the bottom border and `"Tap to update"` is completely invisible.
   - **Change:** For `viewport height <= 430 px`, compact wild-camp metadata onto 2 rows (place `+5%` inline beside `+44 m` and `Open ground`), tighten panel vertical padding from `10 px` to `6 px`, and cap chip row gap at `4 px` so the full `48 px` primary CTA always sits 100% above the fold.

6. **`"Taken by agenttester / Tap to update"` looks disabled rather than tappable, and `Repeat attack` looks still active (Option A; all sizes `taken`; Modern & Classic)**
   - **Seen in:** [q2-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1280x720-modern.png), [q2-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-modern.png), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-classic.png).
   - **Problem (clarity / first-time player misread / HUD consistency):**
     - In Modern, `"Taken by agenttester"` uses a flat grey plate—the exact visual language of disabled buttons (`Take over`, `Under attack`). In Classic, it's a flat cream callout box. First-time players won't realize it is an interactive refresh button.
     - The left icon is a **map pin**, which reads as "jump to location" rather than "captured."
     - Meanwhile, the stale `Kozu camp` header stays at 100% brightness while the map hex right beside it already shows `agenttester`'s fortress, and **`Repeat attack` stays olive-gold (Modern) / light green (Classic)**, making it look clickable while frozen.
   - **Change:**
     - Style `"Taken by [Name] / Tap to update"` as an unmistakable interactive CTA: in Modern, warm riveted brass-gold (`#C68D28 -> #8F5E16` gradient, `#FFF6E0` bold text, corner rivets) with a **flag icon** on the left and a subtle `↻` refresh glyph on the right; in Classic, glossy amber-gold pill (`#F5B82E -> #CC8410`) with crisp dark-brown border.
     - Dim all frozen wild-camp elements (`Kozu camp` header + `Repeat attack` / `Take over` / `Look inside`) uniformly to `opacity: 0.45` and `filter: grayscale(0.6)` so `Repeat attack` cannot be mistaken for an active button.

#### MEDIUM
7. **Two-line `"Taken by"` CTA slightly clips `Look inside` at `1280x720` (Option A; `1280x720-modern`, `1280x720-classic` `taken`)**
   - **Seen in:** [q2-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1280x720-modern.png), [q2-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1280x720-classic.png).
   - **Problem (fit without scrolling):** The 2-line morphed CTA is ~8–10 px taller than the 1-line `Attack` button, nudging `Look inside` halfway behind the bottom border on `720 px`-tall desktop screens.
   - **Change:** Lock the morphed CTA to the exact height of `Attack` (`44 px` desktop / `48 px` touch) using tight two-line typography (`13 px` bold line 1 + `11 px` regular line 2, `1 px` line gap, `4 px` vertical padding) so zero downward push occurs.

8. **Option B `attack` splits reason from disabled button; Option C Classic veil washes out text contrast (Option B & C; all sizes)**
   - **Seen in:** [q2-1280x720-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-1280x720-modern.png) (Col B `attack`), [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-classic.png) (Col C).
   - **Problem (reading order / contrast):** In Option B `attack`, the disabled grey button still says `"Attack"` while `"Under attack"` is duplicated twice above it. In Option C Classic, the pale parchment veil drops frozen labels below `2.5:1` contrast.
   - **Change:** Covered by choosing Option A (which puts the reason directly on the disabled Attack face without veiling active secondary controls).

#### LOW
9. **Gold highlight wash barely visible against Classic parchment (Option A; `1280x720-classic`, `390x844-classic`)**
   - **Seen in:** [q2-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q2-390x844-classic.png).
   - **Change:** Use a warmer amber wash (`#E08A1E` at `28%` peak fill + `2 px` border) in Classic instead of pale cream-yellow so the 600 ms change flash actually reads on parchment.

### Q2 Recommendation
**Recommend Option A (In-place CTA morph, zero layout shift).** Looking at the screenshots, Option A is the only option that avoids both Option B's catastrophic header slicing (`agenttester` cut in half on `390x844` and `844x390` plus a live orange `Attack` button appearing on a friend's outpost) and Option C's ~54 px downward layout shift (which clips `Look inside` on `1280x720`/`390x844`, hides the `Update` bar off-screen on `844x390`, and adds an unnecessary tap on `attack`). Fix Classic's `Under attack` pill contrast/corner artifact, stop inserting a new `Under attack` chip row in Classic, style `"Taken by X / Tap to update"` as a clickable brass/gold button with a flag icon while dimming `Repeat attack`, and compact `844x390` metadata so the CTA never clips.

---

## Q3: Connection Lost

### Severity-Ranked Issues

#### HIGH
1. **Option B and C become unlabelled icon-only buttons on phone, causing first-time player misreads (Option B & C; `390x844`, `844x390`; Modern & Classic)**
   - **Seen in:** [q3-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-390x844-modern.png), [q3-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-390x844-classic.png), [q3-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-844x390-modern.png).
   - **Problem (clarity / first-time player misread):** Dropping `"Not live"` and the retry arrow `↻` on mobile leaves an ambiguous slashed-Wi-Fi glyph. In Option B it looks like a permanent toolbar toggle; in Option C it shares the exact circle shape below `?` and looks like a secondary Help/Settings button. In `live` mode (row 2), the dim dark-green Wi-Fi icon on a dark button is nearly invisible and looks like a permanent icon rather than a brief `"Live"` confirmation.
   - **Change:** Keep the text label (`"Not live"` + `↻` / `"Live"`) on phone as well as desktop—which Option A already handles cleanly without crowding any toolbar.

2. **Option B cramps Modern's 6-button phone toolbar, mismatches HUD framing, and teleports to the bottom bar in landscape (Option B; `390x844-modern`, `844x390-modern`)**
   - **Seen in:** [q3-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-390x844-modern.png) (Col B), [q3-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-844x390-modern.png) (Col B).
   - **Problem (HUD consistency / reading order / fit):** On `390x844` Modern, wedging a 7th button between `Search` and `Mail` compresses gaps to ~5 px, and its flat dark rounded rectangle clashes with the riveted bronze-framed square buttons beside it. Rotating to `844x390` landscape moves it all the way from the top toolbar to the **bottom bar** left of `Mail`, breaking spatial consistency.
   - **Change:** Do not dock the live status indicator inside the phone toolbars.

3. **Option A drops ~40 px too low on phone landscape, floating directly over the central map outposts (Option A; `844x390-modern`)**
   - **Seen in:** [q3-844x390-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-844x390-modern.png) (Col A, `down` & `live`).
   - **Problem (fit / reading order):** On `844x390`, Option A sits at ~`y = 92 px` right on top of the player's own `yardtester` cluster, even though the top-centre lane directly right of `Find bookmarks, outposts` (`y = 48–84 px`) is completely empty.
   - **Change:** On landscape phone (`height <= 430 px`), anchor Option A at `top: 8 px` below the top resource bar (aligned vertically with `?` and the Search pill, centred in the open map band or at `left: 50%` since Search ends well left of centre). That reclaims the middle of the landscape map.

#### MEDIUM
4. **Slashed Wi-Fi icon misleads players into thinking their device Wi-Fi is off (All options A/B/C; all sizes)**
   - **Seen in:** All Q3 contact sheets (`down` row).
   - **Problem (first-time player misread):** A crossed-out Wi-Fi icon strongly signifies "your phone/PC lost Wi-Fi," prompting players to check device settings instead of tapping to reconnect the game's live map stream.
   - **Change:** Replace the placeholder slashed-Wi-Fi glyph with a **broken live-signal / paused-sync icon** (e.g., two small radio arcs with an amber `!` or a paused broadcast dot) paired with `"Not live"` + `↻` (and consider `"Live paused"` if space allows, or keep `"Not live"` with a clear `15 px` `↻` retry arrow).

5. **Touch targets fall below `44 px` on iPad/phone (Option A, B, C; `1024x768`, `390x844`, `844x390`)**
   - **Seen in:** [q3-1024x768-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-1024x768-modern.png) (Col B), [q3-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-390x844-modern.png) (Col A & C), [q3-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-390x844-classic.png) (Col A & C).
   - **Problem (tap targets >= 44 px):** Option B's top-bar pill on `1024x768` iPad is only ~24–26 px tall. Option A's pill on `390x844` is visually ~32–34 px tall, and Option C's phone circle is ~36–38 px.
   - **Change:** For Option A, set visual height to `34–36 px` (`font-size: 13 px` bold, `padding: 0 12 px`) with an invisible `min-height: 44 px` touch hit-area (`padding-block: 5 px` on the outer hit button) on touch/tablet viewports.

6. **Low-contrast green icon in `live` state & far-corner invisibility of Option C at `1920x1080` (All options; `1920x1080-modern`, `390x844`)**
   - **Seen in:** [q3-1920x1080-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-1920x1080-modern.png) (Col C), [q3-390x844-modern.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-390x844-modern.png) (`live` row).
   - **Problem (contrast / reading order):** The `live` green icon (`~#2F9E5A`) has weak contrast against the dark slate/brown fill on phone screens. Meanwhile, Option C sits in the extreme top-left void on `1920x1080`, far outside a player's central focus and visually paired with `?` Help.
   - **Change:** Brighten the `live` icon and subtle rim to `#4CE082` (paired with crisp `#FFFFFF` `"Live"` text) so the 1.5 s reconnect confirmation reads cleanly at a glance.

#### LOW
7. **Classic chip lacks subtle bevel matching neighbouring wood chrome (Option A & C; `1280x720-classic`, `390x844-classic`)**
   - **Seen in:** [q3-1280x720-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-1280x720-classic.png), [q3-390x844-classic.png](file:///home/yujiesim/Coding/backyard-monsters-refitted/worktrees/live-ux/neon/r1/SHEETS/q3-390x844-classic.png).
   - **Change:** Add Classic's `1.5 px` warm-gold bevel rim (`#C89A54` in `down`, `#7EC882` in `live`) and subtle top inner gloss so Option A feels native beside the Classic `Mail / Filter / Key` buttons.

### Q3 Recommendation
**Recommend Option A (Top-centre floating notice chip).** In the screenshots, Option A is the only option that stays readable with full `"Not live ↻"` / `"Live"` text and consistent placement across all five screen sizes and both themes—whereas Option B jams an unlabelled, style-mismatched 7th button into Modern's packed `390x844` toolbar and jumps to the bottom bar on `844x390`, and Option C reduces phone to an unlabelled circle under `?` that vanishes in `live` mode. Ship A after moving it ~40 px higher on `844x390` landscape (aligned with the Search bar), guaranteeing a `44 px` touch hit-area, brightening the `#4CE082` `live` icon, and replacing the slashed Wi-Fi placeholder with a live-sync icon.
