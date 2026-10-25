#!/bin/bash
# usage: run.sh <building> <combo>   e.g. run.sh cannon A1 : set up, paint one redesign sample with one Codex call, then cut it out.
# The image is taken from THIS run's own Codex session folder (parallel runs: Codex may pick up another session's newest image).
# Stops (skips) once any run hit the Codex usage limit: the STOP file next to this script.
K=$(cd "$(dirname "$0")" && pwd)
LOG=/d/Coding/BYMR/archive/logs/codex-art-times.log
[ -f "$K/STOP" ] && { echo "skipped $1 $2 (usage limit)"; exit 0; }
d=$(python "$K/make.py" "$1" "$2" | awk '{print $2}') || exit 1
cd "$d" || exit 1
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
grep -a -q "hit your usage limit" codex.log && grep -a -m1 "hit your usage limit" codex.log > "$K/STOP"
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
rm -f sample-new.png
[ -n "$own" ] && cp "$own" sample-new.png
echo "$(date +%H:%M) redesign $1 $2 $(( $(date +%s) - start ))s $([ -f sample-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a $LOG
[ -f sample-new.png ] || { tail -5 codex.log; exit 1; }
python "$K/finish.py" "$1" "$2"
