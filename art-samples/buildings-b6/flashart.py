"""flashart.py : the Flash original of a yard building, put together as the game draws it (shadow multiplied under the
top, the animation strip's cell on top), from web/src/game/yard/buildingArtData.ts in the main checkout (read only).

    python flashart.py <typeId> [scale]      -> flash/<id>-L<level>.png per art level, plus flash/<id>-anim-L<level>.gif
"""
import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageChops

MAIN = Path("D:/Coding/BYMR/backyard-monsters-refitted")
ASSETS = MAIN / "server/public/assets"
DATA = MAIN / "web/src/game/yard/buildingArtData.ts"
HERE = Path(__file__).resolve().parent


def rows():
    out, cur = {}, None
    for line in DATA.read_text(encoding="utf8").splitlines():
        m = re.match(r'  \[(\d+), "([^"]+)", "([^"]+)", \[$', line)
        if m:
            cur = dict(id=int(m[1]), name=m[2], folder=m[3], levels=[])
            out[cur["id"]] = cur
        elif cur and line.startswith("    [") and line.rstrip().endswith("],"):
            cur["levels"].append(json.loads(line.strip()[:-1]))
    return out


def compose(row, lv, frame=0, pad=12):
    """The level's picture as RGBA, and its origin's pixel."""
    folder = ASSETS / row["folder"]
    top, shadow = lv[1], lv[4]
    anims = lv[7] if len(lv) > 7 else []
    parts = []
    if shadow:
        parts.append(("shadow", Image.open(folder / shadow[0]).convert("RGB"), shadow[1], shadow[2]))
    if top:
        im = Image.open(folder / top[0]).convert("RGBA")
        if len(top) > 3:
            im = im.crop((0, 0, top[3], top[4]))
        parts.append(("top", im, top[1], top[2]))
    for a in anims or []:
        f, x, y, w, h, n = a
        strip = Image.open(folder / f).convert("RGBA")
        k = frame % n
        parts.append(("anim", strip.crop((k * w, 0, (k + 1) * w, h)), x, y))
    parts = [(k, im, int(round(x)), int(round(y))) for k, im, x, y in parts]   # Inferno rows have sub-pixel spots
    x0 = min(p[2] for p in parts) - pad
    y0 = min(p[3] for p in parts) - pad
    x1 = max(p[2] + p[1].width for p in parts) + pad
    y1 = max(p[3] + p[1].height for p in parts) + pad
    canvas = Image.new("RGBA", (x1 - x0, y1 - y0), (0, 0, 0, 0))
    for kind, im, x, y in parts:
        if kind == "shadow":   # multiply on nothing: keep only the dark, as alpha
            g = im.convert("L")
            a = ImageChops.invert(g)
            sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
            sh.putalpha(a.point(lambda v: int(v * 0.55)))
            canvas.alpha_composite(sh, (x - x0, y - y0))
        else:
            canvas.alpha_composite(im, (x - x0, y - y0))
    return canvas, (-x0, -y0)


def frames_of(lv):
    anims = lv[7] if len(lv) > 7 else []
    return max([a[5] for a in anims] or [1])


if __name__ == "__main__":
    tid = int(sys.argv[1])
    scale = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    row = rows()[tid]
    out = HERE / "flash"
    out.mkdir(exist_ok=True)
    for lv in row["levels"]:
        im, _ = compose(row, lv)
        im.resize((im.width * scale, im.height * scale), Image.NEAREST).save(out / f"{tid}-L{lv[0]}.png")
        n = frames_of(lv)
        if n > 1:
            fr = []
            for k in range(n):
                f, _ = compose(row, lv, k)
                f = f.resize((f.width * scale, f.height * scale), Image.NEAREST)
                bg = Image.new("RGBA", f.size, (236, 230, 214, 255))
                bg.alpha_composite(f)
                fr.append(bg.convert("RGB"))
            fr[0].save(out / f"{tid}-anim-L{lv[0]}.gif", save_all=True, append_images=fr[1:], duration=1000 // 24, loop=0)
        print(row["name"], lv[0], im.size, "frames", n)
