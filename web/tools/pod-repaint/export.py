"""export.py : writes the chosen Modern Resource Pod paintings into the game's assets and prints buildingArtTiers.ts rows.

    python -I web/tools/pod-repaint/export.py

From art-samples/pod/runs/L<look>-<variant>/new-4x.png (the shared 4x canvas, origin OX*4, OY*4) for the whole (1),
damaged (1d) and destroyed (1x) looks, into server/public/assets/buildings/istoragesilo/: top.c1@2x.webp,
top.c1.damaged@2x.webp and top.c1.destroyed@2x.webp, each the painting cut to its pixels at half the 4x size (Pixi
reads `@2x` as 2 px a world px). SAT trims a picture's saturation (toward its own brightness) so the broken looks,
which show more lava, stay near 50% like the whole Pod and the other Modern Inferno buildings. The shadows stay
Flash's own JPEGs (same footprint, as the Under Hall's do). Every top-left is on whole 1x pixels. The rows go into
INFERNO_PAINTED_BUILDING_ART[6] in web/src/game/yard/buildingArtTiers.ts.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import FOLDER, LOOKS, OUT, OX, OY, UP, resize_pm  # noqa: E402

PICK = {"1": "A", "1d": "A", "1x": "B"}
SAT = {"1": 1.0, "1d": 0.9, "1x": 0.9}


def run(look):
    return OUT / "runs" / f"L{look}-{PICK[look]}" / "new-4x.png"


def snap(box):
    """A 4x box widened to whole 1x pixels."""
    x0, y0, x1, y1 = box
    return (x0 // UP * UP, y0 // UP * UP, -(-x1 // UP) * UP, -(-y1 // UP) * UP)


def desat(im, f):
    if f == 1.0:
        return im
    a = np.asarray(im).astype(float)
    lum = a[..., :3] @ np.array([0.299, 0.587, 0.114])
    a[..., :3] = lum[..., None] + (a[..., :3] - lum[..., None]) * f
    return Image.fromarray(np.clip(a, 0, 255).astype("uint8"), "RGBA")


def save2x(look, name):
    """Writes the look's painting (its box, whole 1x px) at 2x; returns [file, x, y] in 1x px from the origin."""
    im4 = Image.open(run(look)).convert("RGBA")
    b = snap(im4.getbbox())
    part = im4.crop(b)
    part = desat(resize_pm(part, (part.width // 2, part.height // 2)), SAT[look])
    part.save(FOLDER / name, "WEBP", quality=92, method=6, exact=False)
    return [name, b[0] // UP - OX, b[1] // UP - OY]


def t(v):
    return "[" + ", ".join(f'"{x}"' if isinstance(x, str) else str(x) for x in v) + "]"


top = save2x("1", "top.c1@2x.webp")
damaged = save2x("1d", "top.c1.damaged@2x.webp")
destroyed = save2x("1x", "top.c1.destroyed@2x.webp")
d = LOOKS[1]
print(f'    {{ from: 1, top: {t(top)}, shadow: {t(d["shadow"])}, lift: 0,\n'
      f'      damaged: {{ top: {t(damaged)}, shadow: {t(d["dshadow"])} }},\n'
      f'      destroyed: {{ top: {t(destroyed)}, shadow: {t(d["xshadow"])} }} }},')
