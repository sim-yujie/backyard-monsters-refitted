import sys; from pathlib import Path
import numpy as np; from PIL import Image, ImageDraw
sys.path.insert(0,'.')
import ipost
ipost.D=Path('bone').resolve(); ipost.C=ipost.load(ipost.D)
from scipy import ndimage
def fit(mk):
    ys,xs=np.nonzero(mk);x=xs.astype(float);y=ys.astype(float)
    M=np.stack([x*x,y*y,x,y],1);p,*_=np.linalg.lstsq(M,np.ones_like(x),rcond=None)
    A,C,D,E=p;cx,cy=-D/(2*A),-E/(2*C);k=1+A*cx*cx+C*cy*cy
    return cx,cy,np.sqrt(k/A),np.sqrt(k/C)
m=ipost.on_ground(ipost.frame3d(3,0)).convert('RGB')
f=ipost.flash(3,0,m.size).convert('RGB')
a=np.asarray(f).astype(float);r,g,b=a[...,0],a[...,1],a[...,2]
for th in (6,10):
    mk=(g>r+th)&(b>r-4)&(g>55); mk[880:]=False; mk[:430]=False
    lab,n=ndimage.label(ndimage.binary_closing(mk,iterations=3))
    s=ndimage.sum(mk,lab,range(1,n+1)); keep=np.argsort(s)[::-1][:6]+1
    mk2=np.isin(lab,keep[s[keep-1]>1500])&mk
    cx,cy,A,B=fit(mk2); print(th, f"L3 flash centre ({cx/12:.1f},{cy/12:.1f}) w {2*A/12:.1f} h {2*B/12:.1f} ratio {B/A:.3f} px {mk2.sum()}")
    o=np.zeros_like(a); o[mk2]=a[mk2]
    im=f.copy(); d=ImageDraw.Draw(im); d.ellipse([cx-A,cy-B,cx+A,cy+B],outline=(255,0,0),width=3)
    im.crop((150,350,1150,950)).resize((500,300)).save(f'bone/work/v4/fitL3f-{th}.png')
