"""states.py : out/states.png, the damaged look beside Flash's, per tier (render/L<t>-damaged-base.png). Destroyed is Flash's rubble."""
import os
from PIL import Image
import fref
K = 6
BG = (96, 60, 50, 255)
A = fref.A
FL = {1: ('top.1.damaged.v2.png', 'top.1.destroyed.v2.png'), 2: ('top.2.damaged.png', 'top.2.destroyed.png'), 3: ('top.2.damaged.png', 'top.2.destroyed.png')}
rows = []
for t in (1, 2, 3):
    cells = []
    for i, st in enumerate(('damaged',)):
        f = Image.open(os.path.join(A, FL[t][i])).convert('RGBA')
        c = Image.new('RGBA', (130 * 4, 140 * 4), BG)
        f = f.resize((f.width * 4, f.height * 4), Image.NEAREST)
        c.alpha_composite(f, ((c.width - f.width) // 2, (c.height - f.height) // 2))
        cells.append(c)
        p = 'render/L%d-%s-base.png' % (t, st)
        m = Image.new('RGBA', (130 * K, 140 * K), BG)
        if os.path.exists(p):
            m.alpha_composite(Image.open(p).convert('RGBA'))
        cells.append(m.resize((130 * 4, 140 * 4), Image.LANCZOS))
    row = Image.new('RGB', (sum(c.width for c in cells) + 30, cells[0].height), (30, 30, 30))
    x = 0
    for c in cells:
        row.paste(c.convert('RGB'), (x, 0)); x += c.width + 10
    rows.append(row)
out = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 20), (30, 30, 30))
y = 0
for r in rows:
    out.paste(r, (0, y)); y += r.height + 10
out.save('out/states.png'); print(out.size)
