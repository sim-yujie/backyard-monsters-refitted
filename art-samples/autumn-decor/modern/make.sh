#!/bin/bash
# The autumn decorations' Modern look (owner, 10 Nov 2026), rebuilt from the chosen Codex sheet with the
# game-art skill's scripts (C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts).
#   refs/      reference sheets given to Codex (real Modern building art + the approved Classic six)
#   m1..m3/    Codex calls (prompt.txt, codex.log, sheet); m3 was chosen (m2 copied m1 almost exactly)
#   out/       the cut-outs at in-game size and 2x (15% less colour than the sheet, to sit with the buildings)
# Usage: bash make.sh   (from this folder)
set -e
S=C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts
R=$(cd ../../.. && pwd)
B=assets/buildings
python "$S/ref_sheet.py" --repo "$R" --file-size --out refs/ref-modern-close.png --zoom 2 --cols 4 \
  $B/twigsnapper.v2/top.3d1@2x.webp $B/catapult/top.3d1@2x.webp $B/walls/top.3d1@2x.webp $B/goofactory.v2/top.3d1@2x.webp \
  $B/puttysquisher.v2/top.3d1@2x.webp $B/pebbleshiner.v2/top.3d1@2x.webp $B/flinger/top.3d1@2x.webp $B/yardplanner/top.3d1@2x.webp
python "$S/ref_sheet.py" --repo "$R" --file-size --out refs/ref-modern-all.png --zoom 1 --cols 7 --list modern-list.txt
python "$S/cut_sheet.py" m3/autumn-modern-m3.png --cols 3 --rows 2 --out out \
  --names turkey-topiary,harvest-wheelbarrow,autumn-maple,leaf-pile-rake,apple-barrel,pie-stump \
  --height 54,46,80,40,44,36 --sat 0.85
rm -f out/*.full.png
python "$S/make_game_files.py" --src out --out "$R/server/public/assets/buildings/decorations/autumn" \
  --suffix .modern --format webp \
  --item 201:leaf-pile-rake:40 --item 202:apple-barrel:30 --item 203:pie-stump:30 \
  --item 204:harvest-wheelbarrow:40 --item 205:turkey-topiary:40 --item 206:autumn-maple:40
# Then the build menu's Modern pictures: (cd "$R" && python -I web/tools/build-pictures/make.py)
