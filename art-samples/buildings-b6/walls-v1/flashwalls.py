"""flashwalls.py : the Flash wall blocks (copied into flash-src/) as the game draws them, in one shared pixel frame
(origin = the block's anchor), for fitting and the comparison pictures.

    python flashwalls.py sheet [zoom]   -> work/flash-sheet.png: every look, whole / damaged / destroyed, on grass

Used as a module: LOOKS (key -> set, level), flash_rgba(key, state), shadow_rgba(key, state).
Offsets from web/src/game/yard/buildingArtData.ts (17 Block, 18 Stone Block) and buildingArtInfernoData.ts (17 Block).
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
SRC = HERE / "flash-src"
FRAME = (-30, -30, 38, 38)        # x0, y0, x1, y1 in Flash px round the anchor: every look and its shadow fit
STATES = ("whole", "damaged", "destroyed")

# key: (folder, [(top, x, y) per state], [(shadow, x, y) per state])
_S = ("shadow.jpg", -28, -7)
LOOKS = {
    "block1": ("walls", [("top.1.png", -21, -21), ("top.1.damaged.png", -21, -21), ("top.1.destroyed.png", -21, -5)], [_S] * 3),
    "block2": ("walls", [("top.2.png", -20, -20), ("top.2.damaged.png", -21, -20), ("top.2.destroyed.png", -19, 0)], [_S] * 3),
    "block3": ("walls", [("top.3.png", -21, -21), ("top.3.damaged.png", -22, -21), ("top.3.destroyed.png", -21, -3)], [_S] * 3),
    "block4": ("walls", [("top.4.v2.png", -20, -22), ("top.4.damaged.v2.png", -20, -22), ("top.4.destroyed.png", -20, -2)], [_S] * 3),
    "block5": ("walls", [("top.5.png", -20, -22), ("top.5.damaged.png", -20, -19), ("top.5.destroyed.png", -20, -3)], [_S] * 3),
    "stone": ("stone", [("top.1.png", -16, -21), ("top.1.damaged.png", -17, -19), ("top.1.destroyed.png", -16, 0)],
              [("shadow.1.jpg", -19, -1), ("shadow.1.jpg", -19, -1), ("shadow.1.destroyed.jpg", -14, 5)]),
    "inferno1": ("iwalls", [("top.1.v2.png", -24, -5), ("top.1.damaged.v2.png", -24, -5), ("top.1.destroyed.v2.png", -24, -5)],
                 [("shadow.1.v2.jpg", -20, 0.8), ("shadow.1.damaged.v2.jpg", -20, 0.8), ("shadow.1.destroyed.v2.jpg", -20, 0.8)]),
    "inferno2": ("iwalls", [("top.2.v2.png", -20, -9), ("top.2.damaged.v2.png", -20, -9), ("top.2.destroyed.v2.png", -20, -9)],
                 [("shadow.2.v2.jpg", -20, -0.9)] * 3),
    "inferno3": ("iwalls", [("top.3.v2.png", -20, -27), ("top.3.damaged.v2.png", -20, -27), ("top.3.destroyed.v2.png", -18, -8)],
                 [("shadow.3.v2.jpg", -20, -1)] * 3),
}
SETS = {"blocks": ["block1", "block2", "block3", "block4", "block5"], "stone": ["stone"],
        "inferno": ["inferno1", "inferno2", "inferno3"]}
NAMES = {"block1": "Block L1", "block2": "Block L2", "block3": "Block L3", "block4": "Block L4", "block5": "Block L5",
         "stone": "Stone Block", "inferno1": "Inferno Block L1", "inferno2": "Inferno Block L2",
         "inferno3": "Inferno Block L3"}


def _canvas():
    x0, y0, x1, y1 = FRAME
    return Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))


def flash_rgba(key, state="whole"):
    folder, tops, _ = LOOKS[key]
    f, x, y = tops[STATES.index(state)]
    c = _canvas()
    c.alpha_composite(Image.open(SRC / folder / f).convert("RGBA"), (round(x - FRAME[0]), round(y - FRAME[1])))
    return c


def shadow_rgba(key, state="whole"):
    """The ground shadow as Flash multiplies it: black with alpha = darkness."""
    folder, _, shs = LOOKS[key]
    f, x, y = shs[STATES.index(state)]
    im = Image.open(SRC / folder / f).convert("L")
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sh.putalpha(ImageChops.invert(im))
    c = _canvas()
    c.alpha_composite(sh, (round(x - FRAME[0]), round(y - FRAME[1])))
    return c


def on_grass(key, state="whole", grass=(96, 140, 60)):
    c = _canvas()
    out = Image.new("RGBA", c.size, grass + (255,))
    out.alpha_composite(shadow_rgba(key, state))
    out.alpha_composite(flash_rgba(key, state))
    return out


if __name__ == "__main__":
    (HERE / "work").mkdir(exist_ok=True)
    if sys.argv[1] == "sheet":
        z = int(sys.argv[2]) if len(sys.argv) > 2 else 4
        w, h = (FRAME[2] - FRAME[0]) * z, (FRAME[3] - FRAME[1]) * z
        keys = list(LOOKS)
        out = Image.new("RGB", (w * 3, h * len(keys)), (30, 30, 30))
        d = ImageDraw.Draw(out)
        for r, k in enumerate(keys):
            for c, s in enumerate(STATES):
                out.paste(on_grass(k, s).convert("RGB").resize((w, h), Image.NEAREST), (c * w, r * h))
                d.text((c * w + 3, r * h + 3), f"{NAMES[k]} {s}", fill=(255, 255, 0))
        out.save(HERE / "work/flash-sheet.png")
