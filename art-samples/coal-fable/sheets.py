"""sheets.py : the review pictures from render/ (PB_K=6 stills and parts).
  out/lv/flash-L<lv>.png, out/lv/model-L<lv>.png  for levels_sheet.py (levels 1, 3, 6, 10 -> tiers 1, 2, 2, 3)
  out/tier<t>.png        Flash beside 3D at full size, and a 2x crop of the building
  out/all-tiers.png      the three tiers beside Flash's two looks
  out/tier<t>.mp4        the loop, Flash beside 3D (4 turns)
"""
import os, subprocess, sys
from PIL import Image
import fref
K = 6
BG = (96, 60, 50, 255)
W, H = (fref.FRAME[2] - fref.FRAME[0]) * K, (fref.FRAME[3] - fref.FRAME[1]) * K
N = {1: 47, 2: 45, 3: 45}
LOOK = {1: 1, 2: 2, 3: 2}
os.makedirs('out/lv', exist_ok=True)


def model(t, f=0, bg=None):
    im = Image.new('RGBA', (W, H), bg or (0, 0, 0, 0))
    im.alpha_composite(Image.open('render/L%d-base.png' % t).convert('RGBA'))
    im.alpha_composite(Image.open('render/L%d-parts-%02d.png' % (t, f)).convert('RGBA'))
    return im


def flash(t, f=0, bg=None, big=True):
    im = fref.flash(LOOK[t], f, shadow=True, bg=bg)
    return im.resize((W, H), Image.NEAREST) if big else im


def pair(t, f=0):
    out = Image.new('RGB', (W * 2 + 12, H), (30, 30, 30))
    out.paste(flash(t, f, BG).convert('RGB'), (0, 0))
    out.paste(model(t, f, BG).convert('RGB'), (W + 12, 0))
    return out


CROP = (10 * K, 14 * K, 104 * K, 128 * K)          # the building, in render px
for lv, t in ((1, 1), (3, 2), (6, 2), (10, 3)):
    flash(t).save('out/lv/flash-L%d.png' % lv)
    model(t).save('out/lv/model-L%d.png' % lv)
for t in (1, 2, 3):
    p = pair(t)
    a, b = p.crop((0, 0, W, H)).crop(CROP), p.crop((W + 12, 0, 2 * W + 12, H)).crop(CROP)
    cw, ch = a.size
    # the real game size (2x art shown at 1 Flash px = 1 px ... the game's 2x files): Flash and 3D at K/3 = 2 px a Flash px
    small = [x.resize((cw // 3, ch // 3), Image.NEAREST if i == 0 else Image.LANCZOS) for i, x in enumerate((a, b))]
    sheet = Image.new('RGB', (cw * 2 + 12, ch + 30 + ch // 3), (30, 30, 30))
    sheet.paste(small[0], (cw // 2 - cw // 6, 10)); sheet.paste(small[1], (cw + 12 + cw // 2 - cw // 6, 10))
    sheet.paste(a, (0, ch // 3 + 30)); sheet.paste(b, (cw + 12, ch // 3 + 30))
    sheet.save('out/tier%d.png' % t)
# all tiers: Flash look 1, tier 1, tier 2, tier 3, Flash look 2
cells = [flash(1, 0, BG), model(1, 0, BG), model(2, 0, BG), model(3, 0, BG), flash(3, 0, BG)]
cells = [c.convert('RGB').crop(CROP) for c in cells]
cw, ch = cells[0].size
al = Image.new('RGB', (cw * 5 + 48, ch), (30, 30, 30))
for i, c in enumerate(cells):
    al.paste(c, (i * (cw + 12), 0))
al.save('out/all-tiers.png')
if 'mp4' in sys.argv:
    for t in (1, 2, 3):
        d = 'work/mp4-L%d' % t
        os.makedirs(d, exist_ok=True)
        for f in range(N[t]):
            p = pair(t, f)
            p.crop((CROP[0], CROP[1], W + 12 + CROP[2], CROP[3])).save('%s/%03d.png' % (d, f))
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-stream_loop', '3', '-framerate', '20', '-i', d + '/%03d.png',
                        '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', 'out/tier%d.mp4' % t], check=True)
print('ok')
