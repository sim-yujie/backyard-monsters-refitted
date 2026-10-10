#!/bin/bash
# usage: run.sh col [extra painted images...]   (env NOTE appended to the prompt); outputs in art-trials/champions/fomor/full/H<col>
c=$1; shift
d=/d/Coding/BYMR/art-trials/champions/fomor/full/H$c
python /d/Coding/BYMR/wt-repaint-fomor/web/tools/fomor-kit/make_batch.py $c $d "$@" >/dev/null || exit 1
cd $d
codex exec --skip-git-repo-check --sandbox workspace-write -i frames.png -i style.png -i portrait.png - < prompt.txt 2>&1 | tail -3
python -c "
from PIL import Image
a=Image.open('frames.png'); b=Image.open('frames-new.png').convert('RGB'); print(b.size)
b=b.resize((a.width,int(b.height*a.width/b.width))); g=Image.new('RGB',(a.width,a.height+b.height)); g.paste(a,(0,0)); g.paste(b,(0,a.height)); g.resize((1100,int(g.height*1100/g.width))).save('cmp.png')
b=Image.open('frames-new.png').convert('RGB'); w,h=b.size; b.crop((0,0,w//4,h//2)).save('idle.png')"
