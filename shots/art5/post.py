# After ingame.mjs: enlarge the desktop crops 2x.
# python3 post.py r5
import sys, os, glob
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(HERE, "ingame", sys.argv[1] if len(sys.argv) > 1 else "r5")
for f in sorted(glob.glob(os.path.join(d, "*-desk-*-crop-*.png"))):
    if f.endswith("-2x.png"):
        continue
    im = Image.open(f)
    im.resize((im.width * 2, im.height * 2), Image.LANCZOS).save(f[:-4] + "-2x.png")
    os.remove(f)
