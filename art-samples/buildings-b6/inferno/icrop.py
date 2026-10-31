"""icrop.py <dir> <look> x,y,w,h [out.png] [base] : one area of the 3D still at full size (render pixels) beside the same
area of the Flash look (resized to the render, as ipost's sheets do). 'base' crops render/L<look>-base.png without the
moving layer. Prints the output path."""
import sys
from pathlib import Path

from PIL import Image

import ipost  # noqa: E402

ipost.D = Path(sys.argv[1]).resolve()
ipost.C = ipost.load(ipost.D)

lv = int(sys.argv[2])
x, y, w, h = (int(v) for v in sys.argv[3].split(","))
out = Path(sys.argv[4]) if len(sys.argv) > 4 else ipost.D / "work" / f"crop-L{lv}-{x}-{y}.png"
m = ipost.frame3d(lv, 0)
f = ipost.flash(lv, 0, m.size)
m = ipost.on_ground(m)
box = (x, y, x + w, y + h)
pic = Image.new("RGB", (w * 2 + 6, h), (255, 255, 255))
pic.paste(f.crop(box).convert("RGB"), (0, 0))
pic.paste(m.crop(box).convert("RGB"), (w + 6, 0))
pic.save(out)
print(out)
