"""fitlocal.py: the figures' zone does not follow the whole-picture fit (Codex drew the pedestal a little higher than
the block-out), so register again on a window around the pedestal cap and the group only (game @2x rows Y0-Y1):
IoU of alpha + of the bronze masks. Overwrites fit.json's entries; whole-picture fit kept in fit-whole.json."""
import colorsys, json, shutil, os
from PIL import Image, ImageChops
A = "../../server/public/assets/buildings/decorations/wonders/"
G = {"classic": A + "rizal-monument@2x.png", "modern": A + "rizal-monument.modern@2x.webp"}
if not os.path.exists("fit-whole.json"): shutil.copy("fit.json", "fit-whole.json")
fw = json.load(open("fit-whole.json"))
Y0, Y1 = 60, 150


def cnt(m): return m.histogram()[255]


def bronzeish(im):
    px = im.load(); m = Image.new("L", im.size, 0); mp = m.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            if a < 128: continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            if s > 0.2 and 10 <= h * 360 <= 60 and v < 0.45: mp[x, y] = 255
    return m


bo = Image.open("bo/old-ns.png").convert("RGBA")
bom = bronzeish(bo.crop((0, 300, 1024, 620)))
bom_full = Image.new('L', bo.size, 0); bom_full.paste(bom, (0, 300)); bom = bom_full
out = {}
for look, f in G.items():
    g = Image.open(f).convert("RGBA"); W, H = g.size
    box = (0, Y0, W, Y1)
    gb = bronzeish(g).crop(box).convert("1")
    sx0, sy0, tx0, ty0 = fw[look]
    best = None
    for ds in [k / 100 for k in range(-4, 13, 2)]:
        sx = sx0 * (1 + ds); sy = sy0 * (1 + ds)
        # keep the obelisk axis: pivot the scale around the picture's centre column / row 100
        cx, cy = (W / 2 - tx0) / sx0, (100 - ty0) / sy0
        for dx in range(-8, 9):
            for dy in range(-16, 9):
                tx = W / 2 - cx * sx + dx * 0.5; ty = 100 - cy * sy + dy * 0.5
                aff = (1 / sx, 0, -tx / sx, 0, 1 / sy, -ty / sy)
                mb = bom.transform((W, H), Image.AFFINE, aff, Image.BILINEAR).point(lambda v: 255 if v > 128 else 0).crop(box).convert("1")
                sc = cnt(ImageChops.logical_and(mb, gb).convert("L")) / max(1, cnt(ImageChops.logical_or(mb, gb).convert("L")))
                if best is None or sc > best[0]: best = (sc, sx, sy, tx, ty, ds, dx, dy)
    print(look, "bronze IoU %.3f" % best[0], "ds %.2f dx %.1f dy %.1f" % (best[5], best[6] * 0.5, best[7] * 0.5))
    out[look] = list(best[1:5])
json.dump(out, open("fit.json", "w"))
