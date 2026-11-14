"""uh_final_vet.py : the numbers and the overlay picture for vetting the final Under Hall pass.
Prints, per level: the picture's box in game px, its width against level 3, how much of level 3's body is unchanged
in levels 4-6, brightness/contrast of the shared pixels, the edge darkness; writes sheets/underhall-final-overlay-3-vs-4.png
(level 3 | level 4 | where they differ, 4x). Run: ~/.cache/bymr-art-venv/bin/python uh_final_vet.py
"""
import json

from uh_final_lib import F, FINAL, OX2, OY2, WORK, Image, arr, blur, frame_of, grey, level3, np

TODAY = {1: ("top.c1@2x.webp", -52, -30), 2: ("top.c2@2x.webp", -51, -58), 3: ("top.c3@2x.webp", -51, -54)}


def box1x(im):
    x0, y0, x1, y1 = im.getchannel("A").point(lambda v: 255 if v >= 128 else 0).getbbox()
    return [(x0 - OX2) / 2, (y0 - OY2) / 2, (x1 - OX2) / 2, (y1 - OY2) / 2]


def edge_dark(a):
    """Mean brightness of the outermost 2 px ring of the shape against the whole shape: lower = darker outline."""
    al = a[..., 3]
    inner = blur((al > 0.5).astype(np.float32), 2) > 0.97
    ring = (al > 0.9) & ~inner
    return float(grey(a)[ring].mean() / grey(a)[al > 0.9].mean())


ref = arr(level3())
w3 = None
for lv in range(1, 7):
    im = frame_of(Image.open(F / TODAY[lv][0]), *TODAY[lv][1:]) if lv <= 3 else Image.open(WORK / f"body{lv}@2x.png").convert("RGBA")
    b = box1x(im)
    if lv == 3:
        w3, h3 = b[2] - b[0], b[3] - b[1]
    a = arr(im)
    line = f"level {lv} body box (game px) x {b[0]}..{b[2]} y {b[1]}..{b[3]}  width {b[2] - b[0]}  height {b[3] - b[1]}  edge/whole brightness {edge_dark(a):.3f}"
    if lv >= 4:
        both = (a[..., 3] > 0.95) & (ref[..., 3] > 0.95)
        d = np.abs(a[..., :3] - ref[..., :3]).max(-1)
        same = both & (d < 4 / 255)
        line += (f"  width vs L3 {100 * ((b[2] - b[0]) / w3 - 1):+.1f}%  body height vs L3 {100 * ((b[3] - b[1]) / h3 - 1):+.1f}%"
                 f"  identical to L3 (within 4/255): {100 * same.sum() / (ref[..., 3] > 0.95).sum():.1f}% of L3's pixels"
                 f"  shared-pixel brightness L3 {grey(ref)[both].mean():.3f} / this {grey(a)[both].mean():.3f}")
    print(line)
info = json.loads((FINAL / "anim.json").read_text())
for lv in (4, 5, 6):
    f, x, y = info[str(lv)]["top"]
    t = Image.open(FINAL / f.replace(".webp", ".png"))
    print(f"level {lv} still with flame: {t.size} px at 2x, at ({x}, {y}); top {y} vs level 3's -54: {-54 - y} game px taller")
# overlay sheet: level 3 | level 4 | difference
l3, l4 = level3(), Image.open(WORK / "body4@2x.png").convert("RGBA")
d = np.abs(arr(l4) - arr(l3)).max(-1)
crop, z = (40, 280, 310, 640), 4
def v(im):
    bg = Image.new("RGBA", im.size, (70, 40, 36, 255)); bg.alpha_composite(im)
    return bg.crop(crop).resize(((crop[2] - crop[0]) * z, (crop[3] - crop[1]) * z), Image.LANCZOS).convert("RGB")
dm = Image.fromarray((np.clip(d * 4, 0, 1) * 255).astype(np.uint8)).convert("RGB").crop(crop).resize(((crop[2] - crop[0]) * z, (crop[3] - crop[1]) * z))
s = Image.new("RGB", ((crop[2] - crop[0]) * z * 3, (crop[3] - crop[1]) * z))
for i, x in enumerate((v(l3), v(l4), dm)):
    s.paste(x, (i * (crop[2] - crop[0]) * z, 0))
(FINAL / "sheets").mkdir(exist_ok=True)
s.save(FINAL / "sheets" / "underhall-final-overlay-3-vs-4.png")
