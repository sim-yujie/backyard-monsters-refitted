"""loops.py : the loop check's input and the seam check, from render/ (after sheets.py).
  work/loop-L<t>/NNN.png   the 3D loop alone on the sheet's backdrop, for tools/loop_diff.py
  prints, per tier, the mean change between neighbouring frames and across the seam (last frame -> first): a seamless
  loop's seam step is no bigger than its other steps.
"""
import os
import numpy as np
from PIL import Image
N = {1: 47, 2: 45, 3: 45}
BG = (96, 60, 50, 255)
for t in (1, 2, 3):
    d = 'work/loop-L%d' % t
    os.makedirs(d, exist_ok=True)
    base = Image.open('render/L%d-base.png' % t).convert('RGBA')
    fr = []
    for f in range(N[t]):
        im = Image.new('RGBA', base.size, BG)
        im.alpha_composite(base)
        im.alpha_composite(Image.open('render/L%d-parts-%02d.png' % (t, f)).convert('RGBA'))
        im.convert('RGB').save('%s/%03d.png' % (d, f))
        fr.append(np.asarray(im.convert('RGB')).astype('int16'))
    steps = [float(np.abs(fr[(i + 1) % N[t]] - fr[i]).mean()) for i in range(N[t])]
    inner = steps[:-1]
    print('tier %d: %d frames, step mean %.3f max %.3f, seam %.3f -> %s' % (
        t, N[t], sum(inner) / len(inner), max(inner), steps[-1], 'seamless' if steps[-1] <= max(inner) * 1.05 else 'SEAM JUMPS'))
