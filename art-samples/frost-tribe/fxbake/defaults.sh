#!/bin/bash
# defaults.sh: Krampus's Ice Shards and Blizzard Stomp as every player now sees them (neon's, no ?frostFx=), Modern,
# each at real speed then 4x slower; one video. Frames from film.mjs in $FRAMES (takes a-modern-current and
# sh-modern-current). Writes video/krampus-stomp-shards-neon.mp4.
set -e
H=$(cd "$(dirname "$0")" && pwd)
: "${FRAMES:?set FRAMES}"
T=$(mktemp -d -p "$(dirname "$FRAMES")" kfx-def-XXXX)
n() { ls "$1" | grep -c '\.jpg$'; }
bash $H/card.sh $T/00.mp4 "Krampus: Blizzard Stomp" "neon's design, now the game's: towers inside work 30% slower for 3 s" 2.5
bash $H/caption.sh $FRAMES/a-modern-current 195 280 $T/01.mp4 "Blizzard Stomp (Modern): real speed"
bash $H/caption.sh $FRAMES/a-modern-current-slow1 0 $(( $(n $FRAMES/a-modern-current-slow1) - 1 )) $T/02.mp4 "Blizzard Stomp (Modern): 4x slower"
bash $H/card.sh $T/03.mp4 "Krampus: Ice Shards" "neon's design, now the game's: flings ice at a flyer, chills it 30% for 2 s" 2.5
bash $H/caption.sh $FRAMES/sh-modern-current 120 240 $T/04.mp4 "Ice Shards (Modern): real speed"
bash $H/caption.sh $FRAMES/sh-modern-current-slow0 0 $(( $(n $FRAMES/sh-modern-current-slow0) - 1 )) $T/05.mp4 "Ice Shards (Modern): 4x slower"
for f in $T/0*.mp4; do echo "file '$f'"; done > $T/list.txt
mkdir -p $H/video
ffmpeg -y -loglevel error -f concat -safe 0 -i $T/list.txt -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -r 30 $H/video/krampus-stomp-shards-neon.mp4
ls -la $H/video/krampus-stomp-shards-neon.mp4
