"""post.py : the Wild Monster Baiter 3D sample pictures, from baiter.py's renders (render/) and the Flash art (fref.py).
Flash has one look for every Baiter level (a 41-frame loop), so there is one pair to show.

    python post.py side        baiter-side.png     Flash | 3D, large (the building and its ground shadow), frame 0
    python post.py frames      baiter-frames.png   Flash above 3D at frames 0, 8, 16, 24, 32 (the rig turning)
    python post.py anim        baiter-anim.mp4     Flash | 3D, the loop at the game's 13.3 frames a second, three times
    python post.py motion      baiter-motion.png   where each loop changes pixels (red), Flash beside 3D
    python post.py outline     baiter-outline.png  Flash outline (red) on the 3D (cyan), the miss map; overlap printed
    python post.py crops       crop-*.png          full-size crops of the main details, Flash beside 3D
    python post.py game        baiter-game.png     Flash | 3D at the game's own size (1x) and 2x, on grass
A 3D frame is the base picture (every still part and the ground shadow) with the frame's moving-parts layer laid over
it, so nothing outside the moving parts can change between frames.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import crops
import fit
import fref

HERE = Path(__file__).resolve().parent
R = HERE / "render"
GRASS = (96, 140, 60)
FPS = 40 / 3
NAME = "Wild Monster Baiter"


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def frame3d(k=0):
    base = Image.open(R / "L1-base.png").convert("RGBA")
    p = R / f"L1-parts-{k:02d}.png"
    if p.exists():
        base.alpha_composite(Image.open(p).convert("RGBA"))
    return base


def flash(k, size):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top and the animation cell)."""
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(fref.shadow_rgba().resize(size, Image.BICUBIC))
    out.alpha_composite(fref.flash_rgba(1, k).resize(size, Image.BICUBIC))
    return out


def on_grass(im):
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return out


_BOX = {}


def box_of(size):
    """One crop box: Flash and 3D together, building and shadow, every frame."""
    if size in _BOX:
        return _BOX[size]
    a = np.zeros((size[1], size[0]), bool)
    for k in range(0, fref.FRAMES, 4):
        a |= np.array(fref.flash_rgba(1, k).resize(size).getchannel("A")) > 8
    a |= np.array(fref.shadow_rgba().resize(size).getchannel("A")) > 40
    a |= np.array(frame3d(0).getchannel("A")) > 40
    for p in sorted(R.glob("L1-parts-*.png")):
        a |= np.array(Image.open(p).getchannel("A")) > 8
    ys, xs = np.nonzero(a)
    pad = 30
    _BOX[size] = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(size[0], xs.max() + pad),
                  min(size[1], ys.max() + pad))
    return _BOX[size]


def pair(ims, labels, title):
    w, h = ims[0].size
    out = Image.new("RGB", (w * len(ims) + 10 * (len(ims) + 1), h + 86), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 7), title, fill=(255, 255, 255), font=font(26))
    for i, (im, lab) in enumerate(zip(ims, labels)):
        x = 10 + i * (w + 10)
        d.text((x, 46), lab, fill=(255, 255, 255), font=font(22))
        out.paste(im.convert("RGB"), (x, 76))
    return out


def side(k=0):
    b3 = frame3d(k)
    box = box_of(b3.size)
    return pair([flash(k, b3.size).crop(box), on_grass(b3).crop(box)], ["Flash", "3D"],
                f"{NAME} (one look for every level), frame {k}")


