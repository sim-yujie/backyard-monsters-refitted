#!/bin/bash
# usage: run.sh name c1 c2 c3 c4 [prevfile prevquad]   (env NOTE is appended to the prompt)
cd /d/Coding/BYMR/wt-repaint-wormzer
n=$1; shift
python web/tools/wormzer-kit/make_batch.py /d/Coding/BYMR/art-trials/wormzer-c13/full/$n "$@" >/dev/null
cd /d/Coding/BYMR/art-trials/wormzer-c13/full/$n
codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt 2>&1 | tail -3
python /d/Coding/BYMR/wt-repaint-wormzer/web/tools/wormzer-kit/cmp.py
