#!/bin/bash
# usage: render.sh [skins...] : screenshot mock.html for each skin x screen into shots/<skin>-<screen>.png (needs the http server on 5593)
P="playwright-cli -s=window-mockups"
S=/d/Coding/BYMR/worktrees/ui-skin/mockups/shots
skins=${@:-flash wood scrap cardboard}
for k in $skins; do for s in building build popup; do
  $P goto "http://127.0.0.1:5593/mockups/html/mock.html?skin=$k&screen=$s" >/dev/null 2>&1
  sleep 1.5
  $P screenshot --filename=$S/$k-$s.png >/dev/null 2>&1
done; done
echo rendered
