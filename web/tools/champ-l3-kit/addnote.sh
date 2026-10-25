#!/bin/bash
# addnote.sh <col>... : append the attack NOTE (lessons from look 2 redos) to the Krallen look 3 call full/B<col>/prompt.txt
for c in "$@"; do
  f=/d/Coding/BYMR/art-trials/champions/krallen/L3/full/B$c/prompt.txt
  grep -q "^NOTE:" $f || cat >> $f <<'N'
NOTE: follow the HEIGHT and turn of each old frame exactly. Where the old frame stays low and crouched, the Krallen stays low on all four legs; it only rises as high as the old frame rises (never standing tall on the hind legs unless the old frame does). Keep this heading's turn in EVERY cell (never turn to show the face more than the old frame does). The extra back arms and the mouth move as in the old frames.
N
done
