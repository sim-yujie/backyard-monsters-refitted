#!/bin/bash
# Re-make the Modern build-menu pictures (web/tools/build-pictures/make.py), keeping ONLY those of types 213-222:
# make.py re-encodes every picture with new hashes on this PC, so the others go back to the committed ones.
set -e
cd "$(dirname "$0")/../.."
B=server/public/assets/buildingbuttons/modern
D=web/src/game/yard/buildButtonModernData.ts
git show HEAD:$D > /tmp/bbm-old.ts
python3 -I web/tools/build-pictures/make.py > /dev/null
python3 - <<'PY'
import re
D = "web/src/game/yard/buildButtonModernData.ts"
new = open(D).read(); old = open("/tmp/bbm-old.ts").read()
keep = []
for t in range(213, 223):
    f = re.search(r'    %d: "(%d\.main\.[0-9a-f]+\.webp)",' % (t, t), new).group(1)
    old = re.sub(r'    %d: "%d\.main\.[0-9a-f]+\.webp",' % (t, t), '    %d: "%s",' % (t, f), old)
    keep.append(f)
open(D, "w").write(old)
open("/tmp/bbm-keep.txt", "w").write("\n".join(keep) + "\n")
PY
git ls-files --others --exclude-standard $B | grep -v -F -f /tmp/bbm-keep.txt | xargs -r rm
git status --short $B | grep "^ D" | awk '{print $2}' | grep -v -E "/(21[3-9]|22[0-2])\.main\." | xargs -r git checkout --
rm -f /tmp/bbm-old.ts /tmp/bbm-keep.txt
