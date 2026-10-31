"""before_after.py : the Sniper and Cannon as the game ships them, before (revamp) and after the owner's proportion change
(31 Oct 2026: Sniper STRETCH 1.20, PLATE_STRETCH 1.20, DISC_STRETCH 1.00, FRONT_FOOT_D 1.18; Cannon TURRET_SCALE 1.35).

  python -I art-samples/tower-tune/before_after.py [BEFORE_REV]      (default origin/revamp)

Reads the production pieces (server/public/assets/buildings/<folder>/) and their rows in buildingArtTiers.ts, before from
git and after from this worktree, and writes next to this file, per tower:
  <tower>-before-after.png   tiers 1-3, before above and after below: the still (top) at 3x, then turned to headings 0, 8,
                             16 and 24 (body + turret cell as the game lays them) at 3x, then everything at game size
  <tower>-stills.png         the stills only, before | after for each tier side by side, at 3x, game size underneath
"""
import io
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
REV = sys.argv[1] if len(sys.argv) > 1 else "origin/revamp"
TIERS_TS = "web/src/game/yard/buildingArtTiers.ts"
TOWERS = {"sniper": (21, "snipertower"), "cannon": (20, "cannontower")}
GREEN = (92, 136, 60, 255)
HEADS = (0, 8, 16, 24)


def blob(path, rev):
    if rev is None:
        return (ROOT / path).read_bytes()
    return subprocess.run(["git", "-C", str(ROOT), "show", f"{rev}:{path}"], capture_output=True, check=True).stdout


def rows(rev, type_):
    """Each tier's top, body and strip entries ([x, y] in game px from the origin; strip: x, y, w, h, cells)."""
    ts = blob(TIERS_TS, rev).decode()
    part = ts[ts.find(f"\n  {type_}: ["):]
    part = part[:part.find("\n  ],")]
    out = []
    for t in (1, 2, 3):
        num = r"(-?[\d.]+)"
        top = re.search(rf'top: \["top\.t{t}@2x\.webp", {num}, {num}\]', part)
        body = re.search(rf'body: \["body\.t{t}@2x\.webp", {num}, {num}\]', part)
        strip = re.search(rf'strip: \["turret\.t{t}@2x\.webp", ' + ", ".join([num] * 5) + r"\]", part)
        out.append(dict(top=[float(v) for v in top.groups()], body=[float(v) for v in body.groups()],
                        strip=[float(v) for v in strip.groups()]))
    return out


def pieces(rev, tower):
    type_, folder = TOWERS[tower]
    got = []
    for t, row in zip((1, 2, 3), rows(rev, type_)):
        im = {n: Image.open(io.BytesIO(blob(f"server/public/assets/buildings/{folder}/{n}.t{t}@2x.webp", rev))).convert("RGBA")
              for n in ("top", "body", "turret")}
        got.append((row, im))
    return got


def frame(row, im, k, box):
    """The tower at 2x on the canvas box (game px x0, y0, x1, y1): the still (k None) or body + turret cell k."""
    x0, y0, x1, y1 = box
    f = Image.new("RGBA", (2 * (x1 - x0), 2 * (y1 - y0)), GREEN)
    if k is None:
        f.alpha_composite(im["top"], (round(2 * (row["top"][0] - x0)), round(2 * (row["top"][1] - y0))))
        return f
    sx, sy, w, h, _ = row["strip"]
    cell = im["turret"].crop((round(2 * w * k), 0, round(2 * w * (k + 1)), round(2 * h)))
    f.alpha_composite(im["body"], (round(2 * (row["body"][0] - x0)), round(2 * (row["body"][1] - y0))))
    f.alpha_composite(cell, (round(2 * (sx - x0)), round(2 * (sy - y0))))
    return f


def sheet(tower):
    sets = [("before", pieces(REV, tower)), ("after", pieces(None, tower))]
    # one canvas for every tier, heading, before and after: what any of them covers, in game px, plus a margin
    boxes = []
    for _, ps in sets:
        for row, im in ps:
            boxes.append((row["top"][0], row["top"][1], row["top"][0] + im["top"].width / 2, row["top"][1] + im["top"].height / 2))
            boxes.append((row["body"][0], row["body"][1], row["body"][0] + im["body"].width / 2, row["body"][1] + im["body"].height / 2))
            s = row["strip"]
            boxes.append((s[0], s[1], s[0] + s[2], s[1] + s[3]))
    box = (int(min(b[0] for b in boxes)) - 4, int(min(b[1] for b in boxes)) - 4,
           int(max(b[2] for b in boxes)) + 5, int(max(b[3] for b in boxes)) + 5)
    gw, gh = box[2] - box[0], box[3] - box[1]
    big = [(3 * gw, 3 * gh)]
    cols = 3 * (1 + len(HEADS))
    pad, label = 6, 22
    W = cols * (3 * gw + pad) + pad
    H = 2 * (label + 3 * gh + pad + gh + pad) + 2 * pad
    out = Image.new("RGBA", (W, H), (40, 40, 40, 255))
    d = ImageDraw.Draw(out)
    y = pad
    for name, ps in sets:
        d.text((pad, y + 4), f"{tower} {name}: tiers 1, 2, 3 - still, then headings {', '.join(map(str, HEADS))} (3x; game size below)",
               fill=(255, 255, 255, 255))
        y += label
        x = pad
        for t, (row, im) in enumerate(ps):
            for k in (None, *HEADS):
                f = frame(row, im, k, box)
                out.alpha_composite(f.resize(big[0], Image.LANCZOS), (x, y))
                out.alpha_composite(f.resize((gw, gh), Image.LANCZOS), (x, y + 3 * gh + pad))
                x += 3 * gw + pad
        y += 3 * gh + pad + gh + pad + pad
    out.convert("RGB").save(HERE / f"{tower}-before-after.png", optimize=True)
    print(HERE / f"{tower}-before-after.png", out.size)
    # the stills alone, larger on the page: before | after per tier
    st = Image.new("RGBA", (6 * (3 * gw + pad) + 2 * pad + pad, label + 3 * gh + pad + gh + 2 * pad), (40, 40, 40, 255))
    d = ImageDraw.Draw(st)
    x = pad
    for t in range(3):
        for name, ps in sets:
            row, im = ps[t]
            f = frame(row, im, None, box)
            d.text((x + 4, pad), f"tier {t + 1} {name}", fill=(255, 255, 255, 255))
            st.alpha_composite(f.resize(big[0], Image.LANCZOS), (x, label))
            st.alpha_composite(f.resize((gw, gh), Image.LANCZOS), (x, label + 3 * gh + pad))
            x += 3 * gw + pad
        x += pad
    st.convert("RGB").save(HERE / f"{tower}-stills.png", optimize=True)
    print(HERE / f"{tower}-stills.png", st.size)


for name in TOWERS:
    sheet(name)
