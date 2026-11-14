"""fref.py : the Flash Magma Pump, composited from the game's files exactly as the game draws it.
flash(look, frame, shadow=True) -> RGBA picture of FRAME around the building anchor, at Flash size (1 px = 1 px).
Look 1 is the one the game uses at all ten levels; look 2 is Flash's unused second picture (top.2.png, no strips,
no anchor in the Flash source: placed here so its base sits where look 1's does)."""
import os
from PIL import Image
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'server', 'public', 'assets', 'buildings', 'imagmaproducer')
FRAME = (-60, -80, 60, 60)           # canvas in Flash px around the anchor (as magma.py)
LOOKS = {
    1: dict(top=("top.1.v2.png", -35, -15), shadow=("shadow.1.v2.jpg", -36, 4),
            anims=[("anim.1.v2.png", 9.2, 12.6, 25, 31, 49), ("anim.2.v2.png", -32, 9, 36, 26, 49), ("anim.3.v2.png", -18, -60, 34, 58, 49)]),
    2: dict(top=("top.2.png", -31, -19), shadow=("shadow.1.v2.jpg", -36, 4), anims=[]),
}
def _open(n): return Image.open(os.path.join(A, n))
def frames(look): return 49
def flash(look, frame=0, shadow=True, bg=None, layers=None):
    L = LOOKS[look]; W = FRAME[2] - FRAME[0]; H = FRAME[3] - FRAME[1]
    im = Image.new('RGBA', (W, H), bg or (0, 0, 0, 0))
    def put(src, x, y):
        tmp = Image.new('RGBA', (W, H), (0, 0, 0, 0)); tmp.paste(src, (round(x - FRAME[0]), round(y - FRAME[1])))
        return Image.alpha_composite(im, tmp)
    if shadow:
        s = _open(L['shadow'][0]).convert('L')        # jpg drawn as a multiply: white = no shadow
        sh = Image.new('RGBA', s.size, (0, 0, 0, 255)); sh.putalpha(s.point(lambda v: 255 - v))
        im = put(sh, L['shadow'][1], L['shadow'][2])
    if layers is None or 'top' in layers:
        im = put(_open(L['top'][0]).convert('RGBA'), L['top'][1], L['top'][2])
    for i, (n, x, y, w, h, nf) in enumerate(L['anims']):
        if layers is not None and i not in layers: continue
        sheet = _open(n).convert('RGBA'); f = frame % nf
        im = put(sheet.crop((f * w, 0, f * w + w, h)), x, y)
    return im
if __name__ == '__main__':
    Z = 6
    BG = (96, 60, 50, 255)
    fr = [0, 8, 16, 24, 32, 40]
    ims = [flash(1, f, bg=BG) for f in fr]
    W, H = ims[0].size
    sheet = Image.new('RGB', (W * Z * 3, H * Z * 2))
    for i, im in enumerate(ims):
        sheet.paste(im.convert('RGB').resize((W * Z, H * Z), Image.BOX), ((i % 3) * W * Z, (i // 3) * H * Z))
    sheet.save('work/flash-look1.png')
    for look in (1, 2):
        flash(look, 0, bg=BG).convert('RGB').resize((W * 8, H * 8), Image.BOX).save('work/flash-look%d-f0.png' % look)
    flash(1, 0, bg=BG, layers=['top'], shadow=False).convert('RGB').resize((W * 8, H * 8), Image.BOX).save('work/flash-look1-toponly.png')
    # the strips, enlarged
    for n, x, y, w, h, nf in LOOKS[1]['anims']:
        s = _open(n).convert('RGBA'); b = Image.new('RGBA', s.size, BG); b.alpha_composite(s)
        cols = 13; rows = (nf + cols - 1) // cols; z = 5
        o = Image.new('RGB', (cols * (w * z + 4), rows * (h * z + 4)), (30, 30, 30))
        for f in range(nf):
            o.paste(b.crop((f * w, 0, f * w + w, h)).convert('RGB').resize((w * z, h * z), Image.BOX), ((f % cols) * (w * z + 4), (f // cols) * (h * z + 4)))
        o.save('work/strip-%s.png' % n.split('.v2')[0])
