"""cmp.py <level> <state> [render-name] : Flash | 3D side by side on the yard's grass, same scale, -> work/cmp-L<level>-<state>.png"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import flashstates as FS  # noqa: E402

FRAME = (-56, -66, 116, 104)
GRASS = (96, 140, 60, 255)
lv, st = int(sys.argv[1]), sys.argv[2]
name = sys.argv[3] if len(sys.argv) > 3 else f"prev-L{lv}-{st}.png"
d = Image.open(HERE / "render" / name).convert("RGBA")
row = FS.rows()[16]
lvrow = [l for l in row["levels"] if l[0] == lv][0]
f = FS.compose(row, lvrow, st, FRAME).resize(d.size, Image.BICUBIC)
out = Image.new("RGBA", (d.width * 2 + 8, d.height), (30, 30, 30, 255))
for i, im in enumerate((f, d)):
    g = Image.new("RGBA", d.size, GRASS)
    g.alpha_composite(im)
    out.paste(g, (i * (d.width + 8), 0))
(HERE / "work").mkdir(exist_ok=True)
out.save(HERE / "work" / f"cmp-L{lv}-{st}.png")
