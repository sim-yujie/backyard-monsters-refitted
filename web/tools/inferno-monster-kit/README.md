# Inferno monster kit (IC1-IC8 Modern repaints)

Paints one Inferno monster for the Modern look the way the main-yard monsters were done: a still sheet
(one painted view per heading) and an animated sheet (row 0 idle, rows 1-6 walk, rows 7-11 attack, for
every heading), wired through `REPAINTED_SHEETS` / `REPAINT_LAYOUTS` in
`web/src/game/attack/monsterSprites.ts`. Classic keeps the Flash sheet (the global Classic switch).

Order: Spurtz IC1 (done, branch `art/inferno-monsters`), Zagnoid IC2, Malphus IC3, Valgos IC4,
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
6. `python ../shrink-sheet.py <assets>/<out>-anim@4x.png <assets>/<out>-anim.png` (256 colours; it then
   runs `sheet_copies.py`, which writes the Medium @2x copy and updates `sheetVersions.ts`). Then
   `python ../sheet_copies.py --check`.
7. Wire it: `REPAINTED_SHEETS` and `REPAINT_LAYOUTS` entries; tests: `monsterAnimLayout.test.ts`
   (exact key list + a layout test like Spurtz's). The "unrepainted sheet" examples in
   `monsterSprites.test.ts` now use the `worker` sheet; `monsterAnimLayout.test.ts` still uses IC8 as
   "a sheet with no layout": the IC8 helper must pick another.
8. `python compare.py IC1 $WK <worktree>/shots-inferno-mon/IC1` -> comparison sheets, game-size strip,
   mirror light check, loop mp4s.

Codex calls for IC1: 1 sample + 4 still batches + 17 animation = 22 first-pass calls, plus redos (see the
lead report). `codex_call.sh` appends every call to `$WK/calls.log`.

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
- The painted flame crown is taller than Flash's, so the still (held to the Flash cell's height) comes out
  ~10% narrower; `build_anim.py` grows the animated frames to the Flash body width (`grow` in its output)
  and the anim cell has 12 px of headroom.
- Codex ignores "no sparks" now and then; `common.key_cell` drops specks and loose bits touching the cell
  edge, but look at the contact pictures.
- Vite: never run it on a symlinked `web/node_modules` (shared `.vite` cache breaks the owner's 5173);
  hard-link copy it (`cp -al`) and delete its `.vite`.
