#!/bin/bash
# all.sh : every render of the finished look E, one Blender at a time (each run takes and returns the GPU lock).
#   STORE_LETTERS=0 ./all.sh   the same without the words MATCH BOOK on the cover, into e-plain/ (the one switch)
#   STORE_WEAR=heavy ./all.sh  the words one level more worn in every state, into e-heavy/ (the game has light)
cd "$(dirname "$0")"
export STORE_VAR=e
python3 itex.py
./run.sh base                                   # e/render/L1-base.png, L1-alone.png: the standing store
PB_STATE=damaged ./run.sh base                  # L1-damaged-base.png, -alone.png
PB_STATE=destroyed ./run.sh base                # L1-destroyed-base.png, -alone.png
# the loop's three pictures (post_e.py mixes the 24 frames from them): every glow low; the pips high; the cracks high
PB_STATE=lo  STORE_PIP=0.60 STORE_CRACK=0.50 ./run.sh base
PB_STATE=pip STORE_PIP=1.45 STORE_CRACK=0.50 ./run.sh base
PB_STATE=crk STORE_PIP=0.60 STORE_CRACK=1.60 ./run.sh base
D=e; [ "$STORE_WEAR" = heavy ] && D=e-heavy; [ "$STORE_LETTERS" = 0 ] && D=e-plain
mkdir -p $D/work
./run.sh check > $D/work/check.log 2>&1
./run.sh gap > $D/work/gap.log 2>&1
PB_STATE=damaged ./run.sh check > $D/work/check-damaged.log 2>&1
PB_STATE=destroyed ./run.sh check > $D/work/check-destroyed.log 2>&1
echo ALLDONE
