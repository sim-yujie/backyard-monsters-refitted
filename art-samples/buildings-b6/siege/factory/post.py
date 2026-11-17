"""post.py : the Siege Factory's pictures and loops from factory.py's renders (run with ./py: numpy and Pillow).

./py post.py fit [k]     work/cmp-fit.png: Flash cell k beside the quick fit render (work/fit-L1.png), and a half-and-half
                         overlay
./py post.py frames      anim/frames/f-NN.png (base + moving parts + the pump's smoke), idle.png (frame 0, no smoke)
./py post.py mp4         factory-working.mp4 (Flash beside 3D, the loop three times), factory-working-3d.mp4
./py post.py sheets      sheet-idle.png, sheet-working.png, sheet-damaged.png (Flash beside 3D, same scale, at the
                         render's full size), crop-*.png close-ups, shadow.png
./py post.py game        game/: idle.png, working-strip.png (35 cells side by side), damaged.png, shadow.png at the game's 2x
                         size (2 px per Flash px; the canvas 230 x 210 Flash px, its top left at (-84, -104))
./py post.py check       the loop check: frame 35 against frame 0, what changes outside the moving parts, loop-check.png

The canvas is factory.py's: Flash px x -84..146, y -104..106, the building's anchor at (0, 0).
"""
import math
import random
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

D = Path(__file__).resolve().parent
FLASH = D.parents[3] / "server/public/assets/buildings/siegefactory"
FRAME = (-84, -104, 146, 106)
N = 35
BG = (112, 142, 72, 255)                # yard grass
W, H = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
CROP = (-82, -102, 100, 96)             # the building, its smoke and most of its shadow, in Flash px
MOUTH = (42.0, -50.0)                   # where the smoke leaves the pump box (Flash px)


def font(n):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", n)
    except OSError:
        return ImageFont.load_default()


