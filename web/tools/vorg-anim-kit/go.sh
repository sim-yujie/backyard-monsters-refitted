#!/bin/bash
# go.sh <n>... : generate headings in order; stops at the first one that returns no sheet (limit or error)
K=D:/Coding/BYMR/worktrees/anim-vorg/web/tools/vorg-anim-kit
for n in "$@"; do
  out=$(bash $K/run.sh $n 2>&1); echo "$out"
  case "$out" in *"NO SHEET"*) exit 1;; esac
done
