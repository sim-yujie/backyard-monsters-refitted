#!/bin/bash
# shoot.sh <spec names...>: films each spec in turn (waits while 3 test browsers are open); log per spec.
cd /home/yujiesim/Coding/backyard-monsters-refitted/worktrees/frost-prod/art-samples/frost-tribe/fxbake
for n in "$@"; do
  while [ "$(pgrep -af chrome-headless-shell | grep -vc -- '--type=')" -ge 3 ]; do sleep 10; done
  GAME_PORT=${GAME_PORT:-5461} timeout 1200 node film.mjs specs/$n.json 2>&1 | grep -v "^\s*'" | tail -3 > /home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/${LOGP:-krampus-fx}-film-$n.log
  echo "$n: $(cat /home/yujiesim/Coding/backyard-monsters-refitted/archive/logs/${LOGP:-krampus-fx}-film-$n.log | tr '\n' ' ')"
done
echo ALLDONE
