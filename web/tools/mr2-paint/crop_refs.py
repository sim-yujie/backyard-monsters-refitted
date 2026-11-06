#!/usr/bin/env python3
"""Cuts the mock-up B reference crops that the Codex prompts attach (into git-ignored work/refs/).

  python web/tools/mr2-paint/crop_refs.py [path/to/variant-B-soft-lines.jpg]
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
MOCKUP = Path(sys.argv[1] if len(sys.argv) > 1 else
              "C:/Coding/BYMR/worktrees/mr2-mockup2/art-samples/mr2-mockup2/variant-B-soft-lines.jpg")
# Boxes in the 2000 x 1126 mock-up.
CROPS = {
    "meadow": (500, 600, 900, 900), "meadow2": (560, 880, 900, 1120), "beach": (150, 620, 450, 1000),
    "sea": (0, 450, 300, 950), "cliff": (700, 60, 1340, 520), "forest": (1050, 80, 1700, 640),
    "marsh": (1100, 720, 1800, 1100), "rocks": (720, 400, 1100, 620), "hills": (300, 0, 1000, 420),
}

if __name__ == "__main__":
    out = HERE / "work" / "refs"
    out.mkdir(parents=True, exist_ok=True)
    image = Image.open(MOCKUP).convert("RGB")
    for name, box in CROPS.items():
        image.crop(box).save(out / f"ref-{name}.png")
