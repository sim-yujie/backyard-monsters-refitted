"""Game files for a wonder on the 70 spot from a full-size cut-out, sized by its BASE width, with a shadow that
starts at the base's lower edges (no gap), a soft dark contact ring round the base, and the art-row offsets.

    python seat_files.py --src <dir of name.full.png> --out <assets folder> [--suffix .modern --format webp]
        --item name:basewidth_1x [--item ...] [--button-dir <buildingbuttons> --type name=214,...]

The base is centred on the footprint's centre (35 px below the origin at size 70), so the picture's bottom
(the base's front corner) stands 35 + basewidth/4 below the origin, as the Eiffel Tower's does.
Shadow: each pixel is taken to stand on the base's lower outline in its own column (the ground line), at the
height it rises above it, and is cast to the right and back like the Flash shadows (0.45 px right and 0.28 px
up per px of height). A pixel on the ground line casts onto itself, so the shadow touches the base.
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

sys.path.insert(0, "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from make_game_files import flash_button  # noqa: E402

SHEAR_X, SQUASH = 0.45, 0.28
DARK, FLOOR, BLUR = 0.72, 0.45, 0.8
CENTRE_Y = 35
SKIRT, SKIRT_DX, SKIRT_DARK = 3, 3, 0.55  # 2x px: the contact ring's width, shift to the right, strength


def cast_shadow(alpha2):
    """alpha2: L image at 2x. Returns (mask L at 1x, left, top) with left/top relative to the picture's top-left (1x)."""
    w, h = alpha2.size
    a = alpha2.load()
    ground = [max((y for y in range(h) if a[x, y] > 128), default=None) for x in range(w)]
    pad_r = int(h * SHEAR_X) + 20
    pad_t = (int(h * SQUASH) + 20) // 2 * 2
    cw, ch = w + pad_r + 20, h + pad_t + 20
    canvas = Image.new("L", (cw, ch), 0)
    c = canvas.load()
    span = max(1.0, h * SQUASH)
    for x in range(w):
        g = ground[x]
        if g is None:
            continue
        for y in range(g + 1):
            v = a[x, y]
            if v < 40:
                continue
            ht = g - y
            sx = int(round(x + SHEAR_X * ht)) + 20
            sy = int(round(g - SQUASH * ht)) + pad_t
            dark = DARK * max(FLOOR, 1.0 - 0.55 * (SQUASH * ht) / span)
            val = int(255 * dark * v / 255)
            for dx in (0, 1):  # forward splat, 2 px wide so no holes between columns
                for dy in (0, 1):
                    xx, yy = sx + dx, sy + dy
                    if 0 <= xx < cw and 0 <= yy < ch and c[xx, yy] < val:
                        c[xx, yy] = val
    canvas = canvas.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(BLUR * 2))
    # contact shadow: the ground darkens in a thin soft ring round the base, most on the right (away from the
    # light), so the base reads as sitting on the yard (Flash's Liberty and Big Ben have the same dark foot)
    # (the base's own diamond, not the whole picture: a wisp of steam must not get a dark halo)
    solid = Image.new("L", (w, h), 0)
    A = w / 2
    ImageDraw.Draw(solid).polygon([(A, h), (0, h - A / 2), (A, h - A), (w, h - A / 2)], fill=255)
    ring = Image.new("L", (cw, ch), 0)
    ring.paste(solid, (20 + SKIRT_DX, pad_t))
    ring = ring.filter(ImageFilter.MaxFilter(SKIRT * 2 + 1)).filter(ImageFilter.GaussianBlur(SKIRT))
    canvas = ImageChops.lighter(canvas, ring.point(lambda v: int(v * SKIRT_DARK)))
    # back to 1x, cropped
    one = canvas.resize((cw // 2, ch // 2), Image.LANCZOS)
    bbox = one.point(lambda p: 255 if p > 6 else 0).getbbox()
    return one.crop(bbox), bbox[0] - 10, bbox[1] - pad_t // 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--item", action="append", required=True, help="name:basewidth_1x")
    ap.add_argument("--suffix", default="")
    ap.add_argument("--format", default="png", choices=["png", "webp"])
    ap.add_argument("--buttons", help="buildingbuttons folder: also write Flash-style buttons")
    ap.add_argument("--types", default="", help="name=type,... for the buttons")
    a = ap.parse_args()
    types = dict(p.split("=") for p in a.types.split(",") if p)
    out = Path(a.out)
    for spec in a.item:
        name, base = spec.split(":")
        base = float(base)
        full = Image.open(Path(a.src) / f"{name}.full.png").convert("RGBA")
        # full.png is cropped tight; its width is the base width (checked by measure.py)
        k = 2 * base / full.width
        w2, h2 = round(full.width * k / 2) * 2, round(full.height * k / 2) * 2
        two = full.resize((w2, h2), Image.LANCZOS)
        top = out / f"{name}{a.suffix}@2x.{a.format}"
        if a.format == "webp":
            two.save(top, lossless=False, quality=92, method=6)
        else:
            two.save(top, optimize=True)
        w1, h1 = w2 // 2, h2 // 2
        bottom = round(CENTRE_Y + w1 / 4)
        top_x, top_y = -(w1 // 2), bottom - h1
        mask, sx, sy = cast_shadow(two.getchannel("A"))
        ImageChops.subtract(Image.new("L", mask.size, 255), mask).convert("RGB").save(
            out / f"{name}{a.suffix}-shadow.jpg", quality=90)
        print(f"{name}: [\"{top.name}\", {top_x}, {top_y}], [\"{name}{a.suffix}-shadow.jpg\", {top_x + sx}, {top_y + sy}]"
              f"  (1x {w1}x{h1}, bottom {bottom})")
        if a.buttons and name in types:
            flash_button(two, Path(a.buttons) / f"{types[name]}.jpg")


if __name__ == "__main__":
    main()
