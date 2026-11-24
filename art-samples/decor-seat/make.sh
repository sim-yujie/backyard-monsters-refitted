#!/bin/bash
# Wonders SEATED on the yard grid (owner 24 Nov 2026: "the angle seems a bit off and they dont seem 'seated' on
# the ground"; and bigger). Redrawn square to the 2:1 grid with Codex from GUIDES (10 calls), small residuals
# fixed by square.py, sized by base width, base centred on the footprint centre, shadows that start at the base.
#   measure.py      the lead's base measure (slopes of the two lower edges, front corner off centre)
#   make_guides.py  refs/classic-guide-{a..e}: the exact 2:1 slab each object must stand on; classic-old-*: the
#                   old cut-outs (art/decor-wonders) on the same grid, for design only
#   make_massing.py refs/classic-guide-f: grey block-outs for Paoay and Fort Santiago (Codex kept turning their
#                   facades to the camera from the slab guide alone)
#   make_layouts.py refs/classic-new-{g..j}: the new Classic cut-outs on the grid, the guide for the Modern redraw
#   square.py       line fits on the base's lower outline -> stretch each side + shift columns to exact 2:1
#   seat_files.py   game files (@2x, shadow, offsets), sized by base width
#   wire.py         copies them into the wonders folder and writes the rows in revampDecorations.ts
#   windpump/make.py  the windpump (213) at 1.25x from its full-size cut pieces (decor-new's build.py)
#   seat_view.py    yard-style sheet with the footprint diamond; overlay.py 2:1 lines on cut-outs
#   build_pictures.sh  Modern build pictures for 213-222 only
set -e
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
O=/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/decor-wonders/art-samples/decor-wonders  # branch art/decor-wonders
python3 make_guides.py $O/classic refs/classic-
python3 make_massing.py refs/classic-guide-f.png
python3 prompts_classic.py; python3 prompts_modern.py
# --- Codex (10 calls). ca (6 on one 3x2 sheet) came back turned: dropped. cb..ce two per sheet; cc's Paoay and
#     Fort still faced the camera, so cf redraws them from block-outs. Modern (mg..mj) from the new Classic.
# bash $S/run_codex.sh ca refs/classic-guide-a.png refs/classic-old-a.png refs/ref-flash-wonders-3x.png refs/ref-flash-all-3x.png
# for k in b c d e; do bash $S/run_codex.sh c$k refs/classic-guide-$k.png refs/classic-old-$k.png refs/ref-flash-wonders-3x.png refs/ref-flash-all-3x.png; done
# bash $S/run_codex.sh cf refs/classic-guide-f.png refs/classic-old-c.png refs/ref-flash-wonders-3x.png refs/ref-flash-all-3x.png
mkdir -p classic modern sq sqm
python3 $S/cut_sheet.py cb/wonders-classic-b.png --cols 2 --rows 1 --out classic --names mayon-volcano,rizal-monument
python3 $S/cut_sheet.py cd/wonders-classic-d.png --cols 2 --rows 1 --out classic --names magellans-cross,pyramids
python3 $S/cut_sheet.py ce/wonders-classic-e.png --cols 2 --rows 1 --out classic --names chocolate-hills,banaue-terraces
python3 $S/cut_sheet.py cf/wonders-classic-f.png --cols 2 --rows 1 --out classic --names paoay-church,fort-santiago
W="paoay-church fort-santiago magellans-cross pyramids chocolate-hills banaue-terraces mayon-volcano rizal-monument"
for n in $W; do python3 square.py classic/$n.full.png sq/$n.full.png; done
python3 square.py $O/classic/taj-mahal.full.png sq/taj-mahal.full.png   # Taj Mahal: not redrawn, only squared
python3 make_layouts.py sq refs/classic-new-
# for k in g h i j; do bash $S/run_codex.sh m$k refs/classic-new-$k.png refs/ref-modern-wonders.png refs/ref-modern-all.png; done
python3 $S/cut_sheet.py mg/wonders-modern-g.png --cols 2 --rows 1 --out modern --names paoay-church,fort-santiago
python3 $S/cut_sheet.py mh/wonders-modern-h.png --cols 2 --rows 1 --out modern --names magellans-cross,pyramids
python3 $S/cut_sheet.py mi/wonders-modern-i.png --cols 2 --rows 1 --out modern --names chocolate-hills,banaue-terraces
python3 $S/cut_sheet.py mj/wonders-modern-j.png --cols 2 --rows 1 --out modern --names mayon-volcano,rizal-monument
for n in $W; do python3 square.py modern/$n.full.png sqm/$n.full.png; done
python3 square.py $O/modern/taj-mahal.full.png sqm/taj-mahal.full.png
for d in sq sqm; do
  python3 tidy.py $d rizal-monument mayon-volcano paoay-church fort-santiago pyramids chocolate-hills banaue-terraces magellans-cross
  python3 tidy.py $d --bleed mayon-volcano banaue-terraces chocolate-hills
done
python3 measure.py sq/*.full.png sqm/*.full.png
# --- game files: base widths at 1x (owner: Paoay, Fort, Magellan, Pyramid ~1.3x; Mayon, Banaue, Hills ~1.2x;
#     Rizal and Taj as they were); the footprint diamond is 140 wide
I="--item paoay-church:136 --item fort-santiago:136 --item magellans-cross:129 --item pyramids:135 --item mayon-volcano:128
   --item banaue-terraces:126 --item chocolate-hills:126 --item rizal-monument:98 --item taj-mahal:105"
mkdir -p game/classic game/modern
python3 seat_files.py --src sq --out game/classic $I > game/classic/rows.txt
python3 seat_files.py --src sqm --out game/modern --suffix .modern --format webp $I > game/modern/rows.txt
python3 wire.py classic game/classic; python3 wire.py modern game/modern
python3 windpump/make.py   # then copied to props/windpump* and its rows set by hand (see the commit)
python3 buttons.py         # Flash-style buttons 207-232 (unchanged ones come out the same)
bash build_pictures.sh
(cd ../../web && npx vite-node tools/building-copies/list-art.ts > tools/building-copies/art-uses.json && python3 tools/building-copies/make_copies.py)
