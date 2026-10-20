#!/bin/bash
cd D:/Coding/BYMR/art-trials/projectx-anim/full
for n in "$@"; do
  NOPREV=1 timeout 290 bash run.sh $n >/dev/null 2>&1
  if grep -qi "usage limit\|limit" h$n/codex.log 2>/dev/null && ! [ h$n/sheet.png -nt h$n/prompt.txt ]; then echo "h$n LIMIT"; grep -i limit h$n/codex.log | head -2; exit 1; fi
  [ h$n/sheet.png -nt h$n/prompt.txt ] && echo "h$n new sheet" || echo "h$n NOT UPDATED"
done
