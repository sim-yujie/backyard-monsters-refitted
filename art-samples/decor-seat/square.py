"""Small fix-up of a base that is nearly square to the yard grid: find the base's two lower edges (line fits on
the lower outline of the alpha), then stretch each side of the front corner sideways and shift columns up/down
so both edges run at exactly 2:1 and the front corner sits in the middle of the base. Only for residuals of a
few percent; a base drawn turned needs a redraw. The result is padded so the front corner is the picture's
centre (the yard centres pictures on the origin).

    python square.py <in.full.png> <out.full.png>      prints the found and fixed numbers and the base width
"""
import sys
from PIL import Image


def lower_outline(im):
    a = im.getchannel("A").load()
    w, h = im.size
    return [max((y for y in range(h) if a[x, y] > 128), default=None) for x in range(w)]


def fit(xs, ys):
    n = len(xs); mx = sum(xs) / n; my = sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    k = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return k, my - k * mx


def robust(xs, ys):
    k, c = fit(xs, ys)
    for _ in range(3):
        keep = [(x, y) for x, y in zip(xs, ys) if abs(y - (k * x + c)) < 3]
        if len(keep) < 10:
            break
        k, c = fit([p[0] for p in keep], [p[1] for p in keep])
    return k, c


def edges(im):
    g = lower_outline(im)
    cols = [x for x in range(len(g)) if g[x] is not None]
    x0, x1 = cols[0], cols[-1]
    bx0 = max(cols, key=lambda x: (g[x], -abs(x - (x0 + x1) / 2)))
    # left edge fit over the middle of the left side, right likewise
    def side(a, b):
        lo, hi = a + (b - a) * 0.15, b - (b - a) * 0.15
        xs = [x for x in cols if lo <= x <= hi]
        return robust(xs, [g[x] for x in xs])
    kl, cl = side(x0, bx0)
    kr, cr = side(bx0, x1)
    bx = (cr - cl) / (kl - kr); by = kl * bx + cl
    # base corners: furthest columns still on each line
    lx = bx
    for x in range(int(bx), x0 - 1, -1):
        if g[x] is not None and abs(g[x] - (kl * x + cl)) < 4: lx = x
        elif bx - x > 0.5 * (bx - x0): break
    rx = bx
    for x in range(int(bx), x1 + 1):
        if g[x] is not None and abs(g[x] - (kr * x + cr)) < 4: rx = x
        elif x - bx > 0.5 * (x1 - bx): break
    return dict(sl=kl, sr=-kr, bx=bx, by=by, lx=lx, rx=rx, x0=x0, x1=x1)


def square(im):
    e = edges(im)
    bx, by, lx, rx = e["bx"], e["by"], e["lx"], e["rx"]
    A = (rx - lx) / 2
    sxL, sxR = A / (bx - lx), A / (rx - bx)   # sideways stretch of each side
    w, h = im.size
    # new x of a source x: left side about bx scaled by sxL, right by sxR; front corner lands at X0
    left_w = round(bx * sxL); right_w = round((w - bx) * sxR)
    L = im.crop((0, 0, round(bx), h)).resize((left_w, h), Image.LANCZOS)
    R = im.crop((round(bx), 0, w, h)).resize((right_w, h), Image.LANCZOS)
    pad = 40
    tmp = Image.new("RGBA", (left_w + right_w, h + 2 * pad), (0, 0, 0, 0))
    tmp.alpha_composite(L, (0, pad)); tmp.alpha_composite(R, (left_w, pad))
    X0 = left_w
    out = Image.new("RGBA", tmp.size, (0, 0, 0, 0))
    for x in range(tmp.width):
        d = x - X0
        # source edge height at this column (in source units) vs the 2:1 target
        if d < 0:
            src = e["sl"] * (d / sxL)
        else:
            src = -e["sr"] * (d / sxR)
        tgt = -0.5 * abs(d)
        shift = round(tgt - src)
        col = tmp.crop((x, 0, x + 1, tmp.height))
        out.paste(col, (x, shift))
    bb = out.getbbox()
    # pad so the front corner is the centre
    half = max(X0 - bb[0], bb[2] - X0)
    res = Image.new("RGBA", (2 * half, bb[3] - bb[1]), (0, 0, 0, 0))
    res.alpha_composite(out.crop((X0 - half, bb[1], X0 + half, bb[3])) if False else out.crop(bb), (half - (X0 - bb[0]), 0))
    return res, e, 2 * A


if __name__ == "__main__":
    im = Image.open(sys.argv[1]).convert("RGBA")
    res, e, base = square(im)
    res.save(sys.argv[2])
    e2 = edges(res)
    print(f"{sys.argv[1].split('/')[-1]}: found L {e['sl']:.3f} R {e['sr']:.3f} corner {e['bx'] - (e['lx'] + e['rx']) / 2:+.1f}"
          f" -> L {e2['sl']:.3f} R {e2['sr']:.3f} corner {e2['bx'] - (e2['lx'] + e2['rx']) / 2:+.1f}"
          f" off-centre {e2['bx'] - res.width / 2:+.1f}; base {e2['rx'] - e2['lx']} of {res.width}")
