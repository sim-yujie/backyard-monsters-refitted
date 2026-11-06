#!/bin/bash
# usage: gen.sh <style> <frame|kit> : one Codex image call for a window style, image saved as sample-new.png in gen/<style>/<job>/.
# Same pattern as building-redesign-kit/run.sh: the image is taken from this run's own Codex session folder.
T=$(cd "$(dirname "$0")" && pwd)
LOG=/d/Coding/BYMR/archive/logs/window-mockups-codex.log
d=$(python "$T/prompts.py" "$1" "$2" | awk '{print $2}') || exit 1
cd "$d" || exit 1
[ -n "$NOTE" ] && printf '\n\nNOTE: %s\n' "$NOTE" >> prompt.txt
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
args=""; for f in $(cat inputs.txt); do args="$args -i $f"; done
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
rm -f sample-new.png
[ -n "$own" ] && cp "$own" sample-new.png
echo "$(date +%H:%M) $1 $2 $(( $(date +%s) - start ))s $([ -f sample-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a $LOG
[ -f sample-new.png ] || { tail -5 codex.log; exit 1; }
