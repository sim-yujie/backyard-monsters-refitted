#!/bin/bash
# usage: run.sh <dir> : one Codex image call in <dir> with its prompt.txt; the picture lands as <dir>/art.png.
# The image is taken from THIS run's own Codex session folder (parallel runs).
d=$1; cd "$d" || exit 1
[ -f art.png ] && mv art.png prev-$(date +%H%M%S).png
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" art.png
echo "$d $(( $(date +%s) - start ))s $([ -f art.png ] && echo ok || echo NO-OUTPUT)"
