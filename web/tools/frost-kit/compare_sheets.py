"""Owner comparison sheets for the frost tribe (production round).

    cd web && bun tools/frost-kit/dump-layouts.ts > /tmp/layouts.json && cd ..
    python web/tools/frost-kit/compare_sheets.py /tmp/layouts.json

Writes art-samples/frost-tribe/sheets-prod/:
  frost-cards.png          each frost monster's card beside the real one (Modern 360x240, Classic 180x120 at 2x)
  frost-battle.png         battle size: real vs frost, Modern and Classic, at 1x (as on screen) and 3x, on grass and snow
  krampus-vs-champions.png Krampus L1/L3/L6 beside Gorgo, Drull and Korath: portraits (176 px) and battle frames (2x)
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "art-samples" / "frost-tribe" / "sheets-prod"
MON = REPO / "server" / "public" / "assets" / "monsters"
POR = REPO / "web" / "public" / "portraits"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
FONTB = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG, INK, DIM = (34, 38, 46), (235, 238, 242), (160, 170, 182)
GRASS, SNOW = (92, 140, 62), (226, 233, 240)
NAMES = {"C1": "Pokey", "C5": "Eye-ra", "C6": "Ichi", "C8": "Fang", "C9": "Brain", "C10": "Crabatron", "C14": "Teratorn",
         "C16": "Vorg"}
IDS = ["C1", "C6", "C5", "C14", "C8", "C9", "C10", "C16"]


def font(size, bold=False):
    return ImageFont.truetype(FONTB if bold else FONT, size)


def title(w, text, sub):
    im = Image.new("RGB", (w, 92), BG)
    d = ImageDraw.Draw(im)
    d.text((20, 14), text, font=font(34, True), fill=INK)
    d.text((20, 58), sub, font=font(18), fill=DIM)
    return im


def stack(parts, w):
    h = sum(p.height for p in parts)
    out = Image.new("RGB", (w, h), BG)
    y = 0
    for p in parts:
        out.paste(p, (0, y))
        y += p.height
    return out


def cards():
    blocks = []
    for pair in range(0, 8, 2):
        row = Image.new("RGB", (1700, 330), BG)
        d = ImageDraw.Draw(row)
        for k, mid in enumerate(IDS[pair:pair + 2]):
            x0 = k * 850
            d.text((x0 + 20, 6), NAMES[mid], font=font(24, True), fill=INK)
            real = Image.open(POR / f"{mid}.webp").convert("RGB")
            frost = Image.open(POR / "frost" / f"{mid}.webp").convert("RGB")
            row.paste(real, (x0 + 20, 40))
            row.paste(frost, (x0 + 390, 40))
            d.text((x0 + 20, 284), "real · Modern", font=font(16), fill=DIM)
            d.text((x0 + 390, 284), "frost · Modern", font=font(16), fill=(140, 220, 255))
            rc = Image.open(MON / f"{mid}-portrait.jpg").convert("RGB")
            fc = Image.open(MON / "frost" / f"{mid}-portrait.jpg").convert("RGB")
            row.paste(rc.resize((90, 60)), (x0 + 760, 40))
            row.paste(fc.resize((90, 60)), (x0 + 760, 110))
            d.text((x0 + 760, 176), "Classic\n180x120\n(half)", font=font(13), fill=DIM)
        blocks.append(row)
    return stack([title(1700, "Frost tribe: cards", "Each frost monster beside the real card (Modern 360x240 at 1x; Classic portraits at half size)")] + blocks, 1700)


def cell(lay, look, frost):
    one = lay[look]
    r = one["rect"]
    if look == "modern" and lay["repaint"]:
        name = lay["repaint"].split("/")[-1]
        scale = float(name.split("@")[1].split("x")[0]) if "@" in name else 1.0
    else:
        name, scale = lay["file"].split("/")[-1], 1.0
    path = (MON / "frost" / name) if frost else (MON / name)
    im = Image.open(path).convert("RGBA")
    box = tuple(round(v * scale) for v in (r["x"], r["y"], r["x"] + r["width"], r["y"] + r["height"]))
    return im.crop(box), scale, (r["width"], r["height"])


def on(bg, im):
    base = Image.new("RGBA", im.size, bg + (255,))
    base.alpha_composite(im)
    return base.convert("RGB")


def battle(lay):
    rows = []
    for mid in IDS:
        row = Image.new("RGB", (1700, 170), BG)
        d = ImageDraw.Draw(row)
        d.text((16, 8), NAMES[mid], font=font(20, True), fill=INK)
        x = 150
        for look in ("modern", "classic"):
            for frost in (False, True):
                c, scale, (w, h) = cell(lay[mid], look, frost)
                one = c.resize((w, h), Image.LANCZOS)
                big = c.resize((w * 3, h * 3), Image.LANCZOS if scale > 1 else Image.NEAREST)
                for bg in (GRASS, SNOW):
                    row.paste(on(bg, one), (x, 20))
                    x += w + 6
                row.paste(on(GRASS, big), (x, 8))
                d.text((x, 150), f"{look} {'frost' if frost else 'real'}", font=font(12), fill=(140, 220, 255) if frost else DIM)
                x += w * 3 + 24
        rows.append(row.crop((0, 0, min(1700, x + 10), 170)))
    w = max(r.width for r in rows)
    return stack([title(w, "Frost tribe: battle size", "Front-left heading, first walk frame. 1x (as on screen) on grass and on snow, then 3x. Modern real, Modern frost, Classic real, Classic frost.")] +
                 [r.resize((w, r.height)) if r.width != w else r for r in rows], w)


def champions(lay):
    names = [("G1", "Gorgo"), ("G2", "Drull"), ("G4", "Korath"), ("G6", "Krampus")]
    rows = []
    for gid, name in names:
        row = Image.new("RGB", (1700, 300), BG)
        d = ImageDraw.Draw(row)
        d.text((16, 8), name, font=font(24, True), fill=(140, 220, 255) if gid == "G6" else INK)
        x = 150
        for level in (1, 3, 6):
            p = Image.open(POR / f"{gid}-L{level}.webp").convert("RGBA")
            row.paste(on((70, 74, 84), p), (x, 40))
            d.text((x, 220), f"L{level} portrait", font=font(13), fill=DIM)
            x += 186
        x += 20
        for level in (1, 3, 6):
            c, scale, (w, h) = cell(lay[f"{gid}_{level}"], "modern", False)
            two = c.resize((w * 2, h * 2), Image.LANCZOS)
            if two.height > 250:
                two = two.resize((two.width * 250 // two.height, 250), Image.LANCZOS)
            row.paste(on(GRASS, two), (x, 40))
            d.text((x, 40 + two.height + 4), f"L{level} battle 2x", font=font(13), fill=DIM)
            x += two.width + 14
        rows.append(row)
    return stack([title(1700, "Krampus beside the real champions", "Modern portraits at 176 px, then battle frames at 2x (front-left, walk frame 1), levels 1, 3 and 6")] + rows, 1700)


def main():
    lay = json.loads(Path(sys.argv[1]).read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    cards().save(OUT / "frost-cards.png")
    battle(lay).save(OUT / "frost-battle.png")
    champions(lay).save(OUT / "krampus-vs-champions.png")
    print("written", *(p.name for p in sorted(OUT.iterdir())))


if __name__ == "__main__":
    main()
