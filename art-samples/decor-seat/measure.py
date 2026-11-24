"""Base measurement of yard pictures: slope of the two lower edges (bottom-most point to the left-most and
right-most points of the alpha mask) and the bottom corner's offset from the picture's centre.

    python measure.py <picture> [...]      (@2x pictures; offsets printed in 2x px)
"""
import sys
from PIL import Image


def measure(path, thr=128):
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    a = im.getchannel("A").load()
    pts = [(x, y) for y in range(h) for x in range(w) if a[x, y] > thr]
    by = max(y for _, y in pts)
    bxs = [x for x, y in pts if y == by]
    bx = sum(bxs) / len(bxs)
    lx = min(x for x, _ in pts); ly = max(y for x, y in pts if x == lx)
    rx = max(x for x, _ in pts); ry = max(y for x, y in pts if x == rx)
    sl = (by - ly) / max(1, bx - lx)
    sr = (by - ry) / max(1, rx - bx)
    cx = (lx + rx) / 2
    top = min(y for _, y in pts)
    return dict(w=w, h=h, sl=sl, sr=sr, off=bx - cx, offimg=bx - w / 2, bw=rx - lx, top=top, by=by, bx=bx)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        m = measure(p)
        print(f"{p.split('/')[-1]:42s} {m['w']:4d}x{m['h']:<4d} L {m['sl']:.2f} R {m['sr']:.2f} "
              f"off {m['off']:+5.1f} (img {m['offimg']:+5.1f}) basew {m['bw']}")
