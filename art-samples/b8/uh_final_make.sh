#!/bin/bash
# The whole final Under Hall pass (levels 4-6, direction B "Lava and Black Iron", with animation), in order.
# Run from art-samples/b8. Codex calls (10 in all) are the lines with run_codex.sh; everything lands in
# underhall-levels/final/ (git-ignored; a copy is in archive/b8-codex-fort-hall/underhall-final/).
S=/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts
PY=~/.cache/bymr-art-venv/bin/python      # Pillow + numpy
J=underhall-levels/final/jobs
set -e
# the flame sheet (on black): its prompt is kept as uh_final_flames_prompt.md
mkdir -p $J/flames && cp uh_final_flames_prompt.md $J/flames/prompt.txt
bash $S/run_codex.sh $J/flames
# the bodies, each an edit of the level below (level 3 = the game's approved picture), no flame
for n in 4 5 6; do
  python3 uh_final_prep.py $n
  bash $S/run_codex.sh $J/L$n $J/L$n/base.png $J/L$n/design.png
  $PY uh_final_body.py $n
done
# damaged and destroyed, one Codex pass each
for n in 4 5 6; do for k in d x; do
  python3 uh_final_ruin_prep.py $n $k
  bash $S/run_codex.sh $J/L$n$k $J/L$n$k/base.png $J/L$n$k/manner.png
done; done
$PY uh_final_ruin.py
$PY uh_final_anim.py        # stills, bodies, strips, anim.json, work/frames<N>/
$PY uh_final_show.py        # sheets/ and videos/
$PY uh_final_vet.py         # numbers + overlay sheet
