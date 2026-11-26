#!/bin/bash
# refine.sh <look> <layout> <from job> <job>: a second Codex edit on the composited picture, to clean the stone
# around the new figure (streaks left from the guide's smear). Same canvas as the guide.
cd "$(dirname "$0")"
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
look=$1; lay=$2; from=$3; job=$4; mkdir -p $job in
python3 - "$look" "$from/out@2x.png" "in/fix-$look-$lay.png" <<'PY'
import json, sys
from PIL import Image
look, src, dst = sys.argv[1:4]
m = json.load(open(f"guide/{look}.json")); g = Image.open(src).convert("RGBA")
big = g.resize((g.width * m["F"], g.height * m["F"]), Image.LANCZOS)
f = Image.new("RGBA", big.size, (255, 0, 255, 255)); f.alpha_composite(big)
c = Image.new("RGB", (1024, 1024), (255, 0, 255)); c.paste(f.convert("RGB"), (m["ox"], m["oy"])); c.save(dst)
PY
WHO=$([ $lay = A ] && echo "the seated boy reading" || echo "the two seated boys reading")
cat > $job/prompt.txt <<P
Generate an image using your image generation tool (one image only, do not make variations or extra files).

A small CLEAN-UP edit of a game picture of the Rizal Monument (Manila). Image 1, fix-$look-$lay.png, is the picture to
edit (1024x1024 on flat magenta). Image 2, current-$look.png, is how the stone looked before (style reference).

Fix ONLY the stone right of Jose Rizal, around $WHO on the right:
- The OBELISK's lower part (the part between Rizal and the boy$([ $lay = A ] || echo s), down to the pedestal top) has
  blurry vertical streaks and a pale smeared strip. Repaint it as clean, continuous stone exactly like the obelisk
  above it: the lit front face and the shaded right-hand face, with one straight vertical edge between them and a
  straight right-hand outline, running straight down until they meet the pedestal's flat top.
- The PEDESTAL's flat top surface around and behind the figure$([ $lay = A ] || echo s): clean even stone like the rest of the
  pedestal top, no streaks, no pink, no smudges; its far edge a clean straight line.
Keep EVERYTHING else exactly as it is, pixel for pixel: $WHO, Rizal, the mother and child, the stars, the pedestal
sides, the base, the steps, the outline of the object and the magenta background. Same camera, size and place.
No text. Output one 1024x1024 image. Save the final PNG as rizal-$look-$lay.png in the current working directory.
P
cp guide/$look-current.png in/current-$look.png
bash $S/run_codex.sh $job in/fix-$look-$lay.png in/current-$look.png | tail -1
