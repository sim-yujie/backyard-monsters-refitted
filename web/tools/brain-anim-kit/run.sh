#!/bin/bash
n=$1; cd D:/Coding/BYMR/art-trials/brain-anim/full; mkdir -p h$n
python mkref.py $n; [ -n "$EXTRA" ] && echo "$EXTRA" >> h$n/prompt.txt
cd h$n && codex exec --skip-git-repo-check --sandbox workspace-write -i ref.png -i ../portrait.png - < prompt.txt > codex.log 2>&1
tail -2 codex.log; ls -la sheet.png
