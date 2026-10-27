"""post.py : turn the Blender renders into the sample's pieces and pictures (run after render_all.sh).

  python post.py

Per tier (t1 steel, t1b brass with lamps, t2, t3), in <tier>/ next to this file, the painted kits' layout
(codex-art redesign/cannon/turret/T<n>), so the 3D tower could later go through the same export as the painted one:
  body/body-4x.png            the body without its barrel on the painted tier's 4x canvas
  barrel-4x/hNN.png           the barrel alone at heading NN on the same canvas, body parts in front of it already cut out
                              (so no front layer is needed)
  strip@2x.png + strip.json   the 32 headings at 2x, square cells with the turning point in the middle of each
Pictures for the owner, next to this file:
  tiers-compare.png           tiers 1-3: painted above, 3D below, 3x; game size underneath
  tiers-turning-3x.gif        the three 3D tiers turning together through the 32 headings, 3x
  compare-turning-3x.gif      painted (today's game files) above, 3D below, all three tiers turning, 3x
  t1-steel-vs-brass.png       the two tier 1 versions side by side, large, game size underneath
"""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
R = HERE / "render"
REPO = HERE.parents[1]
PAINTED = Path("D:/Coding/BYMR/worktrees/codex-art/art-samples/redesign/cannon")             # read only
GAME = Path("D:/Coding/BYMR/worktrees/towers-wire/server/public/assets/buildings/cannontower")  # read only
TOP = {"t1": "T2", "t1b": "T2", "t2": "TALL2", "t3": "TALL3"}     # the approved still per tier (export.py TIER_COMBO)
# today's game pieces per tier (buildingArtTiers.ts, type 20): 1x offsets from the building's origin
GAME_TIERS = {
    1: dict(body=("body.t1@2x.webp", -33, -11), strip=("turret.t1@2x.webp", -27, -28, 53, 44),
            front=("front.t1@2x.webp", -12, 8)),
    2: dict(body=("body.t2@2x.webp", -33, -27), strip=("turret.t2@2x.webp", -29, -47, 60, 48),
            front=("front.t2@2x.webp", -16, -14)),
    3: dict(body=("body.t3@2x.webp", -33, -43), strip=("turret.t3@2x.webp", -28, -61, 57, 47),
            front=("front.t3@2x.webp", -18, -27)),
}
UP = 4                         # the renders are at 4x game size
STILL_HEADING = 9              # the barrel's heading closest to the approved stills (up and to the left)
FONT = "arialbd.ttf"


def resize_pm(im, size):
    """Resize with premultiplied alpha, so transparent edges do not go dark."""
    a = np.asarray(im.convert("RGBA")).astype(np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    ch = [Image.fromarray(a[..., i]).resize(size, Image.LANCZOS) for i in range(4)]
    b = np.stack([np.asarray(c) for c in ch], -1).clip(0, 1)
    b[..., :3] /= np.maximum(b[..., 3:4], 1e-6)
    return Image.fromarray((b * 255 + 0.5).clip(0, 255).astype(np.uint8), "RGBA")


def scale(im, f):
    return resize_pm(im, (round(im.width * f), round(im.height * f)))


def grass(w, h, seed=3):
    """The yard's grass, tiled from the 200x100 Flash tiles (as the tower kits do)."""
    tiles = [Image.open(p).convert("RGB") for p in sorted((REPO / "server/public/assets/yardbg/grass").glob("*.png"))]
    tiles = [t for t in tiles if np.asarray(t).reshape(-1, 3).mean(0)[1] > np.asarray(t).reshape(-1, 3).mean(0)[0]]
    rng = np.random.default_rng(seed)
    g = Image.new("RGB", (w, h))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            g.paste(tiles[rng.integers(len(tiles))], (x, y))
    return g.convert("RGBA")


def union(boxes, pad=0):
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes) - pad, min(b[1] for b in boxes) - pad,
            max(b[2] for b in boxes) + pad, max(b[3] for b in boxes) + pad)


