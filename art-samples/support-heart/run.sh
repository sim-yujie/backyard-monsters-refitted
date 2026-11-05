#!/bin/bash
# usage: run.sh <dir> : one Codex image call in <dir> with prompt.txt and the pictures in inputs.txt; result icon-new.png
d=$1; cd "$d" || exit 1
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" icon-new.png
echo "$d $([ -f icon-new.png ] && echo ok || echo NO-OUTPUT)"
