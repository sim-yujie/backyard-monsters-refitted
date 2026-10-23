#!/bin/bash
# usage: run.sh <dir> <input png>...   runs one Codex image call in <dir> with prompt.txt; takes the image from THIS run's own session folder
d=$1; shift
cd "$d" || exit 1
[ -f frames-new.png ] && mv frames-new.png frames-prev-$(date +%H%M%S).png
args=(); for f in "$@"; do args+=(-i "$f"); done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write "${args[@]}" - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" frames-new.png
echo "$d $(( $(date +%s) - start ))s sid=$sid $([ -f frames-new.png ] && echo OK || echo NO-OUTPUT)" | tee -a /d/Coding/BYMR/art-trials/champions/_kit/l3/times.log
[ -f frames-new.png ]
