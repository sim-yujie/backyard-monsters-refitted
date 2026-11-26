#!/bin/bash
# apply.sh <A|B>: put option A (one boy) or B (two boys as one group) in the game, from final/ (composite.py + tone.py):
# both looks' pictures, both shadows, the Classic button 214.jpg, the Modern @1x/@1.5x copies and the Modern build
# picture (214 only; every other file the tools rewrite goes back), and checks the art rows still fit.
set -e
cd "$(dirname "$0")"; R=$(cd ../.. && pwd); O=$1
WD=$R/server/public/assets/buildings/decorations/wonders
python3 - "$O" "$WD" "$R" <<'PY'
import sys
from pathlib import Path
from PIL import Image, ImageChops
o, wd, root = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
sys.path.insert(0, str(root / "art-samples/decor-seat")); sys.path.insert(0, "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from seat_files import cast_shadow
from make_game_files import flash_button
rows = (root / "web/src/game/yard/revampDecorations.ts").read_text()
for look, src, top, shadow in (("classic", f"final/classic-{o}.png", "rizal-monument@2x.png", "rizal-monument-shadow.jpg"),
                               ("modern", f"final/modern-{o}.png", "rizal-monument.modern@2x.webp", "rizal-monument.modern-shadow.jpg")):
    two = Image.open(src).convert("RGBA"); old = Image.open(wd / top)
    assert two.size == old.size, (two.size, old.size)
    if top.endswith(".webp"): two.save(wd / top, lossless=False, quality=92, method=6)
    else: two.save(wd / top, optimize=True)
    # shadow: same cast as seat_files.py; the row's offset is picture offset + (sx, sy): check it is unchanged
    mask, sx, sy = cast_shadow(two.getchannel("A"))
    oldsh = Image.open(wd / shadow)
    ImageChops.subtract(Image.new("L", mask.size, 255), mask).convert("RGB").save(wd / shadow, quality=90)
    print(look, "shadow", mask.size, "was", oldsh.size, "offset from picture", sx, sy)
    if look == "classic": flash_button(two, root / "server/public/assets/buildingbuttons/214.jpg"); print("button 214.jpg")
PY
grep -n "rizal-monument" $R/web/src/game/yard/revampDecorations.ts
# Modern @1x / @1.5x copies (make_copies re-encodes others on this PC: keep only Rizal's)
(cd $R/web && npx vite-node tools/building-copies/list-art.ts > tools/building-copies/art-uses.json && python3 tools/building-copies/make_copies.py > /dev/null)
cd $R
git status --short server/public/assets/buildings web/tools/building-copies web/src/game/yard/buildingArtCopiesData.ts | grep -v rizal-monument | awk '{print $2}' | xargs -r git checkout --
git ls-files --others --exclude-standard server/public/assets/buildings | grep -v rizal-monument | xargs -r rm -f
# Modern build picture: make.py rewrites them all; keep 214's only
export TMPD=/tmp/claude-1000/-home-yujiesim-Coding-backyard-monsters-refitted/d9aac06c-ca43-428b-8589-4659d6f1769e/scratchpad
mkdir -p $TMPD
B=server/public/assets/buildingbuttons/modern; D=web/src/game/yard/buildButtonModernData.ts
git show HEAD:$D > $TMPD/bbm-old.ts
python3 -I web/tools/build-pictures/make.py > /dev/null
python3 - <<'PY'
import re, os
D = "web/src/game/yard/buildButtonModernData.ts"
new = open(D).read(); old = open(os.environ["TMPD"] + "/bbm-old.ts").read()
f = re.search(r'    214: "(214\.main\.[0-9a-f]+\.webp)",', new).group(1)
old = re.sub(r'    214: "214\.main\.[0-9a-f]+\.webp",', '    214: "%s",' % f, old)
open(D, "w").write(old); open(os.environ["TMPD"] + "/bbm-keep.txt", "w").write(f + "\n"); print("build picture", f)
PY
git ls-files --others --exclude-standard $B | grep -v -F -f $TMPD/bbm-keep.txt | xargs -r rm
git status --short $B | grep -E "^ (D|M)" | awk '{print $2}' | grep -v -E "/214\.main\." | xargs -r git checkout --
git status --short
