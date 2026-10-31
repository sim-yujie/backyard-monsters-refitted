"""ell.py look src cx,top,a ratios... : draw ellipses with the given top and half-width over Flash (src=f) or 3D (m)."""
import sys; from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0,'.')
import ipost
ipost.D=Path('bone').resolve(); ipost.C=ipost.load(ipost.D)
lv=int(sys.argv[1]); src=sys.argv[2]; cx,top,a=(float(v) for v in sys.argv[3].split(','))
m=ipost.on_ground(ipost.frame3d(lv,0)).convert('RGB')
im=ipost.flash(lv,0,m.size).convert('RGB') if src=='f' else m
d=ImageDraw.Draw(im); cols=[(255,0,0),(0,255,0),(0,128,255),(255,255,0)]
for i,rt in enumerate(sys.argv[4:]):
    b=a*float(rt); d.ellipse([cx-a,top,cx+a,top+2*b],outline=cols[i],width=3)
im.crop((150,350,1150,1000)).resize((600,390)).save(f'bone/work/v4/ell-{lv}{src}.png')
