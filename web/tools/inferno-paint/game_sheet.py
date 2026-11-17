"""game_sheet.py <outdir> [scale] : Flash beside Modern from the SHIPPED files and the art rows in buildingArtTiers.ts.

For each building one sheet <name>@<s>x.png: a row per look, columns whole / damaged / destroyed, each cell Flash left
and Modern right on the yard's ground (lava for the Inferno buildings, grass for the Cavern) with the shadow each look
draws, origins on the same spot. Also prints each top picture's brightness / saturation.
"""
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from common import REPO, B, canvas, flash_shadow, flash_top, folder, ground, multiply  # noqa: E402

out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
S = int(sys.argv[2]) if len(sys.argv) > 2 else 2
TS = (REPO / "web/src/game/yard/buildingArtTiers.ts").read_text()
IMG = r'(null|\["([^"]+)", (-?\d+), (-?\d+)\])'


def rows(block):
    """[(from, {state: (top, shadow)})] from a TierArt list's source."""
    res = []
    for m in re.finditer(r"\{ from: (\d+), top: " + IMG + r", shadow: " + IMG + r"(.*?)\} \},|\{ from: (\d+), top: " + IMG
                         + r", shadow: " + IMG + r", lift: 0 \}", block, re.S):
        if m.group(1):
            lv, rest = int(m.group(1)), m.group(10)
            st = {"": (img(m, 2), img(m, 6))}
            for s in ("damaged", "destroyed"):
                mm = re.search(s + r": \{ top: " + IMG + r", shadow: " + IMG, rest)
                st[s] = (img(mm, 1), img(mm, 5))
        else:
            lv = int(m.group(11))
            st = {"": (img(m, 12), img(m, 16))}
        res.append((lv, st))
    return res


def img(m, i):
    return None if m.group(i) == "null" else (m.group(i + 1), int(m.group(i + 2)), int(m.group(i + 3)))


def block_of(start, end_pat):
    i = TS.index(start)
    return TS[i:TS.index(end_pat, i + len(start))]


painted = block_of("export const INFERNO_PAINTED_BUILDING_ART", "\n};")
MODERN = {"a": rows(painted[painted.index("  26: ["):painted.index("  128: [")]),
          "b": rows(painted[painted.index("  128: ["):]),
          "c": rows(block_of("export const CAVERN_ART", "\n];"))}


def scene(b, top, shadow):
    CW, CH, OX, OY = canvas(b)
    bg = ground(B[b]["ground"], CW * S, CH * S)
    if shadow:
        f, x, y = shadow
        im = Image.open(folder(b) / f)
        bg = multiply(bg, im.resize((im.width * S, im.height * S), Image.LANCZOS), (OX + x) * S, (OY + y) * S)
    bg = bg.convert("RGBA")
    f, x, y = top
    im = Image.open(folder(b) / f).convert("RGBA")
    k = S / 2 if "@2x" in f else S
    im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
    bg.alpha_composite(im, ((OX + x) * S, (OY + y) * S))
    return bg.convert("RGB"), ((OX + x) * S, (OY + y) * S, (OX + x) * S + im.width, (OY + y) * S + im.height)


def stats(f):
    a = np.asarray(Image.open(f).convert("RGBA")).astype(float) / 255
    rgb = a[..., :3][a[..., 3] > 0.9]
    mx, mn = rgb.max(1), rgb.min(1)
    return f"bright {(rgb @ [0.299, 0.587, 0.114]).mean() * 100:.0f}% sat {np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0).mean() * 100:.0f}%"


for b in "abc":
    states = ["", "damaged", "destroyed"] if b != "c" else [""]
    cells = []
    for lv, st in MODERN[b]:
        line = []
        for s in states:
            look = f"{b}{lv}{'d' if s == 'damaged' else 'x' if s == 'destroyed' else ''}"
            fl, fbox = scene(b, flash_top(look), flash_shadow(look))
            mt, msh = st[s]
            mo, mbox = scene(b, mt, msh)
            box = (max(0, min(fbox[0], mbox[0]) - 10 * S), max(0, min(fbox[1], mbox[1]) - 10 * S),
                   max(fbox[2], mbox[2]) + 10 * S, max(fbox[3], mbox[3]) + 12 * S)
            c = Image.new("RGB", ((box[2] - box[0]) * 2 + 12, box[3] - box[1] + 26), (24, 24, 24))
            c.paste(fl.crop(box), (0, 26)); c.paste(mo.crop(box), (box[2] - box[0] + 12, 26))
            d = ImageDraw.Draw(c)
            name = f"{B[b]['name']} look {lv} {s or 'whole'}"
            d.text((4, 6), f"{name}: Flash", fill=(235, 235, 235))
            d.text((box[2] - box[0] + 16, 6), f"Modern", fill=(235, 235, 235))
            line.append(c)
            print(f"{B[b]['name']:15s} {lv} {s or 'whole':9s} flash {stats(folder(b) / flash_top(look)[0])}  modern {stats(folder(b) / mt[0])}")
        cells.extend([[c] for c in line] if b == "b" else [line])   # the wide Bunker: one state a row
    W = max(sum(c.width for c in line) + 20 * (len(line) - 1) for line in cells)
    H = sum(max(c.height for c in line) for line in cells) + 20 * (len(cells) - 1)
    sheet = Image.new("RGB", (W, H), (24, 24, 24))
    y = 0
    for line in cells:
        x = 0
        for c in line:
            sheet.paste(c, (x, y)); x += c.width + 20
        y += max(c.height for c in line) + 20
    p = out / f"{B[b]['folder']}-flash-vs-modern@{S}x.png"
    sheet.save(p)
    print(p, sheet.size)
