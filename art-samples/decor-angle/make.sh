#!/bin/bash
# Wonders redrawn at the YARD'S CAMERA (owner 24 Nov 2026: "The base looks good but the structures themselves dont
# seem to follow the angle FOV/POV?"). The seated round (decor-seat) squared only the bases: the buildings on them
# were still drawn from a low eye level, their wall tops, cornices and eaves at slopes 0.24-0.40 instead of the
# grid's 0.50 (Pyramid and Fort gate turned face-on). Codex ignores angle words and even block-out guides, so here
# the geometry comes from an exact render and Codex only paints it (an EDIT that moves no edge).
#   angles.py / lines.py   first automatic tries at the diagnosis (too noisy; kept for the record)
#   snap.py         measures chosen edges: fits a line to the strongest edge within +-3 px of a rough segment
#   grid.py         enlarged picture with a source-px grid, to pick the rough segments
#   spec-*.json     the diagnosis picks (references, old Classic, old Modern, windpump, guide-f calibration)
#   blockout.py     Blender block-outs: orthographic, turned 45 deg, 30 deg up (= exact 2:1), on the 10x10 slab;
#                   heights stretched to the approved designs' heights (HEIGHTS), round parts and figures unstretched
#   render.sh       renders on a free GPU under blender-lock-0/1 (bo/<name>.png + bo/<name>.json slab corners)
#   prompts.py      the Codex edit prompt (one wonder per call, both looks from the same render)
#   keylines.py     the block-out's own grid edges projected into any picture of it and measured with snap.py
#   tone.py         small brightness/saturation trims toward the approved versions' numbers (stats.py)
#   build_pictures.sh  Modern build pictures for the six redrawn types only
# The squaring, despill, game files and wiring reuse decor-seat's square.py, tidy.py, seat_files.py, wire.py.
# Source art (renders, Codex sheets, cut-outs) is copied to archive/decor-angle.
set -e
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
W="fort-santiago paoay-church magellans-cross pyramids taj-mahal rizal-monument"
# --- diagnosis
python3 snap.py spec-refs.json snap-refs.png 3; python3 snap.py spec-refs2.json snap-refs2.png 2.5
python3 snap.py spec-cal.json snap-cal.png 0.6
python3 snap.py spec-classic.json snap-classic.png 2.4; python3 snap.py spec-modern.json snap-modern.png 2.4
python3 snap.py spec-wp.json snap-wp.png 4
# --- block-outs and Codex (29 image calls in all: pilot 1, round 1 12 (+1 Fort Modern redo), round 2 at the
#     design heights 12, round 3 Taj and Magellan bigger 4; rounds 1-2 kept in round1/ and round2/ (not used))
# bash render.sh $W
# for n in $W; do python3 prompts.py c-$n $n classic; python3 prompts.py m-$n $n modern
#   bash $S/run_codex.sh c-$n refs/blockout-$n.png refs/design-$n.png refs/ref-flash-wonders-3x.png refs/ref-flash-all-3x.png
#   bash $S/run_codex.sh m-$n refs/blockout-$n.png refs/m/design-$n.png refs/ref-modern-wonders.png refs/ref-modern-all.png; done
mkdir -p classic modern sq sqm game/classic game/modern
for n in $W; do
  python3 $S/cut_sheet.py c-$n/$n-classic.png --cols 1 --rows 1 --out classic --names $n
  python3 $S/cut_sheet.py m-$n/$n-modern.png --cols 1 --rows 1 --out modern --names $n
  python3 ../decor-seat/square.py classic/$n.full.png sq/$n.full.png
  python3 ../decor-seat/square.py modern/$n.full.png sqm/$n.full.png
done
# tone trims (round-2/3 files) toward the approved versions: V/S of stats.py
python3 tone.py sq/paoay-church.full.png 1.0 0.92; python3 tone.py sq/pyramids.full.png 1.0 0.88
python3 tone.py sq/taj-mahal.full.png 1.12 0.88
python3 tone.py sqm/fort-santiago.full.png 0.88 1.0; python3 tone.py sqm/paoay-church.full.png 0.93 0.93
python3 tone.py sqm/pyramids.full.png 0.95 0.9; python3 tone.py sqm/magellans-cross.full.png 0.92 1.0
for d in sq sqm; do python3 ../decor-seat/tidy.py $d $W; done
python3 fringe.py sq/*.full.png sqm/*.full.png   # magenta fringe next to see-through holes (arches, cross)
for n in $W; do python3 keylines.py $n $PWD/bo/$n.png $PWD/classic/$n.full.png $PWD/modern/$n.full.png --sheet $PWD/kl-$n.png; done
I="--item paoay-church:136 --item fort-santiago:136 --item magellans-cross:129 --item pyramids:135 --item rizal-monument:98 --item taj-mahal:105"
python3 ../decor-seat/seat_files.py --src sq --out game/classic $I > game/classic/rows.txt
python3 ../decor-seat/seat_files.py --src sqm --out game/modern --suffix .modern --format webp $I > game/modern/rows.txt
python3 ../decor-seat/wire.py classic game/classic; python3 ../decor-seat/wire.py modern game/modern
python3 ../decor-seat/buttons.py
bash build_pictures.sh
(cd ../../web && npx vite-node tools/building-copies/list-art.ts > tools/building-copies/art-uses.json && python3 tools/building-copies/make_copies.py)
# make_copies re-encodes unrelated buildings on this PC: revert everything outside wonders/ and buildingbuttons/.
