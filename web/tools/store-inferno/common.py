"""Shared bits of the Inferno General Store kit (owner, 20 Nov 2026: "Use surface store for now, get codex to generate
an inferno copy for modern theme. No need 3d blender.").

The General Store (type 12) can be built in the Inferno from patch 8.1. With the Classic look it draws Flash's own
store (`buildings/generalstore/top.1.png`), as on the surface. With the Modern look it draws an Inferno-coloured copy
of the surface's Modern store (`top.3d1@2x.webp`, the 3D matchbook): the same shape, repainted by Codex in the
Inferno's palette, fitted onto the surface picture's box and drawn on its shadow (`shadow.3d1.jpg`).

Reuses web/tools/inferno-paint/common.py (keying on green, premultiplied resize, the yard's ground tiles).
"""
import importlib.util
from pathlib import Path

from PIL import Image

_spec = importlib.util.spec_from_file_location("inferno_paint_common",
                                               Path(__file__).resolve().parents[1] / "inferno-paint" / "common.py")
_paint = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_paint)
ASSETS, REPO = _paint.ASSETS, _paint.REPO
band, ground, key, multiply, on, resize_pm = (_paint.band, _paint.ground, _paint.key, _paint.multiply, _paint.on,
                                             _paint.resize_pm)

OUT = REPO / "art-samples" / "store-inferno"
FOLDER = ASSETS / "buildings" / "generalstore"
UP = 4                                      # the fitted paintings are kept at 4x
SRC = ("top.3d1@2x.webp", -42, -38)         # the surface Modern store (2 px a world px), its top-left in world px
SHADOW = ("shadow.3d1.jpg", -36, 1)         # its shadow, kept for the Inferno copy
CANVAS = (160, 160, 80, 100)                # shared 1x canvas: width, height, origin x, origin y


def surface_rgba():
    """The surface Modern store on the shared canvas at 4x (clear ground)."""
    CW, CH, OX, OY = CANVAS
    f, x, y = SRC
    im = Image.open(FOLDER / f).convert("RGBA")
    im = im.resize((im.width * UP // 2, im.height * UP // 2), Image.LANCZOS)
    c = Image.new("RGBA", (CW * UP, CH * UP), (0, 0, 0, 0))
    c.alpha_composite(im, ((OX + x) * UP, (OY + y) * UP))
    return c
