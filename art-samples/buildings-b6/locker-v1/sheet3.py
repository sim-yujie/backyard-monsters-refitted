"""sheet3.py : Flash | Codex Look (reference) | 3D for every level, at the game's size (1x) and 2x.

    python sheet3.py            -> locker-flash-codex-3d.png
The Codex look is the right half of worktrees/locker-repaint/art-samples/locker/final-L<n>.png ("new"); it is scaled so
its building matches Flash's size (measured on the Flash copy in the left half of the same picture).
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

import fref
from post import GRASS, box_of, flash, font, frame3d, on_grass

HERE = Path(__file__).resolve().parent
CODEX = Path("C:/Coding/BYMR/worktrees/locker-repaint/art-samples/locker")


def panels(n):
    """The left (Flash) and right (Codex new) panels of final-L<n>.png, without the title and borders."""
    im = Image.open(CODEX / f"final-L{n}.png").convert("RGB")
    a = np.array(im.convert("L")).astype(int)
    h, w = a.shape
    dark = (a[h // 3:2 * h // 3] < 40).mean(0) > 0.9
    spans, st = [], None
    for i, v in enumerate(dark):
        if not v and st is None:
            st = i
        if v and st is not None:
            spans.append((st, i))
            st = None
    if st is not None:
        spans.append((st, w))
    spans = [s for s in spans if s[1] - s[0] > 20]
    rows = np.nonzero(~((a[:, w // 4:3 * w // 4] < 40).mean(1) > 0.9))[0]
    y0 = rows[rows > 30].min()
    y1 = rows.max()
    return [im.crop((s[0] + 2, y0 + 2, s[1] - 2, y1 - 2)) for s in spans[:2]]


def not_grass(im):
    a = np.array(im).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    return ~((g > r + 12) & (g > b + 12))


def codex_scale(n, left):
    """Codex px per Flash px: the Flash building's height in the left panel over its height in Flash px."""
    m = not_grass(left)
    ys = np.nonzero(m.mean(1) > 0.02)[0]
    fa = np.array(fref.flash_rgba(n).getchannel("A")) > 128
    fys = np.nonzero(fa.any(1))[0]
    return (ys.max() - ys.min()) / (fys.max() - fys.min())


def column(lv, k):
    size = frame3d(lv, 0).size
    box = box_of(lv, size)
    f = flash(lv, 0, size).crop(box)
    t = on_grass(frame3d(lv, 0)).crop(box)
    left, right = panels(lv)
    s = codex_scale(lv, left)
    c = right.resize((round(right.width * k / s), round(right.height * k / s)), Image.LANCZOS)
    # the Codex panel cut to the same box height (centred), so the three sit at one scale
    if c.height > f.height:
        y = (c.height - f.height) // 2
        c = c.crop((0, y, c.width, y + f.height))
    return f, c, t


def main():
    size = frame3d(1, 0).size
    k = size[0] // (fref.FRAME[2] - fref.FRAME[0])
    blocks = []
    for lv in fref.LEVELS:
        f, c, t = column(lv, k)
        rows = []
        for s in (1, 2):
            rows.append([im.resize((max(1, im.width * s // k), max(1, im.height * s // k)), Image.LANCZOS)
                         for im in (f, c, t)])
        blocks.append((lv, rows))
    gap = 12
    w = max(sum(im.width for im in rows[1]) + gap * 4 for _, rows in blocks)
    h = 44 + sum(30 + rows[0][0].height + rows[1][0].height + gap * 3 for _, rows in blocks)
    out = Image.new("RGB", (w, h), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 8), "Monster Locker: Flash | Codex Look (reference) | Blender 3D, at game size (1x) and 2x",
           fill=(255, 255, 255), font=font(20))
    y = 44
    for lv, rows in blocks:
        d.text((gap, y + 4), f"Level {lv}", fill=(255, 220, 120), font=font(18))
        y += 30
        for r in rows:
            x = gap
            for im, lab in zip(r, ("Flash", "Codex", "3D")):
                out.paste(im.convert("RGB"), (x, y))
                d.text((x + 3, y + 2), lab, fill=(255, 255, 255), font=font(12))
                x += im.width + gap
            y += r[0].height + gap
        y += gap
    out.save(HERE / "locker-flash-codex-3d.png")
    print("wrote locker-flash-codex-3d.png", out.size)


if __name__ == "__main__":
    main()
