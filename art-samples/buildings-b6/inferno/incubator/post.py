"""post.py : the Incubator's pictures and loop from incubator.py's renders (needs numpy and Pillow).

python post.py frames [sub]    <sub>/frames/f-NN.png (base + moving parts + the vent's smoke), idle.png (frame 0, no
                               smoke) and flash/f-NN.png (Flash's own layers on the same canvas). sub: anim (default)
python post.py mp4             incubator-hatching.mp4 (Flash beside 3D, the loop three times) and
                               incubator-hatching-3d.mp4 (3D alone, larger)
python post.py sheets          sheet-idle.png and sheet-hatching.png: Flash beside 3D at the stills' full size
python post.py crops           crop-body.png, crop-foot.png, crop-porthole.png, crop-pump.png: Flash beside 3D, enlarged
python post.py check           loop-check.png (every pixel that changes during the loop, in red, on the idle picture)
                               and the loop's numbers: frame 50 against frame 0, the step 49 -> 0 against the other
                               steps, and how much changes outside the brood, the hose and the smoke

A frame is the base picture (every still part and the ground shadow) with the moving parts' layer laid over it, then
the smoke. The smoke is drawn here, not in Blender (as the Incubator Control Centre's glows): a broad puff of green leaves
the vent's mouth from frame 2 to 29, rise, swell and fade, all gone by frame 48, as Flash's strip (cells 45-49 clear).
The canvas is incubator.py's: Flash px x -80..80, y -60..90, the building's anchor at (0, 0).
"""
import math
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

D = Path(__file__).resolve().parent
FLASH = D.parents[3] / "server/public/assets/buildings/ihatchery"
FRAME = (-80, -60, 80, 90)
N = 50
BG = (96, 60, 52, 255)                  # a dark Inferno ground
MOUTH = (-30.5, -5.4)                   # the vent's mouth in Flash px, and the way it points (incubator.py -- 1 where)
AIM = (-0.63, -0.78)
W, H = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]


def font(n):
    for f in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "C:/Windows/Fonts/segoeuib.ttf"):
        try:
            return ImageFont.truetype(f, n)
        except OSError:
            pass
    return ImageFont.load_default()


def flash(i=0, shadow=True):
    """Flash's Incubator, cell i of its strips, on the canvas at 1x."""
    top = Image.open(FLASH / "top.1.v2.png").convert("RGBA")
    a1 = Image.open(FLASH / "anim.1.v2.png").convert("RGBA")
    a2 = Image.open(FLASH / "anim.2.v2.png").convert("RGBA")
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if shadow:
        sh = Image.open(FLASH / "shadow.1.v2.jpg").convert("L")
        s = Image.new("RGBA", sh.size, (0, 0, 0, 0))
        s.putalpha(sh.point(lambda v: 255 - v))
        im.alpha_composite(s, (-77 - FRAME[0], 15 - FRAME[1]))
    im.alpha_composite(top, (-55 - FRAME[0], -28 - FRAME[1]))
    im.alpha_composite(a1.crop((33 * i, 0, 33 * i + 33, 78)), (-48 - FRAME[0], -45 - FRAME[1]))
    im.alpha_composite(a2.crop((27 * i, 0, 27 * i + 27, 31)), (4 - FRAME[0], 13 - FRAME[1]))
    return im


PUFFS = []
_r = random.Random(5)
for _ in range(80):
    PUFFS.append(dict(b=_r.uniform(2, 29), life=_r.uniform(15, 19), side=_r.uniform(-1, 1), rise=_r.uniform(24, 31),
                      r=_r.uniform(0.8, 1.2), tone=_r.random(), wob=_r.uniform(0, 6.28)))


