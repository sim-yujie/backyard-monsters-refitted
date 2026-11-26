#!/bin/bash
# all Codex calls of round 1 (the pilot c-paoay-church ran first, alone)
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
P() { case $1 in paoay-church) echo refs/Paoay_Church.jpg;; fort-santiago) echo refs/Fort_Santiago.jpg;; magellans-cross) echo refs/Magellans_Cross.jpg;; rizal-monument) echo refs/Rizal_Monument.jpg;; windpump) echo refs/windpump-old.png;; esac; }
for job in "$@"; do
  look=${job%%-*}; n=${job#*-}; L=$([ $look = c ] && echo classic || echo modern)
  [ $n = windpump ] && cp refs/windpump-old-$L.png refs/windpump-old.png
  python3 prompts.py $job $n $L
  if [ $L = classic ]; then R="refs/style/ref-flash-wonders-3x.png refs/style/ref-flash-all-3x.png"; else R="refs/style/ref-modern-wonders.png refs/style/ref-modern-all.png"; fi
  bash $S/run_codex.sh $job refs/blockout-$n.png $(P $n) $R | tail -1
  echo "$job done"
done
