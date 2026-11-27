"""Strong-frost recolour for monster battle sheets (owner pick S, 27 Nov 2026: all ice, clearly frost at battle size).

The frost tribe's monsters fight exactly as the normal ones and use the same frames, so their battle sheets are the
existing sheets recoloured cell for cell (no repaint: every heading, frame, anchor and layout stays identical):

- body colour -> an ice ramp by brightness (deep navy shadows, ice-blue middle, white-cyan lights), a faint trace of
  the original hue left in the shadows so it is still the same creature;
- a white hoarfrost crust on every top edge (pixels whose neighbours above are see-through);
- the baked ground shadow (dark, half see-through) stays a plain dark shadow.
"""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

RAMP_X = np.array([0.0, 0.18, 0.42, 0.68, 0.88, 1.0])
RAMP = np.array([
    (8, 16, 42),
    (22, 62, 132),
    (52, 132, 212),
    (130, 205, 248),
    (205, 240, 255),
    (248, 253, 255),
], dtype=np.float32)
FROST_WHITE = np.array((236, 248, 255), dtype=np.float32)


def ramp(lum):
    out = np.empty(lum.shape + (3,), np.float32)
    for c in range(3):
        out[..., c] = np.interp(lum, RAMP_X, RAMP[:, c])
    return out


def frost_rgba(arr, scale=1.0, lift=0.92, tint=0.22, crust=0.75):
    """arr: HxWx4 uint8 RGBA. scale: the sheet's resolution (4 for @4x). Returns a new HxWx4 uint8 array."""
    rgb = arr[..., :3].astype(np.float32)
    a = arr[..., 3].astype(np.float32) / 255.0
    lum = (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]) / 255.0
    # the baked ground shadow: dark and see-through. Keep it a neutral dark shadow.
    shadow = np.clip((0.985 - a) / 0.05, 0, 1) * np.clip((0.2 - lum) / 0.1, 0, 1)
    # brightness lifted towards the light end, local contrast kept
    l2 = np.clip(lum, 0, 1) ** lift
    ice = ramp(l2)
    # a faint trace of the original hue in the shadows (owner: "a hint of the original colour left")
    orig = rgb
    t = (tint * (1.0 - l2))[..., None]
    ice = ice * (1 - t) + (orig * 0.55 + ice * 0.45) * t
    # hoarfrost crust on top edges: body pixels with see-through pixels a few px above them
    body = (a > 0.55).astype(np.float32) * (1 - shadow)
    k = max(1, int(round(2.2 * scale)))
    above = np.zeros_like(body)
    above[k:] = body[:-k]
    edge = np.clip(body - above, 0, 1)
    edge = ndi.gaussian_filter(edge, sigma=max(0.6, 0.7 * scale))
    edge = np.clip(edge * 1.8, 0, 1) * body
    ice = ice + (FROST_WHITE - ice) * (crust * edge)[..., None]
    out_rgb = ice * (1 - shadow[..., None]) + rgb * shadow[..., None]
    out = np.dstack([np.clip(out_rgb, 0, 255), arr[..., 3:4].astype(np.float32)]).astype(np.uint8)
    return out


def frost_image(path_in, scale):
    im = Image.open(path_in).convert("RGBA")
    return Image.fromarray(frost_rgba(np.asarray(im), scale), "RGBA")
