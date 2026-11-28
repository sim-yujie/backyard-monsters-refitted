"""Cuts one krampus-fx entrant's sheets into the game's 192 px atlas, the same way for every entrant
(after mm-anim's bake/build_set.py, so both bake-offs cut alike).

python3 -I art-samples/frost-tribe/fxbake/build_set.py <worktree> <model> [round] [name] [abilities] [motion file]
  e.g.  build_set.py <wt> neon round-1 krampus-neon iceShards,blizzardStomp motion-hold.json
        build_set.py <wt> astra round-2 aura-astra frostAura

Reads fxbake/<model>/<round>/ (round from fxbake/<model>/use.txt if not given): sheets.json (the entrant's cells.json in one
form: {"sheets": [{"file", "look": modern|classic|both, "kind": solid|light, "columns", "rows", "cells"}]}) and
motion.json, and writes:
- server/public/assets/fx/frostbake/<name>.modern.webp and <name>.classic.webp: every cell the kept abilities use,
  6 across, the same order in both looks; a cell only one look has is copied into the other;
- web/src/game/attack/frostBake/<name>.json: { name, model, round, cells, columns, bounds, plan } for frostBakeFx.ts.
`abilities` (comma list, default all) keeps only those abilities of the plan, and only their cells in the atlas.
`motion file` (default motion.json) names the plan in the round folder; keys starting with "_" (notes) are dropped.

A sheet whose pieces cross its grid lines (neon round 2's Modern sheet) is cut by pieces instead: give it
"cut": "pieces" in sheets.json; each connected piece (big ones only) is named in reading order, its row the grid row
its middle falls in, then left to right. The art itself is never changed.

Solid sheets: magenta keyed off (artlib.key + clean). Light sheets: black is see-through, brightness is alpha,
drawn white (the game tints). Every single piece is cropped to what it holds and fitted to 176 px, centred.
Flipbook frames (every `flipbook` list in motion.json) keep their place in their cell and share one scale.
"""
import json
import os
import sys

from PIL import Image