def smoke(k, size):
    """The smoke layer of frame k (RGBA, `size` px)."""
    kpx = size[0] / W
    acc = np.zeros((size[1], size[0]))            # 1 - product of (1 - alpha)
    col = np.zeros((size[1], size[0], 3))
    for p in PUFFS:
        t = (k - p["b"]) / p["life"]
        if not 0 <= t <= 1:
            continue
        x = MOUTH[0] + AIM[0] * (1 + 2 * t) + p["side"] * (1.4 + 11.5 * t) + 1.2 * math.sin(p["wob"] + 5 * t)
        y = MOUTH[1] + AIM[1] * (1 + 3 * t) - p["rise"] * t ** 1.15
        r = p["r"] * (3.0 + 9.0 * t ** 0.7)
        a = 0.66 * min(1.0, t / 0.12) * (1 - t) ** 1.2
        cx, cy = (x - FRAME[0]) * kpx, (y - FRAME[1]) * kpx
        rp = r * kpx
        x0, x1 = max(0, int(cx - rp)), min(size[0], int(cx + rp) + 2)
        y0, y1 = max(0, int(cy - rp)), min(size[1], int(cy + rp) + 2)
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d = np.hypot(xx - cx, yy - cy) / rp
        al = a * np.clip((1.0 - d) / 0.6, 0, 1) ** 1.5
        c = np.array([184, 190, 16]) * (1 - p["tone"] * 0.35) + np.array([120, 150, 10]) * p["tone"] * 0.35
        w = (slice(y0, y1), slice(x0, x1))
        col[w] = col[w] * (1 - al[..., None]) + c * al[..., None]
        acc[w] = 1 - (1 - acc[w]) * (1 - al)
    out = np.zeros((size[1], size[0], 4), np.uint8)
    out[..., :3] = np.where(acc[..., None] > 1e-4, col / np.maximum(acc[..., None], 1e-4), 0).clip(0, 255)
    # col is already premultiplied by coverage ("over"), so dividing by the coverage gives the puffs' own colour
    out[..., 3] = (acc * 255).clip(0, 255)
    return Image.fromarray(out, "RGBA")


def frame(R, k, with_smoke=True):
    base = Image.open(R / "L1-base.png").convert("RGBA")
    parts = Image.open(R / f"L1-parts-{k % N:02d}.png").convert("RGBA")
    base.alpha_composite(parts)
    if with_smoke:
        base.alpha_composite(smoke(k % N, base.size))
    return base


def on(im, bg=BG):
    out = Image.new("RGBA", im.size, bg)
    out.alpha_composite(im)
    return out


def frames(sub="anim"):
    R = D / sub / "render"
    out = D / sub / "frames"
    out.mkdir(exist_ok=True)
    fl = D / sub / "flash"
    fl.mkdir(exist_ok=True)
    ks = [k for k in range(N + 1) if (R / f"L1-parts-{k:02d}.png").exists()]
    for k in ks:
        (frame(R, k) if k < N else frame_raw(R, k)).save(out / f"f-{k:02d}.png")
    frame(R, 0, False).save(D / sub / "idle.png")
    for k in range(N):
        flash(k).save(fl / f"f-{k:02d}.png")
    print("frames", len(ks), "->", out)


def frame_raw(R, k):
    """Frame 50, rendered again for the loop check: frame 0's state, its own render."""
    base = Image.open(R / "L1-base.png").convert("RGBA")
    base.alpha_composite(Image.open(R / f"L1-parts-{k:02d}.png").convert("RGBA"))
    base.alpha_composite(smoke(k % N, base.size))
    return base


def label(im, text, size=None):
    size = size or max(20, im.width // 36)
    d = ImageDraw.Draw(im)
    d.text((14, 10), text, font=font(size), fill=(255, 240, 220, 255), stroke_width=2, stroke_fill=(30, 20, 16, 255))
    return im


CROP = (-62, -50, 76, 86)               # the building, its smoke and its shadow, in Flash px


def pair(fl, m, zoom=None, names=("Flash", "3D")):
    """Flash beside the 3D picture at the 3D picture's own size (Flash enlarged with hard pixels)."""
    k = m.width // W
    box = tuple((v - o) * k for v, o in zip(CROP, (FRAME[0], FRAME[1]) * 2))
    a = on(fl.resize(m.size, Image.NEAREST)).crop(box)
    b = on(m).crop(box)
    out = Image.new("RGBA", (a.width * 2 + 8, a.height), (30, 20, 16, 255))
    out.paste(label(a, names[0]), (0, 0))
    out.paste(label(b, names[1]), (a.width + 8, 0))
    if zoom:
        out = out.resize((round(out.width * zoom), round(out.height * zoom)), Image.LANCZOS)
    return out


def mp4():
    F = D / "anim" / "frames"
    tmp = D / "anim" / "mp4"
    tmp.mkdir(exist_ok=True)
    for sub in ("pair", "solo"):
        (tmp / sub).mkdir(exist_ok=True)
    for k in range(N):
        m = Image.open(F / f"f-{k:02d}.png").convert("RGBA")
        p = pair(flash(k), m)
        p.convert("RGB").save(tmp / "pair" / f"{k:02d}.png")
        kk = m.width // W
        box = tuple((v - o) * kk for v, o in zip(CROP, (FRAME[0], FRAME[1]) * 2))
        on(m).crop(box).convert("RGB").save(tmp / "solo" / f"{k:02d}.png")
    for sub, name in (("pair", "incubator-hatching.mp4"), ("solo", "incubator-hatching-3d.mp4")):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "2", "-framerate", "25", "-i",
                        str(tmp / sub / "%02d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-crf", "14", str(D / name)], check=True)
        print("made", D / name)


