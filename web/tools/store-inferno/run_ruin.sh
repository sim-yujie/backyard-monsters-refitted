#!/bin/bash
# usage: run_ruin.sh <variant> : the damaged and destroyed shop (make_ruin.py), ONE Codex image call, then cut out and fit (finish_ruin.py).
# The image is taken from THIS run's own Codex session folder.
K=$(cd "$(dirname "$0")" && pwd)
PY=${PY:-$HOME/.cache/bymr-art-venv/bin/python}
LOG=/home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/store-inferno-codex.log
d=$($PY -I "$K/make_ruin.py" "$1" | awk '{print $2}')
[ -n "$d" ] || { echo "make.py failed"; exit 1; }
cd "$d" || exit 1
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t $HOME/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" sample-new.png   # the raw image of this session, never a copy Codex edited
echo "$(date +%H:%M) store-inferno ruin-$1 $(( $(date +%s) - start ))s $([ -f sample-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a $LOG
[ -f sample-new.png ] || { tail -5 codex.log; exit 1; }
$PY -I "$K/finish_ruin.py" "$1"
