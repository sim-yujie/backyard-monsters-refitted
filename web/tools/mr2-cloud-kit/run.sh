#!/bin/bash
# usage: bash run.sh <dir> : one Codex image call in <dir> with its prompt.txt and, when present, ref-*.png
# attached as -i pictures; the picture lands as <dir>/art.png. The image is taken from THIS run's own
# Codex session folder (parallel runs could otherwise pick up another session's newest image).
here=$(cd "$(dirname "$0")" && pwd)
d="$here/$1"; cd "$d" || exit 1
[ -f art.png ] && mv art.png prev-$(date +%H%M%S).png
args=""; for r in ref-*.png; do [ -f "$r" ] && args="$args -i $r"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" art.png
echo "$1 $(( $(date +%s) - start ))s $([ -f art.png ] && echo ok || echo NO-OUTPUT)"
