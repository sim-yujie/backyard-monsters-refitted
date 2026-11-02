"""Makes the build menu's Modern pictures from the game's own art (owner, 2 Nov 2026: "refresh the images in
'buildings' for both overworld and inferno to use our new look for the modern setting").

    python -I web/tools/build-pictures/make.py [--sheet <contact sheet .png>]

Run it again whenever a building's new look changes or a new one lands. `jobs.ts` names every type in a build menu
(main yard, outposts, Inferno) that shows a new look in the yard (`newLookFor`) and the files the yard draws it from;
each picture is that building at level 1, the look a new one has (as Flash's buttons showed; Housing and the Champion
Cage at their top level, as level 1 is a bare fence), centred on the building itself, with its ground shadow,
on a transparent ground and fitted into the same box so every building sits at about the same size in its tile.

Writes `server/public/assets/buildingbuttons/modern/<type>.<main|inferno>.<hash>.webp` (the hash changes with the
picture, so browsers never keep an old one), removes pictures no longer named, and writes the table the game reads,
`web/src/game/yard/buildButtonModernData.ts`. With the Classic look the menu keeps Flash's buttons.
"""

import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[3]
WEB = ROOT / "web"
PUBLIC = ROOT / "server" / "public"
OUT = PUBLIC / "assets" / "buildingbuttons" / "modern"
DATA = WEB / "src" / "game" / "yard" / "buildButtonModernData.ts"

# The picture: 4:5 like the menu's tile (`.build-tile__picture`), at twice the 120 px tile.
WIDTH, HEIGHT = 240, 300
# The box every building (with its shadow) is fitted into, and where its middle sits.
BOX_W, BOX_H = 212, 220
MIDDLE_Y = 156
# The game draws its pictures at 1 px a world px; `@2x` files at 2 px. The pictures are made at 2 px a world px.
SCALE = 2
# A pixel counts as part of the building above this alpha, for the crop.
ALPHA_FLOOR = 10
# Close-ups, as Flash's own buttons for these two: Housing's fence runs off the tile round its building block, and
# the Champion Cage's fence fills the tile. type: (how much bigger than fitting the whole, middle as a share of the
# building's own width and height).
CLOSE_UP = {15: (2.1, (0.80, 0.44)), 114: (1.6, (0.5, 0.5))}


def load(url: str) -> Image.Image:
    return Image.open(PUBLIC / url.lstrip("/")).convert("RGBA")


def at_scale(image: Image.Image, url: str) -> Image.Image:
    """The image at `SCALE` px a world px."""
    factor = SCALE // 2 if "@2x" in url else SCALE
    if factor == 1:
        return image
    return image.resize((image.width * factor, image.height * factor), Image.LANCZOS)


def shadow_layer(url: str) -> Image.Image:
    """A shadow JPEG, which the yard multiplies onto the grass, as black whose alpha darkens the same."""
    grey = Image.open(PUBLIC / url.lstrip("/")).convert("L")
    alpha = ImageChops.invert(grey)
    layer = Image.new("RGBA", grey.size, (0, 0, 0, 0))
    layer.putalpha(alpha)
    return at_scale(layer, url)


def close_up(top: Image.Image, zoom: float, focus: tuple[float, float]) -> Image.Image:
    """The building alone, `zoom` times its whole-fit size, its `focus` point in the picture's middle."""
    own = top.getchannel("A").point(lambda a: 255 if a > ALPHA_FLOOR else 0).getbbox()
    building = top.crop(own)
    fit = min(BOX_W / building.width, BOX_H / building.height) * zoom
    building = building.resize((round(building.width * fit), round(building.height * fit)), Image.LANCZOS)
    picture = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    x = round(WIDTH / 2 - focus[0] * building.width)
    y = round(MIDDLE_Y - focus[1] * building.height)
    picture.paste(building, (x, y), building)
    return picture


