"""Builds the in-game files for the six autumn decorations.

For each: the yard picture at 2x (exactly twice the 1x size, so Pixi draws it at the 1x size),
a Flash-style shadow JPEG (white ground, drawn with a multiply blend), and a 120x160 build-menu
button JPEG in the Flash buttons' style (object and its shadow on white).
Prints the art offsets (from the building's origin) for the art rows.
"""
import sys
from pathlib import Path
from PIL import Image, ImageFilter, ImageChops

SRC = Path(sys.argv[1])          # art-samples/autumn-decor/v2/out
ASSETS = Path(sys.argv[2])       # server/public/assets
OUT = ASSETS / "buildings/decorations/autumn"
BUTTONS = ASSETS / "buildingbuttons"
OUT.mkdir(parents=True, exist_ok=True)

# type, file name, footprint size
ITEMS = [
    (201, "leaf-pile-rake", 40),
    (202, "apple-barrel", 30),
    (203, "pie-stump", 30),
    (204, "harvest-wheelbarrow", 40),
    (205, "turkey-topiary", 40),
    (206, "autumn-maple", 40),
]

# Where the art's bottom edge sits below the origin, by footprint (Flash: acorn, walnut and
# birdhouse 21, outhouse 23 at size 30; scarecrow 29, hammock and lawn chair 30 at size 40).
BOTTOM = {30: 22, 40: 30}

SHEAR_X = 0.45   # shadow leans right by this much per pixel of height (Flash scarecrow ~0.4)
SQUASH = 0.28    # and rises this much per pixel of height
DARK = 0.62      # the build buttons' shadow strength (unchanged since first made)
# The yard shadows, matched to Flash's of similar size (Bonsai, Bird House, Beehive, Outhouse):
# their darkest pixel 50-90 of 255 and most of the shadow solid, so darker and crisper than the
# first cut, which the tester found too light and soft (10 Nov 2026).
YARD_DARK = 0.75
YARD_BLUR = 0.7
YARD_FADE_FLOOR = 0.6


def shadow_mask(
    alpha: Image.Image, scale: float = 1.0, dark: float = DARK, blur_px: float = 1.6, floor: float = 0.35
) -> tuple[Image.Image, int, int]:
    """The shadow cast by `alpha` (an L image) as an L mask, and where its top-left sits relative
    to the art's bottom-left corner."""
    w, h = alpha.size
    pad_x = int(w + h * SHEAR_X) + 8
    pad_y = int(h * SQUASH) + 16
    cw, ch = w + pad_x * 2, h + pad_y * 2
    canvas = Image.new("L", (cw, ch), 0)
    ox, bottom = pad_x, pad_y + h  # art's left edge and bottom row in the canvas
    canvas.paste(alpha, (ox, bottom - h))
    # output (u, v) <- input (x, y): v = bottom - SQUASH*hgt, u = x + SHEAR_X*hgt, hgt = bottom - y
    a = 1.0
    b = SHEAR_X / SQUASH
    c = -SHEAR_X / SQUASH * bottom
    d = 0.0
    e = 1.0 / SQUASH
    f = bottom - bottom / SQUASH
    sheared = canvas.transform((cw, ch), Image.AFFINE, (a, b, c, d, e, f), resample=Image.BILINEAR)
    blur = sheared.filter(ImageFilter.GaussianBlur(blur_px * scale))
    # fade with distance from the base: rows further up (further from bottom) fade out
    fade = Image.new("L", (cw, ch), 0)
    px = fade.load()
    span = max(1.0, h * SQUASH)
    for yy in range(ch):
        dist = max(0.0, bottom - yy)
        val = int(255 * dark * max(floor, 1.0 - 0.55 * dist / span))
        for xx in range(cw):
            px[xx, yy] = val
    mask = ImageChops.multiply(blur, fade)
    bbox = mask.point(lambda p: 255 if p > 6 else 0).getbbox()
    mask = mask.crop(bbox)
    return mask, bbox[0] - ox, bbox[1] - bottom


def to_jpeg_shadow(mask: Image.Image) -> Image.Image:
    white = Image.new("L", mask.size, 255)
    return ImageChops.subtract(white, mask).convert("RGB")


for type_id, name, size in ITEMS:
    one = Image.open(SRC / f"{name}.png").convert("RGBA")
    two = Image.open(SRC / f"{name}@2x.png").convert("RGBA")
    w, h = one.size
    two = two.resize((w * 2, h * 2), Image.LANCZOS)
    two.save(OUT / f"{name}@2x.png", optimize=True)

    bottom = BOTTOM[size]
    top_x, top_y = -round(w / 2), bottom - h
    mask, sx, sy = shadow_mask(one.getchannel("A"), dark=YARD_DARK, blur_px=YARD_BLUR, floor=YARD_FADE_FLOOR)
    to_jpeg_shadow(mask).save(OUT / f"{name}-shadow.jpg", quality=90)
    shadow_x, shadow_y = top_x + sx, bottom + sy
    print(f"{type_id} {name} size {size} top {w}x{h} at ({top_x},{top_y}) shadow {mask.size[0]}x{mask.size[1]} at ({shadow_x},{shadow_y})")

    # Build-menu button: 120x160 white, the object fitted into 80x96, bottom at y 128.
    scale = min(80 / two.width, 96 / two.height)
    big = two.resize((max(1, round(two.width * scale)), max(1, round(two.height * scale))), Image.LANCZOS)
    button = Image.new("RGB", (120, 160), (255, 255, 255))
    bx = (120 - big.width) // 2 - 4
    by = 128 - big.height
    bmask, bsx, bsy = shadow_mask(big.getchannel("A"), scale=scale)
    shade = Image.new("RGB", bmask.size, (0, 0, 0))
    # multiply-like: darken white by mask * 0.6
    button.paste(shade, (bx + bsx, 128 + bsy), bmask.point(lambda p: int(p * 0.6)))
    button.paste(big, (bx, by), big)
    button.save(BUTTONS / f"{type_id}.jpg", quality=92)
