#!/bin/bash
# video3.sh: frost aura round 3 (the Fomor-style mist, ?frostFx=mist) in a real fight, then the bluer Blizzard Stomp,
# real speed then 4x slower, Modern then Classic. Frames from film.mjs in $FRAMES (takes a-<look>-mist,
# a-<look>-current with the bluer stomp, b0-<look>-current with the old one). Writes video/krampus-mist-r3.mp4.
set -e
H=$(cd "$(dirname "$0")" && pwd)
: "${FRAMES:?set FRAMES}"
T=$(mktemp -d -p "$(dirname "$FRAMES")" kfx-r3-XXXX)
n() { ls "$1" | grep -c '\.jpg$'; }
bash $H/card.sh $T/00.mp4 "Krampus: Frost aura, round 3" "A faint ice-blue mist round him, like Fomor's Healing Mist" 2.5
bash $H/caption.sh $FRAMES/a-modern-mist 0 170 $T/01.mp4 "Mist aura (Modern): real speed"
bash $H/caption.sh $FRAMES/a-modern-mist-slow0 0 $(( $(n $FRAMES/a-modern-mist-slow0) - 1 )) $T/02.mp4 "Mist aura (Modern): 4x slower"
bash $H/card.sh $T/03.mp4 "Blizzard Stomp: bluer mist" "Before: mint on grass. After: ice-blue." 2
bash $H/caption.sh $FRAMES/b0-modern-current 150 230 $T/04.mp4 "Stomp BEFORE (Modern): real speed"
bash $H/caption.sh $FRAMES/a-modern-current 150 230 $T/05.mp4 "Stomp AFTER, bluer (Modern): real speed"
bash $H/caption.sh $FRAMES/a-modern-current-slow1 0 $(( $(n $FRAMES/a-modern-current-slow1) - 1 )) $T/06.mp4 "Stomp AFTER (Modern): 4x slower"
bash $H/card.sh $T/07.mp4 "Classic look" "The mist aura, then the stomp before and after" 2
bash $H/caption.sh $FRAMES/a-classic-mist 0 230 $T/08.mp4 "Mist aura + bluer stomp (Classic): real speed"
bash $H/caption.sh $FRAMES/a-classic-mist-slow1 0 $(( $(n $FRAMES/a-classic-mist-slow1) - 1 )) $T/09.mp4 "Stomp in the mist (Classic): 4x slower"
bash $H/caption.sh $FRAMES/b0-classic-current 150 230 $T/10.mp4 "Stomp BEFORE (Classic): real speed"
bash $H/caption.sh $FRAMES/a-classic-current 150 230 $T/11.mp4 "Stomp AFTER, bluer (Classic): real speed"
for f in $T/[01]*.mp4; do echo "file '$f'"; done > $T/list.txt
mkdir -p $H/video
ffmpeg -y -loglevel error -f concat -safe 0 -i $T/list.txt -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -r 30 $H/video/krampus-mist-r3.mp4
rm -rf $T
ls -la $H/video/krampus-mist-r3.mp4