def flash(i=0, shadow=True, state=""):
    """Flash's Siege Factory on the canvas at 1x: cell i of its strip over its still (or its damaged still)."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if shadow:
        sh = Image.open(FLASH / "shadow.1.jpg").convert("L")
        s = Image.new("RGBA", sh.size, (0, 0, 0, 0))
        s.putalpha(sh.point(lambda v: int((255 - v) * 0.6)))
        im.alpha_composite(s, (-29 - FRAME[0], 14 - FRAME[1]))
    if state == "damaged":
        im.alpha_composite(Image.open(FLASH / "top.1.damaged.v3.png").convert("RGBA"), (-75 - FRAME[0], -88 - FRAME[1]))
        return im
    im.alpha_composite(Image.open(FLASH / "top.1.v3.png").convert("RGBA"), (-75 - FRAME[0], -23 - FRAME[1]))
    a = Image.open(FLASH / "anim.1.v2.png").convert("RGBA")
    im.alpha_composite(a.crop((129 * i, 0, 129 * i + 129, 77)), (-58 - FRAME[0], -99 - FRAME[1]))
    return im


PUFFS = []
_r = random.Random(5)
for _ in range(420):
    PUFFS.append(dict(b=_r.uniform(0, N), life=_r.uniform(11, 16), side=_r.uniform(-1, 1), rise=_r.uniform(36, 52),
                      r=_r.uniform(0.6, 1.3), tone=_r.random(), wob=_r.uniform(0, 6.28), amp=_r.uniform(1.5, 5)))


def smoke(k, size):
    """The smoke layer of frame k (RGBA, `size` px): thin yellow-green wisps from behind the pump box's far end, up
    and a little to the right, as Flash's. The puffs are born all round the loop (their age wraps at N), so the
    smoke never stops and frame N is frame 0."""
    kpx = size[0] / W
    acc = np.zeros((size[1], size[0]))
    col = np.zeros((size[1], size[0], 3))
    for p in PUFFS:
        t = ((k - p["b"]) % N) / p["life"]
        if not 0 <= t <= 1:
            continue
        x = MOUTH[0] + 13 * t ** 0.8 + p["side"] * (1.5 + 7.0 * t) + p["amp"] * t * math.sin(p["wob"] + 7 * t)
        y = MOUTH[1] - p["rise"] * t ** 1.05
        r = p["r"] * (2.6 + 7.5 * t ** 0.8)
        a = 0.17 * min(1.0, t / 0.12) * (1 - t) ** 1.1
        cx, cy = (x - FRAME[0]) * kpx, (y - FRAME[1]) * kpx
        rp = r * kpx
        x0, x1 = max(0, int(cx - rp)), min(size[0], int(cx + rp) + 2)
        y0, y1 = max(0, int(cy - 1.5 * rp)), min(size[1], int(cy + 1.5 * rp) + 2)
        if x0 >= x1 or y0 >= y1:
            continue
        yy, xx = np.mgrid[y0:y1, x0:x1]
        d = np.hypot(xx - cx, (yy - cy) / 1.5) / rp           # taller than wide: streaks
        al = a * np.clip((1.0 - d) / 0.7, 0, 1) ** 1.5
        c = np.array([190, 188, 64]) * (1 - p["tone"] * 0.6) + np.array([138, 158, 70]) * p["tone"] * 0.6
        w = (slice(y0, y1), slice(x0, x1))
        col[w] = col[w] * (1 - al[..., None]) + c * al[..., None]
        acc[w] = 1 - (1 - acc[w]) * (1 - al)
    out = np.zeros((size[1], size[0], 4), np.uint8)
    out[..., :3] = np.where(acc[..., None] > 1e-4, col / np.maximum(acc[..., None], 1e-4), 0).clip(0, 255)
    out[..., 3] = (acc * 255).clip(0, 255)
    return Image.fromarray(out, "RGBA")


_HAZE = {}


def haze(size):
    """Flash's pale ground haze round the foot: a soft pale-green ellipse laid under the building."""
    if size not in _HAZE:
        kpx = size[0] / W
        yy, xx = np.mgrid[0:size[1], 0:size[0]]
        d = np.hypot((xx / kpx + FRAME[0] + 6) / 70.0, (yy / kpx + FRAME[1] - 52) / 31.0)
        al = 0.6 * np.clip((1.0 - d) / 0.4, 0, 1) ** 1.2
        out = np.zeros((size[1], size[0], 4), np.uint8)
        out[..., :3] = (160, 182, 124)
        out[..., 3] = (al * 255).astype(np.uint8)
        _HAZE[size] = Image.fromarray(out, "RGBA")
    return _HAZE[size]


def grounded(im):
    out = haze(im.size).copy()
    out.alpha_composite(im)
    return out


def frame(R, k, with_smoke=True):
    base = grounded(Image.open(R / "L1-base.png").convert("RGBA"))
    base.alpha_composite(Image.open(R / f"L1-parts-{k:02d}.png").convert("RGBA"))
    if with_smoke:
        base.alpha_composite(smoke(k % N, base.size))
    return base


def on(im, bg=BG):
    out = Image.new("RGBA", im.size, bg)
    out.alpha_composite(im)
    return out


