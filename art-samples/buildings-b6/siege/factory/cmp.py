"""cmp.py : Flash beside a 3D picture of the same canvas, cropped (Flash px box) and enlarged.
./py cmp.py <flash 1x> <3d png> <out> x0,y0,x1,y1 [zoom of the 1x picture]"""
import sys
from PIL import Image
a = sys.argv[1:]
x0, y0, x1, y1 = map(int, a[3].split(","))
z = int(a[4]) if len(a) > 4 else 6
fx, fy = -84, -104
f = Image.open(a[0]).convert("RGBA")
r = Image.open(a[1]).convert("RGBA")
k = r.width // f.width
box = (x0 - fx, y0 - fy, x1 - fx, y1 - fy)
w, h = (x1 - x0) * z, (y1 - y0) * z
out = Image.new("RGBA", (w * 2 + 8, h), (112, 142, 72, 255))
out.alpha_composite(f.crop(box).resize((w, h), Image.NEAREST), (0, 0))
out.alpha_composite(r.crop(tuple(v * k for v in box)).resize((w, h), Image.LANCZOS), (w + 8, 0))
out.save(a[2])
