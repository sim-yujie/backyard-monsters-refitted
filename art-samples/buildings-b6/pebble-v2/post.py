"""post.py : the Pebble Shiner v2 sample pictures, from pebble2.py's renders (render/) and the Flash art (fref.py).

    python post.py side <level>      L<level>-side.png      Flash | 3D, large (the building fills the frame), frame 0
    python post.py outline <level>   L<level>-outline.png   Flash outline (red) on the 3D, the miss map; overlap printed
    python post.py anim <level>      L<level>-anim.mp4      Flash | 3D, the producing loop at the game's 13.3 frames a
                                     second (40 Hz yard tick, a frame every 3rd tick), three times round
    python post.py motion <level>    L<level>-motion.png    where the 3D loop changes pixels (red), beside Flash's
    python post.py levels            pebble-levels-row.png  L1 L3 L6 L10 side by side at one scale (Flash above, 3D
                                     below), lines through the parts every level shares
A 3D frame is the base picture (every still part and the ground shadow) with the frame's moving-parts layer laid over
it, so nothing outside the moving parts can change between frames.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

import fit
import fref
import stack as S

HERE = Path(__file__).resolve().parent
R = HERE / "render"
GRASS = (96, 140, 60)
FPS = 40 / 3


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def frame3d(lv, k=0, r=R):
    base = Image.open(r / f"L{lv}-base.png").convert("RGBA")
    p = r / f"L{lv}-parts-{k:02d}.png"
    if p.exists():
        base.alpha_composite(Image.open(p).convert("RGBA"))
    return base


def flash(lv, k, size):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top and the animation cell),
    scaled up."""
    sh = fref.shadow_rgba(lv).resize(size, Image.BICUBIC)
    top = fref.flash_rgba(lv, k).resize(size, Image.BICUBIC)
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(sh)
    out.alpha_composite(top)
    return out


def on_grass(im):
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return out


def box_of(lv, size):
    """One crop box for a look: Flash and 3D together, building and shadow, every frame (still parts never shift)."""
    a = np.array(fref.flash_rgba(lv).resize(size).getchannel("A")) > 8
    a |= np.array(fref.shadow_rgba(lv).resize(size).getchannel("A")) > 40
    a |= np.array(frame3d(lv, 0).getchannel("A")) > 40
    for p in sorted(R.glob(f"L{lv}-parts-*.png")):
        a |= np.array(Image.open(p).getchannel("A")) > 8
    ys, xs = np.nonzero(a)
    pad = 30
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(size[0], xs.max() + pad), min(size[1], ys.max() + pad)


def pair(ims, labels, title):
    w, h = ims[0].size
    out = Image.new("RGB", (w * len(ims) + 10 * (len(ims) + 1), h + 80), GRASS)
    d = ImageDraw.Draw(out)
    d.rectangle((0, 0, out.width, 40), fill=(24, 24, 24))
    d.text((12, 7), title, fill=(255, 255, 255), font=font(26))
    for i, (im, lab) in enumerate(zip(ims, labels)):
        x = 10 + i * (w + 10)
        d.text((x, 46), lab, fill=(255, 255, 255), font=font(22))
        out.paste(im.convert("RGB"), (x, 76))
    return out


def side(lv, k=0):
    b3 = frame3d(lv, k)
    box = box_of(lv, b3.size)
    return pair([flash(lv, k, b3.size).crop(box), on_grass(b3).crop(box)], ["Flash", "3D"], f"Pebble Shiner level {lv}")


def anim(lv):
    n = fref.frames(lv)
    tmp = HERE / "work" / f"anim{lv}"
    tmp.mkdir(parents=True, exist_ok=True)
    for f in tmp.glob("*.png"):
        f.unlink()
    for k in range(n):
        im = side(lv, k)
        im = im.crop((0, 0, im.width - im.width % 2, im.height - im.height % 2))
        im.save(tmp / f"{k:02d}.png")
    out = HERE / f"L{lv}-anim.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "2", "-framerate", f"{FPS:.4f}", "-i",
                    str(tmp / "%02d.png"), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def scr(v):
    """Flash pixel of world point v (as pebble2.scr)."""
    sx, sy, sz = 10 * np.cos(np.pi / 4), 10 * np.sin(np.pi / 4) * 0.5, 10 * np.cos(np.pi / 6)
    return S.ORIGIN[0] + sx * (v[0] + v[1]), S.ORIGIN[1] + sy * (v[0] - v[1]) - sz * v[2]


