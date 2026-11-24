#!/bin/bash
# Four wonders redrawn CLOSER TO THE REAL PLACE and the windpump squared to the grid (owner 24 Nov 2026, after the
# angle fix: "Some don't really look similar though..." -> Paoay Church, Fort Santiago Gate, Magellan's Cross,
# Rizal Monument; and the windpump's platform turned ~10 deg off the grid).
# Same route as decor-angle (exact Blender block-out at the yard's camera + Codex paint-over that moves no edge),
# but the block-outs are new models at REAL proportions (no height stretch; size from the approved base widths),
# the clay carries the real colours, and the real photo replaces the old design as the paint reference.
#   blockout.py   the new models (paoay_church, fort_santiago, magellans_cross, rizal_monument, windpump)
#   render.sh     renders on a free GPU under blender-lock-0/1 (bo/<name>.png, bo/<name>.json)
#   prompts.py    the Codex edit prompt (photo = parts/colours/carvings only)    codex_all.sh  the calls
#   keylines.py   the new models' grid edges, measured with snap.py on any picture of them
#   windpump.py   the windpump's game files: painted body + the decor-new wheel laid into the grid plane
# Codex calls: 11 (pilot c-paoay-church, then codex_all.sh with the other 9; one redo of m-rizal-monument for its
# obelisk-top edge came out worse (0.68/0.65) and is not used: m-rizal-monument-r2-unused).
set -e
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
W="paoay-church fort-santiago magellans-cross rizal-monument"
# bash render.sh $W windpump
# python3 prompts.py c-paoay-church paoay-church classic; bash $S/run_codex.sh c-paoay-church refs/blockout-paoay-church.png refs/Paoay_Church.jpg refs/style/ref-flash-wonders-3x.png refs/style/ref-flash-all-3x.png
# bash codex_all.sh m-paoay-church c-fort-santiago m-fort-santiago c-magellans-cross m-magellans-cross c-rizal-monument m-rizal-monument c-windpump m-windpump
mkdir -p classic modern sq sqm game/classic game/modern
for n in $W windpump; do
  case $n in fort-santiago) X="--sat 0.6";; *) X="";; esac
  python3 $S/cut_sheet.py c-$n/$n-classic.png --cols 1 --rows 1 --out classic --names $n $X
  python3 $S/cut_sheet.py m-$n/$n-modern.png --cols 1 --rows 1 --out modern --names $n $X
done
# colour fixes toward the real place (no Codex): Magellan's roof maroon-brown (and whiter Classic walls),
# Rizal's granite grey (the bronze and gold stars untouched)
python3 recolor.py classic/magellans-cross.full.png classic/magellans-cross.full.png 0.52 --walls
python3 recolor.py modern/magellans-cross.full.png modern/magellans-cross.full.png 0.52
python3 greyen.py classic/rizal-monument.full.png classic/rizal-monument.full.png 0.45
python3 greyen.py modern/rizal-monument.full.png modern/rizal-monument.full.png 0.4
for n in $W; do
  python3 ../decor-seat/square.py classic/$n.full.png sq/$n.full.png
  python3 ../decor-seat/square.py modern/$n.full.png sqm/$n.full.png
done
python3 ../decor-angle/tone.py sq/paoay-church.full.png 0.9 1.0   # Classic Paoay V 55% -> 48%, like the other Classic wonders
for d in sq sqm; do python3 ../decor-seat/tidy.py $d $W; done
python3 ../decor-angle/fringe.py sq/*.full.png sqm/*.full.png
for n in $W; do python3 keylines.py $n $PWD/sq/$n.full.png $PWD/sqm/$n.full.png --sheet $PWD/kl-$n.png; done
I="--item paoay-church:136 --item fort-santiago:136 --item magellans-cross:129 --item rizal-monument:98"
python3 ../decor-seat/seat_files.py --src sq --out game/classic $I > game/classic/rows.txt
python3 ../decor-seat/seat_files.py --src sqm --out game/modern --suffix .modern --format webp $I > game/modern/rows.txt
python3 ../decor-seat/wire.py classic game/classic; python3 ../decor-seat/wire.py modern game/modern
# the windpump: body + wheel strip (48 frames) + shadow, both looks; platform edges measured on the full cut
python3 windpump.py; python3 wire_wp.py
python3 ../decor-angle/snap.py spec-wp-full.json windpump/snap-wp-full.png 1
python3 ../decor-seat/buttons.py
bash build_pictures.sh
(cd ../../web && npx vite-node tools/building-copies/list-art.ts > tools/building-copies/art-uses.json && python3 tools/building-copies/make_copies.py)
# make_copies re-encodes unrelated buildings on this PC: revert everything except wonders/{paoay-church,
# fort-santiago,magellans-cross,rizal-monument}*, props/windpump*, buildingbuttons/21[3-7]*.
# Sheets: python3 sheet_real.py wonders classic|modern <out>; python3 sheet_real.py windpump <out>
python3 wp_frames.py   # before/after frames for the owner sheet
