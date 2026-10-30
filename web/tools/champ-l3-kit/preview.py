"""preview.py <sheet> <col>[,<col>...] [scale] : old row above new (from the @4x repaint) for each column, anchor cross in red; also walk.gif of the first column."""
import sys
from PIL import Image, ImageDraw
from spec import SPECS, ASSETS
ANCH = {"ape_3": (42, 52), "dragon_3": (52, 50), "fly_3": (52, 50), "krallen_2_rev_65": (61, 60), "krallen_3_rev_65": (52, 72)}
n = sys.argv[1]; cols = [int(c) for c in sys.argv[2].split(",")]; k = int(sys.argv[3]) if len(sys.argv) > 3 else 2
s = SPECS[n]; w, h, R = s["w"], s["h"], s["rows"]
old = Image.open(ASSETS / f"{n}.png").convert("RGBA"); new = Image.open(ASSETS / f"{n}-repaint@4x.png").convert("RGBA")
out = Image.new("RGB", (R * w * k, len(cols) * 2 * h * k), (128, 128, 128)); d = ImageDraw.Draw(out)
frames = []
for j, c in enumerate(cols):
    for r in range(R):
        o = old.crop((c * w, r * h, (c + 1) * w, (r + 1) * h)).resize((w * k, h * k), Image.NEAREST)
        nw = new.crop((c * w * 4, r * h * 4, (c + 1) * w * 4, (r + 1) * h * 4)).resize((w * k, h * k), Image.LANCZOS)
        for i, im in enumerate((o, nw)):
            x, y = r * w * k, (j * 2 + i) * h * k
            bg = Image.new("RGBA", im.size, (128, 128, 128, 255)); bg.alpha_composite(im); out.paste(bg.convert("RGB"), (x, y))
            ax, ay = x + ANCH[n][0] * k, y + ANCH[n][1] * k
            d.line((ax - 4, ay, ax + 4, ay), fill=(255, 0, 0)); d.line((ax, ay - 4, ax, ay + 4), fill=(255, 0, 0))
        if j == 0:
            g = Image.new("RGB", (w * k * 2, h * k), (128, 128, 128)); g.paste(out.crop((r * w * k, 0, (r + 1) * w * k, h * k)), (0, 0))
            g.paste(out.crop((r * w * k, h * k, (r + 1) * w * k, 2 * h * k)), (w * k, 0)); frames.append(g)
out.save(f"prev-{n}.png")
frames[0].save(f"prev-{n}.gif", save_all=True, append_images=frames[1:], duration=130, loop=0)
