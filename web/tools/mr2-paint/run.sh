#!/bin/bash
# usage: bash run.sh <job>   one Codex image call for web/tools/mr2-paint/prompts/<job>.txt,
# with the mock-up B crops listed on its "# refs:" first line attached as -i pictures.
# Runs in work/runs/<job>/ (git-ignored); the picture is taken from THIS run's own Codex
# session folder (parallel runs could otherwise pick up another session's newest image)
# and copied to work/runs/<job>/sheet.png. Times go to work/times.log.
here=$(cd "$(dirname "$0")" && pwd)
job=$1
d="$here/work/runs/$job"; mkdir -p "$d"; cd "$d" || exit 1
[ -f sheet.png ] && mv sheet.png prev-$(date +%H%M%S).png
refs=$(head -1 "$here/prompts/$job.txt" | sed -n 's/^# refs: //p')
args=""; for r in $refs; do cp "$here/work/refs/ref-$r.png" "ref-$r.png"; args="$args -i ref-$r.png"; done
tail -n +2 "$here/prompts/$job.txt" > prompt.txt
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write $args - < prompt.txt > codex.log 2>&1
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
[ -n "$own" ] && cp "$own" sheet.png
echo "$job $(( $(date +%s) - start ))s $([ -f sheet.png ] && echo ok || echo NO-OUTPUT)" | tee -a "$here/work/times.log"
