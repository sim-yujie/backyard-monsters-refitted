#!/bin/bash
# run.sh <n> : one Codex call for heading n; prints the cause if no sheet came back (e.g. image limit)
n=$1; K=D:/Coding/BYMR/worktrees/anim-vorg/web/tools/vorg-anim-kit; cd D:/Coding/BYMR/art-trials/vorg-anim/full; mkdir -p h$n
python $K/mkref.py $n; [ -n "$EXTRA" ] && echo "$EXTRA" >> h$n/prompt.txt
rm -f h$n/sheet.png
cd h$n && timeout 400 codex exec --skip-git-repo-check --sandbox workspace-write -i ref.png -i ../portrait.png - < prompt.txt > codex.log 2>&1
if [ -f sheet.png ]; then echo "h$n ok"; else echo "h$n NO SHEET"; grep -i "limit" codex.log | head -2; tail -3 codex.log; fi
