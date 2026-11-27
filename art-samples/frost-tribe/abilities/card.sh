#!/bin/bash
# card.sh <out.mp4> <title> <line> [seconds]
F=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
R=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
T=$(mktemp); L=$(mktemp); printf '%s' "$2" > $T; printf '%s' "$3" > $L
ffmpeg -y -loglevel error -f lavfi -i "color=c=0x14283c:s=1280x720:r=30:d=${4:-2}" \
  -vf "drawtext=expansion=none:fontfile=$F:textfile=$T:fontsize=64:fontcolor=0xdff4ff:x=(w-text_w)/2:y=h/2-80,drawtext=expansion=none:fontfile=$R:textfile=$L:fontsize=32:fontcolor=white:x=(w-text_w)/2:y=h/2+20,format=yuv420p" \
  -c:v libx264 -crf 20 -preset slow "$1"; rm -f $T $L
