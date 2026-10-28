#!/bin/bash
# supervise.sh <cols...> : run chain.sh for every Korath level at once (6 Codex calls in parallel), and when Codex reports its usage
# limit (STOP), wait and go again; chain.sh skips calls already painted. Ends when every call of those columns is painted or after 10 hours.
K=/d/Coding/BYMR/art-trials/champions/_kit/korath/full; cd $K
end=$(( $(date +%s) + 36000 ))
while [ $(date +%s) -lt $end ]; do
  for i in 1 2 3 4 5 6; do bash chain.sh korath_$i "$@" & done; wait
  missing=0
  for i in 1 2 3 4 5 6; do for c in "$@"; do for m in A B; do
    [ -f /d/Coding/BYMR/art-trials/champions/korath/L$i/full/$m$c/frames-new.png ] || missing=$((missing+1)); done; done; done
  echo "$(date +%H:%M) pass done, missing $missing" >> chain.log
  [ $missing -eq 0 ] && { echo "$(date +%H:%M) ALLDONE $*" >> chain.log; exit 0; }
  if [ -f STOP ]; then echo "$(date +%H:%M) limit: $(cat STOP | head -c 200); waiting 20 min" >> chain.log; sleep 1200; rm -f STOP; else sleep 30; fi
done
echo "$(date +%H:%M) GAVE UP $*" >> chain.log
