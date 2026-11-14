"""fref.py : the Flash Sulfur Swirler, composited from the game's files exactly as the game draws it.
flash(look, frame, shadow=True) -> RGBA picture of FRAME around the building anchor, at Flash size (1 px = 1 px)."""
import os
from PIL import Image, ImageChops
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'server', 'public', 'assets', 'buildings', 'isulpherproducer')
FRAME = (-60, -80, 60, 70)           # canvas in Flash px around the anchor (as sulfur.py)
LOOKS = {
    1: dict(top=("top.1.v2.png", -24, -41), shadow=("shadow.1.jpg", -33, 13),
            anims=[("anim.1.v2.png", -35, -4, 20, 50, 51), ("anim.2.v2.png", -20, -58, 34, 36, 51), ("anim.3.v2.png", -11, -14, 26, 17, 51)]),
    2: dict(top=("top.2.png", 0, -15), shadow=("shadow.2.jpg", -25, 27),
            anims=[("anim1.2.png", -36, -60, 60, 118, 45)]),
}
def _open(n): return Image.open(os.path.join(A, n))
def frames(look): return LOOKS[look]['anims'][0][5]
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
    import sys
    Z = 6
    for look in (1, 2):
        nf = frames(look); fr = [0, nf // 6, nf // 3, nf // 2, 2 * nf // 3, 5 * nf // 6]
        ims = [flash(look, f, bg=(96, 60, 50, 255)) for f in fr]
        W, H = ims[0].size
        sheet = Image.new('RGB', (W * Z * 3, H * Z * 2))
        for i, im in enumerate(ims):
            sheet.paste(im.convert('RGB').resize((W * Z, H * Z), Image.NEAREST), ((i % 3) * W * Z, (i // 3) * H * Z))
        sheet.save('work/flash-look%d.png' % look)
        flash(look, 0, bg=(96, 60, 50, 255)).convert('RGB').resize((W * 8, H * 8), Image.NEAREST).save('work/flash-look%d-f0.png' % look)
