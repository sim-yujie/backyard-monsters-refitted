"""Builds the towers' shot-effect sheet (beta.5 tower attack effects).

The paintings come from the image model (Antigravity, prompt in
tower-fx-kit/prompt.txt): one greyscale effect on flat green each, in
tower-fx-kit/src/fxNN_name.(png|jpg). Each is unmixed from its green, trimmed,
centred and shrunk into a 192 px cell of server/public/assets/fx/tower-fx.png,
four across, in the order shotFx.ts reads them. The game tints them in code.

A painting not made yet is stood in for by another one, reworked, until it is
painted: see STAND_INS.

    python web/tools/gen-tower-fx-sheet.py
"""

from __future__ import annotations

import glob
import os

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "tower-fx-kit", "src")
OUT = os.path.join(HERE, "..", "..", "server", "public", "assets", "fx", "tower-fx.png")
PREVIEW = os.path.join(HERE, "tower-fx-kit", "preview.png")

CELL = 192
ACROSS = 4
ORDER = ["glow", "flare", "muzzle", "spark", "burst", "zap", "smoke", "wisp", "ring", "orb", "beam", "scorch"]
# Cells that keep their painting's size in the cell rather than filling it.
FILL = 0.92
# name: (painting it borrows, how it is reworked)
STAND_INS = {
    "flare": ("burst", "flare"),
    "zap": ("burst", "zap"),
    "wisp": ("smoke", "wisp"),
    "orb": ("glow", "orb"),
    "scorch": ("smoke", "scorch"),
}


def painting(name: str) -> str | None:
    found = sorted(glob.glob(os.path.join(SRC, f"fx??_{name}.*")))
    return found[0] if found else None


def unmix(path: str) -> np.ndarray:
    """The painting as RGBA floats: a neutral grey over its flat green, taken apart."""
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32) / 255
    edge = np.concatenate([rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3), rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3)])
    bg = np.median(edge, axis=0)
    bg_other = max(bg[0], bg[2])
    bg_excess = bg[1] - bg_other
    excess = rgb[..., 1] - np.maximum(rgb[..., 0], rgb[..., 2])
    alpha = np.clip(1 - excess / bg_excess, 0, 1)
    # JPEG noise in the green: nothing there.
    alpha = np.where(alpha < 0.06, 0, alpha)
    other = np.maximum(rgb[..., 0], rgb[..., 2])
    with np.errstate(divide="ignore", invalid="ignore"):
        value = np.where(alpha > 0, (other - (1 - alpha) * bg_other) / alpha, 0)
    value = np.clip(value, 0, 1)
    return np.dstack([value, value, value, alpha])


def radial(size: int) -> np.ndarray:
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    c = (size - 1) / 2
    return np.hypot(x - c, y - c) / c


def soften_edge(rgba: np.ndarray) -> np.ndarray:
    """The glow fades to nothing at its rim instead of stopping on grey."""
    r = radial(rgba.shape[0])
    fade = np.clip(1 - r / 0.9, 0, 1) ** 1.5
    out = rgba.copy()
    out[..., 3] *= fade
    return out


def as_light(rgba: np.ndarray) -> np.ndarray:
    """A light to add on: white, as strong as the painting is bright, so its grey rim leaves no dark ring."""
    out = rgba.copy()
    # The painting's flat grey plateau around the bloom is let go: only what is brighter glows.
    strength = out[..., 3] * np.clip((out[..., 0] - 0.5) / 0.5, 0, 1) ** 1.2
    # Blurred wide so the painted bands melt into one smooth bloom.
    blurred = Image.fromarray((strength * 255).round().astype(np.uint8), "L").filter(ImageFilter.GaussianBlur(40))
    out[..., 3] = np.asarray(blurred, dtype=np.float32) / 255
    out[..., :3] = 1
    return out


