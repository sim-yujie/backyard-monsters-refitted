"""
Draw PLACEHOLDER champion eggs until the painted ones are approved (champion
eggs, owner 2026-10-20: raising a champion lays an egg that hatches in a day).

Usage (from the repo root):

    pip install pillow
    python web/tools/gen-egg-placeholders.py

Writes, for Gorgo (G1), Drull (G2), Fomor (G3) and Korath (G4):

    web/public/eggs/G<n>-egg.webp       the cage window, 240 square, the egg
                                        centred on transparency (drawn at 120 px)
    web/public/eggs/G<n>-egg-yard.webp  the yard, 96 x 120, the egg standing on
                                        the bottom edge (drawn 60 px tall in the
                                        cage's pen)

The painted eggs replace these files at the same paths and sizes; nothing in
the game needs to change. Korath cannot be raised, so its egg is not shown yet.
"""

from pathlib import Path
import random

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "public" / "eggs"

# Shell colour, spot colour, outline: each champion's own colours.
CHAMPIONS = {
    "G1": ((86, 150, 214), (40, 82, 150), (24, 48, 92)),  # Gorgo, blue
    "G2": ((206, 78, 60), (120, 34, 30), (78, 22, 20)),  # Drull, red
    "G3": ((150, 96, 200), (84, 46, 132), (52, 28, 84)),  # Fomor, purple
    "G4": ((92, 70, 62), (240, 130, 40), (40, 30, 26)),  # Korath, lava rock
}

SCALE = 4  # drawn large, then shrunk for smooth edges


def egg_mask(width: int, height: int) -> Image.Image:
    """An egg outline: rounder at the bottom than at the top."""
    mask = Image.new("L", (width, height), 0)
    pixels = mask.load()
    cx = width / 2
    for y in range(height):
        # 0 at the top, 1 at the bottom
        t = y / (height - 1)
        # Half-width of an egg: a circle stretched, with the widest point low.
        u = 2 * t - 1  # -1..1
        half = (1 - u * u) ** 0.5 * (0.86 + 0.14 * u)
        for x in range(width):
            if abs(x - cx) <= half * width / 2:
                pixels[x, y] = 255
    return mask


def draw_egg(id_: str, width: int, height: int) -> Image.Image:
    shell, spot, line = CHAMPIONS[id_]
    w, h = width * SCALE, height * SCALE
    mask = egg_mask(w, h)

    body = Image.new("RGBA", (w, h), shell + (255,))
    draw = ImageDraw.Draw(body)
    rng = random.Random(id_)
    for _ in range(14):
        r = rng.uniform(0.04, 0.09) * w
        x = rng.uniform(0.2, 0.8) * w
        y = rng.uniform(0.15, 0.85) * h
        draw.ellipse((x - r, y - r * 0.8, x + r, y + r * 0.8), fill=spot + (255,))

    # Shade: darker on the right and bottom, a highlight up and left.
    shade = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shade).ellipse((w * 0.35, h * 0.35, w * 1.3, h * 1.25), fill=110)
    shade = shade.filter(ImageFilter.GaussianBlur(w * 0.12))
    body = Image.composite(Image.new("RGBA", (w, h), (0, 0, 0, 255)), body, shade)
    light = Image.new("L", (w, h), 0)
    ImageDraw.Draw(light).ellipse((w * 0.22, h * 0.14, w * 0.45, h * 0.36), fill=150)
    light = light.filter(ImageFilter.GaussianBlur(w * 0.05))
    body = Image.composite(Image.new("RGBA", (w, h), (255, 255, 255, 255)), body, light)

    egg = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    edge = mask.filter(ImageFilter.MaxFilter(3 * SCALE + 1 if (3 * SCALE) % 2 == 0 else 3 * SCALE))
    egg.paste(line + (255,), (0, 0), edge)
    inner = mask.filter(ImageFilter.MinFilter(2 * SCALE + 1))
    egg.paste(body, (0, 0), inner)
    return egg.resize((width, height), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for id_ in CHAMPIONS:
        window = Image.new("RGBA", (240, 240), (0, 0, 0, 0))
        egg = draw_egg(id_, 150, 190)
        window.alpha_composite(egg, ((240 - 150) // 2, (240 - 190) // 2))
        window.save(OUT / f"{id_}-egg.webp", lossless=True)

        yard = Image.new("RGBA", (96, 120), (0, 0, 0, 0))
        egg = draw_egg(id_, 84, 112)
        yard.alpha_composite(egg, ((96 - 84) // 2, 120 - 112))
        yard.save(OUT / f"{id_}-egg-yard.webp", lossless=True)
        print(f"{id_}: {OUT / f'{id_}-egg.webp'}, {OUT / f'{id_}-egg-yard.webp'}")


if __name__ == "__main__":
    main()
