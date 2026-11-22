# side.py <name> <WxH> : prototype shot | demo shot, side by side, scaled for viewing
import sys
from PIL import Image
W='/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/hcc-r3'
name,size,out=sys.argv[1],sys.argv[2],sys.argv[3]
a=Image.open(f'{W}/shots/hcc/r2-{name}-modern-{size}.png').convert('RGB'); b=Image.open(f'{W}/demo/shots/match-{name}-{size}.png').convert('RGB')
h=int(sys.argv[4]) if len(sys.argv)>4 else 1100
a=a.resize((a.width*h//a.height,h)); b=b.resize((b.width*h//b.height,h))
im=Image.new('RGB',(a.width+b.width+10,h),'red'); im.paste(a,(0,0)); im.paste(b,(a.width+10,0)); im.save(out)
