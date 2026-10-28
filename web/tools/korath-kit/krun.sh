#!/bin/bash
# usage: krun.sh <level 1-6>  (env NOTE appended to the prompt). Paints one Korath sample with one codex image call, then finishes it.
n=$1; K=/d/Coding/BYMR/art-trials/champions/_kit/korath
d=$(python $K/ksample.py $n | awk '{print $2}') || exit 1
cd "$d" || exit 1
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i ref-old.png -i style.png -i portrait.png - < prompt.txt > codex.log 2>&1
echo "$(date +%H:%M) korath_$n codex $(( $(date +%s) - start ))s" | tee -a $K/times.log
sid=$(grep -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" sample-new.png
[ -f sample-new.png ] || { echo "korath_$n NO OUTPUT"; tail -5 codex.log; exit 1; }
python $K/kfinish.py $n
