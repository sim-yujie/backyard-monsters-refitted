#!/bin/bash
# jobs.sh : after "DONE fly_5" in chain.log, run the lines of jobs.txt one at a time (one Codex call at a time); a line "END" stops it.
K=/d/Coding/BYMR/art-trials/champions/_kit/l456; cd $K
until grep -q "DONE fly_5" chain.log; do sleep 20; done
while true; do
  l=$(head -1 jobs.txt 2>/dev/null)
  if [ -z "$l" ]; then sleep 20; continue; fi
  sed -i 1d jobs.txt
  [ "$l" = END ] && { echo "$(date +%H:%M) jobs END" >> chain.log; exit 0; }
  echo "$(date +%H:%M) job: $l" >> chain.log; bash -c "$l"
done
