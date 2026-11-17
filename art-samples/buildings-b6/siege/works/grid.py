"""grid.py : a picture on the canvas, enlarged with a labelled grid in Flash px, to read coordinates off.
./py grid.py <1x canvas png> <out.png> x0,y0,x1,y1 [zoom] [fx,fy]   (box in Flash px; fx,fy = the canvas's top left in Flash px)
An optional 5th picture argument (ids png at any whole multiple) draws its region borders on top."""
import sys
import numpy as np
from PIL import Image, ImageDraw
a = sys.argv[1:]
x0, y0, x1, y1 = map(int, a[2].split(","))
z = int(a[3]) if len(a) > 3 else 8
fx, fy = map(int, a[4].split(",")) if len(a) > 4 else (-75, -95)
im = Image.open(a[0]).convert("RGBA")
bg = Image.new("RGBA", im.size, (112, 142, 72, 255))
bg.alpha_composite(im)
c = bg.crop((x0 - fx, y0 - fy, x1 - fx, y1 - fy)).resize(((x1 - x0) * z, (y1 - y0) * z), Image.NEAREST)
if len(a) > 5:
    ids = Image.open(a[5]).convert("RGB")
    k = ids.width // im.width
    ids = np.array(ids.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)).resize(c.size, Image.NEAREST)).astype(int)
    e = np.zeros(ids.shape[:2], bool)
    e[:, 1:] |= (ids[:, 1:] != ids[:, :-1]).any(-1)
    e[1:, :] |= (ids[1:, :] != ids[:-1, :]).any(-1)
    arr = np.array(c)
    arr[e] = (0, 255, 255, 255)
    c = Image.fromarray(arr)
d = ImageDraw.Draw(c)
for x in range((x0 // 10) * 10, x1 + 1, 10):
    if x >= x0:
        d.line([((x - x0) * z, 0), ((x - x0) * z, c.height)], fill=(255, 255, 255, 110), width=1)
        d.text(((x - x0) * z + 2, 1), str(x), fill=(255, 255, 0, 255))
for y in range((y0 // 10) * 10, y1 + 1, 10):
    if y >= y0:
        d.line([(0, (y - y0) * z), (c.width, (y - y0) * z)], fill=(255, 255, 255, 110), width=1)
        d.text((1, (y - y0) * z + 2), str(y), fill=(255, 255, 0, 255))
c.save(a[1])
