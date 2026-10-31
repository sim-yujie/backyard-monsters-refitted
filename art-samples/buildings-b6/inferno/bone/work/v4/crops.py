"""crops.py : full-size crops (render px, 1:1), Flash above 3D, of each area fixed in v4, into bone/work/crops/."""
import sys; from pathlib import Path
from PIL import Image, ImageDraw
sys.path.insert(0, '.')
import ipost
ipost.D = Path('bone').resolve(); ipost.C = ipost.load(ipost.D)
OUT = ipost.D / 'work' / 'crops'
AREAS = [(1, 'L1-bowl', (170, 340, 980, 820)), (3, 'L3-bowl', (210, 420, 980, 820)),
         (1, 'L1-drum', (110, 860, 560, 360)), (3, 'L3-drum', (140, 920, 600, 380)),
         (3, 'L3-hopper', (540, 20, 720, 680)), (3, 'L3-shield-cog', (760, 620, 540, 600)),
         (1, 'L1-rollers', (300, 320, 620, 440))]
ims = {}
for lv, name, (x, y, w, h) in AREAS:
    if lv not in ims:
        m = ipost.on_ground(ipost.frame3d(lv, 0)).convert('RGB')
        ims[lv] = (ipost.flash(lv, 0, m.size).convert('RGB'), m)
    f, m = ims[lv]
    pic = Image.new('RGB', (w, 2 * h + 8), (255, 255, 255))
    pic.paste(f.crop((x, y, x + w, y + h)), (0, 0))
    pic.paste(m.crop((x, y, x + w, y + h)), (0, h + 8))
    d = ImageDraw.Draw(pic)
    d.text((8, 6), 'Flash', fill=(255, 255, 255)); d.text((8, h + 14), '3D v4', fill=(255, 255, 255))
    pic.save(OUT / f'{name}.png')
    print(OUT / f'{name}.png')
