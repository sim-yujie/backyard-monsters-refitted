"""post.py : the sample pictures and loops of the clean-room Bone Cruncher (crusher.py's renders in render/).

python post.py stills            tier1-3.png, tiers.png, crops (crop-t<tier>-<part>.png), game-1x.png, game-2x.png
python post.py anim <tier>       tier<tier>-anim.mp4 (the loop three times) and the loop check
python post.py loop <tier>       only the loop check

A frame is the base picture (every still part and the ground shadow) with the moving parts' layer laid over it. The
camera is kit.py's: Flash px (sx, sy) of world point (X, Y, Z) = (SX (X + Y), 35 + SY (X - Y) - SZ Z), canvas
x -60..60, y -70..70.
"""
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

D = Path(__file__).resolve().parent
R = D / "render"                        # the stills; anim/render holds the loops
FRAME = (-60, -70, 60, 70)
ORIGIN = (0.0, 35.0)
SX = 10 * math.cos(math.radians(45))
SY = 10 * math.sin(math.radians(45)) * math.sin(math.radians(30))
SZ = 10 * math.cos(math.radians(30))
N = 36
BG = (150, 160, 140, 255)
GROUND = (74, 56, 46, 255)              # a dark Inferno ground for the game-size pictures
NAMES = {1: "Tier 1 (levels 1-2)", 2: "Tier 2 (levels 3-6)", 3: "Tier 3 (levels 7-10)"}


def font(n):
    for f in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(f, n)
        except OSError:
            pass
    return ImageFont.load_default()


def frame(t, k=0):
    base = Image.open(R / f"L{t}-base.png").convert("RGBA")
    parts = Image.open(R / f"L{t}-parts-{k:02d}.png").convert("RGBA")
    if parts.size != base.size:
        parts = parts.resize(base.size, Image.LANCZOS)
    base.alpha_composite(parts)
    return base


def to_px(im, X, Y, Z):
    k = im.width / (FRAME[2] - FRAME[0])
    sx = ORIGIN[0] + SX * (X + Y)
    sy = ORIGIN[1] + SY * (X - Y) - SZ * Z
    return (sx - FRAME[0]) * k, (sy - FRAME[1]) * k


def box_of(im, pts, pad=0.06):
    xs, ys = zip(*[to_px(im, *p) for p in pts])
    w = max(xs) - min(xs)
    h = max(ys) - min(ys)
    p = pad * max(w, h)
    return (int(max(0, min(xs) - p)), int(max(0, min(ys) - p)), int(min(im.width, max(xs) + p)),
            int(min(im.height, max(ys) + p)))


def cube(x0, x1, y0, y1, z0, z1):
    return [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]


def on(im, bg=BG):
    out = Image.new("RGBA", im.size, bg)
    out.alpha_composite(im)
    return out


def bbox_all(t, ks, pad=12):
    """The box round the building itself (not its ground shadow): the picture without the ground, and the moving
    parts' layers."""
    a = np.array(Image.open(R / f"L{t}-alone.png").getchannel("A")) > 8
    for k in ks:
        a |= np.array(Image.open(R / f"L{t}-parts-{k:02d}.png").getchannel("A")) > 8
    ys, xs = np.nonzero(a)
    return (max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad),
            min(a.shape[0], ys.max() + pad))


def enlarge(im, w=900):
    if im.width >= w:
        return im
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)


CROPS = {
    "feeder": {1: cube(-3.4, 2.1, -0.3, 2.9, 0.0, 4.9), 2: cube(-0.9, 0.6, 0.2, 3.7, 2.4, 5.5),
               3: cube(-0.9, 0.6, 0.2, 3.7, 2.4, 5.5)},
    "rollers": {t: cube(-2.6, 2.6, -1.7, 1.7, 0.9, 2.9) for t in (1, 2, 3)},
    "drive": {t: cube(3.0, 3.5, -1.35, 1.35, 0.25, 2.35) for t in (1, 2, 3)},
    "chimney": {3: cube(0.8, 2.3, 2.6, 3.9, 0.0, 6.0)},
    "wedge": {3: cube(-1.9, 0.4, -4.4, -2.6, 0.0, 1.2)},
}


