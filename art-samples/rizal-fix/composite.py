"""composite.py <look> <codex png> <out @2x png>: put Codex's new right-hand group into the CURRENT game picture.
Only a hand-drawn zone right of Rizal (the old boys, the old leaves and pot, the new figures and the stone around
them) is taken from Codex; every other pixel stays the current picture's. Codex's picture is first registered to the
guide canvas (shift + scale search on the stone outside the zone), then brought back to @2x size."""
import json, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageStat
look, src, dst = sys.argv[1:4]
A = "../../server/public/assets/buildings/decorations/wonders/"
G = {"classic": A + "rizal-monument@2x.png", "modern": A + "rizal-monument.modern@2x.webp"}
cur = Image.open(G[look]).convert("RGBA"); W, H = cur.size
meta = json.load(open(f"guide/{look}.json")); F, ox, oy = meta["F"], meta["ox"], meta["oy"]
ZONE = [(98, 70), (131, 70), (148, 116), (148, 130), (113, 143), (94, 143), (88, 135), (89, 118), (91, 104), (97, 99)]
zone = Image.new("L", (W, H), 0); ImageDraw.Draw(zone).polygon(ZONE, fill=255)
cx = Image.open(src).convert("RGB").resize((1024, 1024), Image.LANCZOS)
ref = Image.open(f"guide/{look}-current.png").convert("RGB")
# registration: compare at 1/2 scale on the canvas, outside the zone (zone scaled into canvas, widened)
zc = Image.new("L", (1024, 1024), 0); zc.paste(zone.resize((W * F, H * F)), (ox, oy)); zc = zc.filter(ImageFilter.MaxFilter(41))
keep = ImageChops.invert(zc)
best = None
for s in (0.99, 0.995, 1.0, 1.005, 1.01):
    for dx in range(-8, 9, 2):
        for dy in range(-8, 9, 2):
            t = cx.transform((1024, 1024), Image.AFFINE, (1 / s, 0, (512 - dx) - 512 / s, 0, 1 / s, (512 - dy) - 512 / s), Image.BILINEAR)
            d = ImageChops.difference(t, ref).convert("L")
            e = ImageStat.Stat(d, keep).mean[0]
            if best is None or e < best[0]: best = (e, s, dx, dy)
e, s, dx, dy = best
for ddx in (-1, 0, 1):
    for ddy in (-1, 0, 1):
        t = cx.transform((1024, 1024), Image.AFFINE, (1 / s, 0, (512 - dx - ddx) - 512 / s, 0, 1 / s, (512 - dy - ddy) - 512 / s), Image.BILINEAR)
        ee = ImageStat.Stat(ImageChops.difference(t, ref).convert("L"), keep).mean[0]
        if ee < e: e, best = ee, (ee, s, dx + ddx, dy + ddy)
