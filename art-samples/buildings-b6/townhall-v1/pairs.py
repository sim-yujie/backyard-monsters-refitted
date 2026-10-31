"""pairs.py : each level's Flash look beside its 3D still, on grass, enlarged with the same box and scale (no guide lines).

    python pairs.py [zoom]   -> crops/L<n>-flash-3d.png for levels 1-10 (render/L<n>-base.png)
"""
import sys
from pathlib import Path

from PIL import Image

import fref

HERE = Path(__file__).resolve().parent
GRASS = (96, 140, 60)
# per level: the box round the building in Flash px (x0, y0, x1, y1)
BOX = {1: (-70, -62, 70, 62), 2: (-75, -80, 75, 75), 3: (-75, -82, 75, 72), 4: (-85, -92, 90, 82)}
BOX.update({lv: (-88, -112, 98, 86) for lv in (5, 6, 7, 8)})
BOX.update({lv: (-100, -122, 110, 92) for lv in (9, 10)})


def pair(lv, z):
    x0, y0, x1, y1 = BOX[lv]
    fx, fy = fref.FRAME[:2]
    r = Image.open(HERE / f"render/L{lv}-base.png").convert("RGBA")
    k = r.width // (fref.FRAME[2] - fref.FRAME[0])
    w, h = (x1 - x0) * z, (y1 - y0) * z
    f = fref.flash_rgba(lv).crop((x0 - fx, y0 - fy, x1 - fx, y1 - fy)).resize((w, h), Image.LANCZOS)
    t = r.crop(((x0 - fx) * k, (y0 - fy) * k, (x1 - fx) * k, (y1 - fy) * k)).resize((w, h), Image.LANCZOS)
    out = Image.new("RGB", (2 * w + 12, h), (24, 24, 24))
    for i, im in enumerate((f, t)):
        bg = Image.new("RGBA", (w, h), GRASS + (255,))
        bg.alpha_composite(im)
        out.paste(bg.convert("RGB"), (i * (w + 12), 0))
    return out


if __name__ == "__main__":
    z = int(sys.argv[1]) if len(sys.argv) > 1 else 3
    (HERE / "crops").mkdir(exist_ok=True)
    for lv in range(1, 11):
        p = HERE / f"crops/L{lv}-flash-3d.png"
        pair(lv, z).save(p)
        print(p)
