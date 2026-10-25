#!/bin/bash
# chain.sh <sheet> <col>... : for each column, the A call, then (walking sheets) prep_b + the B call; one Codex call at a time.
# Skips a call whose frames-new.png already exists unless REDO=1. Stops when STOP exists. Progress in chain.log.
K=/d/Coding/BYMR/art-trials/champions/_kit/l456; cd $K
n=$1; shift
D=$(python -c "from spec import SPECS; print(SPECS['$n']['sample'].as_posix() + '/full')")
modes=$(python -c "from spec import SPECS; print(' '.join(SPECS['$n']['calls']))")
for c in "$@"; do
  for m in $modes; do
    [ -f STOP ] && { echo "$(date +%H:%M) STOP $n" >> chain.log; exit 3; }
    d=$D/$m$c
    [ -f $d/frames-new.png ] && [ -z "$REDO" ] && continue
    if [ $m = A ]; then python make_batch.py $n A $c > /dev/null; else python prep_b.py $n $c > /dev/null; fi
    fam=${n%_*}; [ -f autonote-$fam-$m$c.txt ] && cat autonote-$fam-$m$c.txt >> $d/prompt.txt
    bash run.sh $d frames.png style.png portrait.png; echo "$(date +%H:%M) $n $m$c exit $?" >> chain.log
  done
done
echo "$(date +%H:%M) DONE $n $*" >> chain.log
