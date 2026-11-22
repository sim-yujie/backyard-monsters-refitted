#!/bin/bash
# sizes.sh <round> [looks]: the Lab window (research running) at every size, Modern and Classic
R=$1; LOOKS=${2:-"modern classic"}
run() { # name w h scale cave [pan]
  for look in $LOOKS; do
    PAN=$6 CAVE=$5 timeout 240 node film.mjs $R-$1-$look $look $2 $3 $4 clean sel:195 wait:800 shot:popup 'try:^Open$' wait:2500 shot:lab 2>&1 | tail -1 | cut -c1-120
  done
}
run d1280 1280 720 1 285,135
run d1366 1366 768 1 300,135
run d1920 1920 1080 1 400,165
run ipadL 1024 768 2 205,150
run ipadP 768 1024 2 150,350
run phoneP 390 844 3 150,285 170,0
run phoneL 844 390 3 198,84
