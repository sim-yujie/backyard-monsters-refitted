"""export.py : writes the chosen Modern Locker paintings into the game's assets and prints buildingArtTiers.ts rows.

    python -I web/tools/locker-repaint/export.py            (the picks in PICK below)
    python -I web/tools/locker-repaint/export.py --preview  (also art-samples/locker/key-L<n>.png: the key's cells)

Per look n (1-4), from art-samples/locker/runs/L<n>-<variant>/new-4x.png (the shared 4x canvas, origin OX*4, OY*4),
into server/public/assets/buildings/monsterlocker/:

- top.c<n>@2x.webp: the whole painting cut to its pixels at half the 4x size (Pixi reads `@2x` as 2 px a world px).
- body.c<n>@2x.webp + anim.c<n>@2x.webp: the key turning, as Flash's strip turned it. The key's handle (KEY below) is
  taken off the body, and the strip's cells are that handle turning a
  whole turn about the line of its shaft (foreshortened across that line, a little darker side-on and from behind),
  twice Flash's cell count, so it turns at Flash's pace (Flash's cells were half a turn).
- top.c<n>.damaged@2x.webp from L<n>d-<variant>, and top.c.destroyed@2x.webp from Lx-<variant>.

The shadows stay Flash's own JPEGs (same footprint, as the Town Hall's do). Every top-left is on whole 1x pixels.
"""
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import FOLDER, LOOKS, OUT, OX, OY, UP, resize_pm  # noqa: E402

PICK = {"1": "B", "2": "B", "3": "C", "4": "C", "1d": "B", "2d": "B", "3d": "B", "4d": "B", "x": "B"}
# the key's handle per look, in 1x px from the building's origin (read off the paintings on a grid): a box that holds
# it and no other part, the point where its shaft meets it (p) and its middle (q). The handle is what lies in the box
# beyond the line through p square to p->q (or square to `cut`); it turns about the line p->q.
KEY = {
    1: dict(box=(-40, -41, -16, -17), p=(-23, -22), q=(-28, -29)),
    2: dict(box=(-46, -98, -10, -56), p=(-23.5, -61), q=(-29, -78)),
    3: dict(box=(-48, -94, -17, -52), p=(-17, -49), q=(-30, -72)),
    4: dict(box=(-48, -92, 2, -50), p=(-28, -50.5), q=(-21, -73), cut=(0, -1)),
}
PREVIEW = "--preview" in sys.argv


def run(look):
    return OUT / "runs" / f"L{look}-{PICK[look]}" / "new-4x.png"


