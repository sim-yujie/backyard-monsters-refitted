"""
check_crop.py: checks common.flash_cell. Every whole-pixel sheet (no `flash_w`, IC1) must cut exactly as
col * width (unchanged by the fractional-width fix); a fractional sheet (IC2) must give every column its own
art run and nothing of its neighbours'. Writes <out dir>/crop-check-<ID>.png for every sheet when given (row flash_row cut, enlarged).
    python check_crop.py [out dir]
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

import common
from spec import SPECS

def report_fractional(mid, spec, sheet):
    w, h = spec["cell"]
    total = int((np.asarray(sheet)[..., 3] > 0).sum())
    kept = 0
    for c in range(spec["flash_columns"]):
        a = np.asarray(common.flash_cell(spec, c))[..., 3] > 0
        kept += int(a.sum())
        xs = np.flatnonzero(a.any(0))
        body = np.asarray(common.flash_cell(spec, c))[..., 3] > 235
        bx = np.flatnonzero(body.any(0))
        print(f"{mid} c{c:2}: x0 {common.flash_x(spec, c):4}  art x {xs.min():2}-{xs.max():2}  body x {bx.min():2}-{bx.max():2}")
    print(f"{mid}: {kept} of {total} art pixels kept ({total - kept} cut off at the cell edges)")


def picture(mid, spec):
    """crop-check-<ID>.png: the cut cells (row spec flash_row), enlarged."""
    w, h = spec["cell"]
    z = 4
    pic = Image.new("RGB", (10 * w * z, 3 * h * z), (128, 128, 128))
    for c in range(spec["flash_columns"]):
        bg = Image.new("RGBA", (w, h), (128, 128, 128, 255))
        bg.alpha_composite(common.flash_cell(spec, c))
        pic.paste(bg.convert("RGB").resize((w * z, h * z), Image.NEAREST), ((c % 10) * w * z, (c // 10) * h * z))
    Path(sys.argv[1]).mkdir(parents=True, exist_ok=True)
    pic.save(Path(sys.argv[1]) / f"crop-check-{mid}.png")



bad = 0
for mid, spec in SPECS.items():
    w, h = spec["cell"]
    sheet = common.flash_sheet(spec)
    rows = sheet.height // h
    if "flash_w" not in spec:
        for r in range(rows):
            for c in range(spec["flash_columns"]):
                plain = np.asarray(sheet.crop((c * w, r * h, (c + 1) * w, (r + 1) * h)))
                if not np.array_equal(plain, np.asarray(common.flash_cell(spec, c, r))):
                    print(f"{mid} column {c} row {r}: cut changed")
                    bad += 1
        print(f"{mid}: {spec['flash_columns']} x {rows} cells cut as before")
    if "flash_w" in spec:
        report_fractional(mid, spec, sheet)
    if len(sys.argv) > 1:
        picture(mid, spec)
sys.exit(1 if bad else 0)
