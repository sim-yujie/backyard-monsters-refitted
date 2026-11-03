#!/bin/sh
# Reload the game and open Map Room 2 in the mr2-tilt2 session (round 2 samples).
S="playwright-cli -s=mr2-tilt2"
$S reload >/dev/null; sleep 12
$S mousemove 1066 106 >/dev/null; $S mousedown >/dev/null; $S mouseup >/dev/null; sleep 1
$S mousemove 70 810 >/dev/null; $S mousedown >/dev/null; $S mouseup >/dev/null; sleep 9
$S mousemove 1522 158 >/dev/null; $S mousedown >/dev/null; $S mouseup >/dev/null; sleep 1
$S mousemove 800 5 >/dev/null
