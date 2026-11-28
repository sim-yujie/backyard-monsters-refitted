# The gem icons' sheet (owner's pick C): python3 sheet.py ["<title>"]
# All 12 at real 30 px (1x) on the Modern and Classic slot colours, unlocked and locked, then each at 3x
# (the file drawn at 90 px, as a 3x phone shows a 30 px slot) and the 52 px pop-up size at 3x (156 px).
import sys, os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
AB = os.path.join(HERE, "..", "..", "web", "public", "ui", "abilities")
F = lambda s: ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", s)
NAMES = [("Stone Skin", "stone-skin"), ("Chest Pound", "chest-pound"), ("Ground Slam", "ground-slam"),
         ("Bloodthirst", "bloodthirst"), ("Twin Bite", "twin-bite"), ("Obsidian Hide", "obsidian-hide"),
         ("Healing Mist", "healing-mist"), ("Bubble", "bubble"), ("Acid Spit", "acid-spit"),
         ("Burn", "burn"), ("Breath of Fire", "breath-of-fire"), ("Fists of Doom", "fists-of-doom")]
# slot fills sampled from the round-4 in-game shots
MOD_ON, MOD_OFF, CLA_ON, CLA_OFF = (48, 59, 71), (70, 79, 89), (249, 227, 191), (219, 196, 155)


def load(name, locked):
    return Image.open(os.path.join(AB, "gem-c", f"{name}{'.locked' if locked else ''}.webp")).convert("RGBA")


def at(im, s):
    return im.resize((s, s), Image.LANCZOS)


def main():
    title = sys.argv[1] if len(sys.argv) > 1 else "Ability gems (C): the picture inside a cushion-cut gem, seen through its facets"
    cw = 150
    W = 12 * cw + 40
    rows_small = [("Modern, unlocked", MOD_ON, False), ("Modern, locked", MOD_OFF, True),
                  ("Classic, unlocked", CLA_ON, False), ("Classic, locked", CLA_OFF, True)]
    H = 70 + 30 + len(rows_small) * 56 + 20 + 2 * 120 + 20 + 2 * 180 + 20
    out = Image.new("RGBA", (W, H), (12, 12, 12, 255))
    d = ImageDraw.Draw(out)
    d.text((16, 14), title, fill=(255, 255, 255), font=F(24))
    y = 64
    for i, (label, _) in enumerate(NAMES):
        d.text((20 + i * cw, y), label, fill=(235, 220, 180), font=F(14))
    y += 30
    for label, bg, locked in rows_small:
        for i, (_, n) in enumerate(NAMES):
            x = 20 + i * cw
            d.rectangle((x, y, x + cw - 10, y + 48), fill=bg)
            # 1x at 30 px, then the same 30 px blown up 2x with nearest (what the eye gets on a 1x screen)
            small = at(load(n, locked), 30)
            out.alpha_composite(small, (x + 8, y + 9))
            big = small.resize((60, 60), Image.NEAREST)
            tile = Image.new("RGBA", (60, 60), bg + (255,))
            tile.alpha_composite(big)
            out.alpha_composite(tile.crop((0, 6, 60, 54)), (x + 60, y))
        d.text((W - 250, y + 52), "", fill=(200, 200, 200), font=F(12))
        d.text((4, y + 16), "", font=F(12))
        y += 56
    d.text((20, y + 2), "rows: Modern unlocked / Modern locked / Classic unlocked / Classic locked   (each: 30 px at 1x, then the same 30 px blown up 2x)", fill=(170, 170, 170), font=F(13))
    y += 22
    for label, bg, locked in [("3x, Modern", MOD_ON, False), ("3x, Classic, locked", CLA_OFF, True)]:
        for i, (_, n) in enumerate(NAMES):
            x = 20 + i * cw
            d.rectangle((x, y, x + cw - 10, y + 112), fill=bg)
            out.alpha_composite(at(load(n, locked), 90), (x + 25, y + 11))
        d.text((W - 16 - 200, y - 2), "", font=F(12))
        y += 120
    y += 4
    d.text((20, y - 4), "slots at 3x (90 px): Modern unlocked, Classic locked.   Below: the pop-up size, 52 px at 3x (156 px), Modern then Classic", fill=(170, 170, 170), font=F(13))
    y += 16
    for bg in ((58, 70, 84), (250, 236, 205)):
        for i, (_, n) in enumerate(NAMES[:6] if bg[0] < 100 else NAMES[6:]):
            x = 20 + i * 2 * cw
            d.rectangle((x, y, x + 2 * cw - 10, y + 172), fill=bg)
            out.alpha_composite(at(load(n, False), 156), (x + (2 * cw - 10 - 156) // 2, y + 8))
        y += 180
    out = out.crop((0, 0, W, y + 10))
    path = os.path.join(HERE, "gem-option-c.png")
    out.convert("RGB").save(path)
    print(path, out.size)


if __name__ == "__main__":
    main()
