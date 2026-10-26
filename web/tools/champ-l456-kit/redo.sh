#!/bin/bash
# redo.sh <sheet> <mode><col> <note file> : rebuild that call's inputs (B: from the current A idle), append the NOTE, run it once.
K=/d/Coding/BYMR/art-trials/champions/_kit/l456; cd $K
n=$1; call=$2; note=$3; m=${call:0:1}; c=${call:1}
D=$(python -c "from spec import SPECS; print(SPECS['$n']['sample'].as_posix() + '/full')")
if [ $m = A ]; then python make_batch.py $n A $c > /dev/null; else python prep_b.py $n $c > /dev/null; fi
[ -n "$note" ] && cat "$note" >> $D/$call/prompt.txt
bash run.sh $D/$call frames.png style.png portrait.png; echo "$(date +%H:%M) $n redo $call exit $?" >> chain.log
