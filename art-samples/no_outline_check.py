"""no_outline_check.py : the 3D towers' game pictures before (git REV, with the outline) and now (the worktree), checked and
side by side (towers-no-outline, 30 Oct 2026).

    python -I art-samples/no_outline_check.py [REV]

For every 3D tower picture (top, body, turret, anim of each tier) it prints: the same pixel size or not; pixels the new
picture covers that the old did not (there should be none: the outline only ever added to the old); and how much of what
both cover changed. Writes art-samples/no-outline/compare-sheet.png (and a .jpg copy): one tower per row, tiers 1-3,
each the old (with the outline) beside the new, on the yard's grass, 2x the @2x pictures.
"""
import io
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
REV = sys.argv[1] if len(sys.argv) > 1 else "revamp"
ASSETS = "server/public/assets/buildings"
TOWERS = [("Cannon", "cannontower"), ("Sniper", "snipertower"), ("Laser", "lasertower"),
          ("Aerial Defense", "flaktower"), ("Railgun", "railguntower"), ("Tesla", "lightningtower"),
          ("Bunker", "bunker"), ("Blast Tower", "icannontower"), ("Sharpshooter", "isnipertower"),
          ("Magma Tower", "imagmatower"), ("Spurtz", "spurtztower"), ("Black Spurtz", "blackspurtztower")]
PARTS = ("top", "body", "turret", "anim")


def old_img(rel):
    data = subprocess.run(["git", "-C", str(ROOT), "show", f"{REV}:{rel}"], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(data)).convert("RGBA")


def check():
    bad = 0
    for _, folder in TOWERS:
        for t in (1, 2, 3):
            for part in PARTS:
                rel = f"{ASSETS}/{folder}/{part}.t{t}@2x.webp"
                if not (ROOT / rel).exists():
                    continue
                o, n = old_img(rel), Image.open(ROOT / rel).convert("RGBA")
                if o.size != n.size:
                    print(f"SIZE {rel}: {o.size} -> {n.size}")
                    bad += 1
                    continue
                a, b = np.asarray(o).astype(int), np.asarray(n).astype(int)
                grew = int(((b[..., 3] > a[..., 3] + 48)).sum())
                both = (a[..., 3] > 240) & (b[..., 3] > 240)
                d = np.abs(a[..., :3] - b[..., :3]).max(-1)
                lost = int(((a[..., 3] > 128) & (b[..., 3] < 8)).sum())
                print(f"{rel}: {n.size[0]}x{n.size[1]} new px outside old {grew}, old px gone {lost} "
                      f"({lost / max(1, int((a[..., 3] > 128).sum())) * 100:.1f}%), shared px changed >40: "
                      f"{(d[both] > 40).mean() * 100:.1f}%")
                bad += grew > 20
    print("problems:", bad)


def grass(w, h):
    tiles = [Image.open(p).convert("RGB") for p in sorted((ROOT / "server/public/assets/yardbg/grass").glob("*.png"))]
    tiles = [t for t in tiles if np.asarray(t).reshape(-1, 3).mean(0)[1] > np.asarray(t).reshape(-1, 3).mean(0)[0]]
    rng = np.random.default_rng(3)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, tiles[0].height):
        for x in range(0, w, tiles[0].width):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g.convert("RGBA")


def sheet():
    S, pad, lab, name_w = 2, 16, 34, 190
    font, small = ImageFont.truetype("arialbd.ttf", 26), ImageFont.truetype("arialbd.ttf", 20)
    rows = []
    for title, folder in TOWERS:
        pairs = []
        for t in (1, 2, 3):
            rel = f"{ASSETS}/{folder}/top.t{t}@2x.webp"
            if (ROOT / rel).exists():
                pairs.append((t, old_img(rel), Image.open(ROOT / rel).convert("RGBA")))
        if pairs:
            rows.append((title, pairs))
    cw = max(o.width for _, ps in rows for _, o, _ in ps) * S
    chs = [max(o.height for _, o, _ in ps) * S for _, ps in rows]      # each row as tall as its tallest tier
    W = name_w + 3 * (2 * cw + 3 * pad)
    H = lab + sum(ch + pad + lab for ch in chs)
    g = grass(W, H)
    d = ImageDraw.Draw(g)
    d.rectangle((0, 0, W, lab), fill=(20, 20, 20, 255))
    for i in range(3):
        x = name_w + i * (2 * cw + 3 * pad)
        d.text((x + pad, 4), f"Tier {i + 1}: old (outline) | new (none)", fill="white", font=font)
    for r, (title, pairs) in enumerate(rows):
        y, ch = lab + sum(c + pad + lab for c in chs[:r]), chs[r]
        d.rectangle((0, y, W, y + lab - 4), fill=(20, 20, 20, 200))
        d.text((8, y + 4), title, fill="white", font=font)
        for t, o, n in pairs:
            x = name_w + (t - 1) * (2 * cw + 3 * pad)
            for j, im in enumerate((o, n)):
                big = im.resize((im.width * S, im.height * S), Image.LANCZOS)
                g.alpha_composite(big, (x + pad + j * (cw + pad) + (cw - big.width) // 2, y + lab + ch - big.height))
                d.text((x + pad + j * (cw + pad) + 4, y + lab + 2), "old" if j == 0 else "new", fill="white", font=small,
                       stroke_width=2, stroke_fill="black")
    out = ROOT / "art-samples" / "no-outline"
    out.mkdir(exist_ok=True)
    g = g.convert("RGB")
    g.save(out / "compare-sheet.png", optimize=True)
    g.save(out / "compare-sheet.jpg", quality=85)        # the copy kept in git (the png is ~21 MB)
    print("sheet", g.size)


check()
sheet()
