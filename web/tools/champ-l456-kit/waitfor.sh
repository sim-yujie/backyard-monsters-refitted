#!/bin/bash
# waitfor.sh <regex> [secs] : wait (max secs, default 570) until chain.log matches regex or a STOP/failure appears; print the last lines
cd /d/Coding/BYMR/art-trials/champions/_kit/l456; t=$(( $(date +%s) + ${2:-570} )); s0=$(grep -c STOP chain.log)
while [ $(date +%s) -lt $t ]; do grep -qE "$1|exit [1-9]" chain.log && break; [ $(grep -c STOP chain.log) -gt $s0 ] && break; sleep 20; done
tail -2 chain.log
