"""Long straight edges of a yard picture's STRUCTURE (the base slab left out), found with a Hough transform, and
sorted by direction. The yard is a parallel 2:1 corner view: ground-parallel edges run at slope 0.5 (26.6 deg)
left and right, uprights are vertical, nothing ground-parallel is level, and parallel edges stay parallel.

  python lines.py <pic> [...]                 one line of numbers per picture
  python lines.py --sheet out.png <pic> ...   plus a sheet: picture | found lines drawn on it (green: 2:1 within
                                              +-0.08, blue: vertical, red: level (face-on), orange: other slope)
Numbers: share of long-edge length that is 2:1 / vertical / level / other; median slope of the left-rising and
right-rising oblique edges (want 0.50 / 0.50) and their spread (interquartile range; converging lines widen it);
'top' = how far a horizontal square edge's visible top surface opens (see note in README of decor-angle).
"""
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, __import__("os").path.dirname(__file__))
from angles import base_geom


def edge_pixels(im, keep=0.25):
    w, h = im.size
    g = Image.new("RGBA", im.size, (128, 128, 128, 255)); g.alpha_composite(im)
    L = g.convert("L").filter(ImageFilter.GaussianBlur(0.8)).load(); A = im.getchannel("A").load()
    geo = base_geom(im); bx, by, t = geo["bx"], geo["by"], geo["t"]
    band = 6
    def in_base(x, y):
        d = abs(x - bx) * 0.5
        lo = by - d; tf = by - t - d
        return y >= tf - band and y <= lo + 3
    px = []
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if A[x, y] < 128 and A[x - 1, y] < 128 and A[x + 1, y] < 128 and A[x, y - 1] < 128 and A[x, y + 1] < 128: continue
            if in_base(x, y): continue
            gx = (L[x + 1, y - 1] + 2 * L[x + 1, y] + L[x + 1, y + 1]) - (L[x - 1, y - 1] + 2 * L[x - 1, y] + L[x - 1, y + 1])
            gy = (L[x - 1, y + 1] + 2 * L[x, y + 1] + L[x + 1, y + 1]) - (L[x - 1, y - 1] + 2 * L[x, y - 1] + L[x + 1, y - 1])
            m = math.hypot(gx, gy)
            if m < 8: continue
            px.append((m, x, y, math.atan2(gy, gx)))
    px.sort(reverse=True)
    return px[: int(len(px) * keep)], geo


def hough_lines(px, w, h, min_len, max_lines=60, gap=3):
    """theta = normal direction (deg 0..179); rho = x cos + y sin"""
    cs = [(math.cos(math.radians(t)), math.sin(math.radians(t))) for t in range(180)]
    acc = {}
    votes = []
    for i, (m, x, y, gd) in enumerate(px):
        t0 = int(round(math.degrees(gd))) % 180
        vv = []
        for dt in range(-6, 7):
            t = (t0 + dt) % 180
            r = int(round(x * cs[t][0] + y * cs[t][1]))
            acc[(t, r)] = acc.get((t, r), 0) + 1
            vv.append((t, r))
        votes.append(vv)
    alive = [True] * len(px)
    segs = []
    tried = set()
    for _ in range(max_lines * 4):
        if not acc: break
        (t, r), n = max(acc.items(), key=lambda kv: kv[1])
        if n < min_len * 0.6: break
        c, s = cs[t]
        # pixels on this line with a matching gradient direction
        on = []
        for i, (m, x, y, gd) in enumerate(px):
            if not alive[i]: continue
            if abs(x * c + y * s - r) > 1.5: continue
            dg = abs(((math.degrees(gd) - t) + 90) % 180 - 90)
            if dg > 12: continue
            on.append((-x * s + y * c, i))   # position along the line
        on.sort()
        runs, cur = [], []
        for p, i in on:
            if cur and p - cur[-1][0] > gap:
                runs.append(cur); cur = []
            cur.append((p, i))
        if cur: runs.append(cur)
        got = False
        for run in runs:
            if run[-1][0] - run[0][0] >= min_len:
                pts = [(px[i][1], px[i][2]) for _, i in run]
                segs.append(fit_seg(pts)); got = True
            for _, i in run:
                alive[i] = False
                for k in votes[i]:
                    acc[k] -= 1
                    if acc[k] <= 0: del acc[k]
        if not got:
            acc.pop((t, r), None)
        if len(segs) >= max_lines: break
    return segs


