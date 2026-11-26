"""Camera check for yard pictures: which way do the STRUCTURE's own edges run?

The yard is a parallel 2:1 projection seen from a corner: every horizontal edge that runs along the grid shows at
slope +-0.5 (+-26.6 deg), verticals stay vertical, and NO ground-parallel edge is level on screen (a level edge
means a facade turned face-on to the camera). This takes Sobel edges of the picture (over grey), leaves out a band
round the base slab (its outline and the front edges of its top face), and sorts the edge strength by direction:

  iso    within 6 deg of +-26.6 (slope 0.40-0.62)        : on the grid, as it should be
  vert   within 8 deg of vertical                        : walls' upright edges, as they should be
  level  within 10 deg of level (slope < 0.18)           : a face-on facade, or a low eye level
  other  everything else (steep slopes 0.62-6 and shallow 0.18-0.40): perspective lines, roofs, curves

For the left-rising and right-rising edges it also gives the weighted median slope in the upper and lower half of
the structure: in a parallel projection both halves match; converging lines (perspective) make them differ.

    python angles.py <pic> [...]             numbers
    python angles.py --sheet out.png <pic>   also a picture with the edges painted by class
         (green iso, blue vertical, red level, orange other) beside the picture, with true 2:1 guide lines
"""
import math
import sys
from PIL import Image, ImageDraw

ISO = math.degrees(math.atan(0.5))


def base_geom(im):
    a = im.getchannel("A").load(); w, h = im.size
    low = [max((y for y in range(h) if a[x, y] > 128), default=None) for x in range(w)]
    cols = [x for x in range(w) if low[x] is not None]
    by = max(low[x] for x in cols)
    bxs = [x for x in cols if low[x] == by]; bx = sum(bxs) / len(bxs)
    lx, rx = cols[0], cols[-1]
    top = lambda x: min((y for y in range(h) if a[x, y] > 128), default=None)
    # slab thickness: at the far corners the only thing above the lower outline is the slab's top-face corner
    ts = []
    for x in (lx + 3, rx - 3):
        t = top(x)
        if t is not None: ts.append(low[x] - t)
    t = max(4, min(ts)) if ts else 12
    return dict(bx=bx, by=by, lx=lx, rx=rx, t=t, low=low)


def classify(ang):
    """ang in deg, (-90, 90], positive = rising to the right"""
    aa = abs(ang)
    if abs(aa - ISO) <= 6: return "iso"
    if aa >= 82: return "vert"
    if aa <= 10: return "level"
    return "other"


def analyse(path, keep=0.22):
    im = Image.open(path).convert("RGBA"); w, h = im.size
    g = Image.new("RGBA", im.size, (128, 128, 128, 255)); g.alpha_composite(im)
    L = g.convert("L").load(); A = im.getchannel("A").load()
    geo = base_geom(im); bx, by, t = geo["bx"], geo["by"], geo["t"]
    band = 7
    def in_base_band(x, y):
        d = abs(x - bx) * 0.5
        lo = by - d                     # lower outline
        tf = by - t - d                 # top face front edges
        return (lo - band <= y <= lo + 3) or abs(y - tf) <= band or (tf < y < lo)
    px = []
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if A[x, y] < 200 and all(A[x + i, y + j] < 200 for i in (-1, 1) for j in (-1, 1)): continue
            if in_base_band(x, y): continue
            gx = (L[x + 1, y - 1] + 2 * L[x + 1, y] + L[x + 1, y + 1]) - (L[x - 1, y - 1] + 2 * L[x - 1, y] + L[x - 1, y + 1])
            gy = (L[x - 1, y + 1] + 2 * L[x, y + 1] + L[x + 1, y + 1]) - (L[x - 1, y - 1] + 2 * L[x, y - 1] + L[x + 1, y - 1])
            m = math.hypot(gx, gy)
            if m < 1: continue
            # edge direction is perpendicular to the gradient; screen y is down, so flip for "rising"
            dx, dy = -gy, gx
            ang = math.degrees(math.atan2(-dy, dx))
            if ang <= -90: ang += 180
            if ang > 90: ang -= 180
            px.append((m, x, y, ang))
    px.sort(reverse=True)
    px = px[: max(50, int(len(px) * keep))]
    tot = sum(p[0] for p in px)
    cls = {"iso": 0, "vert": 0, "level": 0, "other": 0}
    for m, x, y, ang in px: cls[classify(ang)] += m
    ys = [p[2] for p in px]; ymid = (min(ys) + max(ys)) / 2
    def med_slope(sel):
        s = sorted(sel);
        if not s: return float("nan")
        tw = sum(m for _, m in s); acc = 0
        for v, m in s:
            acc += m
            if acc >= tw / 2: return v
    oblique = lambda ang, sign: 10 < sign * ang < 60
    res = dict(cls={k: v / tot for k, v in cls.items()}, geo=geo, px=px)
    for half, f in (("up", lambda y: y < ymid), ("low", lambda y: y >= ymid)):
        for side, sign in (("R", 1), ("L", -1)):
            sel = [(math.tan(math.radians(abs(a))), m) for m, x, y, a in px if f(y) and oblique(a, sign)]
            res[f"{side}{half}"] = med_slope(sel)
    return res, im


