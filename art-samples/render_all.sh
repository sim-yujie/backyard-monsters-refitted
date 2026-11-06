#!/bin/sh
# render_all.sh [--outline] : renders every 3D tower in the game (all tiers, headings, tilt rows and anim cells) and turns
# the renders into the pieces the exporters read (web/tools/tower-tiers/export3d.py and export3d_static.py, run with
# the worktree as the 3D art worktree). The scripts in art-samples/ are those of art/buildings-3d (20a6bff24: the Cannon,
# Sniper and Laser of art/towers-3d b9d98582c, the Aerial Defense, Railgun, Spurtz and Inferno towers) and
# art/tesla-bunker-3d (e32b41c86: the Tesla Tower and Monster Bunker).
#
# No outline by default (owner, 30 Oct 2026: the game's 3D towers have no dark outline): LOOK3D_NO_LINE=1 leaves out
# look3d's inverted-hull shells and the silhouette line, nothing else. --outline renders them as before.
# One Blender at a time: waits for any other render on the PC first. Renders go to <set>-3d/render/.
B="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")" || exit 1
if [ "$1" = "--outline" ]; then unset LOOK3D_NO_LINE; else export LOOK3D_NO_LINE=1; fi
while tasklist 2>/dev/null | grep -qi "^blender.exe"; do sleep 15; done
start=$(date +%s)
run() { t0=$(date +%s); "$B" -b --factory-startup -P "$@" 2>&1 | grep -E "DONE|Error|Traceback" | cut -c1-160; echo "  $* : $(( $(date +%s) - t0 )) s"; }
# SETS="aerial railgun ..." renders only those (default: all).
want() { [ -z "$SETS" ] || case " $SETS " in *" $1 "*) true ;; *) false ;; esac; }

# The Cannon: body and its one fixed tilt row of 32 headings (PITCHES = [-22]); post.py tilt makes tN/strip*.
want cannon && (cd cannon-3d
  for t in t1 t2 t3; do run cannon3d.py -- $t body; run cannon3d.py -- $t tilts; done
  python -I post.py tilt && for t in t1 t2 t3; do mkdir -p $t/body && cp render/$t/body-4x.png $t/body/body-4x.png; done)
want sniper && (cd sniper-3d
  for t in 1 2 3; do for m in body turret aim; do run sniper3d.py -- $t $m; done; done
  python -I post.py)
# The Laser: body and its 5 tilt rows of 32 headings; post.py tilt makes tN/strip*, laser_body.py tN/body@2x.png.
want laser && (cd laser-3d
  for t in 1 2 3; do run laser3d.py -- $t body; run laser3d.py -- $t tilts; done
  python -I post.py tilt && python -I ../laser_body.py)
for set in aerial railgun; do
  want $set && (cd $set-3d
    for t in 1 2 3; do for m in body turret aim; do run ${set}3d.py -- $t $m; done; done
    python -I ../tower-3d/sqpost.py $set)
done
want spurtz && (cd spurtz-3d
  for t in 1 2; do for m in body turret aim; do run spurtz3d.py -- $t $m; done; done
  python -I spurtzpost.py)
# The Inferno: Blast Tower (1), Sharpshooter (2), Magma Tower (3), each at its three level looks.
want inferno && (cd inferno-3d
  for look in 1 2 3; do
    export INFERNO_LOOK=$look
    for t in 1 2 3; do for m in body turret aim; do run inferno3d.py -- $t $m; done; done
  done
  unset INFERNO_LOOK
  python -I infpost.py && for t in 1 2 3; do python -I levelpost.py $t; done)
# The Tesla: body and the game strip's 55 film cells. The Bunker: body and 15 cells of the shutters rolling up
# (smoothstep, to 4 places, as rendered for the game).
want tesla && (cd tesla-3d
  for t in 1 2 3; do run tesla3d.py -- $t body; run tesla3d.py -- $t film-game; done)
want bunker && (cd bunker-3d
  F=$(python -c "print(' '.join(str(round(3 * (i / 14) ** 2 - 2 * (i / 14) ** 3, 4)) for i in range(15)))")
  for t in 1 2 3; do run bunker3d.py -- $t body; run bunker3d.py -- $t rise $F; done)
echo "all: $(( $(date +%s) - start )) s"
