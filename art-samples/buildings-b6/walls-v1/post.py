"""post.py : the wall pictures from walls.py's renders (render/) and the Flash art (flashwalls.py).

    python post.py prev <look>       work/cmp-<look>.png      Flash | 3D preview (work/prev-*), all three states
    python post.py fit               overlap (IoU) of the 3D outline with Flash's, every look and state -> work/fit.txt
    python post.py side              <look>-side.png          Flash | 3D, 4x, whole / damaged / destroyed, on grass
    python post.py line              line-<set>.png           a row of six blocks as in a yard, Flash above 3D, at game
                                                              size (1x) and 3x
    python post.py states            states-<set>.png         the set's looks, Flash beside 3D, whole/damaged/destroyed
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import flashwalls as F

HERE = Path(__file__).resolve().parent
R = HERE / "render"
W = HERE / "work"
GRASS = (96, 140, 60)
FW, FH = F.FRAME[2] - F.FRAME[0], F.FRAME[3] - F.FRAME[1]


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def flash(key, state, z):
    """Flash as the game draws it (shadow multiplied on the grass, then the top), z px per Flash px."""
    return F.on_grass(key, state, GRASS).resize((FW * z, FH * z), Image.BICUBIC if z > 1 else Image.LANCZOS)


def model(key, state, z, src=None):
    im = Image.open(src or R / f"{key}-{state}-base.png").convert("RGBA")
    im = im.resize((FW * z, FH * z), Image.LANCZOS)
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return out


def label(im, text, n=20, at=(8, 6)):
    d = ImageDraw.Draw(im)
    d.text(at, text, fill=(255, 255, 255), font=font(n), stroke_width=2, stroke_fill=(0, 0, 0))


def iou(key, state):
    al = Image.open(R / f"{key}-{state}-alone.png").getchannel("A")
    fa = F.flash_rgba(key, state).getchannel("A").resize(al.size, Image.BILINEAR)
    f, t = np.array(fa) > 128, np.array(al) > 128
    return (f & t).sum() / max(1, (f | t).sum())


def crop_box(z, pad=4):
    """One crop (Flash px, scaled) round every look: the block and its shadow."""
    return (6 * z, 0, 62 * z, 52 * z) if pad else None


def side(key):
    z = 4
    cb = crop_box(z)
    cells = []
    for st in F.STATES:
        a, b = flash(key, st, z).crop(cb), model(key, st, z).crop(cb)
        label(a, f"Flash {st}")
        label(b, f"3D {st}")
        cells.append((a, b))
    w, h = cells[0][0].size
    out = Image.new("RGB", (3 * (2 * w + 10) + 30, h + 50), (24, 24, 24))
    label(out, f"{F.NAMES[key]}: Flash | 3D, 4x", 24, (10, 10))
    for i, (a, b) in enumerate(cells):
        x = 10 + i * (2 * w + 20)
        out.paste(a.convert("RGB"), (x, 44))
        out.paste(b.convert("RGB"), (x + w, 44))
    out.save(HERE / f"{key}-side.png")


def row(get, n=6):
    """n blocks of one look side by side along one yard axis (20 units = 20 px right, 10 px down each), drawn back to
    front like the game; get() -> the look's RGBA in the FRAME at 1x (shadow and block apart, all shadows first)."""
    step = (20, 10)
    w, h = FW + step[0] * (n - 1), FH + step[1] * (n - 1)
    out = Image.new("RGBA", (w, h), GRASS + (255,))
    sh, top = get()
    for k in range(n):
        out.alpha_composite(sh, (k * step[0], k * step[1]))
    for k in range(n):
        out.alpha_composite(top, (k * step[0], k * step[1]))
    return out


