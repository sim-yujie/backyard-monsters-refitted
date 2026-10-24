#!/bin/bash
# usage: run.sh <dir>   : one Codex image call in <dir> with its prompt.txt and the input pictures listed in inputs.txt.
# The image is taken from THIS run's own Codex session folder (parallel runs: Codex may pick up another session's newest image).
d=$1; cd "$d" || exit 1
[ -f frames-new.png ] && mv frames-new.png prev-$(date +%H%M%S).png
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
rm -f frames-new.png
[ -n "$own" ] && cp "$own" frames-new.png
echo "$d $(( $(date +%s) - start ))s $([ -f frames-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a /d/Coding/BYMR/archive/logs/champ-sheets-l2-times.log
