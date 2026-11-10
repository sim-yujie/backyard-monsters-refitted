#!/bin/bash
# Build-menu Modern pictures (web/tools/build-pictures/make.py), then put back the two trap pictures (24, 117)
# make.py also rebuilds on this branch (an unrelated change, left for the lead).
set -e
R=$(cd "$(dirname "$0")/../../../.." && pwd)
cd "$R"
python -I web/tools/build-pictures/make.py > /dev/null
B=server/public/assets/buildingbuttons/modern
for t in 24:69b3a323 117:40244554; do
  type=${t%%:*}; old=${t##*:}
  for f in $B/$type.main.*.webp; do [ "$(basename "$f")" = "$type.main.$old.webp" ] || rm -f "$f"; done
  git restore "$B/$type.main.$old.webp" 2>/dev/null || true
  sed -i "s/\"$type\.main\.[0-9a-f]*\.webp\"/\"$type.main.$old.webp\"/" web/src/game/yard/buildButtonModernData.ts
done
git status --short "$B" | grep -E " $B/(24|117)\." || echo "traps unchanged"
