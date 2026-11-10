"""Autumn decoration samples: cuts the Codex sheet up and builds the review pictures.

Input:  sheet1/autumn-sheet-v1.png (run-codex.sh sheet1 <refs>, 2 x 2 cells on flat magenta)
Output (shots/ at the worktree root):
  <name>-full.png      the cut-out painting, full size, on a light ground
  <name>-vs-scarecrow.png  Flash's scarecrow beside the sample, both at in-game size, enlarged 4x
  autumn-decor-sheet.png   everything autumn: Flash decorations in the game, the painted
                           Thanksgiving props, then the new samples, labelled
  cutouts/<name>@2x.png    the sample at 2x its in-game size (how the painted props ship)

Usage: python build_samples.py
"""
import importlib.util
import json
import os
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", ".."))
SHOTS = os.path.join(ROOT, "shots")
DECOR = os.path.join(ROOT, "server", "public", "assets", "buildings", "decorations")
TG = os.path.join(ROOT, "server", "public", "assets", "specialevent", "thanksgiving")

# Reuse the Thanksgiving helper's magenta keying.
_spec = importlib.util.spec_from_file_location("tg_build", os.path.join(HERE, "..", "thanksgiving", "build_art.py"))
tg = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tg)

GRASS = (98, 140, 62)
LIGHT = (236, 232, 222)
INK = (30, 26, 20)
ZOOM = 4  # in-game size, enlarged this much for the owner

# name, label, cell index in the 2 x 2 sheet, in-game height in world pixels
# (Flash's scarecrow is 72 tall, the bonsai tree 61, the acorn 30).
SAMPLES = [
    ("turkey-topiary", "Turkey Topiary", 0, 58),
    ("harvest-wheelbarrow", "Harvest Wheelbarrow", 1, 50),
    ("autumn-maple", "Autumn Maple Tree", 2, 80),
    ("leaf-pile-rake", "Leaf Pile and Rake", 3, 50),
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for f in ("C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def trim(im: Image.Image) -> Image.Image:
    return im.crop(im.getbbox())


def at_height(im: Image.Image, h: int) -> Image.Image:
    return im.resize((max(1, round(im.width * h / im.height)), h), Image.LANCZOS)


def zoom(im: Image.Image, z: int = ZOOM) -> Image.Image:
    return im.resize((im.width * z, im.height * z), Image.LANCZOS)


def flash(path: str) -> Image.Image:
    return Image.open(os.path.join(DECOR, path)).convert("RGBA")


def on(bg, im: Image.Image, pad: int = 24) -> Image.Image:
    out = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), bg + (255,))
    out.alpha_composite(im, (pad, pad))
    return out


