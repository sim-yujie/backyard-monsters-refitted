"""itex.py : the Inferno covers' prints, from the surface Store's own matchbook.png (store-v1/mbtex.py): its letters,
flame and match are taken off the red card as masks and repainted, so every shape stays where the surface cover has it.
    python3 itex.py   ->  cover-<d|e|f>.png (colour) and cover-<d|e|f>-glow.png (its own light; black = none)
Pillow only (this PC's python3 has no numpy)."""
import random
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
src = Image.open(HERE.parent.parent / "store-v1" / "matchbook.png").convert("RGB")
R, G, B = src.split()
W, H = src.size


def ramp(im, lo, hi):
    return im.point(lambda v: max(0, min(255, round((v - lo) * 255 / (hi - lo)))))


flame = ImageChops.multiply(ramp(ImageChops.subtract(G, B), 70, 120), G.point(lambda v: 255 if v > 150 else 0))
letters = ImageChops.multiply(ramp(ImageChops.darker(G, B), 150, 210), ImageChops.invert(flame))
head = ramp(ImageChops.invert(R), 255 - 90, 255 - 50)
rnd = random.Random(7)


def mottle(cell, amp):
    """A soft cloud, L, middle 128, +-amp*128."""
    w, h = W // cell + 2, H // cell + 2
    n = Image.new("L", (w, h))
    n.putdata([max(0, min(255, round(128 + rnd.gauss(0, 1) * 128 * amp))) for _ in range(w * h)])
    return n.resize((W, H), Image.BICUBIC)


def times(im, cloud):
    """im * cloud / 128 per channel."""
    c = Image.merge("RGB", (cloud,) * 3)
    return ImageChops.multiply(im, c).point(lambda v: min(255, v * 2))


# scorched toward the rim and sootier low down: a mask, 255 = clean middle
rim = Image.new("L", (W, H), 0)
ImageDraw.Draw(rim).rectangle((70, 70, W - 70, H - 150), fill=255)
rim = rim.filter(ImageFilter.GaussianBlur(70))
rim = ImageChops.multiply(rim, mottle(40, 0.5).point(lambda v: min(255, v * 2)))


def make(v, base, letter, flame_col, head_col, glow_flame, glow_letter):
    col = times(times(Image.new("RGB", (W, H), base), mottle(24, 0.14)), mottle(90, 0.2))
    dark = col.point(lambda x: round(x * 0.4))
    col = Image.composite(col, dark, rim)
    col = Image.composite(times(Image.new("RGB", (W, H), letter), mottle(40, 0.12)), col, letters)
    col = Image.composite(Image.new("RGB", (W, H), flame_col), col, flame)
    col = Image.composite(Image.new("RGB", (W, H), head_col), col, head)
    col.save(HERE / f"cover-{v}.png")
    g = Image.new("RGB", (W, H), (0, 0, 0))
    g = Image.composite(times(Image.new("RGB", (W, H), glow_letter), mottle(30, 0.35)), g, letters)
    g = Image.composite(times(Image.new("RGB", (W, H), glow_flame), mottle(30, 0.35)), g, flame)
    g.filter(ImageFilter.GaussianBlur(2)).save(HERE / f"cover-{v}-glow.png")


# d: the red card burnt dark, ash letters, the flame an ember
make("d", (112, 34, 30), (176, 160, 136), (236, 120, 30), (20, 14, 14), (255, 110, 20), (0, 0, 0))
# e: black iron, the letters and the flame branded in and glowing
make("e", (50, 46, 48), (200, 84, 22), (255, 150, 40), (14, 10, 10), (255, 120, 24), (190, 60, 10))
# f: blackened copper, brass letters and flame, no glow
make("f", (112, 60, 34), (190, 134, 56), (206, 150, 60), (30, 22, 18), (0, 0, 0), (0, 0, 0))
