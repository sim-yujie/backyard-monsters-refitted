"""compare.py : quick check, painted | 3D side by side on green, enlarged 2x (of @2x). Not a deliverable.
  python compare.py out.png painted.webp render.png [painted2 render2 ...]   (renders at 4x are halved first)"""
import sys
from PIL import Image
out = sys.argv[1]
rows = []
for a, b in zip(sys.argv[2::2], sys.argv[3::2]):
    A = Image.open(a).convert("RGBA")
    B = Image.open(b).convert("RGBA")
    if B.width == 2 * A.width:
        B = B.resize((A.width, A.height), Image.LANCZOS)
    w, h = A.width + B.width + 10, max(A.height, B.height)
    g = Image.new("RGBA", (w, h), (90, 140, 70, 255))
    g.alpha_composite(A, (0, h - A.height)); g.alpha_composite(B, (A.width + 10, h - B.height))
    rows.append(g)
W = sum(r.width for r in rows) + 10 * (len(rows) - 1); H = max(r.height for r in rows)
G = Image.new("RGBA", (W, H), (0, 0, 0, 255)); x = 0
for r in rows:
    G.paste(r, (x, H - r.height)); x += r.width + 10
k = 3 if len(rows) == 1 else 2
G.resize((W * k, H * k), Image.LANCZOS).save(out)
