# After ingame.mjs: enlarge the desktop crops 2x, and one side-by-side per look of the same crops for sq/a/b/c.
# python3 post.py r5
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(HERE, "ingame", sys.argv[1] if len(sys.argv) > 1 else "r5")
F = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
for f in sorted(glob.glob(os.path.join(d, "*-desk-*-crop-*.png"))):
    if f.endswith("-2x.png"):
        continue
    im = Image.open(f)
    im.resize((im.width * 2, im.height * 2), Image.LANCZOS).save(f[:-4] + "-2x.png")
    os.remove(f)
LABEL = {"sq": "today: square", "a": "A  octagon socket", "b": "B  hexagon crystal", "c": "C  inside a cut gem"}
for look in ("modern", "classic"):
    for size, crop in (("desk-1280x720", "crop-abilities-korath-2x"), ("phone-390x844", "crop-abilities-korath"),
                       ("desk-1280x720", "crop-unlocked-2x"), ("phone-390x844", "crop-unlocked")):
        ims = []
        for g in ("sq", "a", "b", "c"):
            p = os.path.join(d, f"{g}-{look}-{size}-{crop}.png")
            if os.path.exists(p):
                ims.append((g, Image.open(p).convert("RGB")))
        if not ims:
            continue
        w = max(i.width for _, i in ims)
        h = sum(i.height + 50 for _, i in ims)
        out = Image.new("RGB", (w, h), (14, 14, 14))
        dr = ImageDraw.Draw(out)
        y = 0
        for g, i in ims:
            dr.text((10, y + 8), LABEL[g], fill=(255, 220, 150), font=F)
            out.paste(i, (0, y + 50))
            y += i.height + 50
        name = f"compare-{look}-{size}-{crop.replace('crop-', '').replace('-2x', '')}.png"
        out.save(os.path.join(HERE, "ingame", name))
        print(name, out.size)
