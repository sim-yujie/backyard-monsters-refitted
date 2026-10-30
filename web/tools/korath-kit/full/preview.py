"""preview.py <sheet> <col>[,<col>...] [scale] : old row above new (from the high-resolution repaint) for each column, anchor cross in red;
also prev-<sheet>.gif (old | new) of the first column. Run from this folder."""
import sys
from PIL import Image, ImageDraw
from spec import SPECS, ASSETS
Image.MAX_IMAGE_PIXELS = None
ANCH = {"korath_1": (36, 35), "korath_2": (61, 49), "korath_3": (52, 70), "korath_4": (62, 95), "korath_5": (81, 126), "korath_6": (70, 130)}
UP = {"korath_5": 3, "korath_6": 3}
n = sys.argv[1]; cols = [int(c) for c in sys.argv[2].split(",")]; k = int(sys.argv[3]) if len(sys.argv) > 3 else 2
s = SPECS[n]; w, h = s["w"], s["h"]; R = len(s["calls"]["A"]) + len(s["calls"]["B"]) - 1
u = UP.get(n, 4)
old = Image.open(ASSETS / f"{n}.png").convert("RGBA"); new = Image.open(ASSETS / f"{n}-repaint@{u}x.png").convert("RGBA")
out = Image.new("RGB", (R * w * k, len(cols) * 2 * h * k), (118, 124, 104)); d = ImageDraw.Draw(out)
frames = []
for j, c in enumerate(cols):
    for r in range(R):
        o = old.crop((c * w, r * h, (c + 1) * w, (r + 1) * h)).resize((w * k, h * k), Image.LANCZOS)
        nw = new.crop((c * w * u, r * h * u, (c + 1) * w * u, (r + 1) * h * u)).resize((w * k, h * k), Image.LANCZOS)
        for i, im in enumerate((o, nw)):
            x, y = r * w * k, (j * 2 + i) * h * k
            bg = Image.new("RGBA", im.size, (118, 124, 104, 255)); bg.alpha_composite(im); out.paste(bg.convert("RGB"), (x, y))
            ax, ay = x + ANCH[n][0] * k, y + ANCH[n][1] * k
            d.line((ax - 4, ay, ax + 4, ay), fill=(255, 0, 0)); d.line((ax, ay - 4, ax, ay + 4), fill=(255, 0, 0))
        if j == 0:
            g = Image.new("RGB", (w * k * 2, h * k), (118, 124, 104)); g.paste(out.crop((r * w * k, 0, (r + 1) * w * k, h * k)), (0, 0))
            g.paste(out.crop((r * w * k, h * k, (r + 1) * w * k, 2 * h * k)), (w * k, 0)); frames.append(g)
out.save(f"prev-{n}.png")
frames[0].save(f"prev-{n}.gif", save_all=True, append_images=frames[1:], duration=130, loop=0)
print(out.size)
