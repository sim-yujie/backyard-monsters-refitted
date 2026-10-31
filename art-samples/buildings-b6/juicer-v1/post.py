"""post.py : the Monster Juicer 3D sample pictures, from juicer.py's renders (render/) and the Flash art (fref.py).
Flash has one look for every Juicer level (1-3) and a 51-frame animation over the top.

    python post.py side        juicer-side.png      Flash | 3D, large (the building and its ground shadow), frame 0
    python post.py levels      juicer-levels.png    levels 1, 2, 3: Flash above 3D (one look for all, as Flash)
    python post.py outline     juicer-outline.png   Flash outline (red) on the 3D (cyan), the miss map; overlap printed
    python post.py crops       juicer-crop-*.png    full-size crops of the main details, Flash beside 3D
    python post.py game        juicer-game.png      Flash | 3D at the game's own size (1x) and 2x, on grass
    python post.py anim        juicer-anim.mp4      Flash | 3D, the loop at the game's 13.3 frames a second, three times
    python post.py motion      juicer-motion.png    where each loop changes pixels (red), Flash beside 3D
    python post.py strip       juicer-anim-strip.png  eight frames of the loop, Flash above 3D
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
NAME = "Monster Juicer"


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


def flash(size, k=0):
    """Flash's picture as the game draws it (shadow multiplied on the grass, the top, the animation cell), scaled up."""
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(fref.shadow_rgba().resize(size, Image.BICUBIC))
    out.alpha_composite(fref.flash_rgba(1, k).resize(size, Image.BICUBIC))
    return out


def on_grass(im):
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return out


def box_of(size):
    """One crop for every frame: Flash and 3D, building, shadow and every animation cell / layer."""
    a = np.array(fref.shadow_rgba().resize(size).getchannel("A")) > 40
    a |= np.array(Image.open(R / "L1-base.png").getchannel("A")) > 40
    for k in range(fref.FRAMES):
        a |= np.array(fref.flash_rgba(1, k).resize(size).getchannel("A")) > 8
        p = R / f"L1-parts-{k:02d}.png"
        if p.exists():
            a |= np.array(Image.open(p).getchannel("A")) > 40
    ys, xs = np.nonzero(a)
    pad = 30
    return max(0, xs.min() - pad), max(0, ys.min() - pad), min(size[0], xs.max() + pad), min(size[1], ys.max() + pad)


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


_BOX = None


def box():
    global _BOX
    if _BOX is None:
        _BOX = box_of(frame3d(0).size)
    return _BOX


def side(k=0):
    b3 = frame3d(k)
    bx = box()
    return pair([flash(b3.size, k).crop(bx), on_grass(b3).crop(bx)], ["Flash", "3D"],
                f"{NAME} (one look for levels 1-3, as Flash), frame {k}")


def levels():
    """Levels 1, 2 and 3 at one scale, Flash above 3D: Flash draws every level with one picture, and so does the 3D."""
    b3 = frame3d(0)
    bx = box()
    f = flash(b3.size).crop(bx).convert("RGB")
    t = on_grass(b3).crop(bx).convert("RGB")
    s = 0.6
    f = f.resize((int(f.width * s), int(f.height * s)), Image.LANCZOS)
    t = t.resize(f.size, Image.LANCZOS)
    w, h = f.size
    out = Image.new("RGB", (3 * w + 40, 2 * (h + 40) + 90), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 8), f"{NAME}, levels 1, 2, 3: Flash (top) and 3D (bottom), one scale", fill=(255, 255, 255),
           font=font(26))
    d.text((12, 44), "Flash uses one picture for all three levels, so the 3D does too (one model).",
           fill=(200, 200, 200), font=font(20))
    for i, lv in enumerate((1, 2, 3)):
        x = 10 + i * (w + 10)
        for r, (im, lab) in enumerate(((f, "Flash"), (t, "3D"))):
            y = 84 + r * (h + 40)
            d.text((x, y + 6), f"Level {lv}  {lab}", fill=(255, 255, 255), font=font(22))
            out.paste(im, (x, y + 36))
    return out


