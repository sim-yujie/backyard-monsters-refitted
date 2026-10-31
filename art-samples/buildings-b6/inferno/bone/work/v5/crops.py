"""crops.py : full-size crops (render px, 1:1), Flash above 3D, of each area fixed in v5, into bone/work/crops/.
A third panel: the 3D with Flash's outline over it (red), to lay one silhouette over the other.
    python bone/work/v5/crops.py [name ...]      (run from inferno/)"""
import sys; from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
sys.path.insert(0, '.')
import ipost, iref
ipost.D = Path('bone').resolve(); ipost.C = ipost.load(ipost.D)
OUT = ipost.D / 'work' / 'crops'
AREAS = [(1, 'L1-bowl', (170, 340, 980, 820)), (3, 'L3-bowl', (210, 420, 980, 820)),
         (1, 'L1-drum', (110, 860, 560, 360)), (3, 'L3-drum', (140, 920, 600, 380)),
         (3, 'L3-hopper', (480, 20, 780, 700)), (3, 'L3-rollers', (260, 420, 760, 520)),
         (3, 'L3-shield-cog', (760, 620, 540, 600)), (1, 'L1-rollers', (300, 320, 620, 440))]
want = set(sys.argv[1:])
ims = {}
for lv, name, (x, y, w, h) in AREAS:
    if want and name not in want:
        continue
    if lv not in ims:
        m = ipost.on_ground(ipost.frame3d(lv, 0)).convert('RGB')
        a = iref.flash_rgba(ipost.C.TID, lv, 0, ipost.C.FRAME).resize(m.size, Image.BICUBIC).getchannel('A')
        a = a.point(lambda v: 255 if v > 100 else 0)
        edge = a.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 0 else 0).filter(ImageFilter.MaxFilter(3))
        ov = Image.blend(m, ipost.flash(lv, 0, m.size).convert('RGB'), 0.5); ov.paste((255, 40, 40), mask=edge)
        ims[lv] = (ipost.flash(lv, 0, m.size).convert('RGB'), m, ov)
    f, m, ov = ims[lv]
    pic = Image.new('RGB', (w, 3 * h + 16), (255, 255, 255))
    for i, src in enumerate((f, m, ov)):
        pic.paste(src.crop((x, y, x + w, y + h)), (0, i * (h + 8)))
    d = ImageDraw.Draw(pic)
    for i, t in enumerate(('Flash', '3D v5', '3D v5 and Flash, half each, Flash outline red')):
        d.text((8, 6 + i * (h + 8)), t, fill=(255, 255, 255))
    pic.save(OUT / f'{name}.png')
    print(OUT / f'{name}.png')
