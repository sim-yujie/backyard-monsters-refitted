"""Before | after sheets from raw/<before|after>-<view>.png: compare-<view>.jpg (full screens) and
compare-<view>-crop2x.jpg (a crop of each, enlarged 2x). Usage: python compare.py"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
# Crop box (x0, y0, x1, y1) in the 1600x900 screen for each view.
CROPS = {
    "midfar": (520, 230, 1120, 630),
    "far": (500, 250, 1100, 650),
    "edge": (330, 120, 930, 520),
    "flat": (380, 200, 980, 600),
    "low": (520, 230, 1120, 630),
}
TITLES = {
    "midfar": "Middle-far zoom, tilted (High)",
    "far": "Fully zoomed out, tilted (High)",
    "edge": "Cloud edge close up, tilted (High)",
    "flat": "Tilt off (High)",
    "low": "Low quality, tilted",
}


def font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", size)
    except OSError:
        return ImageFont.load_default()


def sheet(left: Image.Image, right: Image.Image, title: str) -> Image.Image:
    gap, head = 16, 64
    out = Image.new("RGB", (left.width + right.width + gap, left.height + head), (24, 26, 32))
    out.paste(left, (0, head))
    out.paste(right, (left.width + gap, head))
    draw = ImageDraw.Draw(out)
    draw.text((12, 14), f"{title}   before (today's clouds)", fill=(235, 235, 235), font=font(28))
    draw.text((left.width + gap + 12, 14), "after (Civ-style clouds)", fill=(255, 214, 120), font=font(28))
    return out


for view, box in CROPS.items():
    before, after = RAW / f"before-{view}.png", RAW / f"after-{view}.png"
    if not (before.exists() and after.exists()):
        continue
    a, b = Image.open(before).convert("RGB"), Image.open(after).convert("RGB")
    sheet(a, b, TITLES[view]).save(HERE / f"compare-{view}.jpg", quality=90)
    w, h = box[2] - box[0], box[3] - box[1]
    ca = a.crop(box).resize((w * 2, h * 2), Image.LANCZOS)
    cb = b.crop(box).resize((w * 2, h * 2), Image.LANCZOS)
    sheet(ca, cb, TITLES[view] + ", 2x crop").save(HERE / f"compare-{view}-crop2x.jpg", quality=90)
    print(view)
