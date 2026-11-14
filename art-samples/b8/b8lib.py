"""Pillow-only helpers shared by build_fort.py and build_underhall.py (this PC's python3 has Pillow but no numpy)."""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
B = REPO / "server/public/assets/buildings"
sys.path.insert(0, "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts")
import artlib  # noqa: E402

DARK = (24, 28, 24)


def multiply(bg, sh, x, y):
    """Multiply a shadow JPEG onto an RGB picture at (x, y), as the yard does."""
    box = (max(0, x), max(0, y), min(bg.width, x + sh.width), min(bg.height, y + sh.height))
    if box[2] <= box[0] or box[3] <= box[1]:
        return bg
    part = sh.convert("RGB").crop((box[0] - x, box[1] - y, box[2] - x, box[3] - y))
    bg = bg.copy()
    bg.paste(ImageChops.multiply(bg.crop(box), part), box)
    return bg


def resize_pm(im, size):
    """Lanczos resize with premultiplied alpha (no dark fringes)."""
    return im.convert("RGBA").convert("RGBa").resize(size, Image.LANCZOS).convert("RGBA")


def key_green(im):
    """RGBA cut-out of a painting on flat green #00FF00: soft alpha by how much green leads, rim despilled."""
    r, g, b = im.convert("RGB").split()
    other = ImageChops.lighter(r, b)
    lead = ImageChops.subtract(g, other)                       # 0 on the building, ~255 on the ground
    alpha = lead.point(lambda v: 255 if v <= 24 else 0 if v >= 84 else round(255 * (84 - v) / 60))
    g2 = ImageChops.darker(g, other)                           # green never above red/blue: no green fringe
    out = Image.merge("RGBA", (r, g2, b, alpha))
    return out


def solid(im, thr=128):
    return im.getchannel("A").point(lambda v: 255 if v >= thr else 0)


def ends_bottom(im):
    """The lowest solid pixel at the piece's left and right ends (its two corners), averaged."""
    a = solid(im)
    x0, _, x1, _ = a.getbbox()
    n = max(2, round((x1 - x0) * 0.06))
    return (a.crop((x0, 0, x0 + n, a.height)).getbbox()[3] + a.crop((x1 - n, 0, x1, a.height)).getbbox()[3]) / 2


def band(im, thr=128):
    """(left, right, bottom, top) of the solid shape, left/right measured over its bottom 30%."""
    a = solid(im, thr)
    _, top, _, bot = a.getbbox()
    cut = round(bot - 0.3 * (bot - top))
    l, _, r, _ = a.crop((0, cut, a.width, bot)).getbbox()
    return l, r, bot, top


def label(im, text, size=30, fill=(255, 255, 255)):
    d = ImageDraw.Draw(im)
    f = artlib.font(size)
    d.rectangle((0, 0, d.textlength(text, font=f) + 24, size + 16), fill=(20, 24, 20))
    d.text((12, 6), text, font=f, fill=fill)
    return im


def titled(title, body, size=40):
    s = Image.new("RGB", (body.width, body.height + size + 30), DARK)
    ImageDraw.Draw(s).text((20, 12), title, font=artlib.font(size), fill=(255, 255, 255))
    s.paste(body, (0, size + 30))
    return s


def hstack(ims, gap=12):
    s = Image.new("RGB", (sum(i.width for i in ims) + gap * (len(ims) - 1), max(i.height for i in ims)), DARK)
    x = 0
    for i in ims:
        s.paste(i, (x, 0)); x += i.width + gap
    return s


def vstack(ims, gap=12):
    s = Image.new("RGB", (max(i.width for i in ims), sum(i.height for i in ims) + gap * (len(ims) - 1)), DARK)
    y = 0
    for i in ims:
        s.paste(i, (0, y)); y += i.height + gap
    return s


def despill_magenta(im):
    """Takes the magenta cast off a keyed cut-out (red and blue never both above green) and pulls its soft rim in
    by a pixel, so no pink line is left on brass, bone or stone. Not for pink or purple objects."""
    from PIL import ImageFilter
    r, g, b, a = im.convert("RGBA").split()
    excess = ImageChops.subtract(ImageChops.darker(r, b), g)
    a = a.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    return Image.merge("RGBA", (ImageChops.subtract(r, excess), g, ImageChops.subtract(b, excess), a))
