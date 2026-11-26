#!/bin/bash
# Rizal Monument figures, one group each side (owner 26 Nov 2026: "The figures are supposed to be one on each side.
# The current one has 3 on one side."): the two boys + the leaves and pot behind them read as three on the right.
# Only the right-hand group changes; the rest of the picture is the 24 Nov art, pixel for pixel.
#   A = ONE seated boy reading on the obelisk's right face      B = the two boys as one group there (real arrangement)
# Photos: ../decor-real/refs/rizal-monument/ (sources.md; images not in git), sheet refs/photos-rizal-monument.png.
set -e; cd "$(dirname "$0")"
# bash render.sh old A Bface old-ns A-ns Bface-ns      block-outs (../decor-real/blockout.py RIZAL_LAYOUT), -ns = no slab
# python3 fit.py; python3 fitlocal.py                  block-out -> @2x picture registration (fit.json)
# python3 guide.py <classic|modern> <A|Bface>          Codex input: picture at 4x, old group cut out, new clay figure
# bash codex.sh <look> <A|Bface> j1-<look>-<A|Bface>   Codex edit (prompts.py); Modern needed a clean-up pass:
# bash refine.sh modern <A|Bface> j1-modern-<..> j2-modern-<..>
python3 composite.py classic j1-classic-A/rizal-classic-A.png final/classic-A.png
python3 composite.py classic j1-classic-Bface/rizal-classic-Bface.png final/classic-B.png
python3 composite.py modern j2-modern-A/rizal-modern-A.png final/modern-A.png
python3 composite.py modern j2-modern-Bface/rizal-modern-Bface.png final/modern-B.png
python3 tone.py final/classic-A.png 0.8; python3 tone.py final/classic-B.png 0.8   # Classic bronze as dark as the mother's
python3 sheets.py                                     # desk sheets: Now | A | B at 1x, 2x, 4x
# bash apply.sh B   (or A): game files, shadows, button 214.jpg, Modern copies and build picture
