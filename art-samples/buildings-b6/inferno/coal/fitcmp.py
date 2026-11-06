"""fitcmp.py <png> <flash level> <out> [scale] : Flash | 3D | 3D with Flash's outline in red, the same frame (coal.py's)."""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import iref  # noqa: E402

FRAME = (-56, -72, 64, 84)
BG = (62, 44, 38, 255)
src, lv, out = Path(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
sc = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
m = Image.open(src).convert("RGBA")
f = iref.flash_rgba(2, lv, 0, FRAME).resize(m.size, Image.BICUBIC)
sh = iref.shadow_rgba(2, lv, FRAME).resize(m.size, Image.BICUBIC)
fl = Image.new("RGBA", m.size, BG); fl.alpha_composite(sh); fl.alpha_composite(f)
md = Image.new("RGBA", m.size, BG); md.alpha_composite(m)
a = np.array(f.getchannel("A")) > 100
e = a & ~np.array(Image.fromarray(a.astype(np.uint8) * 255).filter(ImageFilter.MinFilter(3))).astype(bool)
ov = np.array(md.copy())
ov[e] = (255, 40, 40, 255)
b = np.array(m.getchannel("A")) > 100
iou = (a & b).sum() / max(1, (a | b).sum())
pic = Image.new("RGBA", (m.width * 3, m.height), BG)
pic.paste(fl, (0, 0)); pic.paste(md, (m.width, 0)); pic.paste(Image.fromarray(ov), (2 * m.width, 0))
if sc != 1.0:
    pic = pic.resize((int(pic.width * sc), int(pic.height * sc)), Image.LANCZOS)
pic.convert("RGB").save(out)
print(out, "IoU %.3f" % iou)
