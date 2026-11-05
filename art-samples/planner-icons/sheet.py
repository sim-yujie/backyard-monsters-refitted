"""Review sheet for the Yard Planner icons: each new icon at 64 and 24 px (from the game files in
web/public/ui/icons) on the Modern steel bar and on Classic parchment, beside three existing icons.

usage: python -I sheet.py [out.png]   (default: ../../art-review/planner-icons-sheet.png)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ICONS = HERE.parents[1] / "web" / "public" / "ui" / "icons"
NEW = ["undo", "redo", "select", "box", "find", "wallupgrade", "rearm", "select2", "box2", "rearm2"]
OLD = ["levelup", "lastarmy", "shield"]
GROUNDS = [("Modern steel", (58, 70, 82)), ("Classic parchment", (248, 228, 192))]
CELL = 96


def main(out):
    names = [n for n in NEW if (ICONS / f"{n}-64.webp").exists()] + OLD
    font = ImageFont.load_default()
    W = 150 + CELL * len(names)
    H = 30 + len(GROUNDS) * 2 * CELL
    sheet = Image.new("RGB", (W, H), (30, 30, 30))
    d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        d.text((150 + i * CELL + 4, 8), n, fill=(230, 230, 230), font=font)
    y = 30
    for label, col in GROUNDS:
        for side in (64, 24):
            d.rectangle((0, y, W, y + CELL - 1), fill=col)
            ink = (230, 230, 230) if sum(col) < 400 else (40, 30, 20)
            d.text((6, y + CELL // 2 - 6), f"{label} {side}px", fill=ink, font=font)
            for i, n in enumerate(names):
                im = Image.open(ICONS / f"{n}-{side}.webp").convert("RGBA")
                bg = Image.new("RGBA", im.size, col + (255,))
                bg.alpha_composite(im)
                sheet.paste(bg.convert("RGB"), (150 + i * CELL + (CELL - side) // 2, y + (CELL - side) // 2))
            y += CELL
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parents[1] / "art-review" / "planner-icons-sheet.png")
