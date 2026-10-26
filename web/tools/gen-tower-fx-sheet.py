"""Builds the towers' shot-effect sheet (beta.5 tower attack effects).

The paintings come from the image model (Antigravity, prompt in
tower-fx-kit/prompt.txt): one greyscale effect on flat green each, in
tower-fx-kit/src/fxNN_name.(png|jpg). Each is unmixed from its green, trimmed,
centred and shrunk into a 192 px cell of server/public/assets/fx/tower-fx.png,
four across, in the order shotFx.ts reads them (after the first twelve: the
flak cloud and shrapnel spray, fx23-fx24, then the Sniper's rifle flash, hit
spray and dirt kick and the flak tower's shell, fireball and muzzle blast,
fx26 and fx29-fx33). The game tints them in code.

A painting not made yet is stood in for by another one, reworked, until it is
painted: see STAND_INS.

Under the cells go the strips, 384 x 96, two across, which the game lays along
a line: the six painted lightning bolts (tower-fx-kit/src/fxNN_boltN.png), each
bolt's bright core (the bolt worn down to its middle, so it follows the same
zigzag thinner), the ray (the beam painting, trimmed to its glow), the
streak (a lens-flare flash, tower-fx-kit/src/fx19_streak.*), the Sniper's
bullet (its hot head and shock cone and fading tail, fx27_bullet.*) and its
vapour trail (fx28_vapour.*). fx22_brake and fx25_tracer, the Sniper's first
flash and tracer, are no longer laid on the sheet.

Beside the sheet go the flows, which the game repeats end to end along a beam
and slides along it: the laser's plasma (fx20_energy.*) and the railgun's
spiral (fx21_helix.*), each cut to 512 x 64 with its two ends blended into one
another so the repeat has no seam, saved as tower-fx-<name>.png.

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
ORDER = [
    "glow", "flare", "muzzle", "spark", "burst", "zap", "smoke", "wisp", "ring", "orb", "beam", "scorch",
    "flak", "shrapnel", "rifleflash", "ricochet", "debris", "shell", "fireball", "aaflash",
]
# The darkest a cell's grey may be: the Sniper's rifle flash and ricochet are laid over the
# ground tinted orange, and their dark greys turned the orange brown. Alpha and shape are kept.
LIFT = {"rifleflash": 0.45, "ricochet": 0.5}
# Cells that keep their painting's size in the cell rather than filling it.
FILL = 0.92
STRIP_W, STRIP_H, STRIP_ACROSS = 384, 96, 2
BOLTS = [f"bolt{n}" for n in range(1, 7)]
STRIPS = BOLTS + [f"core{n}" for n in range(1, 7)] + ["ray", "streak", "bullet", "vapour"]
FLOWS = ["energy", "helix"]
FLOW_W, FLOW_H = 512, 64
# Share of a flow's length blended from one end into the other.
FLOW_SEAM = 0.15
# A bolt not painted yet: another painted bolt, turned upside down.
BOLT_STAND_INS = {"bolt6": "bolt1"}
# What share of a bolt's painted area its core keeps.
CORE_SHARE = 0.3
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
    if name in LIFT:
        floor = LIFT[name]
        rgba[..., :3] = floor + (1 - floor) * rgba[..., :3]
    inner = int(CELL * FILL)
    img = Image.fromarray((shrink(rgba, inner) * 255).round().astype(np.uint8), "RGBA")
    framed = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    framed.paste(img, ((CELL - inner) // 2, (CELL - inner) // 2))
    return framed, (f"stand-in from {source}" if how else os.path.basename(path))


def trim(rgba: np.ndarray, pad: int = 2) -> np.ndarray:
    ys, xs = np.nonzero(rgba[..., 3] > 0.02)
    if len(xs) == 0:
        return rgba
    h, w = rgba.shape[:2]
    return rgba[max(0, ys.min() - pad) : min(h, ys.max() + pad + 1), max(0, xs.min() - pad) : min(w, xs.max() + pad + 1)]


def stretch(rgba: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resizes premultiplied to exactly width x height: a strip is stretched along its line anyway."""
    pre = rgba.copy()
    pre[..., :3] *= pre[..., 3:4]
    chans = [np.asarray(Image.fromarray(pre[..., i], "F").resize((width, height), Image.LANCZOS)) for i in range(4)]
    out = np.clip(np.dstack(chans), 0, 1)
    a = out[..., 3:4]
    with np.errstate(divide="ignore", invalid="ignore"):
        out[..., :3] = np.where(a > 1e-4, np.clip(out[..., :3] / a, 0, 1), 1)
    return out


def core_of(rgba: np.ndarray) -> np.ndarray:
    """The bolt worn down from its edges until CORE_SHARE of it is left: its bright middle, same zigzag."""
    alpha = Image.fromarray((np.clip(rgba[..., 3] * rgba[..., 0], 0, 1) * 255).round().astype(np.uint8), "L")
    whole = max(1.0, float((np.asarray(alpha) > 128).sum()))
    for _ in range(40):
        if (np.asarray(alpha) > 128).sum() <= whole * CORE_SHARE:
            break
        alpha = alpha.filter(ImageFilter.MinFilter(3))
    soft = alpha.filter(ImageFilter.GaussianBlur(1.5))
    out = np.ones_like(rgba)
    out[..., 3] = np.asarray(soft, dtype=np.float32) / 255
    return out


