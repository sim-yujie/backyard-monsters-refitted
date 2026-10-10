#!/bin/bash
# usage: run.sh name c1 c2 c3 c4 [prevfile prevquad]   (env NOTE is appended to the prompt)
cd /d/Coding/BYMR/wt-repaint-dave
n=$1; shift
python web/tools/dave-kit/make_batch.py /d/Coding/BYMR/art-trials/dave/full/$n "$@" >/dev/null
cd /d/Coding/BYMR/art-trials/dave/full/$n
codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt 2>&1 | tail -3
python -c "
from PIL import Image
a=Image.open('frames.png');b=Image.open('frames-new.png').convert('RGB')
b=b.resize((a.width,int(b.height*a.width/b.width)))
g=Image.new('RGB',(a.width*2,max(a.height,b.height)));g.paste(a,(0,0));g.paste(b,(a.width,0));g.save('cmp.png')"
