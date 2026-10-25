#!/bin/bash
# usage: run.sh <sheet e.g. ape_4>   (env NOTE appended to the prompt): paints the sample with one Codex image call, then finishes it.
# Output in <worktree>/art-samples/champions/<champ>/L<n>/. Redo notes: redo-notes.txt next to this script ("<sheet>|note").
# Stops (skips) once any run hit the Codex usage limit: the STOP file next to this script.
n=$1; K=$(cd "$(dirname "$0")" && pwd)
LOG=/d/Coding/BYMR/archive/logs/codex-art-times.log
[ -f "$K/STOP" ] && { echo "skipped $n (usage limit)"; exit 0; }
[ -z "$NOTE" ] && [ -f "$K/redo-notes.txt" ] && export NOTE=$(grep "^$n|" "$K/redo-notes.txt" | tail -1 | cut -d'|' -f2-)
d=$(python "$K/make_sample.py" $n | awk '{print $2}') || exit 1
cd "$d" || exit 1
[ -f sample-new.png ] && mv sample-new.png sample-prev-$(date +%H%M%S).png
start=$(date +%s)
codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i ref-old.png -i style.png -i portrait.png - < prompt.txt > codex.log 2>&1
grep -a -q "hit your usage limit" codex.log && grep -a -m1 "hit your usage limit" codex.log > "$K/STOP"
# take the image from THIS run's own session folder (parallel runs: Codex may copy another session's newest image)
sid=$(grep -a -m1 "^session id:" codex.log | awk '{print $3}')
own=$(ls -t /c/Users/simyu/.codex/generated_images/$sid/*.png 2>/dev/null | head -1)
rm -f sample-new.png
[ -n "$own" ] && cp "$own" sample-new.png
echo "$(date +%H:%M) champ $n $(( $(date +%s) - start ))s $([ -f sample-new.png ] && echo ok || echo NO-OUTPUT)" | tee -a $LOG
[ -f sample-new.png ] || { tail -5 codex.log; exit 1; }
python "$K/finish_sample.py" $n
