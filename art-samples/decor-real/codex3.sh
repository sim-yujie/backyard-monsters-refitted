#!/bin/bash
# Codex calls of the multi-photo pass: bash codex3.sh <look>3-<name>... (e.g. m3-paoay-church c3-fort-santiago)
# Inputs per call: the bo3 block-out, the six-photo sheet, the two real style sheets of the look.
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
mkdir -p refs/blockout3
for job in "$@"; do
  look=${job%%3-*}; n=${job#*3-}; L=$([ $look = c ] && echo classic || echo modern)
  cp bo3/$n-magenta.png refs/blockout3/blockout-$n.png
  python3 prompts3.py $job $n $L
  if [ $L = classic ]; then R="refs/style/ref-flash-wonders-3x.png refs/style/ref-flash-all-3x.png"; else R="refs/style/ref-modern-wonders.png refs/style/ref-modern-all.png"; fi
  bash $S/run_codex.sh $job refs/blockout3/blockout-$n.png refs/sheets/photos-$n.png $R | tail -1
  echo "$job done"
done
