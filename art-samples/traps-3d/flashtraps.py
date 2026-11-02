"""flashtraps.py : the Flash traps (copied into flash/) as the game draws them, in traps.py's pixel frame (origin = the
trap's anchor), for fitting and the comparison pictures.

    python flashtraps.py fit <look> [zoom]   -> work/fit-<look>.png: per state, Flash | 3D prev | Flash outline over 3D
    python flashtraps.py frames              -> work/flash/<look>-<state>.png: Flash on the 3D still's canvas (12 px a
                                                Flash px, top and shadow), for tools/levels_sheet.py

Offsets from web/src/game/yard/buildingArtData.ts (24 Booby Trap, 117 Heavy Trap) = YARD_PROPS.as imageData.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
FRAME = (-24, -14, 24, 30)
STATES = ("whole", "fired")
LOOKS = {   # look: [(top, x, y) per state], [(shadow, x, y) per state]
    "booby": ([("booby-top.png", -15, 1), ("booby-destroyed.png", -15, 2)],
              [("booby-shadow.jpg", -13, 3), ("booby-shadow.jpg", -13, 3)]),
    "heavy": ([("heavy-top.png", -16, -5), ("heavy-destroyed.png", -16, 5)],
              [("heavy-shadow.jpg", -18, 1), ("heavy-shadow.jpg", -18, 1)]),
}


def canvas():
    return Image.new("RGBA", (FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]), (0, 0, 0, 0))


def flash_rgba(look, state):
    f, x, y = LOOKS[look][0][STATES.index(state)]
    c = canvas()
    c.alpha_composite(Image.open(HERE / "flash" / f).convert("RGBA"), (x - FRAME[0], y - FRAME[1]))
    return c


def shadow_rgba(look, state):
    f, x, y = LOOKS[look][1][STATES.index(state)]
    im = Image.open(HERE / "flash" / f).convert("L")
    sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
    sh.putalpha(ImageChops.invert(im))
    c = canvas()
    c.alpha_composite(sh, (x - FRAME[0], y - FRAME[1]))
    return c


def on_grass(img, grass=(96, 140, 60)):
    out = Image.new("RGBA", img.size, grass + (255,))
    out.alpha_composite(img)
    return out


def outline(alpha, colour=(255, 0, 255, 255)):
    a = alpha.point(lambda v: 255 if v > 100 else 0)
    edge = ImageChops.subtract(a, a.filter(ImageFilter.MinFilter(3)))
    o = Image.new("RGBA", alpha.size, colour)
    o.putalpha(edge)
    return o


if __name__ == "__main__":
    (HERE / "work").mkdir(exist_ok=True)
    if sys.argv[1] == "fit":
        look = sys.argv[2]
        z = int(sys.argv[3]) if len(sys.argv) > 3 else 8
        w, h = (FRAME[2] - FRAME[0]) * z, (FRAME[3] - FRAME[1]) * z
        out = Image.new("RGB", (w * 3, h * len(STATES)), (30, 30, 30))
        d = ImageDraw.Draw(out)
        for r, st in enumerate(STATES):
            fl = Image.alpha_composite(shadow_rgba(look, st), flash_rgba(look, st)).resize((w, h), Image.NEAREST)
            prev = Image.open(HERE / "work" / f"prev-{look}-{st}.png").convert("RGBA").resize((w, h), Image.LANCZOS)
            ov = on_grass(prev)
            ov.alpha_composite(outline(flash_rgba(look, st).getchannel("A").resize((w, h), Image.NEAREST)))
            for c, im in enumerate((on_grass(fl), on_grass(prev), ov)):
                out.paste(im.convert("RGB"), (c * w, r * h))
            d.text((4, r * h + 4), f"{look} {st}: Flash | 3D | Flash outline on 3D", fill=(255, 255, 0))
        out.save(HERE / "work" / f"fit-{look}.png")
    elif sys.argv[1] == "frames":
        k = 12
        (HERE / "work" / "flash").mkdir(exist_ok=True)
        for look in LOOKS:
            for st in STATES:
                im = Image.alpha_composite(shadow_rgba(look, st), flash_rgba(look, st))
                im.resize((im.width * k, im.height * k), Image.NEAREST).save(HERE / "work" / "flash" / f"{look}-{st}.png")
