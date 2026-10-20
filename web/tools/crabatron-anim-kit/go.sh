#!/bin/bash
cd D:/Coding/BYMR/art-trials/crabatron-anim/full
for n in "$@"; do
  bash go2.sh $n || exit 1
  python build_h.py $n | grep -o "'i': [0-9]*, 'scale': [0-9.]*, 'area_ratio': [0-9.]*\|clipped': True" | sed "s/'i': //;s/'scale': [0-9.]*, 'area_ratio': //" | paste -sd' ' | sed "s/^/h$n: /"
done
