#!/bin/sh
# postall.sh : every sample picture after a full render (run from inferno/)
for c in "levels" "side 1" "side 3" "outline 1" "outline 3" "anim 1" "anim 3" "motion 1" "motion 3"; do
  python ipost.py bone $c </dev/null 2>&1 | tail -1
done
rm -rf bone/work/v4/f3d-L1 bone/work/v4/f3d-L3
python bone/work/v4/post.py </dev/null
python bone/work/v4/crops.py </dev/null >/dev/null
python bone/work/v4/rimfit.py </dev/null 2>/dev/null | grep L1
python bone/work/v4/loop_diff.py "bone/work/v4/f3d-L1/*.png" -o bone/work/L1-loop.png </dev/null | tail -2
python bone/work/v4/loop_diff.py "bone/work/v4/f3d-L3/*.png" -o bone/work/L3-loop.png </dev/null | tail -2
cp bone/work/v4/mark-drum.png bone/work/mark-drum.png; cp bone/work/v4/mark-bowl.png bone/work/mark-bowl.png
echo POSTDONE
