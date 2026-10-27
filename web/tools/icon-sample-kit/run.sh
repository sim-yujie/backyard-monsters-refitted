#!/bin/bash
# usage: run.sh <batch> [icon,icon,icon,icon]   (env NOTE appended to the prompt): paint one batch with one Codex call, then cut it.
# The image is taken from THIS run's own Codex session folder (other helpers run Codex at the same time).
# Every call is counted in calls.log next to the samples (budget: 20).
K=$(cd "$(dirname "$0")" && pwd)
LOG=/d/Coding/BYMR/archive/logs/codex-icons-times.log
d=$(cd "$K" && python make.py "$@" | awk '{print $2}') || exit 1
cd "$d" || exit 1
[ -f sheet.png ] && mv sheet.png sheet-prev-$(date +%H%M%S).png
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write -i "$(cat inputs.txt)" - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
rm -f sheet.png
[ -n "$own" ] && cp "$own" sheet.png
msg="$(date +%H:%M) batch $1 $(( $(date +%s) - start ))s $([ -f sheet.png ] && echo ok || echo NO-OUTPUT)"
echo "$msg" | tee -a "$LOG" >> "$d/../../calls.log"
echo "$msg"
[ -f sheet.png ] || { tail -5 codex.log; exit 1; }
cd "$K" && python cut.py "$1"
