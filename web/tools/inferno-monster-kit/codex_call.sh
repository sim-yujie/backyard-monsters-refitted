#!/bin/bash
# codex_call.sh <call dir> <expected output file> [label]
# One Codex image call in <call dir>: images from inputs.txt, prompt from prompt.txt.
# Every call is appended to <call dir>/../../calls.log (the work dir), so the count survives.
# Exit 3 when the usage limit is hit (stop, do not retry), 2 when no new picture came back.
d=$1; want=$2; label=${3:-$(basename "$d")}
work=$(cd "$d/../.." && pwd)
cd "$d" || exit 1
args=()
for f in $(cat inputs.txt); do args+=(-i "$f"); done
before=$(stat -c %Y "$want" 2>/dev/null || echo 0)
echo "$(date '+%F %T') call $label" >> "$work/calls.log"
timeout 600 codex exec --skip-git-repo-check --sandbox workspace-write "${args[@]}" - < prompt.txt > codex.log 2>&1
after=$(stat -c %Y "$want" 2>/dev/null || echo 0)
if [ "$after" -gt "$before" ]; then echo "$label: new $want"; exit 0; fi
if grep -qi "usage limit\|rate limit\|limit reached\|try again" codex.log; then
  echo "$label: LIMIT"; grep -i "limit" codex.log | head -3; echo "$(date '+%F %T') LIMIT $label" >> "$work/calls.log"; exit 3
fi
echo "$label: NO PICTURE"; tail -5 codex.log; exit 2
