"""split_headings.py <sheet> : key full/H/frames-new.png (2x2: right, front, left, back) into full/H/new-heading0..3.png (tight RGBA cutouts)."""
import sys
import numpy as np
from PIL import Image
from spec import SPECS, key_cell, tight
name = sys.argv[1]
H = SPECS[name]["sample"] / "full" / "H"
im = Image.open(H / "frames-new.png").convert("RGB")
w, h = im.size
for i in range(4):
    c = key_cell(np.asarray(im.crop(((i % 2) * w // 2, (i // 2) * h // 2, (i % 2 + 1) * w // 2, (i // 2 + 1) * h // 2))))
    tight(c).save(H / f"new-heading{i}.png")
print("split", H, im.size)
