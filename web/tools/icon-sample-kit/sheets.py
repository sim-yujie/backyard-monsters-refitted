"""The two review sheets for the owner.

sheet-large.png: every icon at 128 px with its name, on the game's light and dark panel colours.
sheet-real-size.png: the icons at 32 and 24 px beside the resource piles, and lines of game text
("heart 480  claw 36") in the game font, at true size on top and blown up 2x (pixel for pixel) below.
"""
from PIL import Image, ImageDraw, ImageFont

from cut import fit
from icons import ALTERNATES, NAMES, OUT, REPO, SHEET

FONT = REPO / "web" / "public" / "fonts" / "titan-one" / "titan-one-latin.woff2"
# --colour-surface-base and --colour-text of the light and dark themes (web/src/ui/styles/tokens.css)
THEMES = {"light": ((244, 246, 249), (15, 20, 28)), "dark": ((15, 20, 28), (237, 241, 245))}
PILES = ["twigs", "pebbles", "putty", "goo"]
ALL_PILES = PILES + ["bone", "coal", "sulfur", "magma"]


def icon(name, side):
    if name in ALL_PILES:
        im = Image.open(OUT / "refs" / f"resource{name}.png").convert("RGBA")
        return fit(im.crop(im.getbbox()), side, 0)
    if side in (24, 32):
        return Image.open(OUT / f"{name}-{side}.png").convert("RGBA")
    return fit(Image.open(OUT / "large" / f"{name}.png").convert("RGBA"), side, 0)


def large():
    names = SHEET + ALTERNATES
    cols, cw, ch, pad = 10, 150, 168, 14
    font = ImageFont.truetype(str(FONT), 16)
    rows = (len(names) + cols - 1) // cols
    pw, ph = cols * cw + 2 * pad, rows * ch + 2 * pad
    sheet = Image.new("RGB", (pw, 2 * ph), (0, 0, 0))
    for t, (bg, fg) in enumerate(THEMES.values()):
        p = Image.new("RGBA", (pw, ph), bg + (255,))
        d = ImageDraw.Draw(p)
        for i, n in enumerate(names):
            x, y = pad + (i % cols) * cw, pad + (i // cols) * ch
            p.alpha_composite(icon(n, 128), (x + (cw - 128) // 2, y + 4))
            d.text((x + cw // 2, y + 148), NAMES[n], font=font, fill=fg, anchor="mm")
        sheet.paste(p.convert("RGB"), (0, t * ph))
    sheet.save(OUT / "sheet-large.png")
    print("sheet-large.png", sheet.size)


def strip(bg, fg):
    """True-size view on one theme: icon rows at 32 and 24 px, then game text lines with inline icons."""
    small = ImageFont.truetype(str(FONT), 12)
    text = ImageFont.truetype(str(FONT), 16)
    names = SHEET + PILES
    w, pad = 64 + len(names) * 40, 10
    left = [
        [("health", "480"), ("damage", "36"), ("speed", "120"), ("housing", "20"), ("time", "2h 15m")],
        [("twigs", "4,837"), ("pebbles", "2,100"), ("yarddamage", "100%"), ("lost", "6"), ("retreat", "")],
        [("production", "1,250"), ("storagefull", ""), ("shield", "12h"), ("levelup", "5"), ("resourcebomb", "3")],
    ]
    right = [   # the Inferno piles, and the alternates in use
        [("bone", "3,200"), ("coal", "1,800"), ("sulfur", "950"), ("magma", "400")],
        [("swords", "36"), ("fist", "36"), ("lost2", "6"), ("yarddamage2", "100%")],
        [("production2", "1,250"), ("lastarmy", ""), ("lastarmy2", "")],
    ]
    h = pad + 40 + 34 + len(left) * 32 + pad
    p = Image.new("RGBA", (w, h), bg + (255,))
    d = ImageDraw.Draw(p)
    y = pad
    for side, rowh in ((32, 40), (24, 34)):
        d.text((pad, y + side // 2), f"{side} px", font=small, fill=fg, anchor="lm")
        for i, n in enumerate(names):
            p.alpha_composite(icon(n, side), (64 + i * 40 + (32 - side) // 2, y))
        y += rowh

    def line(x, y, items):
        for n, num in items:
            p.alpha_composite(icon(n, 24), (x, y))
            x += 28
            if num:
                d.text((x, y + 13), num, font=text, fill=fg, anchor="lm")
                x += int(d.textlength(num, font=text))
            x += 16
        return x

    x2 = max(line(pad, y + i * 32, items) for i, items in enumerate(left)) + 24
    for i, items in enumerate(right):
        print("right line ends at", line(x2, y + i * 32, items), "of", w)
    return p.convert("RGB")


def real():
    strips = [strip(bg, fg) for bg, fg in THEMES.values()]
    w, h = strips[0].size
    sheet = Image.new("RGB", (2 * w, h + 2 * (2 * h)), (128, 128, 128))
    for i, s in enumerate(strips):
        sheet.paste(s, (i * w, 0))                                           # true size
        sheet.paste(s.resize((2 * w, 2 * h), Image.NEAREST), (0, h + i * 2 * h))   # 2x, pixel for pixel
    sheet.save(OUT / "sheet-real-size.png")
    print("sheet-real-size.png", sheet.size)


if __name__ == "__main__":
    large()
    real()