def line(set_name):
    keys = F.SETS[set_name]
    rows = []
    for key in keys:
        def fl(key=key):
            return F.shadow_rgba(key), F.flash_rgba(key)

        def md(key=key):
            base = Image.open(R / f"{key}-whole-base.png").convert("RGBA").resize((FW, FH), Image.LANCZOS)
            alone = Image.open(R / f"{key}-whole-alone.png").convert("RGBA").resize((FW, FH), Image.LANCZOS)
            # the shadow alone: the base picture where the block is not
            sa = np.array(base).astype(np.float32)
            aa = np.array(alone.getchannel("A")).astype(np.float32) / 255
            shadow = sa.copy()
            shadow[..., 3] = sa[..., 3] * (1 - aa)
            return Image.fromarray(shadow.clip(0, 255).astype(np.uint8)), alone
        rows.append((key, row(fl), row(md)))
    w1, h1 = rows[0][1].size
    for z, tag in ((1, "1x"), (3, "3x")):
        cw, ch = w1 * z, h1 * z
        gap = 8 * max(1, z // 1)
        out = Image.new("RGB", (len(rows) * (cw + gap) + gap, 2 * ch + 3 * gap + (40 if z > 1 else 14)), (24, 24, 24))
        top = 40 if z > 1 else 14
        d = ImageDraw.Draw(out)
        if z > 1:
            d.text((gap, 8), f"{set_name}: Flash row above, 3D row below ({tag})", fill=(255, 255, 255), font=font(24))
        for i, (key, fr, mr) in enumerate(rows):
            x = gap + i * (cw + gap)
            out.paste(fr.convert("RGB").resize((cw, ch), Image.NEAREST if z > 1 else Image.BILINEAR), (x, top))
            out.paste(mr.convert("RGB").resize((cw, ch), Image.NEAREST if z > 1 else Image.BILINEAR), (x, top + ch + gap))
            if z > 1:
                d.text((x + 6, top + 4), F.NAMES[key], fill=(255, 255, 0), font=font(18))
        out.save(HERE / f"line-{set_name}-{tag}.png")


def states(set_name):
    z = 3
    cb = crop_box(z)
    keys = F.SETS[set_name]
    cw, ch = cb[2] - cb[0], cb[3] - cb[1]
    out = Image.new("RGB", (len(keys) * (2 * cw + 20) + 20, 3 * ch + 4 * 10 + 50), (24, 24, 24))
    label(out, f"{set_name}: Flash | 3D, whole / damaged / destroyed (3x)", 24, (12, 10))
    for i, key in enumerate(keys):
        for j, st in enumerate(F.STATES):
            a, b = flash(key, st, z).crop(cb), model(key, st, z).crop(cb)
            if j == 0:
                label(a, F.NAMES[key], 16)
            x, y = 20 + i * (2 * cw + 20), 50 + j * (ch + 10)
            out.paste(a.convert("RGB"), (x, y))
            out.paste(b.convert("RGB"), (x + cw, y))
    out.save(HERE / f"states-{set_name}.png")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "prev":
        key = sys.argv[2]
        z = 4
        cb = crop_box(z)
        cells = []
        for st in F.STATES:
            p = W / f"prev-{key}-{st}.png"
            if p.exists():
                cells += [flash(key, st, z).crop(cb), model(key, st, z, p).crop(cb)]
        w, h = cells[0].size
        out = Image.new("RGB", (w * len(cells), h))
        for i, c in enumerate(cells):
            out.paste(c.convert("RGB"), (i * w, 0))
        out.save(W / f"cmp-{key}.png")
    elif cmd == "fit":
        lines = []
        for key in F.LOOKS:
            for st in F.STATES:
                if (R / f"{key}-{st}-alone.png").exists():
                    lines.append(f"{key:9s} {st:9s} overlap (IoU) {iou(key, st):.3f}")
        print("\n".join(lines))
        (W / "fit.txt").write_text("\n".join(lines) + "\n")
    elif cmd == "side":
        for key in sys.argv[2:] or F.LOOKS:
            side(key)
    elif cmd == "line":
        for s in sys.argv[2:] or F.SETS:
            line(s)
    elif cmd == "states":
        for s in sys.argv[2:] or F.SETS:
            states(s)