def sheets():
    still = D / "render"
    R = still if (still / "L1-base.png").exists() else D / "anim" / "render"
    idle = frame(R, 0, False)
    pair(flash(0), idle, names=("Flash (idle, cell 0)", "3D (idle, frame 0)")).save(D / "sheet-idle.png")
    k = 24
    A = D / "anim" / "render"
    mid = frame(A, k)
    if mid.size != idle.size:
        mid = mid.resize(idle.size, Image.LANCZOS)
    pair(flash(k), mid, names=(f"Flash (hatching, cell {k})", f"3D (hatching, frame {k})")).save(
        D / "sheet-hatching.png")
    print("made", D / "sheet-idle.png", D / "sheet-hatching.png")


def crops():
    """Flash beside 3D for the parts worth a close look, in Flash px boxes, enlarged with hard Flash pixels."""
    still = D / "render"
    m = frame(still, 0, False)
    k = m.width // W
    fl = flash(0)
    for name, box, z in (("body", (-26, -22, 38, 48), 1), ("foot", (-60, 28, 74, 84), 1),
                         ("porthole", (4, 10, 38, 48), 2), ("pump", (-50, -20, -8, 36), 1)):
        b = tuple((v - o) * k for v, o in zip(box, (FRAME[0], FRAME[1]) * 2))
        a = on(fl.resize(m.size, Image.NEAREST)).crop(b)
        c = on(m).crop(b)
        out = Image.new("RGBA", (a.width * 2 + 8, a.height), (30, 20, 16, 255))
        out.paste(a, (0, 0))
        out.paste(c, (a.width + 8, 0))
        if z != 1:
            out = out.resize((out.width * z, out.height * z), Image.LANCZOS)
        out.save(D / f"crop-{name}.png")
        print("made", D / f"crop-{name}.png", out.size)
    on(m).crop(tuple((v - o) * k for v, o in zip(CROP, (FRAME[0], FRAME[1]) * 2))).save(D / "incubator-idle.png")


# where Flash's moving parts are, in Flash px: the brood's glass, the feed hose, the vent's smoke
MOVING = (("brood", (7, 15, 33, 44)), ("hose", (-47, -2, -12, 36)), ("smoke", (-66, -60, 8, 4)))


def check(tol=10):
    F = D / "anim" / "frames"
    fr = [np.asarray(Image.open(F / f"f-{k:02d}.png").convert("RGBA")).astype(np.int16) for k in range(N + 1)]
    d = lambda a, b: np.abs(a - b).max(axis=2)
    seam = d(fr[N], fr[0])
    print("frame 50 against frame 0: greatest difference %d of 255, pixels over %d: %d" % (seam.max(), tol,
                                                                                         (seam > tol).sum()))
    steps = [float(d(fr[k], fr[(k + 1) % N]).astype(float).mean()) for k in range(N)]
    print("mean change per step: 49 -> 0 is %.3f; the other steps %.3f .. %.3f (median %.3f)" % (
        steps[-1], min(steps[:-1]), max(steps[:-1]), sorted(steps[:-1])[len(steps) // 2]))
    moved = np.zeros(seam.shape, bool)
    for k in range(N):
        moved |= d(fr[k], fr[0]) > tol
    kk = moved.shape[1] // W
    yy, xx = np.nonzero(moved)
    X, Y = xx / kk + FRAME[0], yy / kk + FRAME[1]
    inside = np.zeros(len(X), bool)
    for name, (x0, y0, x1, y1) in MOVING:
        m = (X >= x0) & (X < x1) & (Y >= y0) & (Y < y1)
        if m.any():
            print("  %-6s %6d px change, x %.1f..%.1f y %.1f..%.1f" % (name, m.sum(), X[m].min(), X[m].max(),
                                                                        Y[m].min(), Y[m].max()))
        inside |= m
    print("pixels that change outside the brood, the hose and the smoke: %d of %d" % ((~inside).sum(), len(X)))
    idle = np.asarray(on(Image.open(D / "anim" / "idle.png").convert("RGBA"))).copy()
    idle[moved] = (idle[moved] * 0.35 + np.array([255, 0, 0, 255]) * 0.65).astype(np.uint8)
    Image.fromarray(idle, "RGBA").save(D / "loop-check.png")
    print("made", D / "loop-check.png")


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "frames":
        frames(*sys.argv[2:3])
    elif cmd == "mp4":
        mp4()
    elif cmd == "sheets":
        sheets()
    elif cmd == "crops":
        crops()
    elif cmd == "check":
        check()