def gif(frames, path, ms=90):
    """An animated GIF through ffmpeg: one palette for all frames, and each frame stores only the rectangle that changed
    (the grass and the bodies stand still), which keeps the file small."""
    tmp = R / "_gif"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    for i, f in enumerate(frames):
        f.convert("RGB").save(tmp / f"f{i:02d}.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", f"{1000 / ms:.4f}", "-i", str(tmp / "f%02d.png"),
                    "-vf", "split[a][b];[a]palettegen=max_colors=255:stats_mode=full[p];"
                           "[b][p]paletteuse=dither=none:diff_mode=rectangle",
                    "-gifflags", "+offsetting+transdiff", "-loop", "0", str(path)], check=True)
    shutil.rmtree(tmp)
    return path.stat().st_size


def label_bar(w, text, h=30, size=18):
    bar = Image.new("RGBA", (w, h), (20, 20, 20, 255))
    d = ImageDraw.Draw(bar)
    f = ImageFont.truetype(FONT, size)
    tw = d.textlength(text, font=f)
    d.text(((w - tw) / 2, (h - size) / 2 - 1), text, fill=(255, 255, 255, 255), font=f)
    return bar


# ----------------------------------------------------------------------------------------------------------------- pieces
def pieces(name):
    """The kit-layout pieces for one tier; returns (camera info, body, 32 full towers) at 4x on the tier canvas."""
    cam = json.loads((R / name / "camera.json").read_text())
    px, py = cam["pivot_4x"]
    body = Image.open(R / name / "body-4x.png").convert("RGBA")
    barrels = [Image.open(R / name / "barrel-4x" / f"h{k:02d}.png").convert("RGBA") for k in range(32)]
    out = HERE / name
    (out / "body").mkdir(parents=True, exist_ok=True)
    (out / "barrel-4x").mkdir(exist_ok=True)
    shutil.copy(R / name / "body-4x.png", out / "body" / "body-4x.png")
    for k in range(32):
        shutil.copy(R / name / "barrel-4x" / f"h{k:02d}.png", out / "barrel-4x" / f"h{k:02d}.png")
    # the strip: each heading cropped round the turning point (to the nearest 4x pixel, under 0.25 game px off) and halved;
    # the cell is a multiple of 8 at 4x, big enough for every heading
    reach = max(max(abs(b.getbbox()[0] - px), abs(b.getbbox()[2] - px), abs(b.getbbox()[1] - py), abs(b.getbbox()[3] - py))
                for b in barrels)
    c4 = int(-(-(2 * reach + 8) // 8) * 8)
    cell = c4 // 2
    x0, y0 = round(px - c4 / 2), round(py - c4 / 2)
    strip = Image.new("RGBA", (cell * 32, cell), (0, 0, 0, 0))
    for k, b in enumerate(barrels):
        c = Image.new("RGBA", (c4, c4), (0, 0, 0, 0))
        c.alpha_composite(b, (-x0, -y0))
        strip.alpha_composite(resize_pm(c, (cell, cell)), (k * cell, 0))
    strip.save(out / "strip@2x.png", optimize=True)
    (out / "strip.json").write_text(json.dumps(dict(
        cells=32, cell_w=cell, cell_h=cell, pivot_in_body_4x=[round(px, 2), round(py, 2)],
        body_4x_size=[body.width, body.height], painted_pivot_in_body_4x=cam["painted_pivot_4x"],
        rule="cell k = trunc(bearing / 11.25); cell k shows heading 11.25k (the same 32 headings as the painted strip)",
        note="pivot = middle of each cell; heading = ground bearing in degrees (0 down-right on screen, 45 at the viewer). "
             "Rendered from cannon3d.py: the body's parts that stand in front of the barrel are already cut out of each "
             "cell, so no front layer is needed."), indent=1))
    full = []
    for b in barrels:
        f = body.copy()
        f.alpha_composite(b)
        full.append(f)
    return cam, body, full


def painted_turning(tier):
    """Today's game tower turning (body, turret strip cell, front), 32 frames at 2x on a canvas round the origin."""
    g = GAME_TIERS[tier]
    body = Image.open(GAME / g["body"][0]).convert("RGBA")
    strip = Image.open(GAME / g["strip"][0]).convert("RGBA")
    front = Image.open(GAME / g["front"][0]).convert("RGBA")
    cw, ch = g["strip"][3] * 2, g["strip"][4] * 2
    parts = [(g["body"][1], g["body"][2], body.width, body.height), (g["strip"][1], g["strip"][2], cw, ch),
             (g["front"][1], g["front"][2], front.width, front.height)]
    X0 = min(2 * x for x, y, w, h in parts)
    Y0 = min(2 * y for x, y, w, h in parts)
    X1 = max(2 * x + w for x, y, w, h in parts)
    Y1 = max(2 * y + h for x, y, w, h in parts)
    frames = []
    for k in range(32):
        f = Image.new("RGBA", (X1 - X0, Y1 - Y0), (0, 0, 0, 0))
        f.alpha_composite(body, (2 * g["body"][1] - X0, 2 * g["body"][2] - Y0))
        f.alpha_composite(strip.crop((k * cw, 0, (k + 1) * cw, ch)), (2 * g["strip"][1] - X0, 2 * g["strip"][2] - Y0))
        f.alpha_composite(front, (2 * g["front"][1] - X0, 2 * g["front"][2] - Y0))
        frames.append(f)
    return frames


# --------------------------------------------------------------------------------------------------------------- pictures
def main():
    data = {n: pieces(n) for n in ("t1", "t1b", "t2", "t3")}
    tiers = [("t1", 1), ("t2", 2), ("t3", 3)]
    gap, lab = 14, 30
    S = 3 / UP

    # 1. tiers-compare.png: painted stills above, 3D (same heading) below, 3x; game size (1x) underneath
    cols = []
    for name, t in tiers:
        appr = Image.open(PAINTED / TOP[name] / "new-4x.png").convert("RGBA")
        mine = data[name][2][STILL_HEADING]
        box = union([appr.getbbox(), mine.getbbox()], 8)     # the canvases match, so the bottoms line up
        cols.append([scale(appr.crop(box), S), scale(mine.crop(box), S), scale(appr.crop(box), 1 / UP),
                     scale(mine.crop(box), 1 / UP)])
    cw = max(c[0].width for c in cols)
    h_big = max(c[0].height for c in cols)
    h_one = max(c[2].height for c in cols)
    W = 3 * cw + 4 * gap
    H = 3 * lab + 2 * h_big + h_one + 4 * gap
    g = grass(W, H, seed=7)
    rows_y = [lab, 2 * lab + h_big + gap, 3 * lab + 2 * (h_big + gap)]
    g.alpha_composite(label_bar(W, "Painted (in the game today)"), (0, 0))
    g.alpha_composite(label_bar(W, "3D model"), (0, rows_y[1] - lab))
    g.alpha_composite(label_bar(W, "Game size: painted left, 3D right"), (0, rows_y[2] - lab))
    d = ImageDraw.Draw(g)
    f = ImageFont.truetype(FONT, 16)
    for i, c in enumerate(cols):
        x = gap + i * (cw + gap)
        for r, im in enumerate(c[:2]):
            g.alpha_composite(im, (x + (cw - im.width) // 2, rows_y[r] + h_big - im.height + gap // 2))
        g.alpha_composite(c[2], (x + cw // 2 - c[2].width - 4, rows_y[2] + h_one - c[2].height + gap // 2))
        g.alpha_composite(c[3], (x + cw // 2 + 4, rows_y[2] + h_one - c[3].height + gap // 2))
        d.text((x + 4, rows_y[0] + 4), f"Tier {i + 1}", fill=(255, 255, 255, 255), font=f, stroke_width=2,
               stroke_fill=(0, 0, 0, 255))
    g.convert("RGB").save(HERE / "tiers-compare.png", optimize=True)

    # 2. tiers-turning-3x.gif: the three 3D tiers turning together, 3x, bottoms lined up
    boxes = {n: union([f.getbbox() for f in data[n][2]], 6) for n, _ in tiers}
    big = {n: [scale(f.crop(boxes[n]), S) for f in data[n][2]] for n, _ in tiers}
    cw = max(big[n][0].width for n, _ in tiers)
    hh = max(big[n][0].height for n, _ in tiers)
    W, H = 3 * cw + 4 * gap, lab + hh + gap
    bg = grass(W, H, seed=5)
    bg.alpha_composite(label_bar(W, "3D: tier 1, tier 2, tier 3"), (0, 0))
    frames = []
    for k in range(32):
        fr = bg.copy()
        for i, (n, _) in enumerate(tiers):
            im = big[n][k]
            fr.alpha_composite(im, (gap + i * (cw + gap) + (cw - im.width) // 2, lab + hh - im.height + gap // 2))
        frames.append(fr)
    size1 = gif(frames, HERE / "tiers-turning-3x.gif")

    # 3. compare-turning-3x.gif: today's painted turning tower above, the 3D one below, per tier, 3x
    pt = {}
    for _, t in tiers:
        fr = [scale(x, 1.5) for x in painted_turning(t)]
        bb = union([x.getbbox() for x in fr], 4)
        pt[t] = [x.crop(bb) for x in fr]
    cw = max(max(pt[t][0].width, big[n][0].width) for n, t in tiers)
    hp = max(pt[t][0].height for _, t in tiers)
    W, H = 3 * cw + 4 * gap, 2 * lab + hp + hh + 2 * gap
    bg = grass(W, H, seed=9)
    bg.alpha_composite(label_bar(W, "Painted (in the game today)"), (0, 0))
    bg.alpha_composite(label_bar(W, "3D model"), (0, lab + hp + gap))
    frames = []
    for k in range(32):
        fr = bg.copy()
        for i, (n, t) in enumerate(tiers):
            x = gap + i * (cw + gap)
            a, b = pt[t][k], big[n][k]
            fr.alpha_composite(a, (x + (cw - a.width) // 2, lab + hp - a.height + gap // 2))
            fr.alpha_composite(b, (x + (cw - b.width) // 2, 2 * lab + hp + gap + hh - b.height + gap // 2))
        frames.append(fr)
    size2 = gif(frames, HERE / "compare-turning-3x.gif")

    # 4. t1-steel-vs-brass.png: the two tier 1 versions, large (the 4x renders), game size underneath
    ims = [data[n][2][STILL_HEADING] for n in ("t1", "t1b")]
    box = union([im.getbbox() for im in ims], 10)
    big2 = [im.crop(box) for im in ims]
    one = [scale(im, 1 / UP) for im in big2]
    wb, hb = big2[0].size
    W = 2 * wb + 3 * gap
    H = lab + hb + gap + lab + one[0].height + 2 * gap
    g = grass(W, H, seed=11)
    g.alpha_composite(label_bar(W, ""), (0, 0))
    d = ImageDraw.Draw(g)
    f = ImageFont.truetype(FONT, 20)
    for i, n in enumerate(("Steel bands, no lamps", "Brass bands, lamps")):
        tw = d.textlength(n, font=f)
        d.text((gap + i * (wb + gap) + (wb - tw) / 2, 4), n, fill=(255, 255, 255, 255), font=f)
    for i, im in enumerate(big2):
        g.alpha_composite(im, (gap + i * (wb + gap), lab))
    y = lab + hb + gap
    g.alpha_composite(label_bar(W, "Game size"), (0, y))
    for i, im in enumerate(one):
        g.alpha_composite(im, (gap + i * (wb + gap) + (wb - im.width) // 2, y + lab + gap))
    g.convert("RGB").save(HERE / "t1-steel-vs-brass.png", optimize=True)

    for n in data:
        print(n, "cell", json.loads((HERE / n / "strip.json").read_text())["cell_w"], "pivot", data[n][0]["pivot_4x"],
              "painted", data[n][0]["painted_pivot_4x"])
    print("gifs", size1 // 1024, "KB", size2 // 1024, "KB")


main()