e, s, dx, dy = best
print(look, "registered: scale %.3f shift %d,%d  mean diff outside zone %.1f" % (s, dx, dy, e))
t = cx.transform((1024, 1024), Image.AFFINE, (1 / s, 0, (512 - dx) - 512 / s, 0, 1 / s, (512 - dy) - 512 / s), Image.BICUBIC)
big = t.crop((ox, oy, ox + W * F, oy + H * F))
# magenta key at 4x: alpha from the distance to magenta, de-spill the edge
px = big.load(); rgba = Image.new("RGBA", big.size); rp = rgba.load()
for y in range(big.height):
    for x in range(big.width):
        r, g, b = px[x, y]
        m = min(r, b) - g                       # how magenta-ish
        if m > 150: rp[x, y] = (0, 0, 0, 0); continue
        a = 255 if m < 60 else int(255 * (150 - m) / 90)
        if m > 20:                              # pull the magenta cast out of the edge
            k = min(r, b) - max(g, 0); r = max(g, r - k // 2); b = max(g, b - k // 2)
        rp[x, y] = (r, g, b, a)
# premultiplied downscale to @2x
r_, g_, b_, a_ = rgba.split()
def mul(c): return ImageChops.multiply(c, a_)
small = [mul(c).resize((W, H), Image.BOX) for c in (r_, g_, b_)]
asmall = a_.resize((W, H), Image.BOX)
cp = cur.load()
ap = asmall.load(); out_new = Image.new("RGBA", (W, H)); op = out_new.load(); sp = [c.load() for c in small]
for y in range(H):
    for x in range(W):
        a = ap[x, y]
        op[x, y] = (0, 0, 0, 0) if a == 0 else tuple(min(255, sp[i][x, y] * 255 // a) for i in range(3)) + (a,)
# de-spill: a magenta tint left on edges (red and blue both above green) comes out
for y in range(H):
    for x in range(W):
        r, g, b, a = op[x, y]
        k = min(r - g, b - g)
        if a and k > 0: op[x, y] = (r - k, g, b - k, a)
# take from Codex only what must change: the old group's polygons (guide.py GONE), the new figures (bronze-coloured
# pixels right of Rizal, widened 2 px) and pixels whose cover changed (stone <-> background); the rest of the zone
# keeps the current picture (Codex shifted the stone's tone in a block round its edit)
import colorsys
GONE = {"classic": [[(92, 104), (112, 104), (113, 124), (110, 138), (96, 140), (90, 134), (91, 118)],
                    [(114, 74), (127, 74), (128, 121), (114, 121)]],
        "modern": [[(91, 104), (113, 104), (115, 124), (112, 139), (96, 140), (89, 134), (90, 118)],
                   [(114, 74), (127, 74), (128, 121), (114, 121)]]}
take = Image.new("L", (W, H), 0); dt = ImageDraw.Draw(take)
for p in GONE[look]: dt.polygon(p, fill=255)
nb = Image.new("L", (W, H), 0); nbp = nb.load(); tp = take.load(); zp0 = zone.load()
for y in range(H):
    for x in range(99, W):
        r, g, b, a = op[x, y]
        if a > 128:
            h, sat, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            far = sum(abs(op[x, y][i] - cp[x, y][i]) for i in range(3)) > 45 or cp[x, y][3] < 128
            if sat > 0.3 and 15 <= h * 360 <= 50 and v < 0.45 and far and zp0[x, y]: nbp[x, y] = 255
        if (a > 128) != (cp[x, y][3] > 128): tp[x, y] = 255
nb = nb.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(3))   # drop lone pixels
nb.filter(ImageFilter.MaxFilter(3)).save(dst.replace('.png', '-figmask.png'))
nb = nb.filter(ImageFilter.MaxFilter(5))
take = ImageChops.lighter(take, nb)
zone = ImageChops.multiply(zone, take.filter(ImageFilter.MaxFilter(3)))
# tone match (gradient-domain): Codex shifted the stone's tone a little inside the zone, which showed as a patch.
# Solve for a smooth correction c (Laplace, Gauss-Seidel) on the zone's opaque pixels, c = current - new on the
# zone's border, so the new pixels keep their detail but meet the current picture without a step.
zp = zone.load()
inn = [(x, y) for y in range(H) for x in range(W) if zp[x, y] and op[x, y][3] == 255]
S = set(inn)
corr = {p: [0.0, 0.0, 0.0] for p in inn}
bnd = {}
for (x, y) in inn:
    for q in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        if q in S or not (0 <= q[0] < W and 0 <= q[1] < H): continue
        if cp[q][3] == 255 and op[q][3] == 255 and not zp[q]:
            bnd[q] = [cp[q][i] - op[q][i] for i in range(3)]
for it in range(1500):
    for p in inn:
        x, y = p; acc = [0.0, 0.0, 0.0]; n = 0
        for q in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            v = corr.get(q) or bnd.get(q)
            if v is None: continue
            acc[0] += v[0]; acc[1] += v[1]; acc[2] += v[2]; n += 1
        if n: corr[p] = [a / n for a in acc]
def clamp(v): return max(0, min(255, int(round(v))))
for (x, y), c in corr.items():
    r, g, b, a = op[x, y]; op[x, y] = (clamp(r + c[0]), clamp(g + c[1]), clamp(b + c[2]), a)
for y in range(H):              # edge pixels (part alpha): the mean correction of their solved neighbours
    for x in range(W):
        if not zp[x, y] or (x, y) in S or op[x, y][3] == 0: continue
        cs = [corr[q] for q in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)) if q in corr]
        if cs:
            r, g, b, a = op[x, y]; m = [sum(c[i] for c in cs) / len(cs) for i in range(3)]
            op[x, y] = (clamp(r + m[0]), clamp(g + m[1]), clamp(b + m[2]), a)
print("tone match: %d px, %d border px" % (len(inn), len(bnd)))
# blend into the current picture inside the zone (feathered 1.5 px)
zm = zone
res = Image.composite(out_new, cur, zm)
res.save(dst)
out_new.save(dst.replace(".png", "-codexfull.png"))