def compose(job: dict) -> Image.Image:
    top = at_scale(load(job["top"]["url"]), job["top"]["url"])
    if job["type"] in CLOSE_UP:
        return close_up(top, *CLOSE_UP[job["type"]])
    layers = []
    if job["shadow"]:
        layers.append((shadow_layer(job["shadow"]["url"]), job["shadow"]["x"] * SCALE, job["shadow"]["y"] * SCALE))
    layers.append((top, job["top"]["x"] * SCALE, job["top"]["y"] * SCALE))
    left = min(x for _, x, _ in layers)
    up = min(y for _, _, y in layers)
    right = max(x + image.width for image, x, _ in layers)
    down = max(y + image.height for image, _, y in layers)
    canvas = Image.new("RGBA", (right - left, down - up), (0, 0, 0, 0))
    for image, x, y in layers:
        canvas.alpha_composite(image, (x - left, y - up))
    solid = lambda image: image.getchannel("A").point(lambda a: 255 if a > ALPHA_FLOOR else 0).getbbox()
    box = solid(canvas)
    # Centred on the building alone, not building and shadow: the shadow reaches out to one side and would
    # push the building off the tile's middle (owner, 2 Nov 2026). The crop is widened to be even either side.
    own = solid(top)
    middle = layers[-1][1] - left + (own[0] + own[2]) / 2
    half = max(middle - box[0], box[2] - middle)
    box = (round(middle - half), box[1], round(middle + half), box[3])
    building = Image.new("RGBA", (box[2] - box[0], box[3] - box[1]), (0, 0, 0, 0))
    building.alpha_composite(canvas.crop((max(0, box[0]), box[1], min(canvas.width, box[2]), box[3])), (max(0, -box[0]), 0))
    fit = min(BOX_W / building.width, BOX_H / building.height)
    size = (max(1, round(building.width * fit)), max(1, round(building.height * fit)))
    building = building.resize(size, Image.LANCZOS)
    picture = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    picture.alpha_composite(building, ((WIDTH - size[0]) // 2, MIDDLE_Y - size[1] // 2))
    return picture


def main() -> None:
    sheet_path = sys.argv[sys.argv.index("--sheet") + 1] if "--sheet" in sys.argv else None
    found = subprocess.run(
        ["bun", "tools/build-pictures/jobs.ts"], cwd=WEB, capture_output=True, text=True, check=True, shell=sys.platform == "win32"
    )
    jobs = json.loads(found.stdout)
    OUT.mkdir(parents=True, exist_ok=True)
    table: dict[str, dict[int, str]] = {"main": {}, "inferno": {}}
    pictures = []
    for job in jobs:
        picture = compose(job)
        data = io.BytesIO()
        picture.save(data, "WEBP", quality=90, method=6, alpha_quality=100)
        digest = hashlib.sha1(data.getvalue()).hexdigest()[:8]
        name = f"{job['type']}.{job['kind']}.{digest}.webp"
        (OUT / name).write_bytes(data.getvalue())
        table[job["kind"]][job["type"]] = name
        pictures.append((job, picture))
        print(f"{job['kind']:8} {job['type']:4} {job['name']:28} {name}")
    keep = {name for files in table.values() for name in files.values()}
    for old in OUT.glob("*.webp"):
        if old.name not in keep:
            old.unlink()
    lines = [
        "// Made by web/tools/build-pictures/make.py from the game's own art; run it again rather than editing this.",
        "",
        "/**",
        " * The build menu's Modern pictures, by yard and type: each building's new look at level 1, with its",
        " * shadow, on a transparent ground (`buildButtonArt.ts`), in `/assets/buildingbuttons/modern/`.",
        " */",
        "export const MODERN_BUTTON_FILE: Readonly<Record<\"main\" | \"inferno\", Readonly<Record<number, string>>>> = {",
    ]
    for kind, files in table.items():
        lines.append(f"  {kind}: {{")
        for type_, name in sorted(files.items()):
            lines.append(f'    {type_}: "{name}",')
        lines.append("  },")
    lines.append("};")
    DATA.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    if sheet_path:
        columns = 8
        rows = (len(pictures) + columns - 1) // columns
        sheet = Image.new("RGBA", (columns * (WIDTH + 8), rows * (HEIGHT + 8)), (58, 64, 74, 255))
        for i, (_, picture) in enumerate(pictures):
            sheet.alpha_composite(picture, ((i % columns) * (WIDTH + 8) + 4, (i // columns) * (HEIGHT + 8) + 4))
        sheet.save(sheet_path)


if __name__ == "__main__":
    main()
