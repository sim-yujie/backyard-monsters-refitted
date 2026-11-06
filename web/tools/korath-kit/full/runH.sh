#!/bin/bash
# runH.sh <sheet>... : the headings (H) call of each sheet, one at a time
K=/d/Coding/BYMR/art-trials/champions/_kit/korath/full; cd $K
for n in "$@"; do
  D=$(python -c "from spec import SPECS; print(SPECS['$n']['sample'].as_posix() + '/full/H')")
  [ -f $D/frames-new.png ] && [ -z "$REDO" ] && continue
  bash run.sh $D frames.png style.png portrait.png; echo "$(date +%H:%M) $n H exit $?" >> chain.log
done
