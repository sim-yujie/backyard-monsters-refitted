"""prof.py look : Flash vs 3D silhouette, in Flash px: left/right edge per row (between given cols), bottom per column."""
import sys; from pathlib import Path
import numpy as np; from PIL import Image
sys.path.insert(0,'.')
import ipost, iref
ipost.D=Path('bone').resolve(); ipost.C=ipost.load(ipost.D)
lv=int(sys.argv[1])
im=Image.open(ipost.D/'render'/f'L{lv}-alone.png').convert('RGBA')
f=np.array(iref.flash_rgba(1,lv,0,ipost.C.FRAME).getchannel('A').resize(im.size,Image.BILINEAR))>128
t=np.array(im.getchannel('A'))>128
dy=0 if lv<3 else 90
print('row  Fleft 3left | Fright 3right   (Flash px from frame left; rows Flash px from top, look1 frame)')
for yy in range(int(sys.argv[2]),int(sys.argv[3]),24):
    y=yy+dy
    def lr(m,x0,x1):
        xs=np.nonzero(m[y,x0:x1])[0]
        return (xs.min()+x0)/12 if len(xs) else -1,(xs.max()+x0)/12 if len(xs) else -1
    fl,fr=lr(f,int(sys.argv[4]),int(sys.argv[5])); tl,tr=lr(t,int(sys.argv[4]),int(sys.argv[5]))
    print(f"{yy/12:5.1f}  {fl:5.1f} {tl:5.1f} | {fr:5.1f} {tr:5.1f}")
print('col  Fbottom 3bottom')
for xx in range(int(sys.argv[6]),int(sys.argv[7]),36):
    x=xx+(0 if lv<3 else 48)
    fb=np.nonzero(f[:,x])[0]; tb=np.nonzero(t[:,x])[0]
    print(f"{xx/12:5.1f}  {fb.max()/12 if len(fb) else -1:5.1f} {tb.max()/12 if len(tb) else -1:5.1f}")