def levels():
    """The four looks at one scale and one crop: Flash on top, the 3D under it, dashed lines through the shared parts
    (each at its own height on that level: an added course lifts the parts above it)."""
    size = frame3d(1, 0).size
    k = size[0] / (fref.FRAME[2] - fref.FRAME[0])
    boxes = [box_of(lv, size) for lv in fref.LEVELS]
    box = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    w, h = box[2] - box[0], box[3] - box[1]
    gap, top = 12, 84
    out = Image.new("RGB", (4 * w + 5 * gap, top + 2 * (h + 40) + gap), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 8), "Pebble Shiner, levels 1, 3, 6, 10 at one scale: Flash (top), 3D (bottom). Red crosses: parts fixed "
           "to the body; the ring never moves, an added course lifts what sits above it", fill=(255, 255, 255), font=font(26))
    d.text((12, 44), "L3 adds the head with the spout (lifts collar, pipe, roof); L6 adds a second ring (lifts the head "
           "and up); L10 adds the drum on the peak and the ball on the collar", fill=(200, 200, 200), font=font(22))
    for i, lv in enumerate(fref.LEVELS):
        x = gap + i * (w + gap)
        for row, im in enumerate((flash(lv, 0, size), on_grass(frame3d(lv, 0)))):
            y = top + row * (h + 40 + gap // 2)
            d.text((x, y + 4), f"Level {lv}  {'Flash' if row == 0 else '3D'}", fill=(255, 255, 255), font=font(24))
            out.paste(im.crop(box).convert("RGB"), (x, y + 36))
    y3 = top + h + 40 + gap // 2 + 36
    for i, lv in enumerate(fref.LEVELS):
        x0 = gap + i * (w + gap)
        for name, v in S.mounts(lv).items():
            fx, fy = scr(v)
            py = y3 + (fy - fref.FRAME[1]) * k - box[1]
            for xx in range(x0, x0 + w - 12, 24):
                d.line((xx, py, xx + 12, py), fill=(255, 255, 255), width=2)
            cx = x0 + (fx - fref.FRAME[0]) * k - box[0]
            d.line((cx - 14, py, cx + 14, py), fill=(255, 40, 40), width=4)
            d.line((cx, py - 14, cx, py + 14), fill=(255, 40, 40), width=4)
            if i == 3:
                d.text((x0 + w - 130, py - 28), name, fill=(255, 255, 255), font=font(22))
    return out


def motion(lv):
    """Where the 3D loop changes pixels (red on the frame), beside the same for Flash."""
    ims = []
    for kind in ("flash", "3d"):
        n = fref.frames(lv)
        size = frame3d(lv, 0).size
        get = (lambda k: flash(lv, k, size)) if kind == "flash" else (lambda k: on_grass(frame3d(lv, k)))
        f0 = np.array(get(0).convert("RGB")).astype(int)
        ch = np.zeros(f0.shape[:2], bool)
        for k in range(1, n):
            ch |= np.abs(np.array(get(k).convert("RGB")).astype(int) - f0).max(-1) > 6
        a = f0.astype(float)
        a[ch] = a[ch] * 0.3 + np.array([255, 0, 0]) * 0.7
        ims.append(Image.fromarray(a.astype(np.uint8)).crop(box_of(lv, size)))
    return pair(ims, ["Flash: pixels that change in the loop", "3D"], f"Pebble Shiner level {lv}: what moves")


def still_check(lv):
    """Changed pixels between 3D frames, outside the moving parts' layers (must be 0) and in all."""
    base = np.array(frame3d(lv, 0)).astype(int)
    ch = np.zeros(base.shape[:2], bool)
    cover = np.zeros(base.shape[:2], bool)
    for p in sorted(R.glob(f"L{lv}-parts-*.png")):
        k = int(p.stem.split("-")[-1])
        f = np.array(frame3d(lv, k)).astype(int)
        ch |= np.abs(f - base).max(-1) > 0
        cover |= np.array(Image.open(p).getchannel("A")) > 0
    return int(ch.sum()), int((ch & ~cover).sum())


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "side":
        lv = int(sys.argv[2])
        side(lv).save(HERE / f"L{lv}-side.png")
    elif cmd == "outline":
        lv = int(sys.argv[2])
        r = fit.overlay(lv, R / f"L{lv}-alone.png", HERE / f"L{lv}-outline.png")
        print(f"L{lv}: overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif cmd == "anim":
        lv = int(sys.argv[2])
        print(anim(lv), "changed px (all, outside moving parts):", still_check(lv))
    elif cmd == "levels":
        levels().save(HERE / "pebble-levels-row.png")
    elif cmd == "motion":
        lv = int(sys.argv[2])
        motion(lv).save(HERE / f"L{lv}-motion.png")
