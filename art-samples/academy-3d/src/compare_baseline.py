"""compare_baseline.py : how far a fresh render (render/) is from the saved baseline (../baseline/render/).

    python compare_baseline.py [levels...]      default 1 2 3 4

Per level and picture (L<n>-base, -alone, -parts-00): the largest channel difference (0-255), the mean, and how many
pixels differ by more than 8 in any channel (RGBA, straight alpha as Blender writes it).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
NEW, OLD = HERE / "render", HERE.parent / "baseline" / "render"

for lv in sys.argv[1:] or ["1", "2", "3", "4"]:
    for kind in ("base", "alone", "parts-00"):
        a, b = NEW / f"L{lv}-{kind}.png", OLD / f"L{lv}-{kind}.png"
        if not a.exists():
            print(f"L{lv} {kind:8s} no new render")
            continue
        x = np.asarray(Image.open(a).convert("RGBA")).astype(int)
        y = np.asarray(Image.open(b).convert("RGBA")).astype(int)
        d = np.abs(x - y)
        print(f"L{lv} {kind:8s} max {d.max():3d}  mean {d.mean():.4f}  pixels over 8: {(d.max(axis=2) > 8).sum():6d} "
              f"of {d.shape[0] * d.shape[1]}  identical: {not d.any()}")
