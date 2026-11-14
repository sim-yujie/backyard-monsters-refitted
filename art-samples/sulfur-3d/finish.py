"""finish.py : the checks and extra sheets after a full render (run after sheets.py mp4).
  out/loop-tier<t>.png     loop_diff over the loop's frames (red = pixels that change), and it prints, per tier, the
                           greatest difference between frame N and frame 0 (render with PB_EXTRA=1): 0 = seamless
  out/sulfur-levels.png    Flash above 3D at levels 1, 3, 6, 10 (levels_sheet.py), -crop = the rock and cradle
  out/crops-joints.png     the joints at full size, Flash above 3D, per tier: rock and pipe foot, cradle and chain,
                           funnel, top drive
"""
import os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
import fref, sheets
PY = sys.executable
TOOLS = os.path.join('..', 'traps-3d', 'tools')
K, W, H, BG = sheets.K, sheets.W, sheets.H, sheets.BG
for t in (1, 2, 3):
    n = sheets.N[t]
    d = 'work/loop-L%d' % t
    os.makedirs(d, exist_ok=True)
    for f in os.listdir(d):
        os.remove(os.path.join(d, f))
    for f in range(n):
        sheets.model(t, f, BG).convert('RGB').save('%s/%03d.png' % (d, f))
    r = subprocess.run([PY, os.path.join(TOOLS, 'loop_diff.py'), d + '/*.png', '-o', 'out/loop-tier%d.png' % t], capture_output=True, text=True)
    print('tier', t, r.stdout.strip().replace('\n', ' | '), r.stderr.strip()[-200:])
    if os.path.exists('render/L%d-parts-%02d.png' % (t, n)):
        a = np.array(sheets.model(t, 0, BG).convert('RGB')).astype(int)
        b = np.array(sheets.model(t, n, BG).convert('RGB')).astype(int)
        df = np.abs(a - b)
        print('tier %d seam: frame %d against frame 0: greatest difference %d of 255, pixels differing by more than 2: %d' % (t, n, df.max(), (df.max(axis=2) > 2).sum()))
subprocess.run([PY, os.path.join(TOOLS, 'levels_sheet.py'), '--flash', 'out/lv/flash-L{lv}.png', '--model', 'out/lv/model-L{lv}.png',
                '--levels', '1,3,6,10', '--name', 'Sulfur Swirler', '-o', 'out/sulfur-levels.png', '--bg', '96,60,50',
                '--crop', '%d,%d,%d,%d' % (20 * K, 80 * K, 76 * K, 62 * K), '--zoom', '2'], check=True)
# crops: boxes in Flash px (x0, y0, x1, y1) of the canvas FRAME
BOX = {'rock and pipe foot': {1: (-40, -8, 12, 52), 2: (-42, 4, 10, 64)}, 'cradle and chain': {1: (-12, 0, 40, 50), 2: (-8, 0, 40, 56)},
       'funnel': {1: (12, -50, 40, -18), 2: (2, -46, 40, -8)}, 'top drive': {1: (-36, -64, 16, -24), 2: (-44, -66, 16, -22)}}
Z = 2
rows = []
for name, bx in BOX.items():
    cells = []
    for t in (1, 2, 3):
        x0, y0, x1, y1 = bx[min(t, 2)]
        c = tuple((v - o) * K for v, o in zip((x0, y0, x1, y1), (fref.FRAME[0], fref.FRAME[1]) * 2))
        fl = sheets.flash(t, 0, BG).convert('RGB').crop(c)
        m = sheets.model(t, 0, BG).convert('RGB').crop(c)
        cell = Image.new('RGB', (fl.width, fl.height * 2 + 6), (30, 30, 30))
        cell.paste(fl, (0, 0)); cell.paste(m, (0, fl.height + 6))
        ImageDraw.Draw(cell).text((4, 4), 'tier %d  %s  (Flash above, 3D below)' % (t, name), fill=(255, 255, 0))
        cells.append(cell)
    row = Image.new('RGB', (sum(c.width for c in cells) + 12 * 2, max(c.height for c in cells)), (30, 30, 30))
    x = 0
    for c in cells:
        row.paste(c, (x, 0)); x += c.width + 12
    rows.append(row)
out = Image.new('RGB', (max(r.width for r in rows), sum(r.height for r in rows) + 12 * (len(rows) - 1)), (30, 30, 30))
y = 0
for r in rows:
    out.paste(r, (0, y)); y += r.height + 12
out.save('out/crops-joints.png')
print('ok', out.size)
