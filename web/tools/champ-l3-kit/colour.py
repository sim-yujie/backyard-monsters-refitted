"""colour.py : body colour mean/std of the approved sample vs painted headings vs a painted call, per sheet (mask per champion)."""
import sys
import numpy as np
from PIL import Image
from spec import SPECS, sample_views, key_cell
def mask(n, px):
    r, g, b = px[:, 0], px[:, 1], px[:, 2]
    if n == "fly_3": return np.clip((np.minimum(r, b) - g) / 40, 0, 1) > 0.5
    if n == "ape_3": return (b > r + 30) & (b > g + 5)
    if n == "dragon_3": return (r > g + 50) & (r > b + 40) & (g < 0.6 * r)
    return (r > 140) & (g > 0.55 * r) & (b < 0.6 * g)
def stats(n, ims):
    px = np.concatenate([np.asarray(i)[np.asarray(i)[..., 3] > 200][:, :3].astype(float) for i in ims])
    m = mask(n, px); return px[m].mean(0).round(1), px[m].std(0).round(1), round(m.mean(), 2)
def grid(path, n, gc=4):
    im = Image.open(path).convert("RGB"); w, h = im.size
    return [key_cell(np.asarray(im.crop((i % gc * w // gc, i // gc * h // 2, (i % gc + 1) * w // gc, (i // gc + 1) * h // 2)))) for i in range(n)]
if __name__ == "__main__":
    for n in sys.argv[1:]:
        d = SPECS[n]["sample"] / "full"
        print(n, "sample", *stats(n, sample_views(n)))
        print(n, "H     ", *stats(n, [Image.open(d / "H" / f"new-heading{i}.png") for i in range(4)]))
        for call in sorted(p.name for p in d.iterdir() if (p / "frames-new.png").exists() and p.name != "H"):
            rows = SPECS[n]["calls"][call[0]]
            print(n, call.ljust(6), *stats(n, grid(d / call / "frames-new.png", len(rows), 4 if len(rows) <= 8 else 5)))
