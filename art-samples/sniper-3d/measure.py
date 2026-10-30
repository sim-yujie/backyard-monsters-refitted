"""measure.py : silhouette overlap of the 3D full view (render/tN/full-h00.png) with the painted top.tN@2x, on the same
canvas (pivot on the same pixel). Prints IoU, bounding boxes and widths by row. Not a deliverable."""
import sys
import numpy as np
from PIL import Image
P = 'D:/Coding/BYMR/worktrees/towers-wire/server/public/assets/buildings/snipertower/'
for t in [int(a) for a in sys.argv[1:]] or [1, 2, 3]:
    a = np.asarray(Image.open(P + f'top.t{t}@2x.webp').convert('RGBA'))[..., 3] > 128
    m = Image.open(f'render/t{t}/full-h00.png').convert('RGBA')
    m = m.resize((m.width // 2, m.height // 2), Image.LANCZOS)
    b = np.asarray(m)[..., 3] > 128
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
    iou = (a & b).sum() / (a | b).sum()

    def box(x):
        ys, xs = np.nonzero(x)
        return xs.min(), ys.min(), xs.max(), ys.max()
    print(f"t{t} IoU {iou:.3f}  painted box {box(a)}  3D box {box(b)}  canvas {a.shape[::-1]}")
    rows = range(box(a)[1], box(a)[3], 12)
    print("  y   painted(x0-x1 w)   3D(x0-x1 w)")
    for y in rows:
        def span(x):
            xs = np.nonzero(x[y])[0]
            return f"{xs.min():3d}-{xs.max():3d} {xs.max() - xs.min():3d}" if len(xs) else "   -       "
        print(f"  {y:3d} {span(a)}      {span(b)}")
