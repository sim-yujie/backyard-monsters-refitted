#!/bin/bash
# usage: run.sh <job> <variant>   e.g. run.sh a1+a2 A, run.sh a1d+a1x A, run.sh c5 A : set up, paint with ONE Codex
# image call, then cut out and fit (finish.py). The image is taken from THIS run's own Codex session folder.
K=$(cd "$(dirname "$0")" && pwd)
PY=${PY:-$HOME/.cache/bymr-art-venv/bin/python}
LOG=/home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/inferno-paint-codex.log
d=$($PY -I "$K/make.py" "$1" "$2" | awk '{print $2}')
[ -n "$d" ] || { echo "make.py failed"; exit 1; }
cd "$d" || exit 1
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t $HOME/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" sample-new.png   # the raw image of this session, never a copy Codex edited
echo "$(date +%H:%M) inferno-paint $1 $2 $(( $(date +%s) - start ))s $([ -f sample-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a $LOG
[ -f sample-new.png ] || { tail -5 codex.log; exit 1; }
$PY -I "$K/finish.py" "$1" "$2"
