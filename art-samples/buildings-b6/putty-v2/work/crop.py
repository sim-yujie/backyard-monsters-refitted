"""crop.py lv x0 y0 x1 y1 [scale] [out]: Flash | 3D of a box in Flash px (origin coords), from render/L<lv>-base+parts-00."""
import sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import post, fref
lv, x0, y0, x1, y1 = (int(float(a)) for a in sys.argv[1:6])
sc = float(sys.argv[6]) if len(sys.argv) > 6 else 0.5
out = sys.argv[7] if len(sys.argv) > 7 else str(Path(__file__).parent / "crop.png")
b3 = post.on_grass(post.frame3d(lv, 0))
k = b3.width / (fref.FRAME[2] - fref.FRAME[0])
box = tuple(int(v) for v in ((x0 - fref.FRAME[0]) * k, (y0 - fref.FRAME[1]) * k, (x1 - fref.FRAME[0]) * k, (y1 - fref.FRAME[1]) * k))
fl = post.flash(lv, 0, b3.size).crop(box)
td = b3.crop(box)
w, h = int(fl.width * sc), int(fl.height * sc)
o = Image.new("RGB", (2 * w + 6, h), (20, 20, 20))
o.paste(fl.resize((w, h), Image.LANCZOS).convert("RGB"), (0, 0))
o.paste(td.resize((w, h), Image.LANCZOS).convert("RGB"), (w + 6, 0))
o.save(out)
print(out, o.size)
