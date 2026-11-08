"""contact.py : the owner's desk sheet. Three existing painted badges, then every new one, each at 176, 60 and 24 px.

Reads web/public/achievements/badge-<id>.webp; writes art-samples/badges/contact-sheet.png (all) and
contact-sheet-small.png (60 px and 24 px only, as the game shows them).
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
SRC = ROOT / "web" / "public" / "achievements"
OUT = ROOT / "art-samples" / "badges"
OLD = {1: "Moving Up", 10: "Kozu Crusher", 22: "Top of the Heap"}
NEW = {14: "Better Together", 18: "Into the Depths", 19: "Rock Bottom", 20: "Hall of the Deep", 21: "Hellraiser",
       23: "Neighbourly", 24: "Regular", 25: "Popular", 26: "Kozu Hunter", 27: "Landlord"}
font = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 19)
small = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
BG = (32, 38, 46, 255)


def full():
    CW, CH, COLS = 300, 250, 5
    groups = [("Existing painted badges (for comparison)", OLD), ("New badges", NEW)]
    height = sum(40 + -(-len(g) // COLS) * CH for _, g in groups)
    sheet = Image.new("RGBA", (COLS * CW, height), BG)
    d = ImageDraw.Draw(sheet)
    y = 0
    for title, group in groups:
        d.text((16, y + 8), title, font=font, fill=(255, 210, 90))
        y += 40
        for n, (i, name) in enumerate(group.items()):
            x0, y0 = (n % COLS) * CW, y + (n // COLS) * CH
            b = Image.open(SRC / f"badge-{i}.webp").convert("RGBA")
            sheet.alpha_composite(b, (x0 + 14, y0 + 10))
            sheet.alpha_composite(b.resize((60, 60), Image.LANCZOS), (x0 + 214, y0 + 30))
            sheet.alpha_composite(b.resize((24, 24), Image.LANCZOS), (x0 + 232, y0 + 130))
            d.text((x0 + 244, y0 + 94), "60 px", font=small, fill=(170, 180, 190), anchor="mt")
            d.text((x0 + 244, y0 + 158), "24 px", font=small, fill=(170, 180, 190), anchor="mt")
            d.text((x0 + CW // 2, y0 + 200), f"{i}. {name}", font=font, fill="white", anchor="mt")
        y += -(-len(group) // COLS) * CH
    sheet.convert("RGB").save(OUT / "contact-sheet.png", optimize=True)


def game_size():
    """The sizes the game uses, enlarged 2x with no smoothing so the owner sees the real pixels."""
    items = list(OLD.items()) + list(NEW.items())
    CW, CH = 96, 120
    sheet = Image.new("RGBA", (len(items) * CW, CH), BG)
    d = ImageDraw.Draw(sheet)
    for n, (i, _) in enumerate(items):
        b = Image.open(SRC / f"badge-{i}.webp").convert("RGBA")
        sheet.alpha_composite(b.resize((60, 60), Image.LANCZOS), (n * CW + 18, 10))
        sheet.alpha_composite(b.resize((24, 24), Image.LANCZOS), (n * CW + 36, 80))
        d.text((n * CW + CW // 2, 106), str(i), font=small, fill=(255, 210, 90) if i in OLD else "white", anchor="mm")
    sheet = sheet.resize((sheet.width * 2, sheet.height * 2), Image.NEAREST)
    sheet.convert("RGB").save(OUT / "contact-sheet-game-size.png", optimize=True)


if __name__ == "__main__":
    full()
    game_size()
    print(OUT / "contact-sheet.png")
    print(OUT / "contact-sheet-game-size.png")
