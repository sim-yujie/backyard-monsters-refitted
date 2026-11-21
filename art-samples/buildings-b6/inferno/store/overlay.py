"""overlay.py [variant ...] : the outline check (as the Lab's r2/overlay.py). Each variant's picture without the ground
(render/L1-alone.png or work/fit-L1.png) is brought to the game's art size (2 px per Flash px) and laid over the
surface General Store's own game picture (generalstore/top.3d1@2x.webp), sliding it to the best fit. Prints the two
outlines' sizes and how much they share (shared area / joined area); writes shots/outline-<variant>.png at 3x: the
surface Store's outline area red, the variant's green, shared yellow, between the two pictures."""
import sys
from pathlib import Path
from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "shots"
PAD = 30
r0 = Image.open(ROOT / "server/public/assets/buildings/generalstore/top.3d1@2x.webp").convert("RGBA")
ref = Image.new("RGBA", (r0.width + 2 * PAD, r0.height + 2 * PAD), (0, 0, 0, 0))
ref.paste(r0, (PAD, PAD))
ra = ref.getchannel("A").point(lambda v: 255 if v > 128 else 0)
rb = ra.getbbox()
for v in sys.argv[1:] or ["g"]:
    p = HERE / v / "render" / "L1-alone.png"
    if not p.exists():
        p = HERE / v / "work" / "fit-L1.png"
    im = Image.open(p).convert("RGBA")
    k = im.width // 146                      # px per Flash px (the canvas is 146 Flash px wide)
    im = im.resize((im.width * 2 // k, im.height * 2 // k), Image.LANCZOS)
    a = im.getchannel("A").point(lambda q: 255 if q > 128 else 0)
    b = a.getbbox()
    best = (0, 0, 0)
    for dx in range(-8, 9):
        for dy in range(-28, 9):
            sh = Image.new("L", ra.size, 0)
            sh.paste(a.crop(b), (rb[0] + dx, rb[1] + dy))
            both = sum(ImageChops.multiply(ra, sh).histogram()[128:])
            either = sum(ImageChops.lighter(ra, sh).histogram()[128:])
            best = max(best, (both / either, dx, dy))
    iou, dx, dy = best
    print("%s (%s): surface Store %dx%d px, variant %dx%d px (2 px per Flash px); shared/joined area %.3f at slide %+d,%+d"
          % (v, p.name, rb[2] - rb[0], rb[3] - rb[1], b[2] - b[0], b[3] - b[1], iou, dx, dy))
    sh = Image.new("L", ra.size, 0)
    sh.paste(a.crop(b), (rb[0] + dx, rb[1] + dy))
    mix = Image.merge("RGB", (ra, sh, Image.new("L", ra.size, 0)))
    pic = Image.new("RGBA", ra.size, (74, 42, 36, 255))
    mine = Image.new("RGBA", ra.size, (0, 0, 0, 0))
    mine.paste(im.crop(b), (rb[0] + dx, rb[1] + dy))
    row = Image.new("RGB", (ra.width * 3, ra.height), (74, 42, 36))
    s = pic.copy()
    s.alpha_composite(ref)
    row.paste(s.convert("RGB"), (0, 0))
    row.paste(mix, (ra.width, 0))
    s = pic.copy()
    s.alpha_composite(mine)
    row.paste(s.convert("RGB"), (ra.width * 2, 0))
    row.resize((row.width * 3, row.height * 3), Image.NEAREST).save(OUT / f"outline-{v}.png")