def snap(box):
    """A 4x box widened to whole 1x pixels."""
    x0, y0, x1, y1 = box
    return (x0 // UP * UP, y0 // UP * UP, -(-x1 // UP) * UP, -(-y1 // UP) * UP)


def save2x(im4, box4, name):
    """Writes im4's box (whole 1x px) at 2x; returns [file, x, y] in 1x px from the origin."""
    b = snap(box4)
    part = im4.crop(b)
    part = resize_pm(part, (part.width // 2, part.height // 2))
    part.save(FOLDER / name, "WEBP", quality=92, method=6, exact=False)
    return [name, b[0] // UP - OX, b[1] // UP - OY]


def turn(key4, p, q, c):
    """key4 turned to cos c about the line p->q (4x px): affine, source = p + (u u^T + n n^T / c)(o - p)."""
    u = np.array(q, float) - np.array(p, float)
    u /= np.linalg.norm(u)
    nv = np.array([-u[1], u[0]])
    m = np.outer(u, u) + np.outer(nv, nv) / c
    a, b, d, e = m[0, 0], m[0, 1], m[1, 0], m[1, 1]
    px, py = p
    cx = px - (a * px + b * py)
    cy = py - (d * px + e * py)
    out = key4.transform(key4.size, Image.AFFINE, (a, b, cx, d, e, cy), Image.BICUBIC)
    arr = np.asarray(out).astype(float)
    shade = (0.72 + 0.28 * abs(c)) * (1.0 if c > 0 else 0.86)
    arr[..., :3] *= shade
    return Image.fromarray(np.clip(arr, 0, 255).astype("uint8"), "RGBA")


rows = {}
for n in (1, 2, 3, 4):
    im = Image.open(run(str(n))).convert("RGBA")
    top = save2x(im, im.getbbox(), f"top.c{n}@2x.webp")
    # the key's handle
    kd = KEY[n]
    x0, y0, x1, y1 = ((OX + v) * UP if i % 2 == 0 else (OY + v) * UP for i, v in enumerate(kd["box"]))
    p = ((OX + kd["p"][0]) * UP, (OY + kd["p"][1]) * UP)
    q = ((OX + kd["q"][0]) * UP, (OY + kd["q"][1]) * UP)
    u = np.array(kd.get("cut", np.array(q) - np.array(p)), float)
    yy, xx = np.mgrid[0:im.height, 0:im.width]
    sel = (xx >= x0) & (xx < x1) & (yy >= y0) & (yy < y1) & ((xx - p[0]) * u[0] + (yy - p[1]) * u[1] > 0)
    a = np.asarray(im).copy()
    handle = np.where(sel[..., None], a, 0).astype("uint8")
    body = np.where(sel[..., None], 0, a).astype("uint8")
    body_im = Image.fromarray(body, "RGBA")
    bodyrow = save2x(body_im, body_im.getbbox(), f"body.c{n}@2x.webp")
    hk = Image.fromarray(handle, "RGBA")
    frames = LOOKS[n]["anim"][5] * 2
    cells = [turn(hk, p, q, max(0.06, abs(math.cos(2 * math.pi * i / frames))) * (1 if math.cos(2 * math.pi * i / frames) >= 0 else -1))
             for i in range(frames)]
    # every cell cut to what any cell covers, on whole 1x pixels
    boxes = [c.getbbox() for c in cells if c.getbbox()]
    cb = snap((min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)))
    cw, chh = (cb[2] - cb[0]) // 2, (cb[3] - cb[1]) // 2
    strip = Image.new("RGBA", (cw * frames, chh), (0, 0, 0, 0))
    for i, c in enumerate(cells):
        part = resize_pm(c.crop(cb), (cw, chh))
        strip.alpha_composite(part, (i * cw, 0))
    strip.save(FOLDER / f"anim.c{n}@2x.webp", "WEBP", quality=92, method=6)
    anim = [f"anim.c{n}@2x.webp", cb[0] // UP - OX, cb[1] // UP - OY, cw // 2, chh // 2, frames]
    if PREVIEW:
        pv = Image.new("RGBA", (cw * 10, chh * ((frames + 9) // 10)), (90, 90, 90, 255))
        for i in range(frames):
            pv.alpha_composite(strip.crop((i * cw, 0, (i + 1) * cw, chh)), ((i % 10) * cw, (i // 10) * chh))
        pv.convert("RGB").save(OUT / f"key-L{n}.png")
    dm = Image.open(run(f"{n}d")).convert("RGBA")
    damaged = save2x(dm, dm.getbbox(), f"top.c{n}.damaged@2x.webp")
    rows[n] = dict(top=top, body=bodyrow, anim=anim, damaged=damaged,
                   shadow=list(LOOKS[n]["shadow"]), dshadow=list(LOOKS[n]["dshadow"]))

ds = Image.open(run("x")).convert("RGBA")
destroyed = save2x(ds, ds.getbbox(), "top.c.destroyed@2x.webp")


def t(v):
    return "[" + ", ".join(f'"{x}"' if isinstance(x, str) else str(x) for x in v) + "]"


for n, r in rows.items():
    print(f'    {{ from: {n}, top: {t(r["top"])}, shadow: {t(r["shadow"])}, lift: 0,\n'
          f'      anim: {{ strip: {t(r["anim"])}, body: {t(r["body"])} }},\n'
          f'      damaged: {{ top: {t(r["damaged"])}, shadow: {t(r["dshadow"])} }},\n'
          f'      destroyed: {{ top: {t(destroyed)}, shadow: ["shadow.2.destroyed.jpg", -52, 25] }} }},')