def game():
    """At the game's size: 1x and 2x, Flash beside 3D (each scaled down from its large picture)."""
    b3 = frame3d(0)
    bx = box()
    k = b3.width // (fref.FRAME[2] - fref.FRAME[0])
    f = flash(b3.size).crop(bx)
    t = on_grass(b3).crop(bx)
    rows = []
    for s in (1, 2):
        sz = (f.width * s // k, f.height * s // k)
        rows.append([f.resize(sz, Image.LANCZOS), t.resize(sz, Image.LANCZOS)])
    w = sum(r[0].width * 2 + 30 for r in rows) + 10
    h = max(r[0].height for r in rows) + 86
    out = Image.new("RGB", (w, h), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 7), "Game size: 1x and 2x (Flash | 3D)", fill=(255, 255, 255), font=font(22))
    x = 10
    for s, (a, b) in zip((1, 2), rows):
        d.text((x, 46), f"{s}x", fill=(255, 255, 255), font=font(18))
        out.paste(a.convert("RGB"), (x, 76))
        out.paste(b.convert("RGB"), (x + a.width + 10, 76))
        x += a.width * 2 + 30
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
    out = HERE / "juicer-anim.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "2", "-framerate", f"{FPS:.4f}", "-i",
                    str(tmp / "%02d.png"), "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


def motion():
    """Where each loop changes pixels (red on frame 0), Flash beside 3D."""
    size = frame3d(0).size
    ims = []
    for get in (lambda k: flash(size, k), lambda k: on_grass(frame3d(k))):
        f0 = np.array(get(0).convert("RGB")).astype(int)
        ch = np.zeros(f0.shape[:2], bool)
        for k in range(1, fref.FRAMES):
            ch |= np.abs(np.array(get(k).convert("RGB")).astype(int) - f0).max(-1) > 6
        a = f0.astype(float)
        a[ch] = a[ch] * 0.3 + np.array([255, 0, 0]) * 0.7
        ims.append(Image.fromarray(a.astype(np.uint8)).crop(box()))
    return pair(ims, ["Flash: pixels that change in the loop", "3D"], f"{NAME}: what moves")


def strip():
    """Eight frames of the loop, Flash above 3D, cropped to the top."""
    size = frame3d(0).size
    k = size[0] // (fref.FRAME[2] - fref.FRAME[0])
    x0, y0 = fref.FRAME[:2]
    cb = ((-36 - x0) * k, (-26 - y0) * k, (36 - x0) * k, (34 - y0) * k)
    frames = (0, 15, 17, 20, 25, 33, 37, 40)
    s = 0.5
    w, h = int((cb[2] - cb[0]) * s), int((cb[3] - cb[1]) * s)
    out = Image.new("RGB", (len(frames) * (w + 8) + 8, 2 * (h + 34) + 50), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((10, 8), f"{NAME}: the loop, Flash (top) and 3D (bottom)", fill=(255, 255, 255), font=font(24))
    for i, f in enumerate(frames):
        x = 8 + i * (w + 8)
        for r, im in enumerate((flash(size, f), on_grass(frame3d(f)))):
            y = 44 + r * (h + 34)
            d.text((x + 4, y + 4), f"frame {f}", fill=(255, 255, 255), font=font(18))
            out.paste(im.crop(cb).resize((w, h), Image.LANCZOS).convert("RGB"), (x, y + 30))
    return out


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


CROPS = {"crusher": (-28, -20, 26, 16), "gold": (0, -8, 24, 16), "rim": (-34, -2, 34, 24),
         "corner": (-20, 14, 20, 66), "stepsL": (-48, 4, -6, 56), "stepsR": (6, 4, 48, 56)}


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "side":
        side().save(HERE / "juicer-side.png")
    elif what == "levels":
        levels().save(HERE / "juicer-levels.png")
    elif what == "game":
        game().save(HERE / "juicer-game.png")
    elif what == "outline":
        r = fit.overlay(1, R / "L1-alone.png", HERE / "juicer-outline.png")
        print(f"overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif what == "crops":
        b3 = frame3d(0)
        tmp = HERE / "work" / "_f0.png"
        b3.save(tmp)
        for name, b in CROPS.items():
            z = max(4, min(12, 900 // (b[2] - b[0])))
            crops.crop(str(tmp), *b, zoom=z).save(HERE / f"juicer-crop-{name}.png")
    elif what == "anim":
        print(anim(), "changed px (all, outside moving parts):", still_check())
    elif what == "motion":
        motion().save(HERE / "juicer-motion.png")
    elif what == "strip":
        strip().save(HERE / "juicer-anim-strip.png")
