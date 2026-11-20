"""Quick look: each cut arrow on a drawn dock disc (Modern slate, Classic brown), normal and greyed, at 3x.
usage: python3 -I preview_discs.py <cut folder> <out.png> name,name,...  (names without prev/next prefix)"""
import sys
from PIL import Image, ImageDraw
src, out, cols = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
LOOKS = {"modern": ((0x63, 0x77, 0x8a), (0x26, 0x31, 0x3c), (0xa4, 0x60, 0x2e)),
         "classic": ((0xa0, 0x6a, 0x32), (0x40, 0x22, 0x0a), (0xec, 0xc7, 0x7e))}
S = 3; D = 68 * S; ART = int(sys.argv[4]) if len(sys.argv) > 4 else 40

def disc(top, bot, rim):
    im = Image.new("RGBA", (D, D), (0, 0, 0, 0)); px = im.load()
    cx, cy, r = D / 2, D * 0.35, D * 0.75
    for y in range(D):
        for x in range(D):
            if (x - D / 2) ** 2 + (y - D / 2) ** 2 <= (D / 2) ** 2:
                t = min(1, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / r)
                px[x, y] = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3)) + (255,)
    ImageDraw.Draw(im).ellipse((1, 1, D - 2, D - 2), outline=rim + (255,), width=3 * S)
    return im

rows = []
for look, (top, bot, rim) in LOOKS.items():
    base = disc(top, bot, rim)
    for grey in (False, True):
        row = Image.new("RGBA", (len(cols) * 2 * (D + 12 * S), D + 12 * S), (70, 110, 50, 255))
        for i, c in enumerate(cols):
            for j, d in enumerate(("prev", "next")):
                art = Image.open(f"{src}/{d}{c}.full.png").convert("RGBA")
                s = ART * S / max(art.size); art = art.resize((round(art.width * s), round(art.height * s)), Image.LANCZOS)
                if grey:
                    g = art.convert("LA").convert("RGBA"); g.putalpha(art.getchannel("A")); art = g
                b = base.copy(); b.alpha_composite(art, ((D - art.width) // 2, (D - art.height) // 2))
                if grey:
                    b.putalpha(b.getchannel("A").point(lambda a: int(a * 0.55)))
                row.alpha_composite(b, ((i * 2 + j) * (D + 12 * S) + 6 * S, 6 * S))
        rows.append(row)
sheet = Image.new("RGBA", (rows[0].width, sum(r.height for r in rows)))
y = 0
for r in rows: sheet.alpha_composite(r, (0, y)); y += r.height
sheet.convert("RGB").save(out)