def label(im, text, size=None):
    im = im.copy()
    d = ImageDraw.Draw(im)
    f = font(size or max(14, im.width // 34))
    d.text((12, 8), text, font=f, fill=(255, 255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0, 255))
    return im


def pair(fl, m, zoom=None, names=("Flash", "3D"), crop=CROP):
    """Flash beside the 3D picture at the 3D picture's own size (Flash enlarged with hard pixels)."""
    k = m.width // W
    box = tuple((v - o) * k for v, o in zip(crop, (FRAME[0], FRAME[1]) * 2))
    a = on(fl.resize(m.size, Image.NEAREST)).crop(box)
    b = on(m).crop(box)
    out = Image.new("RGBA", (a.width * 2 + 8, a.height), (30, 20, 16, 255))
    out.paste(label(a, names[0]), (0, 0))
    out.paste(label(b, names[1]), (a.width + 8, 0))
    if zoom:
        out = out.resize((round(out.width * zoom), round(out.height * zoom)), Image.LANCZOS)
    return out


def fit(k=0):
    m = Image.open(D / "work" / "fit-L1.png").convert("RGBA")
    fl = flash(k, shadow=False)
    c = (-82, -102, 82, 72)
    p = pair(fl, m, crop=c)
    p.save(D / "work" / "cmp-fit.png")
    # overlay: the 3D picture with Flash's outline (alpha edge) drawn in red
    kk = m.width // W
    big = fl.resize(m.size, Image.NEAREST)
    a = np.asarray(big)[..., 3] > 128
    edge = a & ~(np.roll(a, 1, 0) & np.roll(a, -1, 0) & np.roll(a, 1, 1) & np.roll(a, -1, 1))
    arr = np.asarray(on(m)).copy()
    arr[edge] = (255, 0, 0, 255)
    mix = Image.blend(on(big), on(m), 0.5)
    box = tuple((v - o) * kk for v, o in zip(c, (FRAME[0], FRAME[1]) * 2))
    out = Image.new("RGBA", ((box[2] - box[0]) * 2 + 8, box[3] - box[1]), (0, 0, 0, 255))
    out.paste(Image.fromarray(arr, "RGBA").crop(box), (0, 0))
    out.paste(mix.crop(box), (box[2] - box[0] + 8, 0))
    out.save(D / "work" / "cmp-overlay.png")
    print("made cmp-fit.png, cmp-overlay.png")


def frames():
    R = D / "anim" / "render"
    out = D / "anim" / "frames"
    out.mkdir(exist_ok=True)
    ks = [k for k in range(N + 1) if (R / f"L1-parts-{k:02d}.png").exists()]
    for k in ks:
        frame(R, k).save(out / f"f-{k:02d}.png")
    frame(R, 0, False).save(D / "anim" / "idle.png")
    print("frames", len(ks), "->", out)


def mp4():
    F = D / "anim" / "frames"
    tmp = D / "anim" / "mp4"
    for sub in ("pair", "solo"):
        (tmp / sub).mkdir(parents=True, exist_ok=True)
    for k in range(N):
        m = Image.open(F / f"f-{k:02d}.png").convert("RGBA")
        pair(flash(k), m, zoom=0.5).convert("RGB").save(tmp / "pair" / f"{k:02d}.png")
        kk = m.width // W
        box = tuple((v - o) * kk for v, o in zip(CROP, (FRAME[0], FRAME[1]) * 2))
        s = on(m).crop(box)
        s.resize((s.width // 2, s.height // 2), Image.LANCZOS).convert("RGB").save(tmp / "solo" / f"{k:02d}.png")
    for sub, name in (("pair", "factory-working.mp4"), ("solo", "factory-working-3d.mp4")):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "2", "-framerate", "25", "-i",
                        str(tmp / sub / "%02d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-crf", "14", str(D / name)], check=True)
        print("made", D / name)


CROPS = (("machine", (-22, -102, 34, -24), 12), ("wheels", (-60, -72, 14, -22), 24), ("pump", (4, -62, 56, -2), 9),
         ("rim", (-56, -30, 46, 26), 0), ("foot", (-70, 16, 60, 78), 0), ("leftbone", (-66, -80, -20, 46), 0))


def sheets():
    F = D / "anim" / "frames"
    idle = Image.open(D / "anim" / "idle.png").convert("RGBA")
    pair(flash(0), idle, names=("Flash (idle)", "3D (idle)")).save(D / "sheet-idle.png")
    k = 6
    pair(flash(k), Image.open(F / f"f-{k:02d}.png").convert("RGBA"),
         names=(f"Flash (working, cell {k})", f"3D (working, frame {k})")).save(D / "sheet-working.png")
    for name, box, k in CROPS:
        m = Image.open(F / f"f-{k:02d}.png").convert("RGBA") if k else idle
        pair(flash(k), m, crop=box, names=("Flash", "3D")).save(D / f"crop-{name}.png")
    dm = D / "damaged" / "render" / "L1-damaged-base.png"
    if dm.exists():
        pair(flash(0, state="damaged"), grounded(Image.open(dm).convert("RGBA")),
             names=("Flash (damaged)", "3D (damaged)")).save(D / "sheet-damaged.png")
    # the ground shadow alone: the base picture's pixels outside the building (the no-ground render's alpha)
    R = D / "anim" / "render"
    base = np.asarray(Image.open(R / "L1-base.png").convert("RGBA")).copy()
    alone = np.asarray(Image.open(R / "L1-alone.png").convert("RGBA"))[..., 3]
    sh = base.copy()
    sh[..., 3] = (base[..., 3].astype(float) * (1 - alone / 255.0)).astype(np.uint8)
    sh[..., :3] = 0
    Image.fromarray(sh, "RGBA").save(D / "shadow.png")
    print("made sheets, crops, shadow.png")


def game():
    out = D / "game"
    out.mkdir(exist_ok=True)
    size = (W * 2, H * 2)
    small = lambda im: im.convert("RGBA").resize(size, Image.LANCZOS)
    small(Image.open(D / "anim" / "idle.png")).save(out / "idle.png")
    strip = Image.new("RGBA", (size[0] * N, size[1]), (0, 0, 0, 0))
    for k in range(N):
        strip.paste(small(Image.open(D / "anim" / "frames" / f"f-{k:02d}.png")), (size[0] * k, 0))
    strip.save(out / "working-strip.png")
    small(grounded(Image.open(D / "damaged" / "render" / "L1-damaged-base.png").convert("RGBA"))).save(out / "damaged.png")
    small(Image.open(D / "shadow.png")).save(out / "shadow.png")
    print("made", out, "cells", size)


MOVING = (("machine", (-62, -104, 34, -22)), ("smoke", (26, -104, 100, -30)))


def check(tol=10):
    F = D / "anim" / "frames"
    fr = [np.asarray(Image.open(F / f"f-{k:02d}.png").convert("RGBA")).astype(np.int16) for k in range(N + 1)]
    d = lambda a, b: np.abs(a - b).max(axis=2)
    seam = d(fr[N], fr[0])
    print("frame %d against frame 0: greatest difference %d of 255, pixels over %d: %d" % (N, seam.max(), tol,
                                                                                         (seam > tol).sum()))
    steps = [float(d(fr[k], fr[(k + 1) % N]).astype(float).mean()) for k in range(N)]
    print("mean change per step: %d -> 0 is %.3f; the other steps %.3f .. %.3f" % (N - 1, steps[-1], min(steps[:-1]),
                                                                                  max(steps[:-1])))
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
            print("  %-8s %6d px change, x %.1f..%.1f y %.1f..%.1f" % (name, m.sum(), X[m].min(), X[m].max(),
                                                                         Y[m].min(), Y[m].max()))
        inside |= m
    print("pixels that change outside the machine (rocker, rod, shaft, wheels) and the smoke: %d of %d" % (
        (~inside).sum(), len(X)))
    idle = np.asarray(on(Image.open(D / "anim" / "idle.png").convert("RGBA"))).copy()
    idle[moved] = (idle[moved] * 0.35 + np.array([255, 0, 0, 255]) * 0.65).astype(np.uint8)
    Image.fromarray(idle, "RGBA").save(D / "loop-check.png")
    print("made", D / "loop-check.png")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fit"
    if cmd == "fit":
        fit(int(sys.argv[2]) if len(sys.argv) > 2 else 0)
    else:
        {"frames": frames, "mp4": mp4, "sheets": sheets, "check": check, "game": game}[cmd]()