def strip(name: str) -> tuple[Image.Image, str]:
    source = {"ray": "beam", "streak": "streak", "bullet": "bullet", "vapour": "vapour"}.get(
        name, name.replace("core", "bolt")
    )
    path = painting(source)
    turned = False
    if path is None and source in BOLT_STAND_INS:
        path, turned = painting(BOLT_STAND_INS[source]), True
    if path is None:
        raise SystemExit(f"no painting for {name} ({source})")
    rgba = trim(unmix(path))
    if turned:
        # Upside down it zigzags the other way: a different bolt to flicker to.
        rgba = rgba[::-1].copy()
    if name.startswith("core"):
        # Kept in the bolt's own box, so it lies exactly on the bolt.
        rgba = core_of(rgba)
    out = stretch(rgba, STRIP_W, STRIP_H)
    note = os.path.basename(path) + (" upside down (stand-in)" if turned else "")
    return Image.fromarray((out * 255).round().astype(np.uint8), "RGBA"), note


def flow(name: str) -> Image.Image:
    """A flow cut to repeat: its ragged ends trimmed, its band centred, its two ends blended into one another."""
    path = painting(name)
    if path is None:
        raise SystemExit(f"no painting for {name}")
    rgba = unmix(path)
    h, w = rgba.shape[:2]
    rows = np.nonzero(rgba[..., 3].max(axis=1) > 0.05)[0]
    mid, half = (rows.min() + rows.max()) / 2, (rows.max() - rows.min()) / 2 * 1.15 + 4
    rgba = rgba[max(0, int(mid - half)) : min(h, int(mid + half) + 1), int(w * 0.03) : int(w * 0.97)]
    # A painting that repeats a shape (the spiral's turns) is cut to a whole number of them.
    profile = rgba[..., 3].sum(axis=0)
    profile = profile - profile.mean()
    w = rgba.shape[1]
    lags = range(w // 14, w // 3)
    scores = [float(np.dot(profile[:-lag], profile[lag:]) / max(1e-6, np.dot(profile[:-lag], profile[:-lag]))) for lag in lags]
    best = int(np.argmax(scores))
    seam_share = FLOW_SEAM
    if scores[best] > 0.6:
        period = lags[best]
        rgba = rgba[:, : (w // period) * period + int(period * 0.3)]
        w = rgba.shape[1]
        seam_share = period * 0.3 / w
    seam = int(w * seam_share)
    ramp = np.linspace(0, 1, seam, dtype=np.float32)[None, :, None]
    out = rgba[:, : w - seam].copy()
    out[:, :seam] = rgba[:, w - seam :] * (1 - ramp) + rgba[:, :seam] * ramp
    # Faded out at the top and bottom, so the band has no hard edge across the beam.
    y = np.linspace(-1, 1, out.shape[0], dtype=np.float32)[:, None]
    out[..., 3] *= np.clip((1 - np.abs(y)) / 0.2, 0, 1)
    return Image.fromarray((stretch(out, FLOW_W, FLOW_H) * 255).round().astype(np.uint8), "RGBA")


def main() -> None:
    rows = -(-len(ORDER) // ACROSS)
    strip_rows = -(-len(STRIPS) // STRIP_ACROSS)
    top = CELL * rows
    sheet = Image.new("RGBA", (CELL * ACROSS, top + STRIP_H * strip_rows), (0, 0, 0, 0))
    for index, name in enumerate(ORDER):
        img, note = cell(name)
        sheet.paste(img, ((index % ACROSS) * CELL, (index // ACROSS) * CELL))
        print(f"{index:2d} {name:7s} {note}")
    for index, name in enumerate(STRIPS):
        img, note = strip(name)
        sheet.paste(img, ((index % STRIP_ACROSS) * STRIP_W, top + (index // STRIP_ACROSS) * STRIP_H))
        print(f"{index:2d} {name:7s} {note}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    sheet.save(OUT, optimize=True)
    # The flows under the sheet in the preview, each laid twice end to end to show the repeat.
    shown = Image.new("RGBA", (sheet.width, FLOW_H * len(FLOWS)), (0, 0, 0, 0))
    for index, name in enumerate(FLOWS):
        img = flow(name)
        img.save(os.path.join(os.path.dirname(OUT), f"tower-fx-{name}.png"), optimize=True)
        for x in range(0, sheet.width, FLOW_W):
            shown.paste(img, (x, index * FLOW_H))
        print(f"   {name:7s} {os.path.basename(painting(name) or '')}")
    whole = Image.new("RGBA", (sheet.width, sheet.height + shown.height), (0, 0, 0, 0))
    whole.paste(sheet, (0, 0))
    whole.paste(shown, (0, sheet.height))
    # A look at it on the game's grass and on black, for the review.
    preview = Image.new("RGBA", (whole.width, whole.height * 2), (0, 0, 0, 255))
    grass = Image.new("RGBA", whole.size, (92, 140, 60, 255))
    preview.paste(Image.alpha_composite(grass, whole), (0, 0))
    preview.paste(Image.alpha_composite(Image.new("RGBA", whole.size, (20, 20, 28, 255)), whole), (0, whole.height))
    preview.convert("RGB").save(PREVIEW)
    print(OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
