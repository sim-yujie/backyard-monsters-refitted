#!/bin/bash
# caption.sh <in frames dir> <first frame> <last frame> <out.mp4> <caption> [crop w:h:x:y in frame px]
# A clip from filmed frames at 30 fps, scaled to 1280x720, with a caption bar along the bottom.
F=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
T=$(mktemp); printf '%s' "$5" > $T
CROP=${6:+crop=$6,}
ffmpeg -y -loglevel error -framerate 30 -start_number $2 -i "$1/f%05d.jpg" -frames:v $(( $3 - $2 + 1 )) \
  -vf "${CROP}scale=1280:720:flags=lanczos,drawbox=x=0:y=ih-60:w=iw:h=60:color=0x14283c@0.8:t=fill,drawtext=expansion=none:fontfile=$F:textfile=$T:fontsize=28:fontcolor=white:x=(w-text_w)/2:y=h-45,format=yuv420p" \
  -c:v libx264 -crf 24 -preset slow -r 30 "$4"; rm -f $T
