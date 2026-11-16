"""Cuts c2/sheet.png (3 designs x 2 looks on magenta) into the orb files in out/.

Run from the worktree root: python -I art-samples/rezghul-orb/cut_c2.py
The Classic row is blurred into the magenta, so a plain key leaves a pink-grey
fringe. Here each orb's soft edge is unmixed: every edge pixel takes the colour of
the nearest solid pixel inside the orb, and its alpha is how far it sits from
magenta toward that colour. Writes out/<look>-<name>{.full,,@2x}.png.
"""
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
NAMES = ["vortex", "knob", "skull"]
HEIGHT = {"vortex": 20, "knob": 20, "skull": 24}
# How far in from the orb's outer edge the colours are clean (sheet px).
CORE_IN = {"classic": 26, "modern": 3}
M = np.array([255.0, 0.0, 255.0])


def cut(cell: np.ndarray, look: str) -> Image.Image:
    rgb = cell[..., :3].astype(float)
    dist = np.linalg.norm(rgb - M, axis=-1)
    obj = dist > 45
    lab, n = ndimage.label(obj)
    sizes = ndimage.sum(obj, lab, range(1, n + 1))
    obj = ndimage.binary_fill_holes(lab == (int(np.argmax(sizes)) + 1))
    core = ndimage.binary_erosion(obj, iterations=CORE_IN[look])
    # Nearest core pixel for every pixel.
    _, (iy, ix) = ndimage.distance_transform_edt(~core, return_indices=True)
    f = rgb[iy, ix]
    fm = f - M
    a = np.sum((rgb - M) * fm, axis=-1) / np.maximum(np.sum(fm * fm, axis=-1), 1.0)
    a = np.clip(a, 0.0, 1.0)
    a[core] = 1.0
    # Only the band joined to the orb counts; far-away stray noise goes.
    near = ndimage.binary_dilation(obj, iterations=4)
    a[~near] = 0.0
    a[a < 0.03] = 0.0
    # Colour: the unmixed colour where alpha is high enough to trust, else the core's.
    safe = np.maximum(a, 1e-3)[..., None]
    unmixed = np.clip(M + (rgb - M) / safe, 0, 255)
    w = np.clip((a - 0.35) / 0.4, 0, 1)[..., None]
    col = np.where(core[..., None], rgb, unmixed * w + f * (1 - w))
    out = np.dstack([col, a * 255]).round().astype(np.uint8)
    im = Image.fromarray(out, "RGBA")
    bbox = Image.fromarray((a > 0.1).astype(np.uint8) * 255).getbbox()
    return im.crop(bbox)


def at_height(im: Image.Image, h: int) -> Image.Image:
    w = max(1, round(im.width * h / im.height))
    # Resize premultiplied so edges do not darken or pick up hidden colours.
    pre = np.asarray(im).astype(float)
    pre[..., :3] *= pre[..., 3:4] / 255
    small = [
        np.asarray(Image.fromarray(pre[..., c].astype(np.float32), "F").resize((w, h), Image.LANCZOS))
        for c in range(4)
    ]
    arr = np.dstack(small)
    alpha = np.clip(arr[..., 3], 0, 255)
    rgb = np.clip(arr[..., :3] / np.maximum(alpha[..., None], 1e-3) * 255, 0, 255)
    rgb[alpha < 1] = 0
    return Image.fromarray(np.dstack([rgb, alpha]).round().astype(np.uint8), "RGBA")


def main() -> None:
    sheet = np.asarray(Image.open(HERE / "c2/sheet.png").convert("RGB"))
    ch, cw = sheet.shape[0] // 2, sheet.shape[1] // 3
    (HERE / "out").mkdir(exist_ok=True)
    for row, look in enumerate(("classic", "modern")):
        for col, name in enumerate(NAMES):
            cell = sheet[row * ch : (row + 1) * ch, col * cw : (col + 1) * cw]
            full = cut(cell, look)
            stem = HERE / f"out/{look}-{name}"
            full.save(f"{stem}.full.png")
            at_height(full, HEIGHT[name]).save(f"{stem}.png")
            at_height(full, HEIGHT[name] * 2).save(f"{stem}@2x.png")
            print(look, name, full.size)


if __name__ == "__main__":
    main()
