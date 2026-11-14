"""states.py : out/states.png, the damaged look beside Flash's, per tier (render/L<t>-damaged-base.png), each drawn
on the model's canvas (fref.FRAME) at 4x. Destroyed is Flash's rubble: there is no 3D destroyed look."""
import os
from PIL import Image
import fref
K, Z = 6, 4
BG = (96, 60, 50, 255)
W, H = fref.FRAME[2] - fref.FRAME[0], fref.FRAME[3] - fref.FRAME[1]
# Flash's damaged still and its place, as the game draws it (buildingArtInfernoData.ts)
FL = {1: ('top.1.damaged.v2.png', -45, -48), 2: ('top.2.damaged.png', -38, -62), 3: ('top.2.damaged.png', -38, -62)}
rows = []
for t in (1, 2, 3):
    n, x, y = FL[t]
    c = Image.new('RGBA', (W, H), BG)
    f = Image.open(os.path.join(fref.A, n)).convert('RGBA')
    c.alpha_composite(f, (x - fref.FRAME[0], y - fref.FRAME[1]))
    m = Image.new('RGBA', (W * K, H * K), BG)
    m.alpha_composite(Image.open('render/L%d-damaged-base.png' % t).convert('RGBA'))
    g = Image.new('RGBA', (W * K, H * K), BG)
    g.alpha_composite(Image.open('render/L%d-damaged-base.png' % t).convert('RGBA'))
    cells = [c.resize((W * Z, H * Z), Image.NEAREST), m.resize((W * Z, H * Z), Image.LANCZOS),
             g.resize((W, H), Image.LANCZOS).resize((W * Z, H * Z), Image.NEAREST)]         # the last: at game size
    row = Image.new('RGB', (sum(c.width for c in cells) + 20, cells[0].height), (30, 30, 30))
    x = 0
    for c in cells:
        row.paste(c.convert('RGB'), (x, 0)); x += c.width + 10
    rows.append(row)
out = Image.new('RGB', (rows[0].width, sum(r.height for r in rows) + 20), (30, 30, 30))
y = 0
for r in rows:
    out.paste(r, (0, y)); y += r.height + 10
out.save('out/states.png'); print(out.size)
