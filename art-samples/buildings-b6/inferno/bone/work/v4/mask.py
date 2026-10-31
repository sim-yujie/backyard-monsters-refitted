import sys; from pathlib import Path
import numpy as np; from PIL import Image
sys.path.insert(0, '.')
import ipost
ipost.D = Path('bone').resolve(); ipost.C = ipost.load(ipost.D)
out=[]
for lv in (1,3):
    m = ipost.on_ground(ipost.frame3d(lv,0)).convert('RGB')
    f = ipost.flash(lv,0,m.size).convert('RGB')
    for im in (f,m):
        a = np.asarray(im).astype(float); r,g,b = a[...,0],a[...,1],a[...,2]
        mk = (g > r+8) & (b > r-5) & (g > 50)
        o = np.zeros_like(a); o[mk] = a[mk]
        out.append(Image.fromarray(o.astype('uint8')).resize((448,464)))
W=Image.new('RGB',(448*4+18,464),(255,255,255))
for i,p in enumerate(out): W.paste(p,(i*454,0))
W.save('bone/work/v4/mask.png')
