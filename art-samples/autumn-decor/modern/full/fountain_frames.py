"""Fountain check: every water frame over the new stone (Modern) beside Flash's own frame (Classic), at 3x.

    python fountain_frames.py <out.png> [<out.gif>]
Writes a contact sheet of all 42 frames (Classic | Modern pairs) and, optionally, a moving GIF of both.
"""
import os
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
D = os.path.abspath(os.path.join(HERE, "../../../../server/public/assets/buildings/decorations/fountain"))
GRASS = (98, 142, 66, 255)
W, H, N, Z = 110, 125, 42, 3  # cell size at 1x around the origin (55, 70); frames; zoom


def frame(i, modern):
    sc = 2  # build at 2x so the 2x stone keeps its detail
    c = Image.new("RGBA", (W * sc, H * sc), GRASS)
    ox, oy = 55 * sc, 70 * sc
    sh = Image.open(os.path.join(D, "shadow.jpg")).convert("L").resize((93 * sc, 44 * sc))
    dark = Image.new("RGBA", sh.size, (0, 0, 0, 255))
    dark.putalpha(sh.point(lambda p: int((255 - p) * 0.55)))
    c.alpha_composite(dark, (ox - 41 * sc, oy + 16 * sc))
    strip = Image.open(os.path.join(D, "water.png" if modern else "anim.png")).convert("RGBA")
    fr = strip.crop((i * 89, 0, i * 89 + 89, 114)).resize((89 * sc, 114 * sc), Image.BICUBIC)
    if modern:
        st = Image.open(os.path.join(D, "fountain-stone.modern@2x.webp")).convert("RGBA")
        c.alpha_composite(st, (ox - 45 * sc, oy - 44 * sc))
    c.alpha_composite(fr, (ox - 47 * sc, oy - 51 * sc))
    return c.resize((W * Z, H * Z), Image.LANCZOS)


def main():
    out = sys.argv[1]
    cols = 6
    cw, ch = W * Z * 2 + 20, H * Z + 30
    rows = (N + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cw, rows * ch), (235, 230, 220, 255))
    d = ImageDraw.Draw(sheet)
    for i in range(N):
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.alpha_composite(frame(i, False), (x, y + 24))
        sheet.alpha_composite(frame(i, True), (x + W * Z, y + 24))
        d.text((x + 6, y + 6), f"frame {i + 1}: Classic | Modern", fill=(0, 0, 0, 255))
    sheet.convert("RGB").save(out)
    print("wrote", out, sheet.size)
    if len(sys.argv) > 2:
        frames = []
        for i in range(N):
            f = Image.new("RGBA", (W * Z * 2, H * Z), GRASS)
            f.alpha_composite(frame(i, False), (0, 0))
            f.alpha_composite(frame(i, True), (W * Z, 0))
            frames.append(f.convert("RGB"))
        frames[0].save(sys.argv[2], save_all=True, append_images=frames[1:], duration=1000 // 30, loop=0)
        print("wrote", sys.argv[2])


if __name__ == "__main__":
    main()
