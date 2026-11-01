"""post.py : the Monster Lab 3D sample pictures, from lab.py's renders (render/) and the Flash art (fref.py).
Flash has one look for every Lab level (1-4), animated (the dome's brew, the side doors' turning cogs), so there is one
pair of stills and one loop to show.

    python post.py side        lab-side.png       Flash | 3D, large (the building and its ground shadow), on grass
    python post.py outline     lab-outline.png    Flash outline (red) on the 3D (cyan), the miss map; overlap printed
    python post.py crops       work/crop-*.png    full-size crops of the risky areas, Flash beside 3D
    python post.py game        lab-game.png       Flash | 3D at the game's own size (1x) and 2x, on grass
    python post.py anim        lab-anim.mp4       Flash | 3D, one whole loop (160 frames: 32 brew x 5 cog), half size
                               work/anim/NNN.png  the 3D frames at full size (the still with the moving boxes laid on)
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

import crops
import fit
import fref

HERE = Path(__file__).resolve().parent
R = HERE / "render"
GRASS = (96, 140, 60)


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


FPS = 40 / 3
LAYERS = (("dome", 32), ("doorL", 5), ("doorR", 5))


def flash(size, k=0):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top), scaled up."""
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(fref.shadow_rgba().resize(size, Image.BICUBIC))
    out.alpha_composite(fref.flash_rgba(frame=k).resize(size, Image.BICUBIC))
    return out


def masks():
    """Per moving layer: where its frames differ from each other or from the still (grown and softened), as 0..1."""
    base = np.array(Image.open(R / "L1-base.png").convert("RGBA")).astype(np.int16)
    out = {}
    for name, n in LAYERS:
        fr = [np.array(Image.open(R / "anim" / f"{name}-{k:02d}.png").convert("RGBA")).astype(np.int16) for k in range(n)]
        live = fr[0][..., 3] > 0
        for f in fr:
            live |= f[..., 3] > 0
        ch = np.zeros(base.shape[:2], bool)
        for f in fr:
            ch |= np.abs(f - fr[0]).max(-1) > 14
        ch &= live
        m = Image.fromarray((ch * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(3))
        m = np.array(m).astype(float) / 255 * (np.array(Image.fromarray((live * 255).astype(np.uint8)).filter(
            ImageFilter.MinFilter(9))) > 0)
        out[name] = (fr, m[..., None])
    return out


def frame3d(k, ms=None):
    """The 3D at loop frame k: the still with each moving layer's frame laid on inside its mask."""
    ms = ms or masks()
    a = np.array(Image.open(R / "L1-base.png").convert("RGBA")).astype(float)
    for name, n in LAYERS:
        fr, m = ms[name]
        a = a * (1 - m) + fr[k % n].astype(float) * m
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def on_grass(im):
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return out


def box_of(size, b3):
    a = np.array(fref.flash_rgba().resize(size).getchannel("A")) > 8
    a |= np.array(fref.shadow_rgba().resize(size).getchannel("A")) > 40
    a |= np.array(b3.getchannel("A")) > 40
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


def side():
    b3 = Image.open(R / "L1-base.png").convert("RGBA")
    box = box_of(b3.size, b3)
    return pair([flash(b3.size).crop(box), on_grass(b3).crop(box)], ["Flash", "3D"],
                "Monster Lab, levels 1-4 (Flash has one look for every level)")


def game():
    """At the game's size: 1x and 2x, Flash beside 3D (each scaled down from its large picture)."""
    b3 = Image.open(R / "L1-base.png").convert("RGBA")
    box = box_of(b3.size, b3)
    k = b3.width // (fref.FRAME[2] - fref.FRAME[0])
    f = flash(b3.size).crop(box)
    t = on_grass(b3).crop(box)
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


CROPS = {"bells": (-46, -100, 40, -30), "dome": (-30, -32, 28, 14), "pipeL": (-62, -30, -26, 6),
         "front": (-40, 12, 36, 62), "doorL": (-80, 14, -36, 62), "doorR": (30, 14, 74, 62),
         "cogL": (-37, 20, -17, 60), "cogR": (17, 20, 37, 60)}


def anim():
    ms = masks()
    b3 = Image.open(R / "L1-base.png").convert("RGBA")
    box = box_of(b3.size, b3)
    tmp = HERE / "work" / "anim"
    tmp.mkdir(parents=True, exist_ok=True)
    for f in tmp.glob("*.png"):
        f.unlink()
    n = 32 * 5
    for k in range(n):
        t = frame3d(k, ms)
        if k < 32:
            t.save(tmp / f"full-{k:03d}.png")
        im = pair([flash(b3.size, k).crop(box), on_grass(t).crop(box)], ["Flash", "3D"],
                  "Monster Lab: the brew turns in the dome, the grey cogs turn in the side doors")
        im = im.resize((im.width // 2 // 2 * 2, im.height // 2 // 2 * 2), Image.LANCZOS)
        im.save(tmp / f"{k:03d}.png")
    out = HERE / "lab-anim.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-framerate", f"{FPS:.4f}", "-i", str(tmp / "%03d.png"),
                    "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(out)], check=True)
    return out


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "side":
        side().save(HERE / "lab-side.png")
    elif what == "anim":
        print(anim())
    elif what == "game":
        game().save(HERE / "lab-game.png")
    elif what == "outline":
        r = fit.overlay(1, R / "L1-alone.png", HERE / "lab-outline.png")
        print(f"overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif what == "crops":
        for name, b in CROPS.items():
            z = max(4, min(10, 700 // (b[2] - b[0])))
            crops.crop(str(R / "L1-base.png"), *b, zoom=z).save(HERE / f"lab-crop-{name}.png")
