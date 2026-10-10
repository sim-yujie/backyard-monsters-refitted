#!/bin/bash
# run.sh <n> : one Codex call for heading n (uses h<n-1>/sheet.png as neighbour ref)
n=$1; cd D:/Coding/BYMR/art-trials/bandito-anim/full; mkdir -p h$n
python mkref.py $n; [ -n "$EXTRA" ] && echo "$EXTRA" >> h$n/prompt.txt
A="-i h$n/ref.png"
if [ $n -gt 0 ] && [ -f h$((n-1))/sheet.png ]; then python -c "
from PIL import Image
im=Image.open('h$((n-1))/sheet.png').convert('RGB'); im.thumbnail((1200,1200)); im.save('h$n/prev.png')"; A="$A -i h$n/prev.png"; fi
cd h$n && codex exec --skip-git-repo-check --sandbox workspace-write $A -i ../portrait.png - < prompt.txt > codex.log 2>&1
tail -2 codex.log; ls -la sheet.png
