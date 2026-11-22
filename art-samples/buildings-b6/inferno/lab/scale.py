"""scale.py : checks composite.py's scale: the Strongbox's own sprite (imonsterlab/top.3d1@2x.webp, 2 px per Flash px)
laid over the Strongbox in the yard screenshot at several sizes; prints the mean colour difference of the best fit at
each. The smallest is the screenshot's px per Flash px."""
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

ROOT = Path(__file__).resolve().parents[4]
shot = Image.open(ROOT / "shots/yard/inferno-in2.png").convert("RGB").crop((1850, 380, 2500, 980))
spr = Image.open(ROOT / "server/public/assets/buildings/imonsterlab/top.3d1@2x.webp").convert("RGBA")
Q = 4
small = shot.resize((shot.width // Q, shot.height // Q), Image.BOX)
for px in (3.2, 3.6, 3.8, 4.0, 4.2, 4.4, 4.8):
    s = spr.resize((round(spr.width * px / 2 / Q), round(spr.height * px / 2 / Q)), Image.LANCZOS)
    mask = s.getchannel("A").point(lambda v: 255 if v > 200 else 0)
    best = (1e9, 0, 0)
    for x in range(0, small.width - s.width):
        for y in range(0, small.height - s.height):
            d = ImageChops.difference(small.crop((x, y, x + s.width, y + s.height)), s.convert("RGB"))
            m = sum(ImageStat.Stat(d, mask).mean)
            best = min(best, (m, x, y))
    print("px per Flash px %.1f: difference %.1f at %s" % (px, best[0], (1850 + best[1] * Q, 380 + best[2] * Q)))