def frames(ks=(0, 8, 16, 24, 32), scale=0.5):
    size = frame3d(0).size
    box = box_of(size)
    rows = []
    for k in ks:
        f = flash(k, size).crop(box)
        t = on_grass(frame3d(k)).crop(box)
        sz = (int(f.width * scale), int(f.height * scale))
        rows.append((f.resize(sz, Image.LANCZOS), t.resize(sz, Image.LANCZOS)))
    w, h = rows[0][0].size
    out = Image.new("RGB", (len(ks) * (w + 10) + 110, 2 * (h + 10) + 80), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 7), f"{NAME}: the turning rig, Flash (top) and 3D (bottom)", fill=(255, 255, 255), font=font(24))
    d.text((10, 76 + h // 2), "Flash", fill=(255, 255, 255), font=font(22))
    d.text((10, 86 + h + h // 2), "3D", fill=(255, 255, 255), font=font(22))
    for i, (k, (f, t)) in enumerate(zip(ks, rows)):
        x = 100 + i * (w + 10)
        d.text((x, 46), f"frame {k}", fill=(255, 255, 255), font=font(20))
        out.paste(f.convert("RGB"), (x, 76))
        out.paste(t.convert("RGB"), (x, 86 + h))
    return out


def anim():
    tmp = HERE / "work" / "anim"
    tmp.mkdir(parents=True, exist_ok=True)
    for f in tmp.glob("*.png"):
        f.unlink()
    for k in range(fref.FRAMES):
        im = side(k)
        im = im.crop((0, 0, im.width - im.width % 2, im.height - im.height % 2))
        im.save(tmp / f"{k:02d}.png")
    out = HERE / "baiter-anim.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "2", "-framerate", f"{FPS:.4f}", "-i",
                    str(tmp / "%02d.png"), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def motion():
    """Where each loop changes pixels (red on frame 0), Flash beside 3D."""
    size = frame3d(0).size
    ims = []
    for kind in ("flash", "3d"):
        get = (lambda k: flash(k, size)) if kind == "flash" else (lambda k: on_grass(frame3d(k)))
        f0 = np.array(get(0).convert("RGB")).astype(int)
        ch = np.zeros(f0.shape[:2], bool)
        for k in range(1, fref.FRAMES):
            ch |= np.abs(np.array(get(k).convert("RGB")).astype(int) - f0).max(-1) > 6
        a = f0.astype(float)
        a[ch] = a[ch] * 0.3 + np.array([255, 0, 0]) * 0.7
        ims.append(Image.fromarray(a.astype(np.uint8)).crop(box_of(size)))
    return pair(ims, ["Flash: pixels that change in the loop", "3D"], f"{NAME}: what moves")


def still_check():
    """Changed pixels between 3D frames, outside the moving parts' layers (must be 0) and in all."""
    base = np.array(frame3d(0)).astype(int)
    ch = np.zeros(base.shape[:2], bool)
    cover = np.zeros(base.shape[:2], bool)
    for p in sorted(R.glob("L1-parts-*.png")):
        k = int(p.stem.split("-")[-1])
        f = np.array(frame3d(k)).astype(int)
        ch |= np.abs(f - base).max(-1) > 0
        cover |= np.array(Image.open(p).getchannel("A")) > 0
    return int(ch.sum()), int((ch & ~cover).sum())


def game():
    """At the game's size: 1x and 2x, Flash beside 3D (each scaled down from its large picture), frame 0."""
    b3 = frame3d(0)
    box = box_of(b3.size)
    k = b3.width // (fref.FRAME[2] - fref.FRAME[0])
    f = flash(0, b3.size).crop(box)
    t = on_grass(b3).crop(box)
    rows = []
    for s in (1, 2):
        sz = (f.width * s // k, f.height * s // k)
        rows.append([f.resize(sz, Image.LANCZOS), t.resize(sz, Image.LANCZOS)])
    w = sum(r[0].width * 2 + 30 for r in rows) + 10
    h = max(r[0].height for r in rows) + 86
    out = Image.new("RGB", (max(w, 420), h), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 7), "Game size: 1x and 2x (Flash | 3D)", fill=(255, 255, 255), font=font(22))
    x = 10
    for s, (a, b) in zip((1, 2), rows):
        d.text((x, 46), f"{s}x", fill=(255, 255, 255), font=font(18))
        out.paste(a.convert("RGB"), (x, 76))
        out.paste(b.convert("RGB"), (x + a.width + 10, 76))
        x += a.width * 2 + 30
    return out


CROPS = {"top": (-30, -28, 32, 24), "label": (-28, 14, 28, 60), "cog": (4, 18, 36, 54), "rockL": (-40, 22, -16, 58),
         "rockR": (18, 22, 42, 58)}


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "side":
        side().save(HERE / "baiter-side.png")
    elif what == "frames":
        frames().save(HERE / "baiter-frames.png")
    elif what == "anim":
        print(anim(), "changed px (all, outside moving parts):", still_check())
    elif what == "motion":
        motion().save(HERE / "baiter-motion.png")
    elif what == "game":
        game().save(HERE / "baiter-game.png")
    elif what == "outline":
        r = fit.overlay(1, R / "L1-alone.png", HERE / "baiter-outline.png")
        print(f"overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif what == "crops":
        frame0 = frame3d(0)
        frame0.save(HERE / "work" / "_frame0.png")
        for name, b in CROPS.items():
            z = max(4, min(10, 700 // (b[2] - b[0])))
            crops.crop(str(HERE / "work" / "_frame0.png"), *b, zoom=z).save(HERE / f"crop-{name}.png")
