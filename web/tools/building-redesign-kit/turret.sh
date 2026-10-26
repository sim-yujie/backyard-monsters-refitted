#!/bin/bash
# usage: turret.sh <T1|T2|T3> <body|turret> : one Codex call for the Sniper's separate turret (see turret.py), then cut it out.
# Same as run.sh: the image is taken from this run's own Codex session folder; stops once any run hit the usage limit (STOP file).
K=$(cd "$(dirname "$0")" && pwd)
LOG=/d/Coding/BYMR/archive/logs/codex-art-times.log
[ -f "$K/STOP" ] && { echo "skipped $1 $2 (usage limit)"; exit 0; }
d=$(python "$K/turret.py" setup "$1" "$2" | awk '{print $2}') || exit 1
cd "$d" || exit 1
[ -n "$NOTE" ] && printf '\n\nNOTE: %s\n' "$NOTE" >> prompt.txt
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
grep -a -q "hit your usage limit" codex.log && grep -a -m1 "hit your usage limit" codex.log > "$K/STOP"
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
rm -f sample-new.png
[ -n "$own" ] && cp "$own" sample-new.png
echo "$(date +%H:%M) turret sniper $1 $2 $(( $(date +%s) - start ))s $([ -f sample-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a $LOG
[ -f sample-new.png ] || { tail -5 codex.log; exit 1; }
python "$K/turret.py" cut "$1" "$2"