COL = {"iso": (40, 220, 60), "vert": (60, 140, 255), "level": (255, 40, 40), "other": (255, 160, 0)}


def sheet_row(path, label, scale=1.5):
    r, im = analyse(path)
    w, h = im.size
    bg = Image.new("RGBA", im.size, (128, 128, 128, 255)); bg.alpha_composite(im)
    ed = Image.new("RGBA", im.size, (24, 24, 24, 255)); ep = ed.load()
    for m, x, y, a in r["px"]: ep[x, y] = COL[classify(a)] + (255,)
    geo = r["geo"]; d = ImageDraw.Draw(ed)
    # true 2:1 guides through the base's front corner and every 30 px up
    for k in range(0, h + w, 30):
        y0 = geo["by"] - k
        d.line([(geo["bx"] - w, y0 - w / 2), (geo["bx"], y0), (geo["bx"] + w, y0 - w / 2)], fill=(255, 255, 255, 40), width=1)
    pair = Image.new("RGBA", (2 * w + 6, h), (24, 24, 24, 255)); pair.paste(bg, (0, 0)); pair.alpha_composite(ed, (w + 6, 0))
    pair = pair.resize((int(pair.width * scale), int(pair.height * scale)), Image.NEAREST)
    c = r["cls"]
    txt = (f"{label}  iso {c['iso']*100:.0f}%  vert {c['vert']*100:.0f}%  LEVEL {c['level']*100:.0f}%  other {c['other']*100:.0f}%"
           f"   slopes up L {r['Lup']:.2f} R {r['Rup']:.2f} / low L {r['Llow']:.2f} R {r['Rlow']:.2f}")
    return pair, txt, r


def fmt(p, r):
    c = r["cls"]
    return (f"{p.split('/')[-1]:36s} iso {c['iso']*100:4.0f}% vert {c['vert']*100:4.0f}% level {c['level']*100:4.0f}% "
            f"other {c['other']*100:4.0f}% | up L {r['Lup']:.2f} R {r['Rup']:.2f} | low L {r['Llow']:.2f} R {r['Rlow']:.2f} | t {r['geo']['t']}")


if __name__ == "__main__":
    args = sys.argv[1:]
    out = None
    if args[0] == "--sheet": out = args[1]; args = args[2:]
    rows = []
    for p in args:
        if out:
            pair, txt, r = sheet_row(p, p.split("/")[-1]); rows.append((pair, txt))
        else:
            r, _ = analyse(p)
        print(fmt(p, r))
    if out:
        W = max(p.width for p, _ in rows) + 20; H = sum(p.height + 30 for p, _ in rows) + 10
        s = Image.new("RGB", (W, H), (16, 16, 16)); d = ImageDraw.Draw(s); y = 10
        for p, t in rows:
            d.text((10, y), t, fill=(255, 255, 255)); s.paste(p.convert("RGB"), (10, y + 18)); y += p.height + 30
        s.save(out)
