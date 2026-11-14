"""sheets.py [mp4] : the review pictures from render/ (PB_K=6 stills and parts). PIL only.
  out/tier<t>.png         Flash beside the 3D at full size (6 px a Flash px); tier 1 against the look in play
                          (top.1.v2 + strips), tiers 2 and 3 against Flash's unused top.2 (a guide, not a target)
  out/all-tiers.png       Flash look 1 | tier 1 | tier 2 | tier 3 at one scale, with fixed marks on shared parts
  out/tier<t>-frames.png  six frames of the 3D loop (tier 1: Flash's frames above)
  out/tier<t>.mp4         the loop four times (tier 1: Flash beside 3D), out/tier<t>-loop.png the loop check
"""
import glob, os, subprocess, sys
from PIL import Image, ImageChops, ImageDraw
import fref
K = 6
BG = (96, 60, 50, 255)
N = 49
W, H = (fref.FRAME[2] - fref.FRAME[0]) * K, (fref.FRAME[3] - fref.FRAME[1]) * K
LOOK = {1: 1, 2: 2, 3: 2}
os.makedirs('out', exist_ok=True)


def model(t, f=0, bg=None):
    im = Image.new('RGBA', (W, H), bg or (0, 0, 0, 0))
    im.alpha_composite(Image.open('render/L%d-base.png' % t).convert('RGBA'))
    im.alpha_composite(Image.open('render/L%d-parts-%02d.png' % (t, f)).convert('RGBA'))
    return im


def flash(look, f=0, bg=None):
    return fref.flash(look, f, shadow=True, bg=bg).resize((W, H), Image.BOX)


CROP = (14 * K, 10 * K, 114 * K, 136 * K)          # the building, in render px


def pair(t, f=0, look=None):
    a, b = flash(look or LOOK[t], f, BG).convert('RGB').crop(CROP), model(t, f, BG).convert('RGB').crop(CROP)
    out = Image.new('RGB', (a.width * 2 + 12, a.height), (30, 30, 30))
    out.paste(a, (0, 0)); out.paste(b, (a.width + 12, 0))
    return out


def loop_diff(frames, out, tol=0):
    """Paint red every pixel that changes during the loop; print how many and their box."""
    acc = None
    first = frames[0].convert('RGB')
    for fr in frames[1:]:
        d = ImageChops.difference(first, fr.convert('RGB')).convert('L').point(lambda v: 255 if v > tol else 0)
        acc = d if acc is None else ImageChops.lighter(acc, d)
    n = acc.histogram()[255]
    im = first.copy(); im.paste((255, 0, 0), mask=acc.point(lambda v: v // 2))
    im.save(out)
    return n, acc.getbbox()


if __name__ == '__main__':
    tiers = [t for t in (1, 2, 3) if os.path.exists('render/L%d-base.png' % t)]
    for t in tiers:
        pair(t).save('out/tier%d.png' % t)
        have = [f for f in range(N) if os.path.exists('render/L%d-parts-%02d.png' % (t, f))]
        if len(have) < N:
            continue
        fr = [0, 6, 12, 20, 30, 40]
        cw, ch = CROP[2] - CROP[0], CROP[3] - CROP[1]
        rows = ([[flash(1, f, BG) for f in fr]] if t == 1 else []) + [[model(t, f, BG) for f in fr]]
        s = Image.new('RGB', (len(fr) * (cw // 2 + 6), len(rows) * (ch // 2 + 6)), (30, 30, 30))
        for j, row in enumerate(rows):
            for i, im in enumerate(row):
                s.paste(im.convert('RGB').crop(CROP).resize((cw // 2, ch // 2), Image.LANCZOS), (i * (cw // 2 + 6), j * (ch // 2 + 6)))
        s.save('out/tier%d-frames.png' % t)
        frames = [model(t, f, BG) for f in range(N)]
        n, bb = loop_diff(frames, 'out/tier%d-loop.png' % t)
        print('tier %d loop: %d px change, box %s (render px of %dx%d)' % (t, n, bb, W, H))
        if os.path.exists('render/L%d-parts-%02d.png' % (t, N)):       # frame N must equal frame 0
            d = ImageChops.difference(model(t, 0, BG).convert('RGB'), model(t, N, BG).convert('RGB')).convert('L')
            print('tier %d seam: frame %d vs frame 0, largest difference %d of 255, pixels over 8: %d' % (t, N, d.getextrema()[1], sum(d.histogram()[9:])))
        if 'mp4' in sys.argv:
            d = 'work/mp4-L%d' % t
            os.makedirs(d, exist_ok=True)
            for f in range(N):
                (pair(t, f) if t == 1 else model(t, f, BG).convert('RGB').crop(CROP)).save('%s/%03d.png' % (d, f))
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-stream_loop', '3', '-framerate', '20', '-i', d + '/%03d.png',
                            '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '16', 'out/tier%d.mp4' % t], check=True)
    if len(tiers) == 3:
        cells = [flash(1, 0, BG), model(1, 0, BG), model(2, 0, BG), model(3, 0, BG)]
        cells = [c.convert('RGB').crop(CROP) for c in cells]
        cw, ch = cells[0].size
        al = Image.new('RGB', (cw * 4 + 36, ch + 40), (30, 30, 30))
        dr = ImageDraw.Draw(al)
        for i, (c, lab) in enumerate(zip(cells, ('Flash (all levels)', '3D tier 1 (levels 1-2)', '3D tier 2 (levels 3-6)', '3D tier 3 (levels 7-10)'))):
            al.paste(c, (i * (cw + 12), 40)); dr.text((i * (cw + 12) + 10, 8), lab, fill=(255, 255, 255), font_size=24)
        al.save('out/all-tiers.png')
    print('ok')