def stills():
    ims = {t: frame(t) for t in (1, 2, 3)}
    bbs = [bbox_all(t, [0], 40) for t in (1, 2, 3)]
    bb = (min(b[0] for b in bbs), min(b[1] for b in bbs), max(b[2] for b in bbs), max(b[3] for b in bbs))
    for t, im in ims.items():
        on(im).crop(bb).save(D / f"tier{t}.png")
        for part, boxes in CROPS.items():
            if t in boxes:
                enlarge(on(im).crop(box_of(im, boxes[t]))).save(D / f"crop-t{t}-{part}.png")
    # the three side by side, labelled
    cw, ch = bb[2] - bb[0], bb[3] - bb[1]
    sheet = Image.new("RGBA", (3 * cw, ch + 70), BG)
    d = ImageDraw.Draw(sheet)
    for i, t in enumerate((1, 2, 3)):
        sheet.alpha_composite(ims[t].crop(bb), (i * cw, 70))
        d.text((i * cw + 20, 18), NAMES[t], fill=(30, 30, 30, 255), font=font(34))
    sheet.save(D / "tiers.png")
    # game size: the whole 120 x 140 canvas at 1x and 2x, three side by side on a dark Inferno ground
    for s in (1, 2):
        w, h = 120 * s, 140 * s
        g = Image.new("RGBA", (3 * w, h), GROUND)
        for i, t in enumerate((1, 2, 3)):
            g.alpha_composite(ims[t].resize((w, h), Image.LANCZOS), (i * w, 0))
        g.save(D / f"game-{s}x.png")
    print("DONE stills", bb)


def loopcheck(t):
    """1) Frame 36 (one whole loop on) against frame 0: must be the same picture (only render noise).
    2) The jump from the last frame to the first against the usual step between frames.
    3) Pixels that change between frames outside the moving parts' layer: must be 0."""
    def arr(k):
        return np.asarray(frame(t, k), dtype=np.float32)
    f0 = arr(0)
    steps = [np.abs(arr(k + 1) - arr(k)).mean() for k in range(0, N - 1, 5)]
    jump = np.abs(f0 - arr(N - 1)).mean()
    res = {"mean step": float(np.mean(steps)), "last->first": float(jump)}
    p36 = R / f"L{t}-parts-{N:02d}.png"
    if p36.exists():
        f36 = arr(N)
        res["frame36 vs frame0 mean"] = float(np.abs(f36 - f0).mean())
        res["frame36 vs frame0 pixels >8"] = int((np.abs(f36 - f0).max(axis=2) > 8).sum())
    base = np.asarray(Image.open(R / f"L{t}-base.png").convert("RGBA"), dtype=np.float32)
    moving = np.zeros(base.shape[:2], bool)
    for k in range(N):
        moving |= np.asarray(Image.open(R / f"L{t}-parts-{k:02d}.png").getchannel("A")) > 0
    out = 0
    for k in range(1, N):
        diff = np.abs(arr(k) - f0).max(axis=2) > 1
        out += int((diff & ~moving).sum())
    res["changed pixels outside the moving layer"] = out
    print("LOOP tier", t, res)
    return res


def anim(t):
    tmp = R / f"mp4-{t}"
    tmp.mkdir(exist_ok=True)
    fr = [frame(t, k) for k in range(N)]
    bb = bbox_all(t, range(N), 30)
    w, h = bb[2] - bb[0], bb[3] - bb[1]
    w, h = w + w % 2, h + h % 2
    for rep in range(3):
        for k, im in enumerate(fr):
            on(im).crop((bb[0], bb[1], bb[0] + w, bb[1] + h)).convert("RGB").save(tmp / f"f{rep * N + k:03d}.png")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "40/3", "-i", str(tmp / "f%03d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", str(D / f"tier{t}-anim.mp4")], check=True)
    for p in tmp.glob("*.png"):
        p.unlink()
    tmp.rmdir()
    print("DONE anim", t)
    loopcheck(t)


if __name__ == "__main__":
    if sys.argv[1] in ("anim", "loop"):
        R = D / "anim" / "render"
    if sys.argv[1] == "stills":
        stills()
    elif sys.argv[1] == "anim":
        anim(int(sys.argv[2]))
    else:
        loopcheck(int(sys.argv[2]))
