"""kfinish.py <level> : key sample-new.png, fit each painted frame onto the old Korath cell (same body area, same feet),
write idle-1x/walk-1x/idle-4x/walk-4x.png, and compare.png for the owner: rows idle / walk, columns
Flash original | new Korath (with a soft ground shadow, as in game) | approved Gorgo of the same level, cropped and enlarged."""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
from scipy.ndimage import gaussian_filter

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "scripts"))
from kparts import KIT, KL, APE, cell, gorgo_cell  # noqa: E402

# reuse the keyer, resizer and body measure of the champion sample finisher (its functions only, not its script part)
src_txt = (Path(__file__).parent.parent / "scripts" / "finish_sample.py").read_text(encoding="utf-8")
ns = {"np": np, "Image": Image, "ndi": ndi, "ImageFilter": __import__("PIL.ImageFilter").ImageFilter}
exec(src_txt[src_txt.index("def key_cell"):src_txt.index("src = Image.open")], ns)
key_cell, resize_pm, body = ns["key_cell"], ns["resize_pm"], ns["body"]

lvl = int(sys.argv[1])
out = KIT.parent / "korath" / f"L{lvl}"
fw, fh, wc, WALK = KL[lvl]
FRONT, UP = 2, 4
BG = (118, 124, 104)  # a muted grass-grey so lava and shadow both read


def shadow_under(c4):
    """soft dark ground ellipse under the body (like web/tools/add-champ-ground-shadow.py), behind it."""
    a = np.asarray(c4)[..., 3] >= 128
    ys, xs = np.where(a)
    top, bot = ys.min(), ys.max()
    low = a[(top + bot) // 2:bot + 1]
    cols = np.where(low)[1]
    x0, x1 = np.percentile(cols, 8), np.percentile(cols, 92)
    rx = (x1 - x0) / 2 * 1.0; ry = rx * 0.32
    cx = (x0 + x1) / 2; cy = bot - ry * 0.6
    H, W = a.shape
    yy, xx = np.mgrid[0:H, 0:W]
    m = (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 <= 1).astype(float)
    m = gaussian_filter(m, 1.25 * UP) * 0.58
    sh = np.zeros((H, W, 4), "uint8"); sh[..., 3] = (m * 255).astype("uint8")
    s = Image.fromarray(sh, "RGBA"); s.alpha_composite(c4); return s


src = Image.open(out / "sample-new.png").convert("RGB")
w, h = src.size
whole = key_cell(np.asarray(src))
wa = np.asarray(whole).copy()
# Korath has no pink or purple anywhere, so any magenta-hued pixel is background seen through a gap (between an arm
# and the body, under a harness band) that the edge-connected keyer kept: clear it and a 1 px rim around it.
s_ = np.asarray(src).astype(int)
hole = ((s_[..., 0] - s_[..., 1]) > 40) & ((s_[..., 2] - s_[..., 1]) > 40)
hole = ndi.binary_dilation(hole, iterations=1)
wa[..., 3] = np.where(hole, 0, wa[..., 3])
lab, nl = ndi.label(wa[..., 3] > 0)
painted = []
for i in (0, 1):
    m = np.zeros(lab.shape, bool)
    for j in range(1, nl + 1):
        blob = lab == j
        if blob.sum() < 200:
            continue
        if (np.where(blob)[1].mean() < w / 2) == (i == 0):
            m |= blob
    a = wa.copy(); a[..., 3] = np.where(m, a[..., 3], 0)
    painted.append(Image.fromarray(a, "RGBA"))
olds = [cell(lvl, FRONT, r) for r in (0, WALK)]

pb = body(painted[0], 128); ob = body(olds[0])
k = np.sqrt(ob[4] * UP * UP / pb[4])
res = {}
for tag, p, o in zip(("idle", "walk"), painted, olds):
    x0, y0, x1, y1, _ = body(p, 128)
    crop = resize_pm(p.crop((x0, y0, x1, y1)), (max(1, round((x1 - x0) * k)), max(1, round((y1 - y0) * k))))
    ox0, oy0, ox1, oy1, _ = body(o)
    c4 = Image.new("RGBA", (fw * UP, fh * UP), (0, 0, 0, 0))
    c4.alpha_composite(crop, (round((ox0 + ox1) / 2 * UP - crop.width / 2), round(oy1 * UP - crop.height)))
    c4.save(out / f"{tag}-4x.png")
    resize_pm(c4, (fw, fh)).save(out / f"{tag}-1x.png")
    res[tag] = c4

# compare.png: same crop window for Flash and new (so position and size compare honestly), body ~300 px tall
up_old = [o.resize((fw * UP, fh * UP), Image.LANCZOS) for o in olds]
boxes = [Image.alpha_composite(up_old[i], res[t]).getbbox() for i, t in enumerate(("idle", "walk"))]
bx0 = min(b[0] for b in boxes); by0 = min(b[1] for b in boxes); bx1 = max(b[2] for b in boxes); by1 = max(b[3] for b in boxes)
pad = 6 * UP
win = (max(0, bx0 - pad), max(0, by0 - pad), min(fw * UP, bx1 + pad), min(fh * UP, by1 + pad))
F = 340 / (win[3] - win[1])  # display scale from 4x


def tile(im4):
    c = Image.new("RGBA", im4.size, BG + (255,)); c.alpha_composite(im4)
    c = c.crop(win)
    return c.resize((round(c.width * F), round(c.height * F)), Image.LANCZOS).convert("RGB")


gw, gh = APE[lvl]
g4 = [gorgo_cell(lvl, FRONT, r) for r in (0, 3)]
gb = [g.getbbox() for g in g4]
gwin = (min(b[0] for b in gb) - pad, min(b[1] for b in gb) - pad, max(b[2] for b in gb) + pad, max(b[3] for b in gb) + pad)


def gtile(im4):
    c = Image.new("RGBA", im4.size, BG + (255,)); c.alpha_composite(im4)
    c = c.crop(gwin)
    s = min(F, 340 / c.height)
    return c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS).convert("RGB")


cols = [("Flash (old)", [tile(u) for u in up_old]),
        (f"New Korath {lvl}", [tile(shadow_under(res[t])) for t in ("idle", "walk")]),
        (f"Approved Gorgo {lvl} (style)", [gtile(g) for g in g4])]
try:
    font = ImageFont.truetype("arial.ttf", 22)
except OSError:
    font = ImageFont.load_default()
cw = [max(im.width for im in c[1]) for c in cols]
rh = [max(c[1][j].height for c in cols) for j in (0, 1)]
G = 14
img = Image.new("RGB", (sum(cw) + G * (len(cols) + 1), sum(rh) + 3 * G + 34), (34, 34, 38))
d = ImageDraw.Draw(img)
x = G
for (t, ims), wdt in zip(cols, cw):
    d.text((x, 10), t, fill=(235, 235, 235), font=font)
    y = 34 + G
    for j, im in enumerate(ims):
        img.paste(im, (x + (wdt - im.width) // 2, y + (rh[j] - im.height) // 2)); y += rh[j] + G
    x += wdt + G
img.save(out / "compare.png")
print("done", out.as_posix(), "scale", round(k, 3), img.size)