def fit_seg(pts):
    n = len(pts); mx = sum(p[0] for p in pts) / n; my = sum(p[1] for p in pts) / n
    sxx = sum((p[0] - mx) ** 2 for p in pts); syy = sum((p[1] - my) ** 2 for p in pts)
    sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
    ang = 0.5 * math.atan2(2 * sxy, sxx - syy)   # direction of the line
    dx, dy = math.cos(ang), math.sin(ang)
    proj = [(p[0] - mx) * dx + (p[1] - my) * dy for p in pts]
    a, b = min(proj), max(proj)
    return ((mx + a * dx, my + a * dy), (mx + b * dx, my + b * dy))


def seg_info(seg):
    (x0, y0), (x1, y1) = seg
    L = math.hypot(x1 - x0, y1 - y0)
    if abs(x1 - x0) < 1e-6: return L, float("inf"), 0
    k = (y0 - y1) / (x1 - x0)   # rise to the right, screen y down
    return L, k, (1 if k > 0 else -1)


def classify(k):
    a = abs(k)
    if a > 6: return "vert"
    if 0.42 <= a <= 0.58: return "iso"
    if a < 0.18: return "level"
    return "other"


def analyse(path, min_len=None):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    if min_len is None: min_len = max(14, round(w * 0.075))
    px, geo = edge_pixels(im)
    segs = hough_lines(px, w, h, min_len)
    info = [(s,) + seg_info(s) for s in segs]
    tot = sum(i[1] for i in info) or 1
    share = {c: sum(i[1] for i in info if classify(i[2]) == c) / tot for c in ("iso", "vert", "level", "other")}
    def stats(sign):
        sl = sorted((abs(i[2]), i[1]) for i in info if i[3] == sign and 0.18 <= abs(i[2]) <= 6)
        if not sl: return float("nan"), float("nan"), 0
        tw = sum(l for _, l in sl)
        def q(f):
            acc = 0
            for v, l in sl:
                acc += l
                if acc >= f * tw: return v
            return sl[-1][0]
        return q(0.5), q(0.75) - q(0.25), tw
    return dict(im=im, geo=geo, segs=info, share=share, R=stats(1), L=stats(-1), n=len(info))


COL = {"iso": (40, 230, 70), "vert": (70, 150, 255), "level": (255, 40, 40), "other": (255, 165, 0)}


def fmt(name, r):
    s = r["share"]
    return (f"{name:34s} 2:1 {s['iso']*100:3.0f}%  vert {s['vert']*100:3.0f}%  LEVEL {s['level']*100:3.0f}%  "
            f"other {s['other']*100:3.0f}% | left-rising med {r['L'][0]:.2f} iqr {r['L'][1]:.2f} | "
            f"right-rising med {r['R'][0]:.2f} iqr {r['R'][1]:.2f} | {r['n']} lines")


def draw(r, scale):
    im = r["im"]; w, h = im.size
    bg = Image.new("RGBA", im.size, (128, 128, 128, 255)); bg.alpha_composite(im)
    big = bg.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    ov = big.copy(); dim = Image.new("RGBA", big.size, (0, 0, 0, 120)); ov.alpha_composite(dim)
    d = ImageDraw.Draw(ov)
    for s, L, k, sg in r["segs"]:
        (x0, y0), (x1, y1) = s
        d.line([(x0 * scale, y0 * scale), (x1 * scale, y1 * scale)], fill=COL[classify(k)] + (255,), width=3)
    pair = Image.new("RGBA", (big.width * 2 + 8, big.height), (20, 20, 20, 255))
    pair.paste(big, (0, 0)); pair.paste(ov, (big.width + 8, 0))
    return pair


if __name__ == "__main__":
    args = sys.argv[1:]; out = None
    if args and args[0] == "--sheet": out = args[1]; args = args[2:]
    rows = []
    for p in args:
        r = analyse(p); name = p.split("/")[-1]
        print(fmt(name, r))
        if out:
            sc = 300 / max(r["im"].size)
            rows.append((draw(r, sc), fmt(name, r)))
    if out:
        W = max(p.width for p, _ in rows) + 20; H = sum(p.height + 30 for p, _ in rows) + 10
        s = Image.new("RGB", (max(W, 1100), H), (16, 16, 16)); d = ImageDraw.Draw(s); y = 10
        for p, t in rows:
            d.text((10, y), t, fill=(255, 255, 255)); s.paste(p.convert("RGB"), (10, y + 16)); y += p.height + 30
        s.save(out)
