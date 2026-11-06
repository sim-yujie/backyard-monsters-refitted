#!/bin/bash
# usage: run.sh <look> <variant>   e.g. run.sh 2 A : set up, paint one Locker look with one Codex call, then cut it out and fit it.
# The image is taken from THIS run's own Codex session folder (parallel runs: Codex may pick up another session's newest image).
K=$(cd "$(dirname "$0")" && pwd)
LOG=/c/Coding/BYMR/archive/logs/locker-repaint-codex.log
d=$(python -I "$K/make.py" "$1" "$2" | awk '{print $2}') || exit 1
cd "$d" || exit 1
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
rm -f sample-new.png
[ -n "$own" ] && cp "$own" sample-new.png
echo "$(date +%H:%M) locker $1 $2 $(( $(date +%s) - start ))s $([ -f sample-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a $LOG
[ -f sample-new.png ] || { tail -5 codex.log; exit 1; }
python -I "$K/finish.py" "$1" "$2"
