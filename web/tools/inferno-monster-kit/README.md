# Inferno monster kit (IC1-IC8 Modern repaints)

Paints one Inferno monster for the Modern look the way the main-yard monsters were done: a still sheet
(one painted view per heading) and an animated sheet (row 0 idle, rows 1-6 walk, rows 7-11 attack, for
every heading), wired through `REPAINTED_SHEETS` / `REPAINT_LAYOUTS` in
`web/src/game/attack/monsterSprites.ts`. Classic keeps the Flash sheet (the global Classic switch).

Order: Spurtz IC1 (done, branch `art/inferno-monsters`), Zagnoid IC2 (done, same branch), Malphus IC3, Valgos IC4,
Balthazar IC5, Grokus IC6, Sabnox IC7, King Wormzer IC8. One monster per Codex usage window (~40 calls).

Python: `~/.cache/bymr-art-venv/bin/python` (numpy + Pillow; **imagequant** was pip-installed into it on
15 Nov for the shrink step, since this PC has no pngquant). The kit needs no scipy. Run every script from
this folder. Work files go in `<worktree>/art-work/<ID>/` (never commit that folder).

## Steps (IC1 numbers)

0. `codex login status`. Add the monster to `spec.py` (copy IC1's entry: Flash file, cell, anchor, how the
   Flash columns turn, painted headings, words for the creature/parts/walk/attack). Look at the Flash sheet
   first (rows, columns, which column faces where); `docs/art/monster-sprites.md` has the table.
1. Design sample, 1 call: `python still_batch.py IC1 $WK 8 12 16 24` then
   `bash codex_call.sh $WK/still/b-8-12-16-24 frames-new.png sample`. Look at `frames-new.png`; when right,
   `python approve.py IC1 $WK $WK/still/b-8-12-16-24` (its views become the style row of later batches).
2. Still batches, 4 headings per call: `still_batch.py` + `codex_call.sh` for the remaining painted headings
   (IC1: 9 10 11 13 / 14 15 17 18 / 19 20 21 22 / 23 + 3 spares). Three can run at once.
   A view painted twice: the later batch wins; drop one with a line `b-<dir> <heading>` in `$WK/still/skip.txt`.
3. `python build_still.py IC1 $WK` -> `<out>-repaint@4x.png` + 1x, `still/fit.json`, `still/cuts/`, and a
   facing check (a `CHECK FACING` line = the painting matches the mirrored Flash cell better: redo it).
4. Animated sheet, 1 call per painted heading: `bash run_anim.sh IC1 $WK 8 9 ... 24` (4 at a time; stops
   on the usage limit). Redo one heading: `EXTRA="..." bash run_anim.sh IC1 $WK 13`.
