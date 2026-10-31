"""post.py : the Catapult 3D sample pictures, from catapult.py's renders (render/) and the Flash art (fref.py).
Flash has three looks (art levels 1-3; level 4 shows look 3) and no animation, so there is one still per look.

    python post.py shade [looks]   render/L<look>-base.png from L<look>-raw.png: the ground shadow lighter and shorter,
                                   as Flash's
    python post.py side [looks]    catapult-side-L<look>.png   Flash | 3D, large (the building and its shadow), on grass
    python post.py outline [looks] catapult-outline-L<look>.png Flash outline (red) on the 3D (cyan); overlap printed
    python post.py crops [looks]   catapult-crop-L<look>-*.png  full-size crops of the risky areas, Flash beside 3D
    python post.py game            catapult-game.png  every look, Flash | 3D at the game's own size (1x) and 2x
looks: a comma list (default 1,2,3).
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
LOOKS = (1, 2, 3)


def font(n):
    try:
        return ImageFont.truetype("arialbd.ttf", n)
    except OSError:
        return ImageFont.load_default()


def flash(size, lv, look=1):
    """Flash's picture as the game draws it (shadow multiplied on the grass, then the top), scaled up."""
    out = Image.new("RGBA", size, GRASS + (255,))
    out.alpha_composite(fref.shadow_rgba(look, lv).resize(size, Image.BICUBIC))
    out.alpha_composite(fref.flash_rgba(look, lv).resize(size, Image.BICUBIC))
    return out


def on_grass(im):
    out = Image.new("RGBA", im.size, GRASS + (255,))
    out.alpha_composite(im)
    return out


def box_of(size, b3, lv, look=1):
    a = np.array(fref.flash_rgba(look, lv).resize(size).getchannel("A")) > 8
    a |= np.array(fref.shadow_rgba(look, lv).resize(size).getchannel("A")) > 40
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


LEVELS = {1: "level 1", 2: "level 2", 3: "levels 3 and 4"}


def side(lv):
    b3 = Image.open(R / f"L{lv}-base.png").convert("RGBA")
    box = box_of(b3.size, b3, lv)
    return pair([flash(b3.size, lv).crop(box), on_grass(b3).crop(box)], ["Flash", "3D"],
                f"Catapult look {lv} ({LEVELS[lv]}; no animation in Flash)")


def game():
    """At the game's size: every look at 1x, then 2x; Flash above 3D (each scaled down from its large picture)."""
    cols = []
    for lv in LOOKS:
        b3 = Image.open(R / f"L{lv}-base.png").convert("RGBA")
        box = box_of(b3.size, b3, 3)                    # one crop for all looks (look 3 is the largest)
        k = b3.width // (fref.FRAME[2] - fref.FRAME[0])
        cols.append((flash(b3.size, lv).crop(box), on_grass(b3).crop(box), k))
    rows = []
    for s in (1, 2):
        rows.append([(f.resize((f.width * s // k, f.height * s // k), Image.LANCZOS),
                      t.resize((t.width * s // k, t.height * s // k), Image.LANCZOS)) for f, t, k in cols])
    w = 10 + sum(a.width + 10 for r in rows for a, _ in r) + 20
    h = max(a.height * 2 + 10 for a, _ in rows[1]) + 86
    out = Image.new("RGB", (w, h), (24, 24, 24))
    d = ImageDraw.Draw(out)
    d.text((12, 7), "Catapult at game size: looks 1-3 at 1x, then 2x (Flash above, 3D below)", fill=(255, 255, 255),
           font=font(20))
    x = 10
    for s, ims in zip((1, 2), rows):
        d.text((x, 46), f"{s}x", fill=(255, 255, 255), font=font(18))
        for a, b in ims:
            out.paste(a.convert("RGB"), (x, 76))
            out.paste(b.convert("RGB"), (x, 76 + a.height + 10))
            x += a.width + 10
        x += 20
    return out


def shade(lv, k0=0.78, x1=28.0, x2=80.0, k2=0.2):
    """Flash's ground shadow is lighter than the 3D sun's, and shorter to the right: keep the building's pixels as
    rendered (render/L<look>-raw.png) and only thin the shadow (where L<look>-alone.png has no building), by k0 up to
    Flash x = x1, fading to k2 at x2. The shadow is black; its strength is (raw alpha - building alpha) /
    (1 - building alpha)."""
    raw = np.array(Image.open(R / f"L{lv}-raw.png").convert("RGBA")).astype(float) / 255
    ba = np.array(Image.open(R / f"L{lv}-alone.png").convert("RGBA").getchannel("A")).astype(float) / 255
    k = raw.shape[1] // (fref.FRAME[2] - fref.FRAME[0])
    fx = np.arange(raw.shape[1]) / k + fref.FRAME[0]
    kk = np.interp(fx, (x1, x2), (k0, k2))[None, :]
    s = ((raw[..., 3] - ba) / np.maximum(1e-4, 1 - ba)).clip(0, 1)
    a = ba + (1 - ba) * s * kk
    rgb = raw[..., :3] * raw[..., 3:4] / np.maximum(1e-4, a)[..., None]        # premultiplied colour stays
    out = np.dstack([rgb.clip(0, 1), a]) * 255
    Image.fromarray(out.round().astype(np.uint8)).save(R / f"L{lv}-base.png")


# the risky areas per look, in Flash px
CROPS = {
    1: {"axle": (-32, 6, 10, 38), "gear": (6, 20, 46, 58), "bucket": (-46, 30, -10, 68), "frame": (-22, 22, 16, 70)},
    2: {"bows": (-34, -24, 26, 22), "gear": (-2, 4, 36, 42), "box": (-20, 24, 46, 74), "bucket": (-46, 32, -10, 74)},
    3: {"drum": (-10, -32, 32, 14), "bows": (-34, -32, 26, 18), "box": (-20, 24, 46, 76), "bucket": (-46, 32, -10, 76)},
}


def looks():
    return [int(v) for v in sys.argv[2].split(",")] if len(sys.argv) > 2 else LOOKS


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "shade":
        for lv in looks():
            shade(lv)
    elif what == "side":
        for lv in looks():
            side(lv).save(HERE / f"catapult-side-L{lv}.png")
    elif what == "game":
        game().save(HERE / "catapult-game.png")
    elif what == "outline":
        for lv in looks():
            r = fit.overlay(lv, R / f"L{lv}-alone.png", HERE / f"catapult-outline-L{lv}.png")
            print(f"L{lv}: overlap (IoU) {r[0]:.3f}  Flash not covered {r[1]:.3f}  3D outside Flash {r[2]:.3f}")
    elif what == "crops":
        for lv in looks():
            fref.LV = lv
            for name, b in CROPS[lv].items():
                z = max(4, min(10, 700 // (b[2] - b[0])))
                crops.crop(str(R / f"L{lv}-base.png"), *b, zoom=z).save(HERE / f"catapult-crop-L{lv}-{name}.png")
