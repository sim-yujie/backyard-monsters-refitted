"""tile.py <out> <dir>... : grid_cmp each dir and tile the cmp images in one row (each 640 wide), labelled."""
import sys, subprocess
from PIL import Image, ImageDraw
out, dirs = sys.argv[1], sys.argv[2:]
ims = []
for d in dirs:
    subprocess.run([sys.executable, "grid_cmp.py", d, "640"], check=True)
    ims.append(Image.open(f"{d}/cmp.png"))
H = max(i.height for i in ims)
t = Image.new("RGB", (640 * len(ims) + 10 * (len(ims) - 1), H + 16), (30, 30, 30)); dr = ImageDraw.Draw(t)
for k, (d, i) in enumerate(zip(dirs, ims)):
    t.paste(i, (k * 650, 16)); dr.text((k * 650 + 4, 2), d.split("champions/")[-1], fill=(255, 255, 0))
t.save(out)
