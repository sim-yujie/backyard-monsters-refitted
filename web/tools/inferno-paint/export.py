"""export.py : writes the chosen paintings into the game's assets and prints the TierArt rows.

    ~/.cache/bymr-art-venv/bin/python -I web/tools/inferno-paint/export.py

From art-samples/b8-inferno-paint/runs/<run>/new-4x-<look>.png (the building's shared 4x canvas), each look is cut to
its pixels at half the 4x size (Pixi reads `@2x` as 2 px a world px), every top-left on whole 1x pixels, as
top.c<level>[.damaged|.destroyed]@2x.webp in the building's Flash folder. SAT trims a look's saturation toward its own
brightness (Modern style note: buildings 20-60%; the gold Academy and the lava came out above Flash's). The Cavern's
new rocks stand on Flash's own soft ground of cracks and lava glow (common.flash_ground), drawn into the same picture.
Shadows stay Flash's own JPEGs (same footprint). Rows go into buildingArtTiers.ts (26 and 128:
INFERNO_PAINTED_BUILDING_ART; 127: CAVERN_ART, the main yard's).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import OUT, UP, B, canvas, flash_ground, flash_shadow, folder, parse, resize_pm  # noqa: E402

PICK = {"a1": "a1+a2-A", "a2": "a1+a2-A", "a1d": "a1d+a1x-A", "a1x": "a1d+a1x-A", "a2d": "a2d+a2x-B",
        "a2x": "a2d+a2x-B", "b1": "b1-A", "b1d": "b1d-B", "b1x": "b1d+b1x-A",
        "c1": "c1-A", "c2": "c2-A", "c3": "c3-A", "c4": "c4-A", "c5": "c5-A"}
SAT = {"a1": 0.88, "a2": 0.9, "a1d": 0.85, "a1x": 0.88, "a2d": 0.85, "a2x": 0.88, "b1": 1.0, "b1d": 0.9, "b1x": 0.9,
       "c1": 1.0, "c2": 0.88, "c3": 0.88, "c4": 1.0, "c5": 0.92}


def snap(box):
    x0, y0, x1, y1 = box
    return (x0 // UP * UP, y0 // UP * UP, -(-x1 // UP) * UP, -(-y1 // UP) * UP)


def desat(im, f):
    if f == 1.0:
        return im
    a = np.asarray(im).astype(float)
    lum = a[..., :3] @ np.array([0.299, 0.587, 0.114])
    a[..., :3] = lum[..., None] + (a[..., :3] - lum[..., None]) * f
    return Image.fromarray(np.clip(a, 0, 255).astype("uint8"), "RGBA")


def name_of(look):
    b, lv, st = parse(look)
    return f"top.c{lv}{'.' + st if st else ''}@2x.webp"


def save2x(look):
    b = look[0]
    CW, CH, OX, OY = canvas(b)
    im4 = Image.open(OUT / "runs" / PICK[look] / f"new-4x-{look}.png").convert("RGBA")
    im4 = desat(im4, SAT[look])
    if b == "c":   # on Flash's own soft ground
        g = flash_ground(look).resize((CW * UP, CH * UP), Image.LANCZOS)
        g.alpha_composite(im4)
        im4 = g
    box = snap(im4.getbbox())
    part = im4.crop(box)
    part = resize_pm(part, (part.width // 2, part.height // 2))
    part.save(folder(b) / name_of(look), "WEBP", quality=92, method=6, exact=False)
    return [name_of(look), box[0] // UP - OX, box[1] // UP - OY]


def t(v):
    return "null" if v is None else "[" + ", ".join(f'"{x}"' if isinstance(x, str) else str(x) for x in v) + "]"


for b in "abc":
    print(f"  // {B[b]['type']} {B[b]['name']}")
    for lv in B[b]["looks"]:
        lk = f"{b}{lv}"
        top = save2x(lk)
        row = f"    {{ from: {lv}, top: {t(top)}, shadow: {t(flash_shadow(lk))}, lift: 0"
        if f"{lk}d" in PICK:
            row += (f",\n      damaged: {{ top: {t(save2x(lk + 'd'))}, shadow: {t(flash_shadow(lk + 'd'))} }},\n"
                    f"      destroyed: {{ top: {t(save2x(lk + 'x'))}, shadow: {t(flash_shadow(lk + 'x'))} }}")
        print(row + " },")
