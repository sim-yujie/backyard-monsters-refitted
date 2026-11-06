"""keep_layout.py : runs a 3D tower exporter and puts its pictures back on the game's layout (towers-no-outline, 30 Oct 2026).

    python -I art-samples/keep_layout.py layout.jsonl web/tools/tower-tiers/export3d.py <3D art worktree> [tower ...]
    python -I art-samples/keep_layout.py layout.jsonl web/tools/tower-tiers/export3d_static.py <3D art worktree> [tower ...]

The exporters cut every picture to what it covers. Without the outline the towers cover a pixel or so less, so the cuts,
and with them the rows in `buildingArtTiers.ts`, would move. Here the exporter's pictures are caught before they are
written and set back on the size and rows the game has (`layout.jsonl`: the rows the exporters printed for the art in the
game, outlined): each picture, or every cell of a strip, goes on a transparent canvas of the game picture's size, at the
whole 2x pixel where it matches the game picture best (the same camera drew both, so where the outline is not, they are
the same pixels). The rows themselves are rounded to 1x pixels, sometimes from half pixels, so they are not used to place
it. A turning tower's still (`top`) is made again as the exporter makes it, from the placed body and the resting cell at
the game's rows. Only then is a picture written, once, with the exporter's WEBP settings, so `buildingArtTiers.ts` stays
as it is. Prints, per picture, the shift found and how well it matches; a poor match stops the run.
"""
import io
import json
import os
import runpy
import subprocess
import sys
from contextlib import redirect_stdout
from pathlib import Path

import numpy as np
from PIL import Image

STATIC_FOLDER = {"tesla": "lightningtower", "bunker": "bunker"}
LAYOUT = Path(sys.argv[1])
EXPORTER = Path(sys.argv[2]).resolve()
REV = os.environ.get("LAYOUT_REV", "revamp")


def key(row):
    return row.get("folder") or STATIC_FOLDER[row["tower"]], row["tier"]


old = {key(r): r for r in (json.loads(s) for s in LAYOUT.read_text().splitlines() if s.startswith("{"))}

caught = {}
real_save = Image.Image.save


def catch(self, fp, format=None, **params):
    if format == "WEBP" and "/server/public/assets/buildings/" in Path(fp).as_posix():
        caught[Path(fp)] = (self.copy(), params)
        return None
    return real_save(self, fp, format, **params)


Image.Image.save = catch
sys.argv = [str(EXPORTER), *sys.argv[3:]]
buf = io.StringIO()
with redirect_stdout(buf):
    G = runpy.run_path(str(EXPORTER), run_name="__main__")
Image.Image.save = real_save
new = [json.loads(s) for s in buf.getvalue().splitlines() if s.startswith("{")]
for s in buf.getvalue().splitlines():
    if not s.startswith("{"):
        print(s)


def arr(im):
    return np.asarray(im.convert("RGBA")).astype(np.int16)


def best_shift(news, olds, what, reach=6):
    """The (dx, dy), 2x px, that sets every picture in `news` on its partner in `olds` (all olds one size) best: the share
    of the new picture's solid pixels whose colour is within 16 of the old one's there."""
    H, W = olds[0].shape[:2]
    h, w = news[0].shape[:2]
    tried = []
    for dy in range(-reach, H - h + reach + 1):
        for dx in range(-reach, W - w + reach + 1):
            good = total = spill = 0
            for n, o in zip(news, olds):
                y0, x0 = max(0, -dy), max(0, -dx)
                y1, x1 = min(h, H - dy), min(w, W - dx)
                spill += int(n[..., 3].sum()) - int(n[y0:y1, x0:x1, 3].sum())
                nn, oo = n[y0:y1, x0:x1], o[y0 + dy:y1 + dy, x0 + dx:x1 + dx]
                solid = nn[..., 3] > 200
                total += int(solid.sum())
                good += int((solid & (oo[..., 3] > 200) & (np.abs(nn[..., :3] - oo[..., :3]).max(-1) <= 16)).sum())
            tried.append((good / max(total, 1) - (1 if spill > 255 * 4 else 0), dx, dy))
    tried.sort(reverse=True)
    (score, dx, dy), runner = tried[0], (tried[1] if len(tried) > 1 else (0, 0, 0))
    # where the outline was, the pixels differ, so a good match is well under 1; it must stand out from the next best
    assert score > 0.5 and score - runner[0] > 0.1, (what, "no clear match with its game picture", tried[:3])
    return dx, dy, score


