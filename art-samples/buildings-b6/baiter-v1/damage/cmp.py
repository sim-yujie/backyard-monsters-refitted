"""cmp.py <state> [k] : Flash's look beside the 3D preview (render/prev-L1-<state>.png), both at k px a Flash px, on
the background colour, for checking by eye -> work/cmp-<state>.png"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import flashstates as FS  # noqa: E402

HERE = Path(__file__).resolve().parent
st = sys.argv[1]
k = int(sys.argv[2]) if len(sys.argv) > 2 else 4
FR = (-50, -36, 62, 72)
row = FS.rows()[19]
fl = FS.compose(row, row["levels"][0], st, FR)
w, h = FR[2] - FR[0], FR[3] - FR[1]
fl = fl.resize((w * k, h * k), Image.LANCZOS)
src = HERE.parent / "render" / (f"prev-L1-{st}.png" if len(sys.argv) < 4 else sys.argv[3])
im = Image.open(src).convert("RGBA").resize((w * k, h * k), Image.LANCZOS)
out = Image.new("RGBA", (w * k * 2, h * k), (236, 230, 214, 255))
out.alpha_composite(fl, (0, 0))
out.alpha_composite(im, (w * k, 0))
(HERE.parent / "work").mkdir(exist_ok=True)
out.convert("RGB").save(HERE.parent / "work" / f"cmp-{st}.png")
