"""Guide sheets for the Codex redraw: in each cell the exact square base (a 2:1 isometric slab, front corner
straight down in the middle) the object must stand on, and the old cut-outs laid out on the same grid.

    python make_guides.py <old cut-outs folder (classic|modern)> <out prefix>
"""
import sys
from PIL import Image, ImageDraw

MAGENTA = (255, 0, 255, 255)
# sheet: (canvas, [(name, cell centre x, base bottom y, half width A, slab thickness)])
SHEETS = {
    "a": ((1536, 1024), [
        ("paoay-church", 256, 486, 200, 16), ("fort-santiago", 768, 486, 200, 16), ("magellans-cross", 1280, 486, 190, 16),
        ("pyramids", 256, 998, 200, 14), ("chocolate-hills", 768, 998, 200, 12), ("banaue-terraces", 1280, 998, 200, 12)]),
    "b": ((1536, 1024), [("mayon-volcano", 384, 990, 270, 12), ("rizal-monument", 1152, 990, 230, 16)]),
    # the six of "a" again, two per sheet (a 3x2 sheet of six came back turned; two per sheet came back square)
    "c": ((1536, 1024), [("paoay-church", 384, 990, 260, 16), ("fort-santiago", 1152, 990, 260, 16)]),
    "d": ((1536, 1024), [("magellans-cross", 384, 990, 250, 16), ("pyramids", 1152, 990, 260, 14)]),
    "e": ((1536, 1024), [("chocolate-hills", 384, 990, 260, 10), ("banaue-terraces", 1152, 990, 260, 10)]),
}


def slab(d, cx, b, a, t):
    h = a / 2
    top = [(cx, b - t), (cx - a, b - h - t), (cx, b - 2 * h - t), (cx + a, b - h - t)]
    left = [(cx, b), (cx - a, b - h), (cx - a, b - h - t), (cx, b - t)]
    right = [(cx, b), (cx + a, b - h), (cx + a, b - h - t), (cx, b - t)]
    d.polygon(left, fill=(150, 150, 150, 255))
    d.polygon(right, fill=(80, 80, 80, 255))
    d.polygon(top, fill=(205, 205, 205, 255))


def main():
    old, prefix = sys.argv[1], sys.argv[2]
    for key, (size, items) in SHEETS.items():
        guide = Image.new("RGBA", size, MAGENTA)
        olds = Image.new("RGBA", size, MAGENTA)
        d = ImageDraw.Draw(guide)
        for name, cx, b, a, t in items:
            slab(d, cx, b, a, t)
            im = Image.open(f"{old}/{name}.full.png").convert("RGBA")
            k = 2 * a / im.width
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
            olds.alpha_composite(im, (round(cx - im.width / 2), max(0, b - im.height)))
        guide.convert("RGB").save(f"{prefix}guide-{key}.png")
        olds.convert("RGB").save(f"{prefix}old-{key}.png")


if __name__ == "__main__":
    main()
