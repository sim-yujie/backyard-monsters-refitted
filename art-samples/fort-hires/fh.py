"""fh.py : shared parts of the high-res redraw of Flash's fortification art (art/fort-hires, 14 Nov 2026).
Run with ~/.cache/bymr-art-venv/bin/python (numpy + Pillow). Only the scripts and prompts are in git; the Codex sheets
(<job>/sheet.png), the pieces and the owner sheets are kept in archive/b8-codex-fort-hall/fort-hires-final/."""
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FORT = REPO / "server/public/assets/buildings/fortifications"
MAGENTA = (255, 0, 255)
# sheet layout: 1536x1024, 2x2 cells; left column = back halves, right = front halves; rows = the job's two levels
SHEET = (1536, 1024)
SCALE = {70: 4.0, 130: 2.5}          # sheet px per Flash px
JOBS = {"s70_12": (70, (1, 2)), "s70_34": (70, (3, 4)), "s130_12": (130, (1, 2)), "s130_34": (130, (3, 4))}


def flash(size, half, tier):
    return Image.open(FORT / f"fort{size}_{half}{tier}.png").convert("RGBA")


def split(im):
    """Flash piece -> (vine RGBA, shadow alpha as float array 0..1). The baked shadow is near-black and
    translucent; the vines and spikes are lighter or opaque."""
    a = np.asarray(im).astype(np.float32)
    al = a[..., 3] / 255
    mx = a[..., :3].max(-1)
    w = np.clip((mx - 26) / 26, 0, 1)                 # 0 = shadow-dark, 1 = clearly vine
    solid = np.clip((al - 0.62) / 0.3, 0, 1)          # opaque dark creases belong to the vine
    keep = np.maximum(w, solid)
    vine = a.copy()
    vine[..., 3] = 255 * al * keep
    return Image.fromarray(vine.astype(np.uint8), "RGBA"), al * (1 - keep)


def cell_box(col, row):
    cw, ch = SHEET[0] // 2, SHEET[1] // 2
    return col * cw, row * ch, cw, ch


def place(size, half, tier, row):
    """Where a Flash piece sits on the sheet: (x, y, w, h) of its enlarged canvas, centred in its cell."""
    im = flash(size, half, tier)
    s = SCALE[size]
    w, h = round(im.width * s), round(im.height * s)
    cx, cy, cw, ch = cell_box("BF".index(half), row)
    return cx + (cw - w) // 2, cy + (ch - h) // 2, w, h


def ref_sheet(job):
    size, tiers = JOBS[job]
    sh = Image.new("RGB", SHEET, MAGENTA)
    for row, t in enumerate(tiers):
        for half in "BF":
            vine, _ = split(flash(size, half, t))
            x, y, w, h = place(size, half, t, row)
            big = vine.convert("RGBa").resize((w, h), Image.LANCZOS).convert("RGBA")
            sh.paste(big, (x, y), big)
    return sh


if __name__ == "__main__":
    for job in JOBS:
        (HERE / job).mkdir(exist_ok=True)
        ref_sheet(job).save(HERE / job / "flash-ref.png")
        print(job)
