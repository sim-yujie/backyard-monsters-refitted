"""Small recolours after a cut (no Codex): Codex leaves a lilac or pink cast on greys (stone, metal plates).

degrey(out, name, hue=None): in out/<name>.png, @2x.png and .full.png, pale lilac/pink pixels (low colour, hue
230-345) lose 85% of their colour; with hue=<degrees> (pinks up to 20 too) they keep 50% but turn to that hue (250 = Flash's cool grey).
"""
import os

import numpy as np
from PIL import Image


def degrey(out, name, hue=None):
    for suf in (".png", "@2x.png", ".full.png"):
        p = os.path.join(out, name + suf)
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert("RGBA")
        hsv = np.asarray(im.convert("RGB").convert("HSV")).astype(float)
        h, s = hsv[..., 0] * 360 / 255, hsv[..., 1]
        m = (s < 90) & (h > 230) & (h < 345) if hue is None else (s < 90) & ((h > 230) | (h < 20))
        if hue is None:
            hsv[..., 1] = np.where(m, s * 0.15, s)
        else:
            hsv[..., 0] = np.where(m, hue * 255 / 360, hsv[..., 0])
            hsv[..., 1] = np.where(m, s * 0.5, s)
        rgb = Image.fromarray(hsv.round().clip(0, 255).astype(np.uint8), "HSV").convert("RGB")
        rgb.putalpha(im.getchannel("A"))
        rgb.save(p)
