# Quick 30 px preview of icons (in order given) on both slot colours, normal + locked, shown 3x with NEAREST.
import sys
from PIL import Image, ImageOps
fs = sys.argv[2:]
def locked(im):
    g = ImageOps.grayscale(im).convert("RGBA"); r = Image.blend(im, g, 0.8)
    r.putalpha(im.getchannel("A").point(lambda v: int(v * 0.35))); return r
out = Image.new("RGBA", (len(fs) * 100 + 10, 4 * 100 + 10), (0, 0, 0, 255))
for c, f in enumerate(fs):
    im = Image.open(f).convert("RGBA").resize((96, 96), Image.LANCZOS).resize((30, 30), Image.LANCZOS)
    for r, (bg, lk) in enumerate([((66, 70, 68), 0), ((66, 70, 68), 1), ((255, 242, 194), 0), ((255, 242, 194), 1)]):
        t = Image.new("RGBA", (30, 30), bg + (255,)); t.alpha_composite(locked(im) if lk else im)
        tile = Image.new("RGBA", (100, 100), bg + (255,)); tile.alpha_composite(t.resize((90, 90), Image.NEAREST), (5, 5))
        out.alpha_composite(tile, (c * 100 + 5, r * 100 + 5))
out.save(sys.argv[1])
