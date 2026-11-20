"""export.py <variant> [<out folder>] : write one fitted shop (runs/shop-<variant>/new-4x.png) as game files.

    ~/.cache/bymr-art-venv/bin/python -I web/tools/store-inferno/export.py A

Writes, by default into buildings/generalstore/ (the Inferno General Store's folder, which it shares with the
surface's), top.ishop<variant>@2x.webp (cut to its pixels at half the 4x size, every top-left on whole 1x pixels;
Pixi reads `@2x` as 2 px a world px) and shadow.ishop<variant>.jpg (cast from its own outline to the lower right,
the dark crisp yard shadow of the game-art skill's make_game_files.py). The variant letter is in the names, so a
different pick is a new file and needs no BUILDING_ART_VERSION bump. Prints the TierArt row for
INFERNO_PAINTED_BUILDING_ART[12].
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter

sys.path.insert(0, str(Path(__file__).parent))
from common import CANVAS, FOLDER, OUT, UP, resize_pm  # noqa: E402

# The yard shadow of the game-art skill's make_game_files.py (.claude/skills/game-art/scripts/, kept outside git),
# copied as it is.
SHEAR_X = 0.45   # shadow leans right by this much per pixel of height (Flash scarecrow ~0.4)
SQUASH = 0.28    # and rises this much per pixel of height
DARK = 0.62      # the build buttons' shadow strength
# Yard shadows, matched to Flash's of similar size (Bonsai, Bird House, Beehive, Outhouse): darkest pixel
# 50-90 of 255, most of the shadow solid. The first cut (DARK, blur 1.6, floor 0.35) was too light and
# soft in the yard (tester, 10 Nov 2026).
YARD_DARK, YARD_BLUR, YARD_FLOOR = 0.75, 0.7, 0.6
BOTTOM = {20: 15, 30: 22, 40: 30, 50: 37, 60: 45}


def shadow_mask(alpha, scale=1.0, dark=DARK, blur_px=1.6, floor=0.35):
    """The shadow cast by `alpha` (an L image) as an L mask, and its top-left relative to the art's bottom-left."""
    w, h = alpha.size
    pad_x = int(w + h * SHEAR_X) + 8
    pad_y = int(h * SQUASH) + 16
    cw, ch = w + pad_x * 2, h + pad_y * 2
    canvas = Image.new("L", (cw, ch), 0)
    ox, bottom = pad_x, pad_y + h
    canvas.paste(alpha, (ox, bottom - h))
    b = SHEAR_X / SQUASH
    sheared = canvas.transform((cw, ch), Image.AFFINE,
                               (1.0, b, -b * bottom, 0.0, 1.0 / SQUASH, bottom - bottom / SQUASH),
                               resample=Image.BILINEAR)
    blur = sheared.filter(ImageFilter.GaussianBlur(blur_px * scale))
    fade = Image.new("L", (cw, ch), 0)
    px = fade.load()
    span = max(1.0, h * SQUASH)
    for yy in range(ch):
        val = int(255 * dark * max(floor, 1.0 - 0.55 * max(0.0, bottom - yy) / span))
        for xx in range(cw):
            px[xx, yy] = val
    mask = ImageChops.multiply(blur, fade)
    bbox = mask.point(lambda p: 255 if p > 6 else 0).getbbox()
    return mask.crop(bbox), bbox[0] - ox, bbox[1] - bottom



variant = sys.argv[1]
dest = Path(sys.argv[2]) if len(sys.argv) > 2 else FOLDER
dest.mkdir(parents=True, exist_ok=True)
CW, CH, OX, OY = CANVAS
im4 = Image.open(OUT / "runs" / f"shop-{variant}" / "new-4x.png").convert("RGBA")
x0, y0, x1, y1 = im4.getbbox()
box = (x0 // UP * UP, y0 // UP * UP, -(-x1 // UP) * UP, -(-y1 // UP) * UP)
part = im4.crop(box)
two = resize_pm(part, (part.width // 2, part.height // 2))
top = f"top.ishop{variant}@2x.webp"
two.save(dest / top, "WEBP", quality=92, method=6, exact=False)
tx, ty = box[0] // UP - OX, box[1] // UP - OY
one = resize_pm(part, (part.width // UP, part.height // UP))
mask, sx, sy = shadow_mask(one.getchannel("A"), dark=YARD_DARK, blur_px=YARD_BLUR, floor=YARD_FLOOR)
shadow = f"shadow.ishop{variant}.jpg"
ImageChops.subtract(Image.new("L", mask.size, 255), mask).convert("RGB").save(dest / shadow, quality=90)
bottom = ty + one.height
print(f'    {{ from: 1, top: ["{top}", {tx}, {ty}], shadow: ["{shadow}", {tx + sx}, {bottom + sy}], lift: 0 }},')
