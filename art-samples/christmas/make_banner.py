"""The Christmas card's banner (placeholder): the Modern cutouts on a snowy night.

python3 make_banner.py <cut folder> <out.png>
Composed from the Codex option sheet's cutouts (no new painting): a night-sky
gradient, a snowy ground strip and soft snowflakes, the tree, lamp post,
snowman and present pile standing on the snow. 1200 x 300 (4:1, the card's band).
"""
import random
import sys
from PIL import Image, ImageDraw, ImageFilter

src, out = sys.argv[1:3]
W, H = 1200, 300
random.seed(7)
bg = Image.new("RGBA", (W, H))
top, bottom = (16, 28, 58), (52, 78, 120)
d = ImageDraw.Draw(bg)
for y in range(H):
    t = y / (H - 1)
    d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,))
# Snowy ground: a gentle wavy bank.
snow = Image.new("L", (W, H), 0)
sd = ImageDraw.Draw(snow)
pts = [(0, H)] + [(x, 262 + round(8 * __import__("math").sin(x / 90))) for x in range(0, W + 1, 20)] + [(W, H)]
sd.polygon(pts, fill=255)
snow = snow.filter(ImageFilter.GaussianBlur(2))
bg.paste((214, 226, 242, 255), (0, 0), snow)
shade = Image.new("L", (W, H), 0)
ImageDraw.Draw(shade).rectangle((0, 285, W, H), fill=90)
shade = shade.filter(ImageFilter.GaussianBlur(8))
bg.paste((150, 170, 205, 255), (0, 0), shade)


def put(name, height, cx, base):
    im = Image.open(f"{src}/{name}.full.png").convert("RGBA")
    im = im.crop(im.getchannel("A").getbbox())
    w = round(im.width * height / im.height)
    im = im.resize((w, height), Image.LANCZOS)
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).ellipse((cx - w * 0.55 + 8, base - 9, cx + w * 0.55 + 8, base + 9), fill=110)
    sh = sh.filter(ImageFilter.GaussianBlur(6))
    bg.paste((40, 52, 80, 255), (0, 0), sh)
    bg.alpha_composite(im, (round(cx - w / 2), base - height))


put("lamppost", 230, 150, 274)
put("tree", 220, 340, 276)
put("present", 52, 445, 280)
put("goldenpresent", 44, 500, 284)
put("snowman", 180, 880, 276)
put("presentpile", 170, 1050, 278)
put("present", 46, 965, 284)
# Falling snow on top.
flakes = Image.new("RGBA", (W, H), (0, 0, 0, 0))
fd = ImageDraw.Draw(flakes)
for _ in range(140):
    x, y, r = random.uniform(0, W), random.uniform(0, H - 30), random.choice((1.2, 1.6, 2.2, 2.8))
    fd.ellipse((x - r, y - r, x + r, y + r), fill=(255, 255, 255, random.randint(120, 220)))
bg.alpha_composite(flakes.filter(ImageFilter.GaussianBlur(0.6)))
bg.convert("RGB").save(out, optimize=True)
print("wrote", out)
