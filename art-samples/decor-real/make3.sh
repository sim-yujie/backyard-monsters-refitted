#!/bin/bash
# Multi-photo pass (owner, Desk 8, 24 Nov 2026: "can you use more than 1 reference photo at different angles so as to
# give a proper render? My concern with this is a wrong image leading to offending my players"): the four wonders
# (Paoay Church, Fort Santiago Gate, Magellan's Cross, Rizal Monument) redone from 7 verified Commons photos each.
#   refs/<name>/        the photos + sources.md (URL, author, date, licence; angle and what each shows)
#   refs/sheets/        the six-photo sheet each Codex call gets
#   blockout.py         the four models remodelled from measured photos (render3.sh -> bo3/); windpump untouched
#   prompts3.py         the edit prompt with each landmark's MUST-BE-RIGHT list     codex3.sh  the calls
#   sheet3.py           owner sheets: 3 photos | today | new (today frozen in sheets/today before re-wiring)
# Same camera, slab, seat sizes and game-file route as make.sh (decor-angle / decor-seat approved); the windpump
# and keylines.py (old models' edges) are not part of this pass.
set -e
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
W="paoay-church fort-santiago magellans-cross rizal-monument"
# bash render3.sh $W
# bash codex3.sh m3-paoay-church      (pilot), then:
# bash codex3.sh c3-paoay-church m3-fort-santiago c3-fort-santiago m3-magellans-cross c3-magellans-cross m3-rizal-monument c3-rizal-monument
rm -rf classic3 modern3 sq3 sqm3 game3 rz; mkdir -p classic3 modern3 sq3 sqm3 game3/classic game3/modern rz
# Rizal's bronze darker (dark brown-black like the real figures), masked to the block-out's bronze, before the cut
python3 bronze.py c3-rizal-monument/rizal-monument-classic.png bo3/rizal-monument-magenta.png rz/c.png 0.62
python3 bronze.py m3-rizal-monument/rizal-monument-modern.png bo3/rizal-monument-magenta.png rz/m.png 0.62
for n in $W; do
  C=c3-$n/$n-classic.png; M=m3-$n/$n-modern.png
  [ $n = rizal-monument ] && C=rz/c.png && M=rz/m.png
  python3 $S/cut_sheet.py $C --cols 1 --rows 1 --out classic3 --names $n
  python3 $S/cut_sheet.py $M --cols 1 --rows 1 --out modern3 --names $n
done
# colour toward the photos (no Codex; medians measured on refs/*/front*.jpg): stone greyer (Codex warmed it toward
# tan/pink), Magellan's roof dark red-brown not orange
python3 greyen.py modern3/paoay-church.full.png modern3/paoay-church.full.png 0.5 0.42
python3 greyen.py classic3/paoay-church.full.png classic3/paoay-church.full.png 0.45 0.45
python3 greyen.py modern3/fort-santiago.full.png modern3/fort-santiago.full.png 0.75 0.45
python3 greyen.py classic3/fort-santiago.full.png classic3/fort-santiago.full.png 0.8 0.45
for l in classic3 modern3; do
  python3 recolor.py $l/magellans-cross.full.png $l/magellans-cross.full.png 0.44
  python3 greyen.py $l/magellans-cross.full.png $l/magellans-cross.full.png 0.6 0.32
  python3 greyen.py $l/rizal-monument.full.png $l/rizal-monument.full.png 0.4 0.32
done
for n in $W; do
  python3 ../decor-seat/square.py classic3/$n.full.png sq3/$n.full.png
  python3 ../decor-seat/square.py modern3/$n.full.png sqm3/$n.full.png
done
for d in sq3 sqm3; do python3 ../decor-seat/tidy.py $d $W; done
python3 ../decor-angle/fringe.py sq3/*.full.png sqm3/*.full.png
I="--item paoay-church:136 --item fort-santiago:136 --item magellans-cross:129 --item rizal-monument:98"
python3 ../decor-seat/seat_files.py --src sq3 --out game3/classic $I > game3/classic/rows.txt
python3 ../decor-seat/seat_files.py --src sqm3 --out game3/modern --suffix .modern --format webp $I > game3/modern/rows.txt
python3 ../decor-seat/wire.py classic game3/classic; python3 ../decor-seat/wire.py modern game3/modern
python3 ../decor-seat/buttons.py          # rewrites every new decoration's button: keep only 214-217 (see below)
bash build_pictures3.sh
(cd ../../web && npx vite-node tools/building-copies/list-art.ts > tools/building-copies/art-uses.json && python3 tools/building-copies/make_copies.py)
# make_copies re-encodes unrelated buildings on this PC: revert everything except
# wonders/{paoay-church,fort-santiago,magellans-cross,rizal-monument}* and buildingbuttons/21[4-7]*.
# Sheets: python3 $S/yard_compose.py --repo ../.. --out sheets/new3 214 215 216 217; python3 sheet3.py classic|modern <out>
