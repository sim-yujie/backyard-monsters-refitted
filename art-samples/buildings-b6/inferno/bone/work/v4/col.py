"""col.py x0,y0,w,h dy3 : the same strip of Flash and 3D, look 1 and look 3 (look 3 moved by dy3 render px down and
48 right, Flash's look shift), with a line every 24 render px (2 Flash px) and a label every 120."""
import sys; from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0,'.')
import ipost
ipost.D=Path('bone').resolve(); ipost.C=ipost.load(ipost.D)
x,y,w,h=(int(v) for v in sys.argv[1].split(',')); out=sys.argv[2]
pics=[]
for lv in (1,3):
    m=ipost.on_ground(ipost.frame3d(lv,0)).convert('RGB'); f=ipost.flash(lv,0,m.size).convert('RGB')
    for im in (f,m):
        im=im.copy(); d=ImageDraw.Draw(im)
        for gy in range(0,im.height,24): d.line([(0,gy),(im.width,gy)],(255,255,0) if gy%120 else (255,0,0),1)
        pics.append(im.crop((x,y,x+w,y+h)))
W=Image.new('RGB',(w*4+30,h),(255,255,255))
for i,p in enumerate(pics): W.paste(p,(i*(w+10),0))
W.save(out)
