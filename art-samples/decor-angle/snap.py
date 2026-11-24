"""Measure chosen edges precisely: for each rough segment (picked by eye on grid.py crops), fit a line to the
strongest edge pixels within +-R px of it whose gradient runs across the segment, and report the fitted slope.

  python snap.py spec.json out.png [scale]
spec.json: {"label": {"pic": path, "lines": [[x0, y0, x1, y1, "name"], ...]}, ...}
Slope = rise to the right in screen terms (y up), so 2:1 left face edges read -0.50 (falling to the right toward the
front corner) and right face edges +0.50. Printed and drawn on the picture (white label = |slope|).
"""
import json
import math
import sys
from PIL import Image, ImageDraw, ImageFilter

R = 3.0


def grad(im):
    g = Image.new("RGBA", im.size, (128, 128, 128, 255)); g.alpha_composite(im)
    return g.convert("L").filter(ImageFilter.GaussianBlur(0.6)).load()


def snap(im, L, seg):
    x0, y0, x1, y1 = seg
    w, h = im.size
    dx, dy = x1 - x0, y1 - y0; n = math.hypot(dx, dy); ux, uy = dx / n, dy / n; nx, ny = -uy, ux
    best = []
    steps = int(n)
    for s in range(steps + 1):
        cx, cy = x0 + ux * s, y0 + uy * s
        cand = None
        for k in range(-int(R * 2), int(R * 2) + 1):
            o = k / 2
            x, y = int(round(cx + nx * o)), int(round(cy + ny * o))
            if not (1 <= x < w - 1 and 1 <= y < h - 1): continue
            gx = (L[x + 1, y - 1] + 2 * L[x + 1, y] + L[x + 1, y + 1]) - (L[x - 1, y - 1] + 2 * L[x - 1, y] + L[x - 1, y + 1])
            gy = (L[x - 1, y + 1] + 2 * L[x, y + 1] + L[x + 1, y + 1]) - (L[x - 1, y - 1] + 2 * L[x, y - 1] + L[x + 1, y - 1])
            m = abs(gx * nx + gy * ny)   # strength across the segment
            if cand is None or m > cand[0]: cand = (m, cx + nx * o, cy + ny * o)
        if cand and cand[0] > 10: best.append(cand)
    if len(best) < 5: return None
    # weighted total least squares, two passes dropping outliers
    pts = best
    for _ in range(2):
        W = sum(p[0] for p in pts); mx = sum(p[0] * p[1] for p in pts) / W; my = sum(p[0] * p[2] for p in pts) / W
        sxx = sum(p[0] * (p[1] - mx) ** 2 for p in pts); syy = sum(p[0] * (p[2] - my) ** 2 for p in pts)
        sxy = sum(p[0] * (p[1] - mx) * (p[2] - my) for p in pts)
        a = 0.5 * math.atan2(2 * sxy, sxx - syy); ex, ey = math.cos(a), math.sin(a)
        res = [abs(-(p[1] - mx) * ey + (p[2] - my) * ex) for p in pts]
        keep = [p for p, r in zip(pts, res) if r <= 1.2]
        if len(keep) >= 5: pts = keep
    proj = [(p[1] - mx) * ex + (p[2] - my) * ey for p in pts]
    a0, a1 = min(proj), max(proj)
    seg = (mx + a0 * ex, my + a0 * ey, mx + a1 * ex, my + a1 * ey)
    slope = float("inf") if abs(ex) < 1e-6 else -ey / ex
    return seg, slope, len(pts) / (steps + 1)


def run(spec, out, scale=3.0):
    rows = []; results = {}
    for label, item in spec.items():
        im = Image.open(item["pic"]).convert("RGBA"); L = grad(im)
        bg = Image.new("RGBA", im.size, (128, 128, 128, 255)); bg.alpha_composite(im)
        big = bg.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        dim = Image.new("RGBA", big.size, (0, 0, 0, 90)); big.alpha_composite(dim)
        d = ImageDraw.Draw(big)
        results[label] = []
        for x0, y0, x1, y1, name in item["lines"]:
            r = snap(im, L, (x0, y0, x1, y1))
            if r is None:
                print(f"{label:28s} {name:24s} NOT FOUND"); continue
            (a, b, c, e), k, cover = r
            results[label].append((name, k))
            ak = abs(k)
            col = (60, 235, 80) if 0.44 <= ak <= 0.56 else (255, 60, 60) if ak < 0.30 else (255, 170, 0) if ak < 8 else (90, 160, 255)
            d.line([(a * scale, b * scale), (c * scale, e * scale)], fill=col + (255,), width=3)
            tx, ty = (a + c) / 2 * scale, (b + e) / 2 * scale - 14
            t = "vert" if ak > 8 else f"{ak:.2f}"
            d.rectangle([tx - 2, ty - 1, tx + 7 * len(t), ty + 11], fill=(0, 0, 0, 200))
            d.text((tx, ty), t, fill=(255, 255, 255, 255))
            print(f"{label:28s} {name:24s} slope {k:+.3f}  (|{ak:.2f}|, cover {cover:.0%})")
        rows.append((label, big))
    if out:
        W = sum(b.width + 12 for _, b in rows) + 12; H = max(b.height for _, b in rows) + 30
        s = Image.new("RGB", (W, H), (18, 18, 18)); dd = ImageDraw.Draw(s); x = 12
        for lab, b in rows:
            dd.text((x, 6), lab, fill=(255, 255, 255)); s.paste(b.convert("RGB"), (x, 24)); x += b.width + 12
        s.save(out)
    return results


if __name__ == "__main__":
    spec = json.load(open(sys.argv[1]))
    run(spec, sys.argv[2] if len(sys.argv) > 2 else None, float(sys.argv[3]) if len(sys.argv) > 3 else 3.0)
