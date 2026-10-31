"""crops_dmg.py : full-size crops of the damaged and destroyed 3D looks (render/L1-<state>-base.png, 12 px per Flash px),
on grass, scaled to 2/3 -> cage-damaged-crop.png, cage-destroyed-crop.png. Boxes are Flash pixels (x0, y0, x1, y1)."""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
R = HERE.parent / "render"
FRAME = (-140, -24, 160, 160)
K = 12
GRASS = (96, 140, 60)
BOXES = {"damaged": (-104, 60, 24, 154), "destroyed": (-64, 30, 72, 140)}

for state, (x0, y0, x1, y1) in BOXES.items():
    im = Image.open(R / f"L1-{state}-base.png").convert("RGBA")
    c = im.crop(((x0 - FRAME[0]) * K, (y0 - FRAME[1]) * K, (x1 - FRAME[0]) * K, (y1 - FRAME[1]) * K))
    bg = Image.new("RGBA", c.size, GRASS + (255,))
    bg.alpha_composite(c)
    bg.convert("RGB").resize((c.width * 2 // 3, c.height * 2 // 3), Image.LANCZOS).save(HERE / f"cage-{state}-crop.png")