def rework(rgba: np.ndarray, how: str) -> np.ndarray:
    out = rgba.copy()
    if how == "flare":
        # The burst's hot core and spikes, thinned to a sparkle.
        out[..., 3] *= np.clip(out[..., 0] * 1.6 - 0.5, 0, 1)
    elif how == "zap":
        # The burst, only its brightest strokes: crackle rather than a blast.
        out[..., 3] *= np.clip(out[..., 0] * 2.2 - 1.1, 0, 1) ** 0.7
        out[..., :3] = 1
    elif how == "wisp":
        out[..., :3] = 0.55 + out[..., :3] * 0.45
        out[..., 3] *= 0.55
    elif how == "orb":
        out[..., :3] = np.clip(out[..., :3] * 1.15, 0, 1)
        out[..., 3] = np.clip(out[..., 3] * (1.4 - radial(out.shape[0])), 0, 1)
    elif how == "scorch":
        out[..., :3] = out[..., :3] * 0.22
        out[..., 3] *= np.clip(1.15 - radial(out.shape[0]), 0, 1) * 0.85
    return out


def trim_square(rgba: np.ndarray) -> np.ndarray:
    ys, xs = np.nonzero(rgba[..., 3] > 0.02)
    if len(xs) == 0:
        return rgba
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    half = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 + 4
    h, w = rgba.shape[:2]
    big = int(np.ceil(half * 2))
    canvas = np.zeros((big, big, 4), dtype=np.float32)
    x0, y0 = int(round(cx - big / 2)), int(round(cy - big / 2))
    sx0, sy0 = max(0, x0), max(0, y0)
    sx1, sy1 = min(w, x0 + big), min(h, y0 + big)
    canvas[sy0 - y0 : sy1 - y0, sx0 - x0 : sx1 - x0] = rgba[sy0:sy1, sx0:sx1]
    return canvas


def shrink(rgba: np.ndarray, size: int) -> np.ndarray:
    """Shrinks premultiplied, in floats, so faint edges keep their grey instead of going black."""
    pre = rgba.copy()
    pre[..., :3] *= pre[..., 3:4]
    chans = [np.asarray(Image.fromarray(pre[..., i], "F").resize((size, size), Image.LANCZOS)) for i in range(4)]
    out = np.clip(np.dstack(chans), 0, 1)
    a = out[..., 3:4]
    with np.errstate(divide="ignore", invalid="ignore"):
        out[..., :3] = np.where(a > 1e-4, np.clip(out[..., :3] / a, 0, 1), 1)
    return out


def cell(name: str) -> tuple[Image.Image, str]:
    source, how = name, None
    path = painting(name)
    if path is None:
        if name not in STAND_INS:
            raise SystemExit(f"no painting for {name}")
        source, how = STAND_INS[name]
        path = painting(source)
        if path is None:
            raise SystemExit(f"no painting for {name} or its stand-in {source}")
    rgba = trim_square(unmix(path))
    if source == "glow":
        rgba = as_light(soften_edge(rgba))
    if how:
        rgba = rework(rgba, how)
    inner = int(CELL * FILL)
    img = Image.fromarray((shrink(rgba, inner) * 255).round().astype(np.uint8), "RGBA")
    framed = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    framed.paste(img, ((CELL - inner) // 2, (CELL - inner) // 2))
    return framed, (f"stand-in from {source}" if how else os.path.basename(path))


def main() -> None:
    rows = -(-len(ORDER) // ACROSS)
    sheet = Image.new("RGBA", (CELL * ACROSS, CELL * rows), (0, 0, 0, 0))
    for index, name in enumerate(ORDER):
        img, note = cell(name)
        sheet.paste(img, ((index % ACROSS) * CELL, (index // ACROSS) * CELL))
        print(f"{index:2d} {name:7s} {note}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT, optimize=True)
    # A look at it on the game's grass and on black, for the review.
    preview = Image.new("RGBA", (sheet.width, sheet.height * 2), (0, 0, 0, 255))
    grass = Image.new("RGBA", sheet.size, (92, 140, 60, 255))
    preview.paste(Image.alpha_composite(grass, sheet), (0, 0))
    preview.paste(Image.alpha_composite(Image.new("RGBA", sheet.size, (20, 20, 28, 255)), sheet), (0, sheet.height))
    preview.convert("RGB").save(PREVIEW)
    print(OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