def place(im, dx, dy, size):
    """im on a transparent canvas of `size`, its top-left at (dx, dy) (2x px); anything outside is cut (checked: nearly
    transparent)."""
    out = Image.new("RGBA", size, (0, 0, 0, 0))
    big = Image.new("RGBA", (size[0] + 2 * im.width, size[1] + 2 * im.height), (0, 0, 0, 0))
    big.paste(im, (dx + im.width, dy + im.height))
    out.paste(big.crop((im.width, im.height, im.width + size[0], im.height + size[1])), (0, 0))
    return out


def cells(im, w, h, n, cols):
    return [im.crop(((i % cols) * w, (i // cols) * h, (i % cols + 1) * w, (i // cols + 1) * h)) for i in range(n)]


def game_picture(folder, name):
    """The game's picture as committed (REV, default revamp: the outlined art)."""
    rel = (ASSETS / folder / name).relative_to(ASSETS.parents[3]).as_posix()
    data = subprocess.run(["git", "-C", str(ASSETS.parents[3]), "show", f"{REV}:{rel}"], capture_output=True, check=True)
    return Image.open(io.BytesIO(data.stdout)).convert("RGBA")


ASSETS = Path(G["ASSETS"])
done = {}
for nr in new:
    k = key(nr)
    orw = old[k]
    for part in ("body", "strip", "anim", "top"):
        if part not in nr:
            continue
        name = nr[part][0]
        path = ASSETS / k[0] / name
        im, params = caught.pop(path)
        was = game_picture(k[0], name)
        if part == "top" and "strip" in nr:
            # the still, as export3d.py makes it: the body, and the resting cell over it, at the game's rows
            p = G["read"](nr["tower"], nr["tier"])
            cols = len(p["cells"][0])
            aim0 = p["aim"][0] if p["aim"] else None
            rest = (min(range(cols), key=lambda i: abs((aim0[i] - G["REST_AIM"] + 180) % 360 - 180)) if aim0
                    else cols * 6 // 32)
            tx, ty = orw["top"][1], orw["top"][2]
            out = Image.new("RGBA", was.size, (0, 0, 0, 0))
            body = done[(k, "body")]
            out.alpha_composite(place(body, 2 * (orw["body"][1] - tx), 2 * (orw["body"][2] - ty), was.size))
            s = orw["strip"]
            cell = cells(done[(k, "strip")], 2 * s[3], 2 * s[4], s[5], orw.get("columns", s[5]))[rest]
            out.alpha_composite(place(cell, 2 * (s[1] - tx), 2 * (s[2] - ty), was.size))
            dx = dy = None
            a, b = arr(out), arr(was)
            solid = a[..., 3] > 200
            score = float((solid & (b[..., 3] > 200) & (np.abs(a[..., :3] - b[..., :3]).max(-1) <= 16)).sum() / solid.sum())
            assert score > 0.5, (k, part, "the still does not match the game's", score)
        elif len(nr[part]) > 3:
            nn, on = nr[part], orw[part]
            n = nn[5]
            assert n == on[5], (k, part, n, on[5])
            new_cells = cells(im, 2 * nn[3], 2 * nn[4], n, nr.get("columns", n))
            old_cells = cells(was, 2 * on[3], 2 * on[4], n, orw.get("columns", n))
            dx, dy, score = best_shift([arr(c) for c in new_cells], [arr(c) for c in old_cells], (k, part))
            out = Image.new("RGBA", was.size, (0, 0, 0, 0))
            cols = orw.get("columns", n)
            for i, c in enumerate(new_cells):
                out.paste(place(c, dx, dy, (2 * on[3], 2 * on[4])), ((i % cols) * 2 * on[3], (i // cols) * 2 * on[4]))
        else:
            dx, dy, score = best_shift([arr(im)], [arr(was)], (k, part))
            out = place(im, dx, dy, was.size)
        done[(k, part)] = out
        real_save(out, path, "WEBP", **params)
        rows_say = None if dx is None else [2 * (nr[part][1] - orw[part][1]), 2 * (nr[part][2] - orw[part][2])]
        print(json.dumps(dict(file=f"{k[0]}/{name}", shift_2x=None if dx is None else [dx, dy], rows_say=rows_say,
                              match=round(score, 3), new_size=list(im.size), size=list(out.size))))
assert not caught, ("pictures with no row", list(caught))