5. `python build_anim.py IC1 $WK` -> `<out>-anim@4x.png` + 1x and `anim/frames/`.
6. Copy the four new sheets to `$WK/masters/`, then `python ../shrink-sheet.py <assets>/<out>-anim@4x.png
   <assets>/<out>-anim.png <assets>/<out>-repaint@4x.png <assets>/<out>-repaint.png` (256 colours; it then
   runs `sheet_copies.py`, which writes the Medium @2x copies and updates `sheetVersions.ts`). Delete the
   `<out>-repaint@2x.png` it makes (the still sheet is not wired, like the Wormzer's), then
   `python ../sheet_copies.py` and `python ../sheet_copies.py --check` (prints nothing when all is well).
7. Wire it: `REPAINTED_SHEETS` and `REPAINT_LAYOUTS` entries; tests: `monsterAnimLayout.test.ts`
   (exact key list + a layout test like Spurtz's). The "unrepainted sheet" examples in
   `monsterSprites.test.ts` now use the `worker` sheet; `monsterAnimLayout.test.ts` still uses IC8 as
   "a sheet with no layout": the IC8 helper must pick another.
8. `python compare.py IC1 $WK <worktree>/shots-inferno-mon/IC1` -> comparison sheets, game-size strip,
   mirror light check, loop mp4s.

Codex calls for IC1: 1 sample + 4 still batches + 17 animation + 1 redo (heading 17) = **23 calls**,
about 25 minutes of Codex time (calls run 3-4 at once). Codex calls for IC2 (all 30 headings painted): 1 sample + 7 still batches (the last one 28 29 plus spares 0 and 20, which replaced the earlier views) + 30 animation + 2 redos (headings 0 and 16, the two side views: dark tiger stripes, a comb of spines and a row of legs; redone with an `EXTRA` note) = **40 calls**, about 30 minutes. Masters before the 256-colour shrink are kept in
`$WK/masters/` (rerun the shrink from those, never from an already shrunk sheet). `codex_call.sh` appends every call to `$WK/calls.log`.

## Gotchas

- **Mirroring.** A left-right symmetric monster needs only front -> left -> back painted (`painted` in
  spec, 17 of 32 headings); heading h is the mirror of (directions/2 - h). The prompts say "glows evenly
  from within, no light from one side" so a flipped view does not show light from the other side. Check
  `mirror-check.png`. An asymmetric monster (one claw, side horn) must paint every heading instead.
- **Spurtz's Flash sheet has 30 columns but the game reads 32 headings** (`SPRITES.as` IC1 branch,
  `rotation / 11.25`): Flash's headings 30 and 31 read past the sheet. The art is drawn 12 degrees apart.
  The repaint paints 32 true headings 11.25 degrees apart and sets `columns: 32` in `REPAINT_LAYOUTS`
  (with 32 directions that packs exactly one heading per column). `spec.flash_column` maps a heading to
  the nearest Flash column for the reference pictures. Check each Inferno sheet's columns vs directions.
- **Pillow images made with `Image.fromarray` ignore `ImageDraw.floodfill`** (read-only buffer): `.copy()` them.
- Size: the painted flame crown is taller than Flash's, so the still (held to the Flash cell's height)
  is height-limited ("cut to fit the cell" lines are normal). `build_anim.py` would grow the frames to the
  Flash body width if the still came out narrower (`grow` in its output; 1.0 for Spurtz). `drop` in the
  spec stands the body 1 px into the Flash shadow, as Flash does (without it Spurtz looked to float).
- `despill="fire"` (spec): thin flame tips pick up magenta; for a creature with no blue or purple the
  blue above green is stripped. Leave it out for purple/blue monsters.
- Codex keeps the facing well with the facing words from `spec.view_of`; the one redo for IC1 (heading 17)
  was a walk that tipped the body over and lost the face sliver; redo with an `EXTRA` note (step 4).
- Codex ignores "no sparks" now and then; `common.key_cell` drops specks and loose bits touching the cell
  edge, but look at the contact pictures.
- Vite: never run it on a symlinked `web/node_modules` (shared `.vite` cache breaks the owner's 5173);
  hard-link copy it (`cp -al`) and delete its `.vite`.
- **Next monsters.** IC3-IC8 read 30 headings on 30-column sheets (only IC1 has the 32/30 quirk), so
  `columns` stays out of their layout. Several are not left-right symmetric (Malphus, Valgos, Grokus,
  Sabnox: check the Flash sheet with a column-vs-mirrored-column diff as done for Spurtz and Zagnoid):
  then set `painted` to all headings, 8 still + 30 animation calls, which fills a whole window. Move every
  word that is the monster's own into `spec.py` (`features`, `face_marks`, `portrait_note`, `light`,
  `texture`, `no_fx`, `creature`, `parts`, `back_note`, `walk`, `attack`, and `face`/`back_range` for
  `view_of`). Run `python check_crop.py <dir>` first and look at `crop-check-<ID>.png`.

## IC2 Zagnoid (done 15 Nov): what was new

