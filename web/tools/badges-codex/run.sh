#!/bin/bash
# usage: run.sh <id> : paint two symbol options for one achievement badge with one Codex call.
# Writes art-samples/badges/gen/<slug>/option-{1,2}.png; badge.py then puts a symbol on the tier's medal frame.
# Setup once: art-samples/badges/{style-sheet.png,frames/frame-*.png} copied from C:/Coding/BYMR/archive/huge-rage-medal/work
# (the frame and style sheet of the first 17 badges), ref/*.png from server/public/assets (see symbols.py).
# Then: run.sh <id> -> preview.py <id> -> pick in picks.tsv -> ship.sh -> contact.py
K=$(cd "$(dirname "$0")" && pwd)
W="$K/../../../art-samples/badges"
LOG=/c/Coding/BYMR/archive/logs/badges-codex.log
slug=$(python -I "$K/make.py" "$1") || exit 1
cd "$W" || exit 1
[ -d "gen/$slug" ] && mv "gen/$slug" "gen/$slug-prev-$(date +%H%M%S)"
args=""; for f in $(cat "prompts/$slug.inputs"); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < "prompts/$slug.txt" > "prompts/$slug.log" 2>&1
n=$(ls gen/$slug/option-*.png 2>/dev/null | wc -l)
if [ "$n" -eq 0 ]; then  # Codex left the pictures in its own session folder: take this session's, oldest first
  sid=$(grep -a -m1 "^session id:" "prompts/$slug.log" | awk '{print $3}')
  mkdir -p "gen/$slug"; k=0
  for f in $(ls -tr /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null); do k=$((k+1)); cp "$f" "gen/$slug/option-$k.png"; done
  n=$k
fi
echo "$(date +%H:%M) badge $1 $slug $(( $(date +%s) - start ))s options=$n" | tee -a $LOG
[ "$n" -gt 0 ] || { tail -5 "prompts/$slug.log"; exit 1; }
