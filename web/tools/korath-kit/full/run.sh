#!/bin/bash
# usage: run.sh <dir> <input png>...   runs one Codex image call in <dir> with prompt.txt; takes the image from THIS run's own session folder.
# Skips when STOP exists (written when Codex reports its usage limit). Times go to archive/logs/korath-art-times.log.
K=/d/Coding/BYMR/art-trials/champions/_kit/korath/full
LOG=/d/Coding/BYMR/archive/logs/korath-art-times.log
[ -f "$K/STOP" ] && { echo "$(date '+%m-%d %H:%M') SKIP $1 (STOP)" >> $LOG; exit 3; }
d=$1; shift
cd "$d" || exit 1
[ -f frames-new.png ] && mv frames-new.png frames-prev-$(date +%H%M%S).png
args=(); for f in "$@"; do args+=(-i "$f"); done
start=$(date +%s); t0=$(date '+%m-%d %H:%M')
codex exec --skip-git-repo-check --sandbox workspace-write "${args[@]}" - < prompt.txt > codex.log 2>&1
grep -a -q -i "usage limit" codex.log && grep -a -m1 -i "usage limit" codex.log > "$K/STOP"
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" frames-new.png
echo "$t0 call $(echo $d | sed "s#.*champions/##") $(( $(date +%s) - start ))s sid=$sid $([ -f frames-new.png ] && echo OK || echo NO-OUTPUT)" >> $LOG
[ -f frames-new.png ]
