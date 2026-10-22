import numpy as np, os, sys
from PIL import Image
from lib import premul_resize
BIGOUT='out/slimeattikus-anim@4x.png'
M=Image.open('D:/Coding/BYMR/worktrees/anim-slimeattikus/server/public/assets/monsters/slimeattikusmini-repaint@4x.png').convert('RGBA')
OW,OH=120,80; CW,CH=160,128; PX,PY=20,44
F=lambda n,k:Image.open(f'h{n}/frames/f{k:02d}.png').convert('RGBA')
def solid(im):
    a=np.asarray(im); m=(a[...,3]>200); ys,xs=np.where(m); return m.sum(),xs.mean(),ys.max()
COLS=list(range(30))+[29,0]
cols={}
for n in range(30):
    still=M.crop((n*OW,0,n*OW+OW,OH)); st=Image.new('RGBA',(CW,CH)); st.paste(still,(PX,PY))
    ma,mx,my=solid(st)
    big0=F(n,0); ba,bx,by=solid(big0); s=np.sqrt(ma/ba)
    sc0=premul_resize(big0,(round(256*s),round(192*s))); a2,x2,y2=solid(sc0)
    dx=round(mx-x2); dy=round(my-y2)
    col=[st]
    for k in range(1,12):
        im=premul_resize(F(n,k),(round(256*s),round(192*s))); c=Image.new('RGBA',(CW,CH)); c.alpha_composite(im,(dx,dy)) if dx>=0 and dy>=0 else c.paste(im,(dx,dy)); col.append(c)
    # report clipping
    for k,c in enumerate(col):
        a=np.asarray(c)[...,3]
        if a[0].any() or a[-1].any() or a[:,0].any() or a[:,-1].any(): print('touch edge',n,k)
    cols[n]=col; 
    if n%6==0: print(n,round(float(s),3),dx,dy)
sheet=Image.new('RGBA',(32*CW,12*CH))
for c,n in enumerate(COLS):
    for k in range(12): sheet.paste(cols[n][k],(c*CW,k*CH))
sheet.save('out/slimeattikusmini-anim@4x.png')
s1=Image.new('RGBA',(32*CW//4,12*CH//4))
for c,n in enumerate(COLS):
    for k in range(12): s1.paste(premul_resize(cols[n][k],(CW//4,CH//4)),(c*CW//4,k*CH//4))
s1.save('out/slimeattikusmini-anim.png')
import subprocess; subprocess.run([sys.executable,'D:/Coding/BYMR/worktrees/anim-slimeattikus/web/tools/shrink-sheet.py','out/slimeattikusmini-anim@4x.png','out/slimeattikusmini-anim.png'],check=True)