def row(items: list[tuple[str, Image.Image]], bg, gap: int = 40, label_h: int = 44, f=None) -> Image.Image:
    """Items standing on one baseline, each with its label under it."""
    f = f or font(26)
    h = max(im.height for _, im in items)
    widths = [max(im.width, int(f.getlength(t)) + 8) for t, im in items]
    out = Image.new("RGBA", (sum(widths) + gap * (len(items) + 1), h + label_h + gap), bg + (255,))
    d = ImageDraw.Draw(out)
    x = gap
    for (text, im), w in zip(items, widths):
        out.alpha_composite(im, (x + (w - im.width) // 2, gap // 2 + h - im.height))
        d.text((x + w // 2, gap // 2 + h + 8), text, fill=INK, font=f, anchor="ma")
        x += w + gap
    return out


def titled(title: str, body: Image.Image, bg=LIGHT) -> Image.Image:
    f = font(34)
    out = Image.new("RGBA", (max(body.width, int(f.getlength(title)) + 48), body.height + 60), bg + (255,))
    ImageDraw.Draw(out).text((24, 12), title, fill=INK, font=f)
    ImageDraw.Draw(out).rectangle((0, 60, out.width, out.height), fill=body.getpixel((0, 0)))
    out.alpha_composite(body, ((out.width - body.width) // 2, 60))
    return out


def stack(parts: list[Image.Image], bg=LIGHT, gap: int = 16) -> Image.Image:
    w = max(p.width for p in parts)
    out = Image.new("RGBA", (w, sum(p.height for p in parts) + gap * (len(parts) - 1)), bg + (255,))
    y = 0
    for p in parts:
        out.alpha_composite(p, (0, y))
        y += p.height + gap
    return out


def main() -> None:
    os.makedirs(os.path.join(SHOTS, "cutouts"), exist_ok=True)
    sheet = tg.key(Image.open(os.path.join(HERE, "sheet1", "autumn-sheet-v1.png")))
    paintings = [trim(tg.clean(c, 40)) for c in tg.cells(sheet, 2, 2)]
    scarecrow = flash("scarecrow/top.png")

    games = []
    for name, label, idx, h in SAMPLES:
        full = paintings[idx]
        on(LIGHT, full, 40).convert("RGB").save(os.path.join(SHOTS, f"{name}-full.png"))
        at2 = at_height(full, h * 2)
        at2.save(os.path.join(SHOTS, "cutouts", f"{name}@2x.png"))
        game = zoom(at2, ZOOM // 2)  # 2x art drawn at 1x, then the owner's 4x
        games.append((label, game))
        cmp_ = row([("Flash Scarecrow (in game)", zoom(scarecrow)), (f"{label} (new)", game)], GRASS, gap=60, f=font(28))
        titled(f"{label}: beside the Scarecrow, both at in-game size, enlarged {ZOOM}x", cmp_).convert("RGB").save(
            os.path.join(SHOTS, f"{name}-vs-scarecrow.png"))

    z = 3
    existing = row([
        ("Scarecrow 69", zoom(scarecrow, z)),
        ("D.A.V.E. Pumpkin 110", zoom(flash("pumpkins/attended-large-top.png"), z)),
        ("Mini-Pumpkin 111", zoom(flash("pumpkins/attended-small-top.png"), z)),
        ("Acorn 55", zoom(flash("acorn/top.png"), z)),
        ("Pinecone 66", zoom(flash("pinecone/top.png"), z)),
        ("Walnut 72", zoom(flash("walnut/top.png"), z)),
        ("Blackberry Bush 86", zoom(flash("blackberrybush/top.png"), z)),
    ], GRASS, f=font(22))

    props = Image.open(os.path.join(TG, "props.png")).convert("RGBA")
    boxes = json.load(open(os.path.join(TG, "props.json")))
    def prop(n: str) -> Image.Image:
        # props.png is 2x art, drawn at half size in the yard.
        b = boxes[n]
        cut = props.crop((b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]))
        return cut.resize((b["w"] * z // 2, b["h"] * z // 2), Image.LANCZOS)
    painted = row([("Hay Bale", prop("hay")), ("Corn Shock", prop("corn")), ("Pumpkin Pile", prop("pumpkins")),
                   ("Cornucopia", prop("cornucopia")), ("Leaves", prop("leaf-red"))], GRASS, f=font(22))

    sc = zoom(scarecrow, z)
    new = row([("Scarecrow (Flash)", sc)] + [(f"{l} (NEW)", g.resize((g.width * z // ZOOM, g.height * z // ZOOM), Image.LANCZOS))
                                             for l, g in games], GRASS, f=font(22))

    out = stack([
        titled(f"1. In the game today (Flash art; 69, 110, 111 are event rewards only, not in the shop), {z}x", existing),
        titled(f"2. Already painted for the Thanksgiving yard edge (Codex, 8 Nov), not decorations yet, {z}x", painted),
        titled(f"3. New samples (Codex, 9 Nov), in-game size, {z}x, Scarecrow for scale", new),
    ])
    out.convert("RGB").save(os.path.join(SHOTS, "autumn-decor-sheet.png"))
    print("sheet", out.size)


if __name__ == "__main__":
    main()