- **Fractional cell.** The Flash cell is 64.4 px wide (1933 / 30). `spec.flash_w` = 64.4; `common.flash_x`
  starts column c at round(c * 64.4) and cuts `cell` = 64 px. The sheet has exactly one see-through-separated
  art run per column, so `flash_cell` keeps only column c's own run (without that, the left neighbour's shadow
  tip and the right neighbour's tail tip show in the cut). 70 of 28221 art pixels fall outside the cuts
  (Flash's own cut lost them too). `check_crop.py` proves every IC1 cell cuts exactly as before.
- **Drift.** The art was laid out about 64.65 px apart, not 64.4 (the last column is cut off at the sheet
  edge): a body-centre fit (linear + one sine over the turn, 0.4 px residual) gives the body creeping right
  0.25 px a column, 7 px over the turn, then jumping back between headings 29 and 0. `spec.flash_drift`
  takes it out (`common.flash_shift`, centred on the middle column, so at most 3.6 px either way) for both
  the body and its shadow. Classic still shows Flash's creep.
- **Not symmetric.** Mirror diff (lit body, centred): shape mismatch 0.38 vs Spurtz's 0.08, and Flash is lit
  from the upper left with the cast shadow to the lower right. All 30 headings painted; the prompts ask for
  the same screen-fixed light from the upper left.
- **Long cast shadow.** `shadow="flash"` draws the Flash cell's own shadow shape (`common.cast_shadow`)
  instead of an ellipse under the body (the ellipse lost Zagnoid's long shadow). `ref_body_only` gives
  Codex reference cells without that shadow, centred with margin (the body touches the cell's left edge).
- **Body at the cell edge.** `still_pad=6`: the still sheet's cells are 76 px wide (the anim cell width), so a
  painting 1.2x the Flash area is not cut at the left edge. Fit coordinates stay in Flash-cell pixels.
- **Snout on a neck.** `view_of` takes `face` (the word: "snout") and `back_range` (headings with no face:
  234-306 degrees); the three-quarter back views outside it say the snout shows in profile, as Flash does.
- **Facing check** is now body-centred (`common.facing_scores`): the old whole-cell diff is decided by
  position on an off-centre cell.
- Codex calls: see the IC2 line under Steps (plus 2 more redos after it: headings 1 and 8, colour drift found by
  comparing each heading's mean frame colour with its idle frame; 42 calls in all).
- `compare.py` writes `mirror-check.png` for mirrored headings only; with every heading painted it means nothing.

## IC2 Zagnoid round 2 (15 Nov): faithful to the Flash sprite

The owner rejected round 1 ("looks nothing alike": a fat, ribbed, glossy golden grub with a smile). Causes: the
concept portrait in every prompt, and prompt words written from it ("fat lumpy slug", "glossy golden", "stubby
legs"). Round 2 (work dir `art-work/IC2-r2`, 45 Codex calls: 2 samples + 7 still batches + 2 still redos + 30
animation + 4 animation redos for front headings 6-9, whose wind-up grinned) changed the kit, all switched on per monster in `spec.py` so IC1 is untouched:

- `portrait=False`: no concept painting. `still_batch.py` says frames.png is the only design reference;
  `anim_ref.py` sends that heading's Flash cell (`flash.png`) beside the painted still instead.
- `ref_smooth`: the Flash cells are blown up bicubic, not blocky (Codex read the blocky head as a thin bird beak).
- Words picked from the Flash pixels (comment above the IC2 entry), plus `style` (a faithful remaster, not glossy).
- `open_holes`: `key_cell` makes magenta gaps closed in by bent arms and claw fingers see-through again.
- `grade`: per-part (body / limbs; crest left alone) per-channel colour match to the Flash sprite
  (`common.grade`), applied when placing views (build_still) and to every animated frame (build_anim); the cuts
  and Codex references stay ungraded. The numbers come from the mean and spread of the 30 still views at 1x.
- `anim_colour_lock`: build_anim matches each animated frame's colours to its heading's still view (heading 9's
  sheet came back olive-grey). `gamma=1.0`: no brightness lift (the grade already matches Flash).
- No `despill` (the crest is grey-teal). `compare.py` with `STEP=1` writes a compare sheet for every heading.
- Front views drift to a grin: the redo note for headings 5-8 (stills) and 6-9 (animation, `EXTRA`) asked for a
  closed mouth hidden under the bill in every cell.
- The limb and crest numbers in `grade` were then set by eye on `game-size-x3.png` (the stats fit made the legs
  salmon and left the crest near black at 1x); the crest grade only touches dark green pixels.

## Battle shot setup (own database copy, never `bym`)

- The server needs `INFERNO_ENABLED=on` (every `/bm/inferno/*` route answers "The Inferno is not open yet"
  without it): add it to the helper's server command.
- yardtester (user 2503, password `Dev12345!` in the `inferno_mon` copy): Inferno save basesaveid 3401. Set
  `monsters.housed` (e.g. `{"IC1": 0, "IC2": 60}`) and `lockerdata.<ID>` = `{"t": 2}`. The tribe attack flings at
  most the Housing Bunker's capacity (`infernoTribeFlingCapacity`: 200 at level 1, 1140 at level 5), so raise
  the bunker (building id 8, type 128) with `l` and `monsters.space` to match.
- Weakest tribe at yardtester's Inferno level (21): "Moloch's Minions, Level 19" (baseid 228).
- **Flash likeness of IC1** (lead's call): the Modern crown is a little taller and the body a little
  redder than Flash's (crown 38% vs 32% of the height, yellow 31% vs 34% of the pixels). A sample at
  Flash proportions (one call, not used) is in `art-work/IC1-flashprop` and
  `shots-inferno-mon/IC1/flash-proportions-sample.png`; a redo at those proportions is about 22 calls.

## IC2 Zagnoid round 3 (15 Nov): the portrait is the design

The owner rejected round 2 too: by "sprite" he meant the picture in the Hatchery / Locker
(`web/public/portraits/IC2.webp`), not the Flash battle sprite. Round 3 (work dir `art-work/IC2-r3`, round 2's
game sheets backed up in `art-work/IC2-r3/r2-assets`) paints that creature:

- `design="portrait"` (spec) with `portrait=True`: `still_batch.py` tells Codex the portrait decides the design,
  parts and colours and frames.png (the Flash cells) only the facing, pose and size; the Flash cell's dark head
  spikes are named as the eye stalks and its beak-like head as the mane and mouth. `anim_ref.py` sends ref.png
  (the painted still) + portrait.png; an `EXTRA` note (art-work/IC2-r3/anim-extra.txt) says the portrait shows
  one side only and every cell keeps ref.png's angle.
- Words written from the portrait (eye stalks, mane, fangs, drool, crab claws, neck spikes, curled tail, leg nubs).
  The creature is left-right symmetric, so it is lit from above and only headings 8-22 are painted (mirrored rest).
- `view_match` (build_still, `common.match_views`): Codex painted one 2x2 batch more orange than the others; every
  painted view's colour mean and spread is matched to the median view before placing (and before the cuts the
  animation calls and the anim colour lock use).
- `grade`: Codex paints it more orange and saturated than the card; the grade moves body and limbs toward the
  portrait's paler, greener gold and coral.
- Codex calls: 1 sample (8 12 15 21) + 3 still batches (the last with heading 15 again as a spare; the later one
  won) + 15 animation = **19 calls**. No redos were needed.
- Polish (owner: "finish the polish", 15 Nov): `grade_chroma` (spec) leaves grey / white pixels (fangs, drool, glints,
  crevices) as painted, since the old grade turned the drool cyan; headings 9 and 21 repainted at their true turn (they
  had come out as straight front / back views, so h6-h9 and h21-h24 looked alike); heading 12 repainted without the
  black-tipped tail tendril; heading 8's animation redone (the tail flipped to the left in the walk frames), then
  9, 12 and 21 animated again from their new stills. `still/skip.txt` keeps only h9/h21 and h12 from the two redo
  batches. 6 more calls: **25 calls** for round 3.
- Comparison pictures: `art-work/IC2-r3/r3sheets.py <shots dir>` (portrait | round 2 | round 3; every heading; game
  size). Battle and yard shots: `art-work/IC2-r3/film.mjs` (yardtester, own server on 5461).

## IC3 Malphus (painted 16 Nov, waiting for the owner)

- **Flash rows.** `malphus.png` is 30 x 9 whole-pixel cells of 51 x 35. The game plays rows 1-8 (walk) and never row 0,
  a standing pose whose columns turn the other way (column c faces 360 - 12c degrees). `spec.flash_row` = 1:
  `common.flash_cell` (and so the Codex references, shadows, fits and facing checks) use the first walk frame;
  `compare.py` shows that row as "Flash idle". `check_crop.py <dir>` now writes `crop-check-<ID>.png` for every sheet.
- **Symmetric** (silhouette XOR / union vs the mirror column 15 - c, same measure: IC1 0.11, IC2 0.15). Malphus 0.44
  frame for frame, but the walk is a four-legged gait whose mirror is half a cycle on: matched 4 rows later it is 0.27,
  less than two neighbouring columns differ (0.32) or the walk changes one column (0.36). The portrait creature is
  symmetric but for its drool. So headings 8-22 are painted, lit from above, the rest mirrored, and
  `mirror_walk_roll=3` makes `build_anim.py` play walk frame k+3 on mirrored headings (no leg jump at the seams).
- Words from the portrait (`design="portrait"`); `pose_parts` / `frames_note` (spec) now hold the words
  `still_batch.py` used to say only for Zagnoid. Pink is asked for as "dusty rose" and never pure magenta (the key
  colour); look for holes in the head stripes, leg webs and fur after each batch. `view_match` is off (front views
  carry the orange belly and tusks that the back views hide). Still NOTE: `art-work/IC3/note-still.txt` (stand evenly
  on all four legs, not mid-stride); animation EXTRA: `art-work/IC3/anim-extra.txt`.
- **Painting (16 Nov), 27 Codex calls**: 2 samples + 6 still batches + 15 animation + 4 animation redos. Work dir
  `art-work/IC3`; comparison pictures `art-work/IC3/sheets.py <shots dir>`; battle film `art-work/IC3/film.mjs`
  (yardtester, own server on 5471; drop at DX=200 DY=640, the old 330,520 spot is a refused red ring).
  - Sample 1 painted the belly as a smooth ball with seams and the 252-degree view dead straight: the spec now asks for an
    egg of 5-6 stacked horizontal plates, and `note-still.txt` has a TURN line. Sample 2 approved (style row).
  - **Turns.** `view_of` put 204-240 degrees in "only the very left edge of the face may show", so Codex painted five
    identical back views (h18-h22). `back_range=(246, 294)` makes 204-240 ask for the head in profile at the left, as
    Flash shows, and the redo batches carried per-heading turn notes (`turn-r1/r2/r3.txt`). The last one asked for the
    whole body (legs too) to turn diagonally; only that got h18-h21 to turn step by step. Later batch wins: h9 h14-16
    from b-9-14-15-16, h17 from b-17-18-19-20, h18-21 from b-18-19-20-21, h22 from b-19-20-22-21 (no skip.txt needed).
  - **Fur holes.** The lilac fur highlights pass the magenta test (green ~90-110), so `open_holes=True` punched specks
    into the fur. `open_holes="core"` (common.key_cell) opens only gaps with real key colour (green < 60) in them.
  - **Attack facing.** In side views (h13-16) the anticipation and wind-up cells turned to face the viewer (arms "raised
    to the sides" reads as a front pose). Redone with `anim-extra-attack.txt` (same angle as ref.png, arms up and
    forward toward the facing direction); `sheet-try1.png` keeps the first try.
  - **Colour.** Codex's armour came out more golden and saturated than the card (hue 42 vs 48, saturation 0.77 vs 0.60):
    `grade` (body = armour; limbs = belly, fur, pink) with `grade_chroma`. Walk / attack vs idle mean colour within 1.

  - **Magenta specks.** A few drool-gap pixels under the jaw at h18 (and its mirror h27) came back hot pink (green
    under 40) but not magenta enough to key out: spec `demagenta` (`common.demagenta`, run inside `grade`) fills
    them from their neighbours. The dark violet fur (red under 150) and the dusty-rose stripes (green ~100) are untouched.
  - **Filming gotchas.** A tribe base disappears after it is attacked (L19 was gone on the next run; L20, L21, L24
    were offered). A running server keeps the save in memory and writes it back, so change `monsters.housed` only
    with the server stopped. Malphus run off fast (they leap walls toward resource buildings), so the camera loses them.
  - The Hatchery / Locker show only the portrait card (`ui/monsters/LockerTab.ts` uses `monsterPortrait`); the
    painted sprite shows in battle and as housed monsters walking in the Inferno yard.
