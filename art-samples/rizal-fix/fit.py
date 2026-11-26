"""fit.py: register the no-slab block-out (bo/old-ns.png, 1024) to each look's game picture (@2x) by an axis-aligned
scale + offset (bbox start, then an IoU search on the alpha masks). Writes fit.json {look: [sx, sy, tx, ty]} so that
game_xy = bo_xy * s + t."""
import json
from PIL import Image, ImageChops


def cnt(m): return m.histogram()[255]
A = "../../server/public/assets/buildings/decorations/wonders/"
G = {"classic": A + "rizal-monument@2x.png", "modern": A + "rizal-monument.modern@2x.webp"}
bo = Image.open("bo/old-ns.png").convert("RGBA")
x0, y0, x1, y1 = bo.getchannel("A").point(lambda v: 255 if v > 128 else 0).getbbox()
out = {}
for look, f in G.items():
    g = Image.open(f).convert("RGBA"); W, H = g.size
    ga = g.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    gx0, gy0, gx1, gy1 = ga.getbbox()
    best = None
    for dsx in [k / 200 for k in range(-6, 7)]:
        for dsy in [k / 200 for k in range(-6, 7)]:
            sx = (gx1 - gx0) / (x1 - x0) * (1 + dsx); sy = (gy1 - gy0) / (y1 - y0) * (1 + dsy)
            for dx in range(-4, 5):
                for dy in range(-4, 5):
                    tx = gx0 - x0 * sx + dx * 0.5; ty = gy0 - y0 * sy + dy * 0.5
                    # resample bo alpha into game frame
                    m = bo.getchannel("A").transform((W, H), Image.AFFINE, (1 / sx, 0, -tx / sx, 0, 1 / sy, -ty / sy), Image.BILINEAR)
                    ma = m.point(lambda v: 255 if v > 128 else 0)
                    iou = cnt(ImageChops.logical_and(ma.convert('1'), ga.convert('1')).convert('L')) / cnt(ImageChops.logical_or(ma.convert('1'), ga.convert('1')).convert('L'))
                    if best is None or iou > best[0]: best = (iou, sx, sy, tx, ty)
    print(look, "IoU %.4f" % best[0], best[1:])
    out[look] = list(best[1:])
json.dump(out, open("fit.json", "w"))
