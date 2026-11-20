#!/bin/bash
# The Under Hall's fire done again (levels 4-6), three options for the owner, in order. Run from art-samples/b8,
# after uh_final_make.sh (it needs final/work/body<N>@2x.png and final/anim.json). Everything lands in
# underhall-levels/final/fire2/ (git-ignored; a copy without the raw Blender renders is in archive/b8-codex-fort-hall/underhall-final/fire2/).
#   uh_fire2_make.sh sims   : only the Blender simulations (about 3 minutes each, one graphics card, lock held per run)
#   uh_fire2_make.sh strips : only the strips, sheets and videos from the simulations already there
PY=~/.cache/bymr-art-venv/bin/python      # Pillow + numpy
O=underhall-levels/final/fire2/work/sim
set -e
if [ "$1" != strips ]; then
  # flames: a round burner; a lower burning rate and a faster rise make a taller flame
  C="res=176 noise=1 vort=1.0 turb=0.6 pow=2.6 glow=5 warm=40 frames=64"
  ./uh_fire2_sim.sh L6 $O $C radius=0.5 burn=0.28 rise=1.6 seed=6
  ./uh_fire2_sim.sh L5 $O $C radius=0.46 burn=0.42 rise=1.25 seed=5
  ./uh_fire2_sim.sh L4 $O $C radius=0.42 burn=0.62 rise=0.9 seed=4
  ./uh_fire2_sim.sh gate $O $C radius=0.7 burn=0.5 rise=1.0 seed=7        # the wide low fire behind level 6's gate
  ./uh_fire2_sim.sh smoke $O kind=smoke res=144 noise=2 turb=0.3 radius=0.12 rise=1.6 dissolve=26 glow=3 warm=60 frames=64 seed=8   # a thin column
fi
if [ "$1" != sims ]; then
  $PY uh_fire2_anim.py        # fire2/<sim|game|glow>/: strips, stills, anim.json; fire2/work/frames-<option>/L<N>/
  $PY uh_fire2_show.py        # fire2/sheets/ and fire2/videos/
fi
