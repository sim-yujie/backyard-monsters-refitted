"""export.py : writes the chosen Modern Under Hall paintings into the game's assets and prints buildingArtTiers.ts rows.

    python -I web/tools/underhall-repaint/export.py

Per look n (1-3), from art-samples/underhall/runs/L<n>-<variant>/new-4x.png (the shared 4x canvas, origin OX*4, OY*4),
L<n>d-<variant> and L<n>x-<variant>, into server/public/assets/buildings/itownhall/:
top.c<n>@2x.webp, top.c<n>.damaged@2x.webp and top.c<n>.destroyed@2x.webp, each the painting cut to its pixels at
half the 4x size (Pixi reads `@2x` as 2 px a world px). The shadows stay Flash's own JPEGs (same footprint, as the
Town Hall's and the Locker's do). Every top-left is on whole 1x pixels. The rows go into
INFERNO_PAINTED_BUILDING_ART[14] in web/src/game/yard/buildingArtTiers.ts.
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import FOLDER, LOOKS, OUT, OX, OY, UP, resize_pm  # noqa: E402

PICK = {"1": "C", "2": "G", "3": "H", "1d": "A", "2d": "A", "3d": "A", "1x": "B", "2x": "D", "3x": "B"}


def run(look):
    return OUT / "runs" / f"L{look}-{PICK[look]}" / "new-4x.png"


def snap(box):
    """A 4x box widened to whole 1x pixels."""
    x0, y0, x1, y1 = box
    return (x0 // UP * UP, y0 // UP * UP, -(-x1 // UP) * UP, -(-y1 // UP) * UP)


def save2x(look, name):
    """Writes the look's painting (its box, whole 1x px) at 2x; returns [file, x, y] in 1x px from the origin."""
    im4 = Image.open(run(look)).convert("RGBA")
    b = snap(im4.getbbox())
    part = im4.crop(b)
    part = resize_pm(part, (part.width // 2, part.height // 2))
    part.save(FOLDER / name, "WEBP", quality=92, method=6, exact=False)
    return [name, b[0] // UP - OX, b[1] // UP - OY]


def t(v):
    return "[" + ", ".join(f'"{x}"' if isinstance(x, str) else str(x) for x in v) + "]"


for n, frm in ((1, 1), (2, 2), (3, 3)):
    top = save2x(f"{n}", f"top.c{n}@2x.webp")
    damaged = save2x(f"{n}d", f"top.c{n}.damaged@2x.webp")
    destroyed = save2x(f"{n}x", f"top.c{n}.destroyed@2x.webp")
    d = LOOKS[n]
    print(f'    {{ from: {frm}, top: {t(top)}, shadow: {t(d["shadow"])}, lift: 0,\n'
          f'      damaged: {{ top: {t(damaged)}, shadow: {t(d["dshadow"])} }},\n'
          f'      destroyed: {{ top: {t(destroyed)}, shadow: {t(d["xshadow"])} }} }},')
