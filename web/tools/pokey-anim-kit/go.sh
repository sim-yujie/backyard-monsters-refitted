#!/bin/bash
cd D:/Coding/BYMR/art-trials/pokey-anim/full
for n in "$@"; do
  timeout 290 bash run.sh $n >/dev/null
  [ -f h$n/sheet.png ] && python build_h.py $n | grep -o "'i': [0-9]*, 'scale': [0-9.]*, 'area_ratio': [0-9.]*\|clipped': True" | sed "s/'i': //;s/'scale': [0-9.]*, 'area_ratio': //" | paste -sd' ' | sed "s/^/h$n: /" || echo "h$n FAILED"
done
