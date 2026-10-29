"""compare.py : sample sheets, Flash original beside the 3D model, both cropped to the subject and enlarged.

    python compare.py <name> <typeId> <level> [<level> ...]      -> <name>-levels.png (one row per level: Flash | 3D)
    python compare.py <name> <typeId> anim <level> [frames]      -> <name>-anim-L<level>.gif (Flash | 3D, looping)
The 3D renders are at 4x (150 px per unit), or 8x from render/<name>/x2/ when that exists; the Flash art is scaled up
to the same size.
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

import flashart as F

HERE = Path(__file__).resolve().parent
BG = (96, 140, 60)                  # the yard's grass, as the tower samples
BAR = (24, 24, 24)
ZOOM = 1.0                          # shown as rendered


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def crop(im, pad=16):
    box = im.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    return im.crop((box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad)) if box else im


UP = 4                              # 4, or 8 when the 3D pictures are the x2 renders


def flash_im(tid, level, frame=0):
    row = F.rows()[tid]
    lv = [l for l in row["levels"] if l[0] <= level][-1]
    im, _ = F.compose(row, lv, frame)
    return im.resize((im.width * UP, im.height * UP), Image.LANCZOS), lv


def load3d(path):
    """A 3D render with its ground shadow (path-shadow.png) under it, when there is one."""
    im = Image.open(path).convert("RGBA")
    sh = path.with_name(path.stem + "-shadow.png")
    if sh.exists():
        out = Image.open(sh).convert("RGBA").filter(ImageFilter.GaussianBlur(5))      # a soft edge, as Flash's
        out.alpha_composite(im)
        return out
    return im


def pair(a, b, title, cell_w=None, cell_h=None):
    a, b = (x.resize((round(x.width * ZOOM), round(x.height * ZOOM)), Image.LANCZOS) for x in (a, b))
    cw = cell_w or max(a.width, b.width)
    ch = cell_h or max(a.height, b.height)
    out = Image.new("RGB", (cw * 2 + 30, ch + 70), BG)
    d = ImageDraw.Draw(out)
    d.rectangle((0, 0, out.width, 34), fill=BAR)
    d.text((10, 5), title, fill=(255, 255, 255), font=font(22))
    for i, (im, lab) in enumerate(((a, "Flash"), (b, "3D"))):
        x = 10 + i * (cw + 10)
        d.text((x, 40), lab, fill=(255, 255, 255), font=font(18))
        bg = Image.new("RGBA", im.size, BG + (255,))
        bg.alpha_composite(im)
        out.paste(bg.convert("RGB"), (x + (cw - im.width) // 2, 64 + ch - im.height))
    return out


if __name__ == "__main__":
    name, tid = sys.argv[1], int(sys.argv[2])
    rd = HERE / "render" / name
    if (rd / "x2").exists():
        rd, UP = rd / "x2", 8
    if sys.argv[3] == "anim":
        level = int(sys.argv[4])
        n3 = len(list((rd / f"anim-L{level}").glob("f??.png")))
        fl, lv = flash_im(tid, level)
        nf = F.frames_of(lv)
        n = max(n3, nf)
        fa = [crop(flash_im(tid, level, k * nf // n)[0]) for k in range(n)]
        fb = [crop(load3d(rd / f"anim-L{level}" / f"f{k * n3 // n:02d}.png")) for k in range(n)]
        cw = round(max(x.width for x in fa + fb) * ZOOM)
        ch = round(max(x.height for x in fa + fb) * ZOOM)
        fr = [pair(a, b, f"{F.rows()[tid]['name']} level {level}: producing", cw, ch) for a, b in zip(fa, fb)]
        fr[0].save(HERE / f"{name}-anim-L{level}.gif", save_all=True, append_images=fr[1:], duration=round(1000 / 24),
                   loop=0)
        print("saved", HERE / f"{name}-anim-L{level}.gif", len(fr), "frames")
    else:
        rows = []
        for lev in [int(a) for a in sys.argv[3:]]:
            a = crop(flash_im(tid, lev)[0])
            b = crop(load3d(rd / f"L{lev}.png"))
            rows.append(pair(a, b, f"{F.rows()[tid]['name']} level {lev}"))
        w = max(r.width for r in rows)
        out = Image.new("RGB", (w, sum(r.height for r in rows)), BG)
        y = 0
        for r in rows:
            out.paste(r, ((w - r.width) // 2, y))
            y += r.height
        out.save(HERE / f"{name}-levels.png")
        print("saved", HERE / f"{name}-levels.png", out.size)
