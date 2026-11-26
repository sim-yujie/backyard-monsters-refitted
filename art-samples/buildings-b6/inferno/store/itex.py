"""itex.py : the Inferno covers' prints, from the surface Store's own matchbook.png (store-v1/mbtex.py): its letters,
flame and match are taken off the red card as masks and repainted, so every shape stays where the surface cover has it.
    python3 itex.py   ->  cover-<d|e|f>.png (colour) and cover-<d|e|f>-glow.png (its own light; black = none), and
                          cover-e-plain.png and -glow.png: E's cover without the words MATCH BOOK
                          cover-e-w<1..4>.png and -glow.png: E's cover with the words weathered (worn(), below)
                          cover-e-new.png: E's cover with the words whole (before the wear; for the pictures only)
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


# ---------------------------------------------------------------------------------- E's words, weathered (owner, 22 Nov)
# "make some of the alphabets scratched off, or dropped off": the words stay MATCH BOOK, as on a burnt old sign. Four
# levels of wear, each the level below and more (nothing lost ever comes back):
#   1  the second O of BOOK has dropped off (its pale ghost and two rivet holes stay; istore.py lays the letter on the
#      ground), A's and K's feet are scorched away, M and H are scratched across, C burns low
#   2  and: the T hangs askew by one rivet and burns low, M's left leg and B's foot are eaten, H burns low
#   3  and: the T has gone too (ghost), C is half eaten, the first O is scratched across, K is down to its stem
#   4  and: M and H are mostly eaten, B burns low
# STORE_WEAR=light (the game's): standing 1, damaged 2, destroyed 3.   STORE_WEAR=heavy: 2, 3, 4.
# The wear is letter-sized on purpose: at the game's size a letter is 6 to 12 px tall and a fine scratch is not seen.
BOX = dict(M=(32, 670, 181, 802), A=(208, 670, 338, 802), T=(359, 670, 480, 802), C=(504, 668, 624, 804),
           H=(660, 668, 785, 802), B=(42, 862, 186, 1001), O1=(218, 860, 383, 1003), O2=(412, 860, 577, 1003),
           K=(615, 862, 771, 1001))


def cloud(rng, cell, amp):
    """mottle() with its own dice (the wear must not move the clouds of the covers made after it)."""
    w, h = W // cell + 2, H // cell + 2
    n = Image.new("L", (w, h))
    n.putdata([max(0, min(255, round(128 + rng.gauss(0, 1) * 128 * amp))) for _ in range(w * h)])
    return n.resize((W, H), Image.BICUBIC)


def box_mask(name, pad=8):
    x0, y0, x1, y1 = BOX[name]
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rectangle((x0 - pad, y0 - pad, x1 + pad, y1 + pad), fill=255)
    return m


def worn(level):
    """-> (the letters still there, L; the ghosts of the dropped ones, L; their rivet holes, L; the scorch, L)."""
    rng = random.Random(22 + 0)                 # the same dice at every level: a level is the one below and more
    rough = cloud(rng, 14, 0.55)
    rough2 = cloud(rng, 30, 0.5)
    cut = Image.new("L", (W, H), 0)             # 255: the letter is eaten away here (scorched: ragged)
    d = ImageDraw.Draw(cut)
    gouge = Image.new("L", (W, H), 0)           # 255: scratched off here (clean strokes)
    gd = ImageDraw.Draw(gouge)

    def bite(x, y, rx, ry):
        d.ellipse((x - rx, y - ry, x + rx, y + ry), fill=255)

    def scratch(x0, y0, x1, y1, n, wd, spread):
        for i in range(n):
            o = (i - (n - 1) / 2) * spread
            j0, j1 = rng.uniform(-6, 6), rng.uniform(-6, 6)
            gd.line((x0 + o + j0, y0 - o * 0.3, x1 + o + j1, y1 - o * 0.3), fill=255, width=wd)

    dim = Image.new("L", (W, H), 255)           # how hot a letter still burns

    def burn_low(name, v):
        dim.paste(v, (BOX[name][0] - 8, BOX[name][1] - 8, BOX[name][2] + 8, BOX[name][3] + 8))

    dropped = ["O2"]
    bite(214, 800, 46, 44)                      # A: its left foot
    bite(770, 1004, 50, 46)                     # K: its lower leg's end
    scratch(60, 650, 190, 820, 3, 11, 22)       # M
    scratch(772, 655, 690, 815, 3, 10, 20)      # H
    burn_low("C", 150)
    if level >= 2:
        bite(40, 780, 46, 60)                   # M: its left leg
        bite(60, 1004, 52, 40)                  # B: its foot
        burn_low("H", 140)
        burn_low("T", 150)
    if level >= 3:
        dropped.append("T")
        bite(560, 790, 62, 50)                  # C: its lower half
        scratch(240, 850, 370, 1010, 3, 12, 24)  # the first O
        bite(745, 880, 60, 44)                  # K: its upper arm
        bite(790, 970, 60, 70)
    if level >= 4:
        bite(120, 800, 70, 60)
        bite(160, 680, 40, 40)
        bite(760, 760, 60, 70)
        bite(700, 670, 40, 30)
        burn_low("B", 150)
    # ragged edges: the bites' rims are pushed about by a cloud, then cut hard
    cut = cut.filter(ImageFilter.GaussianBlur(9))
    near = cut.point(lambda v: 255 if v > 24 else 0)                       # (no pinholes away from a bite)
    cut = ImageChops.multiply(ImageChops.add(cut, rough, 1.0, -128), near)
    cut = cut.point(lambda v: 255 if v > 120 else 0).filter(ImageFilter.GaussianBlur(1.5))
    cut = ImageChops.lighter(cut, gouge.filter(ImageFilter.GaussianBlur(1.5)))
    keep = ImageChops.multiply(ImageChops.multiply(letters, ImageChops.invert(cut)), dim)
    ghost = Image.new("L", (W, H), 0)
    holes = Image.new("L", (W, H), 0)
    hd = ImageDraw.Draw(holes)
    for name in dropped:
        bm = box_mask(name)
        ghost = ImageChops.lighter(ghost, ImageChops.multiply(letters, bm))
        keep = ImageChops.multiply(keep, ImageChops.invert(bm))
    for x, y in ((440, 931), (549, 931)) + (((420, 690), (420, 786)) if "T" in dropped else ()):
        hd.ellipse((x - 9, y - 9, x + 9, y + 9), fill=255)
    if level == 2:                              # the T hangs askew by its top rivet, slipped a little
        x0, y0, x1, y1 = BOX["T"]
        keep = ImageChops.multiply(keep, ImageChops.invert(box_mask("T")))
        pad = 60
        t = ImageChops.multiply(letters, box_mask("T"))
        t = t.crop((x0 - pad, y0 - pad, x1 + pad, y1 + pad)).rotate(-18, Image.BICUBIC,
                                                                          center=(pad + (x1 - x0) / 2, pad + 14))
        t = t.point(lambda v: v * 150 // 255)
        slip = Image.new("L", (W, H), 0)
        slip.paste(t, (x0 - pad + 4, y0 - pad + 14))
        keep = ImageChops.lighter(keep, slip)
    # the scorch: a sooty halo where letters were eaten (not where one dropped off whole), ragged
    scorch = ImageChops.multiply(letters, ImageChops.subtract(cut, gouge)).filter(ImageFilter.GaussianBlur(7))
    scorch = ImageChops.multiply(scorch, rough2.point(lambda v: min(255, v * 2)))
    return keep, ghost, holes, scorch


def make(v, base, letter, flame_col, head_col, glow_flame, glow_letter, words=True, wear=0):
    col = times(times(Image.new("RGB", (W, H), base), mottle(24, 0.14)), mottle(90, 0.2))
    dark = col.point(lambda x: round(x * 0.4))
    col = Image.composite(col, dark, rim)
    mask, glow_mask = letters, letters
    if words and wear:
        mask, ghost, holes, scorch = worn(wear)
        col = Image.composite(col.point(lambda x: round(x * 0.45)), col, scorch)
        # a dropped letter's ghost: the iron it kept from the soot, paler, a dark line round it, its two rivet holes
        line = ImageChops.subtract(ghost.filter(ImageFilter.MaxFilter(13)), ghost)
        col = Image.composite(col.point(lambda x: round(x * 0.5)), col, line.point(lambda x: x * 3 // 4))
        col = Image.composite(col.point(lambda x: min(255, round(x * 1.7 + 14))), col, ghost.point(lambda x: x * 4 // 5))
        col = Image.composite(Image.new("RGB", (W, H), (12, 10, 10)), col, holes.filter(ImageFilter.GaussianBlur(1.5)))
        glow_mask = mask.point(lambda x: x * x // 255)      # a letter burning low gives far less light
    if words:
        col = Image.composite(times(Image.new("RGB", (W, H), letter), mottle(40, 0.12)), col, mask)
    col = Image.composite(Image.new("RGB", (W, H), flame_col), col, flame)
    col = Image.composite(Image.new("RGB", (W, H), head_col), col, head)
    col.save(HERE / f"cover-{v}.png")
    g = Image.new("RGB", (W, H), (0, 0, 0))
    if words:
        g = Image.composite(times(Image.new("RGB", (W, H), glow_letter), mottle(30, 0.35)), g, glow_mask)
    g = Image.composite(times(Image.new("RGB", (W, H), glow_flame), mottle(30, 0.35)), g, flame)
    g.filter(ImageFilter.GaussianBlur(2)).save(HERE / f"cover-{v}-glow.png")


# d: the red card burnt dark, ash letters, the flame an ember
make("d", (112, 34, 30), (176, 160, 136), (236, 120, 30), (20, 14, 14), (255, 110, 20), (0, 0, 0))
# e: black iron, the letters and the flame branded in and glowing; the words weathered (worn(), levels 1 to 4), and
# e-plain without the words (STORE_LETTERS=0 in istore.py): every one on the same iron, only the letters differ
E_COVER = ((50, 46, 48), (200, 84, 22), (255, 150, 40), (14, 10, 10), (255, 120, 24), (190, 60, 10))
before_e = rnd.getstate()
make("e-new", *E_COVER)                     # the words whole, as they were before the wear (kept for the pictures)
after_e = rnd.getstate()
for level in (1, 2, 3, 4):
    rnd.setstate(before_e)
    make(f"e-w{level}", *E_COVER, wear=level)
rnd.setstate(before_e)
make("e-plain", *E_COVER, words=False)
rnd.setstate(after_e)
# f: blackened copper, brass letters and flame, no glow
make("f", (112, 60, 34), (190, 134, 56), (206, 150, 60), (30, 22, 18), (0, 0, 0), (0, 0, 0))
