#!/bin/bash
# usage: run.sh <dir> : one Codex image call in <dir> with its prompt.txt and the pictures in inputs.txt; the picture lands as <dir>/art.png.
d=$1; cd "$d" || exit 1
[ -f art.png ] && mv art.png prev-$(date +%H%M%S).png
args=""; [ -f inputs.txt ] && for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" art.png
echo "$d $(( $(date +%s) - start ))s $([ -f art.png ] && echo ok || echo NO-OUTPUT)"
