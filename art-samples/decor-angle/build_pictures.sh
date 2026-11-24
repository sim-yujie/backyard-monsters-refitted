#!/bin/bash
# Re-make the Modern build-menu pictures (web/tools/build-pictures/make.py), keeping ONLY those of types 214-217, 221, 222 (the redrawn wonders):
# make.py re-encodes every picture with new hashes on this PC, so the others go back to the committed ones.
set -e
export TMPD=/tmp/claude-1000/-home-yujiesim-Coding-backyard-monsters-refitted/f7d827f6-120b-447d-a81c-b577a9fee8ce/scratchpad
cd "$(dirname "$0")/../.."
B=server/public/assets/buildingbuttons/modern
D=web/src/game/yard/buildButtonModernData.ts
git show HEAD:$D > $TMPD/bbm-old.ts
python3 -I web/tools/build-pictures/make.py > /dev/null
python3 - <<'PY'
import re, os
D = "web/src/game/yard/buildButtonModernData.ts"
new = open(D).read(); old = open(os.environ["TMPD"] + "/bbm-old.ts").read()
keep = []
for t in (214, 215, 216, 217, 221, 222):
    f = re.search(r'    %d: "(%d\.main\.[0-9a-f]+\.webp)",' % (t, t), new).group(1)
    old = re.sub(r'    %d: "%d\.main\.[0-9a-f]+\.webp",' % (t, t), '    %d: "%s",' % (t, f), old)
    keep.append(f)
open(D, "w").write(old)
open(os.environ["TMPD"] + "/bbm-keep.txt", "w").write("\n".join(keep) + "\n")
PY
git ls-files --others --exclude-standard $B | grep -v -F -f $TMPD/bbm-keep.txt | xargs -r rm
git status --short $B | grep "^ D" | awk '{print $2}' | grep -v -E "/(21[4-7]|22[12])\.main\." | xargs -r git checkout --
rm -f $TMPD/bbm-old.ts $TMPD/bbm-keep.txt
