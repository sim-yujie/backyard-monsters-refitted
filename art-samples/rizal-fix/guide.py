"""guide.py <look> <layout>: the Codex input for one look and layout. The current game picture (@2x) at 4x on a 1024
magenta canvas, with the right-hand group (two boys + leaves and pot, polygons GONE) cut out and the new layout's clay figures from
the block-out pasted in, registered with fit.json. Also writes masks (game @2x frame) used by composite.py:
  masks/<layout>-old.png  bronze of the old group that goes away     masks/<layout>-new.png  bronze of the new figures
    python3 guide.py classic A  ->  guide/classic-A.png"""
import colorsys, json, os, sys
from PIL import Image, ImageChops, ImageFilter
look, lay = sys.argv[1], sys.argv[2]
A = "../../server/public/assets/buildings/decorations/wonders/"
G = {"classic": "before/rizal-monument@2x.png", "modern": "before/rizal-monument.modern@2x.webp"}   # the 24 Nov pictures (the game files change)
F, CAN = 4, 1024
sx, sy, tx, ty = json.load(open("fit.json"))[look]
g = Image.open(G[look]).convert("RGBA"); W, H = g.size


def to_game(im, size=None):
    """block-out (1024) -> game @2x frame (or a multiple of it)"""
    k = 1 if size is None else size[0] / W
    return im.transform(size or (W, H), Image.AFFINE, (1 / (sx * k), 0, -tx / sx, 0, 1 / (sy * k), -ty / sy), Image.BICUBIC)


def bronze(path):
    im = Image.open(path).convert("RGBA"); px = im.load(); m = Image.new("L", im.size, 0); mp = m.load()
    for y in range(300, 620):   # the figures (stars are near the top, the plaque below 680)
        for x in range(im.width):
            r, gg, b, a = px[x, y]
            if a < 128: continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, gg / 255, b / 255)
            if s > 0.2 and 10 <= h * 360 <= 60 and v < 0.5: mp[x, y] = 255
    return m


from PIL import ImageDraw
# what goes away, drawn by hand on the picture (game @2x px; the figures there do not follow the block-out closely):
# the two boys at the front-right corner, and the leaves and pot right of the obelisk
GONE = {"classic": [[(92, 104), (112, 104), (113, 124), (110, 138), (96, 140), (90, 134), (91, 118)],
                    [(114, 74), (127, 74), (128, 121), (114, 121)]],
        "modern": [[(91, 104), (113, 104), (115, 124), (112, 139), (96, 140), (89, 134), (90, 118)],
                   [(114, 74), (127, 74), (128, 121), (114, 121)]]}
old, new = bronze("bo/old-ns.png"), bronze(f"bo/{lay}-ns.png")
gone_g = Image.new("L", (W, H), 0); dg = ImageDraw.Draw(gone_g)
for p in GONE[look]: dg.polygon(p, fill=255)
added = ImageChops.subtract(new, old).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))
os.makedirs("masks", exist_ok=True); os.makedirs("guide", exist_ok=True)
gone_g.save(f"masks/{lay}-old-{look}.png")
to_game(new).point(lambda v: 255 if v > 64 else 0).save(f"masks/{lay}-new-{look}.png")

# 4x frame
BW, BH = W * F, H * F
big = g.resize((BW, BH), Image.LANCZOS)
bo = to_game(Image.open(f"bo/{lay}-ns.png").convert("RGBA"), (BW, BH))
gone4 = gone_g.resize((BW, BH), Image.NEAREST); add4 = to_game(added, (BW, BH)).filter(ImageFilter.MaxFilter(3))
patch = ImageChops.lighter(gone4, add4).point(lambda v: 255 if v > 64 else 0)
# fill the cut-out: inside the object's new outline (left of the obelisk's right edge x=112, or on the pedestal top,
# below its back-right edge from (112, 103.5) to the right corner (145, 120)) a smooth fill from the stone around
# (normalised blur at growing radii); outside it magenta. Then the new layout's clay figures from the block-out on top.
def inside(xg, yg): return xg <= 112.5 or yg >= 120 - (145 - xg) / 2
known = Image.new("L", (BW, BH), 0); kp = known.load(); ap = big.getchannel("A").load(); pm = patch.load()
for y in range(BH):
    for x in range(BW):
        if ap[x, y] > 200 and not pm[x, y]: kp[x, y] = 255
rgb = big.convert("RGB"); fill = rgb.copy()
blank = Image.new("L", (BW, BH), 0)
got = known.copy()
for r in (4, 8, 16, 32, 64):
    num = Image.composite(rgb, Image.new("RGB", (BW, BH)), known).filter(ImageFilter.BoxBlur(r))
    den = known.filter(ImageFilter.BoxBlur(r))
    np_, dp, fp, gp2 = num.load(), den.load(), fill.load(), got.load()
    for y in range(BH):
        for x in range(BW):
            if pm[x, y] and not gp2[x, y] and dp[x, y] > 8:
                c = np_[x, y]; fp[x, y] = tuple(min(255, int(v * 255 / dp[x, y])) for v in c); gp2[x, y] = 255
out = Image.new("RGBA", (BW, BH), (255, 0, 255, 255)); out.alpha_composite(big); op = out.load(); fp = fill.load()
bp = bo.load(); add4p = add4.load()
for y in range(BH):
    for x in range(BW):
        if not pm[x, y]: continue
        if add4p[x, y] and bp[x, y][3] > 128: op[x, y] = bp[x, y][:3] + (255,); continue   # new clay figure
        op[x, y] = fp[x, y] + (255,) if inside(x / F, y / F) else (255, 0, 255, 255)
can = Image.new("RGB", (CAN, CAN), (255, 0, 255))
ox, oy = (CAN - BW) // 2, (CAN - BH) // 2
flat = Image.new("RGBA", (BW, BH), (255, 0, 255, 255)); flat.alpha_composite(out)
can.paste(flat.convert("RGB"), (ox, oy))
can.save(f"guide/{look}-{lay}.png")
# the unchanged current picture on the same canvas (the reference "before")
can2 = Image.new("RGB", (CAN, CAN), (255, 0, 255)); f2 = Image.new("RGBA", (BW, BH), (255, 0, 255, 255)); f2.alpha_composite(big)
can2.paste(f2.convert("RGB"), (ox, oy)); can2.save(f"guide/{look}-current.png")
json.dump({"F": F, "ox": ox, "oy": oy, "W": W, "H": H}, open(f"guide/{look}.json", "w"))
print(look, lay, "canvas offset", ox, oy)
