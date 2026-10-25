"""finish_sample.py <sheet e.g. ape_2> : key sample-new.png, fit each painted frame onto the old cell (same body area, same feet),
write idle-1x.png / walk-1x.png / idle-4x.png / walk-4x.png and compare.png (old | approved level 3 repaint | new, at 2x game size, on grey)."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
from scipy import ndimage as ndi

sys.path.insert(0, str(Path(__file__).parent))
from layout import KIT, L, OUT, cell, l3_sheet, on  # noqa: E402
from parts import CHAMP  # noqa: E402

name = sys.argv[1]
fam, lvl = name.split("_")
out = OUT / CHAMP[fam] / f"L{lvl}"
fw, fh, wf, wc = L[name]
WALK, FRONT, UP = wf + 2, 2, 4
GREY = (128, 128, 128)


def key_cell(rgb):
    rgb = rgb.astype(float)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    ground = (r > 175) & (b > 175) & (g < 120) & (np.abs(r - b) < 70)
    lab, _ = ndi.label(ground)
    edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    edge.discard(0)
    fg = ndi.binary_opening(~np.isin(lab, list(edge)), iterations=1)
    lab2, _ = ndi.label(fg)
    ids, cnt = np.unique(lab2[lab2 > 0], return_counts=True)
    keep = np.zeros_like(fg)
    for i, c in zip(ids, cnt):
        if c > cnt.max() * 0.02:
            keep |= lab2 == i
    keep = ndi.binary_fill_holes(keep)
    keep = ndi.binary_erosion(keep, iterations=2)
    alpha = np.asarray(Image.fromarray((keep * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(1.2))).astype(float)
    rim = ndi.binary_dilation(keep & ~ndi.binary_erosion(keep, iterations=5), iterations=2) & (alpha > 0)
    spill = rim & (np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) < 130)
    o = rgb.copy()
    o[..., 0] = np.where(spill, np.minimum(r, g + 0.35 * (b - g)), r)
    # any pixel still close to the #FF00FF ground loses its pink (a Fomor's purple body is darker, so it is left alone)
    bad = (alpha > 0) & (np.sqrt((255 - r) ** 2 + g ** 2 + (255 - b) ** 2) < 110)
    o[..., 0] = np.where(bad, np.minimum(o[..., 0], g + 0.3 * (b - g)), o[..., 0])
    o[..., 2] = np.where(bad, np.minimum(b, g + 0.3 * (r - g)), b)
    return Image.fromarray(np.dstack([o, alpha]).astype("uint8"), "RGBA")


def resize_pm(im, size):
    a = np.asarray(im).astype("float32")
    a[..., :3] *= a[..., 3:] / 255
    ch = [np.asarray(Image.fromarray(a[..., i], "F").resize(size, Image.LANCZOS)) for i in range(4)]
    o = np.dstack(ch)
    al = np.clip(o[..., 3:], 0, 255)
    rgb = np.where(al > 0, o[..., :3] / np.maximum(al, 1e-3) * 255, 0)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), al]).astype("uint8"), "RGBA")


def body(im, thr=200):
    """bbox and area of the solid body (the old sheets' baked shadow is translucent, so alpha >= 200 drops it)."""
    m = np.asarray(im)[..., 3] >= thr
    ys, xs = np.where(m)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, m.sum()


src = Image.open(out / "sample-new.png").convert("RGB")
w, h = src.size
# key the whole canvas, then give each blob to the cell its centre is in (a spread wing can cross the middle line)
whole = key_cell(np.asarray(src))
wa = np.asarray(whole)
lab, nl = ndi.label(wa[..., 3] > 0)
painted = []
for i in (0, 1):
    m = np.zeros(lab.shape, bool)
    for j in range(1, nl + 1):
        blob = lab == j
        if blob.sum() < 200:
            continue
        cx = np.where(blob)[1].mean()
        if (cx < w / 2) == (i == 0):
            m |= blob
    a = wa.copy(); a[..., 3] = np.where(m, a[..., 3], 0)
    painted.append(Image.fromarray(a, "RGBA"))
olds = [cell(name, FRONT, r) for r in (0, WALK)]

# one scale for both frames, from the idle: painted body area = old body area x AREA
AREA = 1.0
pb = body(painted[0], 128); ob = body(olds[0])
k = np.sqrt(ob[4] * UP * UP * AREA / pb[4])
res = {}
for tag, p, o in zip(("idle", "walk"), painted, olds):
    x0, y0, x1, y1, _ = body(p, 128)
    crop = p.crop((x0, y0, x1, y1))
    crop = resize_pm(crop, (max(1, round(crop.width * k)), max(1, round(crop.height * k))))
    ox0, oy0, ox1, oy1, _ = body(o)
    c4 = Image.new("RGBA", (fw * UP, fh * UP), (0, 0, 0, 0))
    cx = (ox0 + ox1) / 2 * UP
    c4.alpha_composite(crop, (round(cx - crop.width / 2), round(oy1 * UP - crop.height)))   # centred, feet on the old feet line
    c4.save(out / f"{tag}-4x.png")
    resize_pm(c4, (fw, fh)).save(out / f"{tag}-1x.png")
    res[tag] = c4

# compare.png: rows = idle, walk; columns = old | approved level 3 repaint | new, all at 2x game size on grey
D = 2
def show(im, s):  # im at scale s -> 2x
    return on(GREY, im.resize((im.width * D // s, im.height * D // s), Image.LANCZOS if s > D else Image.NEAREST))

cols = [("Flash original", [show(o, 1) for o in olds])]
if fam != "krallen":
    f1w, f1h, w1, _ = L[f"{fam}_3"]
    sh = l3_sheet(fam)
    cols.append(("Approved level 3 (colour reference)", [show(sh.crop((FRONT * f1w * 4, r * f1h * 4, (FRONT + 1) * f1w * 4, (r + 1) * f1h * 4)), 4) for r in (0, w1 + 2)]))
cols.append((f"New level {lvl}", [show(res["idle"], 4), show(res["walk"], 4)]))
cw = max(c[1][0].width for c in cols); chh = max(c[1][0].height for c in cols)
g = Image.new("RGB", (len(cols) * (cw + 12) + 12, 2 * (chh + 8) + 30), (36, 36, 40))
d = ImageDraw.Draw(g)
for i, (t, ims) in enumerate(cols):
    x = 12 + i * (cw + 12)
    d.text((x, 8), t, fill=(230, 230, 230))
    for j, im in enumerate(ims):
        g.paste(im, (x + (cw - im.width) // 2, 28 + j * (chh + 8) + (chh - im.height)))
g.save(out / "compare.png")
print("done", out, "scale", round(k, 3))
