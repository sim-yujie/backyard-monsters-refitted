"""overlay.py out.png T...: the 3D full view with the painted top's outline drawn over it in red (and the 3D outline in
cyan over the painted, beside it), 3x. Not a deliverable."""
import sys
import numpy as np
from PIL import Image, ImageFilter
P = 'D:/Coding/BYMR/worktrees/towers-wire/server/public/assets/buildings/snipertower/'
out = sys.argv[1]
tiles = []
for t in [int(a) for a in sys.argv[2:]]:
    a = Image.open(P + f'top.t{t}@2x.webp').convert('RGBA')
    m = Image.open(f'render/t{t}/full-h00.png').convert('RGBA')
    m = m.resize((m.width // 2, m.height // 2), Image.LANCZOS).crop((0, 0) + a.size)

    def edge(im):
        al = im.split()[3].point(lambda v: 255 if v > 128 else 0)
        return np.asarray(al.filter(ImageFilter.MaxFilter(3))) ^ np.asarray(al)
    for base, other, col in ((m, a, (255, 0, 0, 255)), (a, m, (0, 255, 255, 255))):
        g = Image.new('RGBA', a.size, (60, 90, 50, 255))
        g.alpha_composite(base)
        px = np.asarray(g).copy()
        px[edge(other) > 0] = col
        tiles.append(Image.fromarray(px))
W = sum(t.width for t in tiles) + 6 * len(tiles); H = max(t.height for t in tiles)
G = Image.new('RGBA', (W, H), (0, 0, 0, 255)); x = 0
for t in tiles:
    G.paste(t, (x, H - t.height)); x += t.width + 6
G.resize((W * 2, H * 2), Image.NEAREST).save(out)
