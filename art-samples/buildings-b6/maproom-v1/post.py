"""post.py : the Map Room 3D sample pictures, from maproom.py's renders (render/) and the Flash art (fref.py).
Flash has one look for every Map Room level and no animation, so there is one pair to show.

    python post.py shade       render/L1-base.png   from L1-raw.png: the ground shadow lighter and shorter, as Flash's
    python post.py side        maproom-side.png       Flash | 3D, large (the building and its ground shadow), on grass
    python post.py outline     maproom-outline.png    Flash outline (red) on the 3D (cyan), the miss map; overlap printed
    python post.py crops       maproom-crop-*.png  full-size crops of the risky areas, Flash beside 3D
    python post.py game        maproom-game.png       Flash | 3D at the game's own size (1x) and 2x, on grass
"""
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


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def flash(size):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top), scaled up."""
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(fref.shadow_rgba().resize(size, Image.BICUBIC))
    out.alpha_composite(fref.flash_rgba().resize(size, Image.BICUBIC))
    return out


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
                "Map Room (one look for every level, no animation in Flash)")


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


def shade(k0=0.78, x1=28.0, x2=80.0, k2=0.2):
    """Flash's ground shadow is lighter than the 3D sun's, and shorter to the right: keep the building's pixels as
    rendered (render/L1-raw.png) and only thin the shadow (where render/L1-alone.png has no building), by k0 up to Flash
    x = x1, fading to k2 at x2. The shadow is black; its strength is (raw alpha - building alpha) / (1 - building alpha)."""
    raw = np.array(Image.open(R / "L1-raw.png").convert("RGBA")).astype(float) / 255
    ba = np.array(Image.open(R / "L1-alone.png").convert("RGBA").getchannel("A")).astype(float) / 255
    k = raw.shape[1] // (fref.FRAME[2] - fref.FRAME[0])
    fx = np.arange(raw.shape[1]) / k + fref.FRAME[0]
    kk = np.interp(fx, (x1, x2), (k0, k2))[None, :]
    s = ((raw[..., 3] - ba) / np.maximum(1e-4, 1 - ba)).clip(0, 1)
    a = ba + (1 - ba) * s * kk
    rgb = raw[..., :3] * raw[..., 3:4] / np.maximum(1e-4, a)[..., None]        # premultiplied colour stays
    out = np.dstack([rgb.clip(0, 1), a]) * 255
    Image.fromarray(out.round().astype(np.uint8)).save(R / "L1-base.png")


CROPS = {"house": (-22, -40, 26, 14), "tower": (-12, -72, 22, -30), "scope": (-26, -50, 8, -14),
         "scissors": (-52, -28, -4, 26), "blades": (-46, 12, -16, 68), "stairs": (2, 8, 56, 70), "stone": (-62, 0, 40, 70)}


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "shade":
        shade()
    elif what == "side":
        side().save(HERE / "maproom-side.png")
    elif what == "game":
        game().save(HERE / "maproom-game.png")
    elif what == "outline":
        r = fit.overlay(1, R / "L1-alone.png", HERE / "maproom-outline.png")
        print(f"overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif what == "crops":
        for name, b in CROPS.items():
            z = max(4, min(10, 700 // (b[2] - b[0])))
            crops.crop(str(R / "L1-base.png"), *b, zoom=z).save(HERE / f"maproom-crop-{name}.png")