sys.path.insert(0, "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from artlib import cells as grid_cells, clean, key  # noqa: E402

WT, MODEL = sys.argv[1], sys.argv[2]
BASE = os.path.join(WT, "art-samples", "frost-tribe", "fxbake", MODEL)
ROUND = sys.argv[3] if len(sys.argv) > 3 else open(os.path.join(BASE, "use.txt")).read().strip()
SET = sys.argv[4] if len(sys.argv) > 4 else MODEL
KEEP = sys.argv[5].split(",") if len(sys.argv) > 5 and sys.argv[5] else None
MOTION = sys.argv[6] if len(sys.argv) > 6 else "motion.json"
SRC = os.path.join(BASE, ROUND)
CELL, FIT, COLS = 192, 176, 6


def light(c):
    grey = c.convert("L")
    alpha = grey.point(lambda v: 0 if v < 12 else min(255, int((v - 12) * 1.06)))
    white = Image.new("RGBA", c.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    return white


def pieces_of(im, columns, rows, count):
    """The `count` biggest connected pieces of a keyed sheet, in reading order (grid row of the middle, then x),
    each on its own canvas the sheet's size (so fit_one crops it)."""
    step = 2
    small = im.getchannel("A").resize((im.width // step, im.height // step))
    w, h = small.size
    a = small.load()
    seen = [[False] * w for _ in range(h)]
    found = []
    for y0 in range(h):
        for x0 in range(w):
            if seen[y0][x0] or a[x0, y0] < 40:
                continue
            stack, box, n = [(x0, y0)], [x0, y0, x0, y0], 0
            seen[y0][x0] = True
            while stack:
                x, y = stack.pop()
                n += 1
                box = [min(box[0], x), min(box[1], y), max(box[2], x), max(box[3], y)]
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and a[nx, ny] >= 40:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            found.append((n, [v * step for v in box]))
    big = sorted(found, key=lambda f: -f[0])[:count]
    # small specks near a big piece (snow crumbs) go with it
    out = []
    for n, (x0, y0, x1, y1) in big:
        pad = 12
        box = (max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + step + pad), min(im.height, y1 + step + pad))
        piece = Image.new("RGBA", im.size)
        piece.paste(im.crop(box), box[:2])
        out.append(((y0 + y1) / 2, (x0 + x1) / 2, piece))
    cell_h = im.height / rows
    out.sort(key=lambda o: (int(o[0] // cell_h), o[1]))
    return [o[2] for o in out]


def fit_one(piece):
    box = piece.getbbox()
    out = Image.new("RGBA", (CELL, CELL))
    if not box:
        return out
    piece = piece.crop(box)
    z = min(FIT / piece.width, FIT / piece.height)
    piece = piece.resize((max(1, round(piece.width * z)), max(1, round(piece.height * z))), Image.LANCZOS)
    out.alpha_composite(piece, ((CELL - piece.width) // 2, (CELL - piece.height) // 2))
    return out


def fit_frames(frames):
    """A flipbook: one scale for all, each keeps its place about its cell's centre."""
    boxes = [f.getbbox() for f in frames]
    w, h = frames[0].size
    reach_x = max((max(w / 2 - b[0], b[2] - w / 2) for b in boxes if b), default=1)
    reach_y = max((max(h / 2 - b[1], b[3] - h / 2) for b in boxes if b), default=1)
    z = min(FIT / 2 / reach_x, FIT / 2 / reach_y)
    out = []
    for f in frames:
        g = f.resize((max(1, round(w * z)), max(1, round(h * z))), Image.LANCZOS)
        left, top = (g.width - CELL) // 2, (g.height - CELL) // 2
        out.append(g.crop((left, top, left + CELL, top + CELL)))
    return out


def flipbooks_of(node, found):
    if isinstance(node, dict):
        if isinstance(node.get("flipbook"), list):
            book = tuple(node["flipbook"])
            if book not in found:
                found.append(book)
        for v in node.values():
            flipbooks_of(v, found)
    elif isinstance(node, list):
        for v in node:
            flipbooks_of(v, found)
    return found


spec = json.load(open(os.path.join(SRC, "sheets.json")))
plan = json.load(open(os.path.join(SRC, MOTION)))
plan = {k: v for k, v in plan.items() if not k.startswith("_") and (KEEP is None or k in KEEP)}
flipbooks = flipbooks_of(plan, [])
raw = {"modern": {}, "classic": {}}
for sheet in spec["sheets"]:
    im = Image.open(os.path.join(SRC, sheet["file"]))
    if sheet["kind"] == "solid":
        im = key(im.convert("RGBA"))
    if sheet.get("cut") == "pieces":
        pieces = pieces_of(im.convert("RGBA"), sheet["columns"], sheet["rows"], len([c for c in sheet["cells"] if c]))
    else:
        pieces = grid_cells(im.convert("RGBA") if sheet["kind"] == "solid" else im.convert("RGB"), sheet["columns"], sheet["rows"])
    looks = ["modern", "classic"] if sheet["look"] == "both" else [sheet["look"]]
    for name, piece in zip(sheet["cells"], pieces):
        if not name:
            continue
        piece = clean(piece) if sheet["kind"] == "solid" else light(piece)
        for look in looks:
            raw[look][name] = piece

used = set()


def _used(node):
    if isinstance(node, dict):
        if isinstance(node.get("cell"), str):
            used.add(node["cell"])
        for v in node.values():
            _used(v)
    elif isinstance(node, list):
        for v in node:
            _used(v)


_used(plan)
used |= {f for book in flipbooks for f in book}
names = sorted((set(raw["modern"]) | set(raw["classic"])) & used)
fitted = {"modern": {}, "classic": {}}
for look in ("modern", "classic"):
    have = raw[look]
    for name in names:
        if name not in have:
            have[name] = raw["classic" if look == "modern" else "modern"][name]
    done = set()
    for frames in flipbooks:
        frames = [f for f in frames if f in have and f not in done]
        if not frames:
            continue
        for f, img in zip(frames, fit_frames([have[f] for f in frames])):
            fitted[look][f] = img
            done.add(f)
    for name in names:
        if name not in done:
            fitted[look][name] = fit_one(have[name])

out_dir = os.path.join(WT, "server/public/assets/fx/frostbake")
os.makedirs(out_dir, exist_ok=True)
for look in ("modern", "classic"):
    rows = (len(names) + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * CELL, rows * CELL))
    for i, name in enumerate(names):
        atlas.alpha_composite(fitted[look][name], ((i % COLS) * CELL, (i // COLS) * CELL))
    path = os.path.join(out_dir, f"{SET}.{look}.webp")
    atlas.save(path, "WEBP", quality=90, method=6, exact=True)
    print(path, atlas.size, os.path.getsize(path))

bounds = {}
for name in names:
    box = fitted["modern"][name].getbbox() or (0, 0, CELL, CELL)
    bounds[name] = [round((box[2] - box[0]) / CELL, 4), round((box[3] - box[1]) / CELL, 4)]
for frames in flipbooks:
    frames = [f for f in frames if f in bounds]
    if frames:
        union = [max(bounds[f][0] for f in frames), max(bounds[f][1] for f in frames)]
        for f in frames:
            bounds[f] = union
if used - set(names):
    print("CELLS THE PLAN NAMES BUT NO SHEET HOLDS:", sorted(used - set(names)))
web = os.path.join(WT, "web/src/game/attack/frostBake", f"{SET}.json")
json.dump({"name": SET, "model": MODEL, "round": ROUND, "cells": names, "columns": COLS, "bounds": bounds, "plan": plan},
          open(web, "w"), indent=1)
print(web, len(names), "cells")
