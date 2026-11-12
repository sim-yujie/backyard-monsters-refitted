"""Comparison sheet of the Rezghul orb candidates, on real yard ground beside Rezghul.

Run from the worktree root: python -I art-samples/rezghul-orb/compare_orbs.py
Writes art-samples/rezghul-orb/compare-orbs.png (and a 1x strip compare-orbs-1x.png).
Each cell: the yard ground of that look at 4x, Rezghul at its real size and the orb
beside it at its real size (both x4), with the game's soft white glow under the orb
(Flash's GlowFilter, alpha 0.8, blur 9), and the orb alone at 8x in the corner.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ASSETS = ROOT / "server/public/assets"
NAMES = ["vortex", "knob", "skull"]
TITLES = {"vortex": "A  Soul vortex", "knob": "B  Grave knob", "skull": "C  Ghost skull"}
ZOOM = 4
CELL_W, CELL_H = 520, 400


def tile(ground: Image.Image, w: int, h: int) -> Image.Image:
    out = Image.new("RGBA", (w, h))
    for y in range(0, h, ground.height):
        for x in range(0, w, ground.width):
            out.alpha_composite(ground, (x, y))
    return out


def glowed(orb: Image.Image) -> Image.Image:
    """The orb over a soft white glow, as the game draws it."""
    pad = 10
    big = Image.new("RGBA", (orb.width + pad * 2, orb.height + pad * 2))
    big.alpha_composite(orb, (pad, pad))
    alpha = big.getchannel("A").filter(ImageFilter.GaussianBlur(3))
    glow = Image.new("RGBA", big.size, (255, 255, 255, 0))
    glow.putalpha(alpha.point(lambda v: int(min(255, v * 0.8 * 1.6))))
    glow.alpha_composite(big)
    return glow


def rezghul(look: str) -> Image.Image:
    if look == "classic":
        sheet = Image.open(ASSETS / "monsters/rezghul.png").convert("RGBA")
        return sheet.crop((4 * 48, 0, 5 * 48, 43))
    sheet = Image.open(ASSETS / "monsters/rezghul-anim@2x.png").convert("RGBA")
    return sheet.crop((4 * 128, 0, 5 * 128, 112)).resize((64, 56), Image.LANCZOS)


def ground(look: str) -> Image.Image:
    if look == "classic":
        return Image.open(ASSETS / "yardbg/grass/2174_isograss1_isograss1.png").convert("RGBA")
    return Image.open(ASSETS / "yardbg/meadow/layer1.webp").convert("RGBA")


def font(size: int) -> ImageFont.ImageFont:
    for name in ("arialbd.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def cell(look: str, name: str) -> Image.Image:
    orb = Image.open(HERE / f"out/{look}-{name}.png").convert("RGBA")
    small = tile(ground(look), CELL_W // ZOOM, CELL_H // ZOOM)
    demon = rezghul(look)
    small.alpha_composite(demon, (8, small.height - demon.height - 22))
    g = glowed(orb)
    small.alpha_composite(g, (74 - g.width // 2, 46 - g.height // 2))
    big = small.resize((CELL_W, CELL_H), Image.NEAREST if look == "classic" else Image.LANCZOS)
    # The orb alone at 8x (its @2x file at 4x) in the top right.
    orb2 = Image.open(HERE / f"out/{look}-{name}@2x.png").convert("RGBA")
    alone = orb2.resize((orb2.width * 4, orb2.height * 4), Image.LANCZOS)
    box = Image.new("RGBA", (alone.width + 16, alone.height + 16), (20, 20, 24, 210))
    box.alpha_composite(alone, (8, 8))
    big.alpha_composite(box, (CELL_W - box.width - 8, 8))
    return big


def main() -> None:
    head = 54
    side = 150
    sheet = Image.new("RGB", (side + CELL_W * 3 + 40, head + CELL_H * 2 + 30), (30, 30, 34))
    draw = ImageDraw.Draw(sheet)
    for col, name in enumerate(NAMES):
        draw.text((side + col * (CELL_W + 10) + 10, 14), TITLES[name], fill=(240, 240, 240), font=font(26))
    for row, look in enumerate(("classic", "modern")):
        y = head + row * (CELL_H + 10)
        draw.text((14, y + CELL_H // 2 - 14), look.capitalize(), fill=(240, 240, 240), font=font(26))
        for col, name in enumerate(NAMES):
            sheet.paste(cell(look, name).convert("RGB"), (side + col * (CELL_W + 10), y))
    sheet.save(HERE / "compare-orbs.png")

    # True size strip: each orb at 1x and 2x on its ground, no zoom.
    strip = Image.new("RGBA", (6 * 70, 2 * 60))
    for row, look in enumerate(("classic", "modern")):
        bg = tile(ground(look), 6 * 70, 60)
        strip.alpha_composite(bg, (0, row * 60))
        for col, name in enumerate(NAMES):
            orb = Image.open(HERE / f"out/{look}-{name}.png").convert("RGBA")
            strip.alpha_composite(glowed(orb), (col * 140 + 10, row * 60 + 10))
            orb2 = Image.open(HERE / f"out/{look}-{name}@2x.png").convert("RGBA")
            strip.alpha_composite(orb2, (col * 140 + 70, row * 60 + 8))
    strip.save(HERE / "compare-orbs-1x.png")


if __name__ == "__main__":
    main()
