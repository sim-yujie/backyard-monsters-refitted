"""owner_before_after.py : the owner's before/after picture of the 3D towers' dark outline (towers-no-outline,
30 Oct 2026).

    python -I art-samples/owner_before_after.py [REV]

For each of the 12 3D towers, its top tier (tier 3; Spurtz and Black Spurtz have one) as it was at git REV (with the
outline) beside the worktree's (no outline), on the yard's grass, the @2x pictures drawn at 3x, two towers to a row
(paired by height, so no row is mostly grass).
Writes art-samples/no-outline/owner-before-after.png and a .jpg copy (the one kept in git).
"""
import io
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REV = sys.argv[1] if len(sys.argv) > 1 else "revamp"
ASSETS = ROOT / "server/public/assets/buildings"
TOWERS = [("Cannon", "cannontower", 3), ("Sniper", "snipertower", 3), ("Laser", "lasertower", 3),
          ("Aerial Defense", "flaktower", 3), ("Railgun", "railguntower", 3), ("Tesla", "lightningtower", 3),
          ("Bunker", "bunker", 3), ("Blast Tower", "icannontower", 3), ("Sharpshooter", "isnipertower", 3),
          ("Magma Tower", "imagmatower", 3), ("Spurtz", "spurtztower", 1), ("Black Spurtz", "blackspurtztower", 1)]
S, PER_ROW, GAP, PAD, LAB = 3, 2, 24, 28, 56


def old_img(rel):
    data = subprocess.run(["git", "-C", str(ROOT), "show", f"{REV}:{rel}"], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(data)).convert("RGBA")


def grass(w, h):
    """The yard's plain grass tile, laid as the yard lays it (diamonds, every other row half a tile across)."""
    tile = Image.open(ROOT / "server/public/assets/yardbg/grass/2174_isograss1_isograss1.png").convert("RGBA")
    g = Image.new("RGBA", (w, h), (83, 126, 19, 255))
    tw, th = tile.size
    for r, y in enumerate(range(-th, h + th, th // 2)):
        for x in range(-tw + (tw // 2) * (r % 2), w + tw, tw):
            g.paste(tile, (x, y), tile)
    return g


def main():
    font, small = ImageFont.truetype("arialbd.ttf", 34), ImageFont.truetype("arialbd.ttf", 26)
    pairs = []
    for title, folder, t in TOWERS:
        rel = f"server/public/assets/buildings/{folder}/top.t{t}@2x.webp"
        o, n = old_img(rel), Image.open(ASSETS / folder / f"top.t{t}@2x.webp").convert("RGBA")
        assert o.size == n.size, rel
        box = o.getbbox()                                   # the old covers the new (the outline only added)
        big = [im.crop(box).resize(((box[2] - box[0]) * S, (box[3] - box[1]) * S), Image.LANCZOS) for im in (o, n)]
        pairs.append((title, big))
    pairs.sort(key=lambda p: p[1][0].height)
    cw = max(b[0].width for _, b in pairs) * 2 + GAP + 2 * PAD
    rows = [pairs[i:i + PER_ROW] for i in range(0, len(pairs), PER_ROW)]
    rh = [max(b[0].height for _, b in r) + LAB + 44 + PAD for r in rows]
    W, H = cw * PER_ROW, 70 + sum(rh)
    g = grass(W, H)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, W, 70), fill=(20, 20, 20, 255))
    d.text((PAD, 16), "3D towers, top tier: left with the dark outline (now), right without (beta 5)", fill="white",
           font=font)
    y = 70
    for r, row in zip(rh, rows):
        for k, (title, (o, n)) in enumerate(row):
            x = k * cw
            d.rectangle((x, y, x + cw - 1, y + LAB - 8), fill=(20, 20, 20, 210))
            d.text((x + PAD, y + 8), title, fill="white", font=font)
            base = y + r - PAD                                # both stand on the same line
            half = (cw - 2 * PAD - GAP) // 2
            for j, (im, lab) in enumerate(((o, "outline"), (n, "no outline"))):
                ox = x + PAD + j * (half + GAP) + (half - im.width) // 2
                g.alpha_composite(im, (ox, base - im.height))
                d.text((x + PAD + j * (half + GAP) + 4, y + LAB + 2), lab, fill="white", font=small, stroke_width=3,
                       stroke_fill="black")
        y += r
    out = ROOT / "art-samples" / "no-outline"
    out.mkdir(exist_ok=True)
    g = g.convert("RGB")
    g.save(out / "owner-before-after.png", optimize=True)
    g.save(out / "owner-before-after.jpg", quality=85)
    print("owner-before-after", g.size)


main()
