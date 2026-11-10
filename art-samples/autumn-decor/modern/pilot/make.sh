#!/bin/bash
# The PILOT of the Flash decorations' Modern look (owner, 10 Nov 2026), with the game-art skill's scripts.
#   p1/ p2/   Codex sheets (prompt.txt, codex.log, sheet): p1 six small/medium items, p2 three tall ones
#   p3/       Codex redo of the Tiki Torch (p2's came out too thin: small cup, no grass splay); right cell used
#   out/      cut-outs at in-game size and 2x (15% less colour; trophy 20%; Liberty recoloured to Flash's
#             orange-gold: hue -1 deg, gamma 1.4, it came out paler and yellower than Flash's)
# Heights, bottoms and centres are the Flash pictures' own, measured with the skill's flash_anchor.py, so each
# Modern picture stands on the same spot at the same height. Flags and Tiki Torch keep Flash's shadow (their
# moving cloth / flame casts it), so their game files are only the picture (the -shadow.jpg made is deleted).
# Usage: bash make.sh   (from this folder); then (cd <repo> && python -I web/tools/build-pictures/make.py)
set -e
S=C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts
R=$(cd ../../../.. && pwd)
D=$R/server/public/assets/buildings/decorations
python "$S/cut_sheet.py" p1/pilot-p1.png --cols 3 --rows 2 --out out \
  --names red-flowers,bonsai-tree,tombstone,outhouse,dave-pumpkin,soccer-trophy --height 34,61,44,42,64,66 \
  --sat 0.85,soccer-trophy=0.8
python "$S/cut_sheet.py" p2/pilot-p2.png --cols 3 --rows 1 --out out --names statue-liberty,flagpole,- \
  --height 172,51,0 --sat 0.85 --hue statue-liberty=-1 --gamma statue-liberty=1.4
python "$S/cut_sheet.py" p3/pilot-p3.png --cols 2 --rows 1 --out out --names=-,tiki-torch --height 0,45 \
  --sat 0.85 --gamma 1.25
g() { python "$S/make_game_files.py" --src out --suffix .modern --format webp --out "$D/$1" --item "$2"; }
g flowers 93:red-flowers:20:13:-0.5
g bonsaitree 87:bonsai-tree:40:25:-8.5
g graveyardtombstone 73:tombstone:40:31:0
g outhouse 65:outhouse:30:23:0
g pumpkins 110:dave-pumpkin:40:32:0
g statue-soccer 98:soccer-trophy:40:30:1.5
g statue-liberty 99:statue-liberty:70:55:-2.5
g flags 28:flagpole:20:10:1 && rm "$D/flags/flagpole.modern-shadow.jpg"
g tikitorch 71:tiki-torch:20:7:-1.5 && rm "$D/tikitorch/tiki-torch.modern-shadow.jpg"
