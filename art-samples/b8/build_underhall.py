"""build_underhall.py : cut the Codex Under Hall level sheets (uA1, uB1: level 4, 5, 6 left to right on green), fit
them on today's level 3 look (same base width, same ground line, same centre, one scale for all three), write the
game-size pictures (@2x) and the owner's sheets: all six levels in a row at one scale with today's looks marked.
Proposal only: nothing here is wired into the game. Run: python3 build_underhall.py   (from art-samples/b8)
"""
import glob
import json
import random

from PIL import Image

from b8lib import B, HERE, REPO, artlib, band, hstack, key_green, label, multiply, resize_pm, titled, vstack

UH = HERE / "underhall-levels"
DIRS = {"uA1": "A  Bone and Skull", "uB1": "B  Lava and Black Iron"}
F = B / "itownhall"
# today's Modern looks (buildingArtTiers.ts INFERNO_PAINTED_BUILDING_ART[14]): top (file, x, y), shadow (file, x, y)
TODAY = {1: (("top.c1@2x.webp", -52, -30), ("shadow.1.v2.jpg", -65, 49)),
         2: (("top.c2@2x.webp", -51, -58), ("shadow.2.v2.jpg", -70, 35)),
         3: (("top.c3@2x.webp", -51, -54), ("shadow.3.v2.jpg", -74, 35))}
W, H, OX, OY = 190, 250, 80, 110            # one view box (1x) for every level; the building's origin at (OX, OY)


def ground(w, h, seed=5):
    """The Inferno yard's lava ground, tiled from Flash's 200x100 lava tiles."""
    tiles = [Image.open(p).convert("RGB") for p in sorted(glob.glob(str(REPO / "server/public/assets/yardbg/lava/*inferno_lava*.png")))]
    rng = random.Random(seed)
    g = Image.new("RGB", (w, h), (60, 30, 24))
    for y in range(0, h, 100):
        for x in range(0, w, 200):
            if tiles:
                g.paste(rng.choice(tiles), (x, y))
    return g


def today2x(level):
    f, x, y = TODAY[level][0]
    return Image.open(F / f).convert("RGBA"), x, y


def fit(job):
    """{level: (picture at 2x game size, x, y in game px)} for levels 4-6 of one sheet."""
    sheet = Image.open(UH / job / "sheet.png").convert("RGB")
    cuts, tops = [], []
    for n in range(3):
        im = key_green(sheet.crop((n * 512, 0, (n + 1) * 512, 1024)))
        box = im.getbbox()
        cuts.append(im.crop(box))
        tops.append(box[1])
    ref, rx, ry = today2x(3)
    l0, r0, b0, _ = band(ref)                                  # level 3's base, in its own 2x pixels
    bands = [band(c) for c in cuts]
    k = (r0 - l0) / (bands[0][1] - bands[0][0])                # one scale: level 4's base = level 3's base
    ground_y = tops[0] + bands[0][2]                           # one ground line: level 4's, in sheet pixels
    out = {}
    for n, (c, (l, r, _, _)) in enumerate(zip(cuts, bands)):
        im = resize_pm(c, (round(c.width * k), round(c.height * k)))
        # centred on the base band's centre (the sheet column's middle is unreliable), standing on the common line
        x = rx + ((l0 + r0) / 2 - (l + r) / 2 * k) / 2
        y = ry + (b0 - (ground_y - tops[n]) * k) / 2
        out[4 + n] = (im, x, y)
    return out, k


def scene(pic, x, y, up, shadow=TODAY[3][1]):
    """One level on the Inferno's lava with its ground shadow, at `up` x game size (pic is at 2x)."""
    bg = ground(W, H)
    sf, sx, sy = shadow
    bg = multiply(bg, Image.open(F / sf), OX + sx, OY + sy)
    c = bg.resize((W * up, H * up), Image.LANCZOS).convert("RGBA")
    p = pic if up == 2 else resize_pm(pic, (round(pic.width * up / 2), round(pic.height * up / 2)))
    c.alpha_composite(p, (round((OX + x) * up), round((OY + y) * up)))
    return c.convert("RGB")


def level_scene(job, level, up):
    if level <= 3:
        pic, x, y = today2x(level)
        return scene(pic, x, y, up, TODAY[level][1])
    pic, x, y = FIT[job][level]
    return scene(pic, x, y, up)


FIT, rows = {}, {}
out, sheets = UH / "out", UH / "sheets"
out.mkdir(exist_ok=True)
sheets.mkdir(exist_ok=True)
for job in DIRS:
    FIT[job], k = fit(job)
    for level, (im, x, y) in FIT[job].items():
        im.save(out / f"{job[:2]}-top.c{level}@2x.png")
        rows[f"{job[:2]}-top.c{level}@2x.png"] = [round(x, 1), round(y, 1), im.width, im.height]
    print(job, "scale", round(k, 3), {lv: (im.size, round(x, 1), round(y, 1)) for lv, (im, x, y) in FIT[job].items()})
(out / "offsets.json").write_text(json.dumps(rows, indent=1))

YEL = (255, 220, 150)
for job, title in DIRS.items():
    d = title[0]
    # all six levels in one row, same scale (3x game size)
    cs = [label(level_scene(job, lv, 3), f"Level {lv}  TODAY" if lv <= 3 else f"Level {lv}  NEW {d}", 26,
                YEL if lv <= 3 else (255, 255, 255)) for lv in range(1, 7)]
    titled(f"Under Hall levels 1-6, direction {title} (3x game size; today levels 4-6 look like level 3)",
           hstack(cs, 8)).save(sheets / f"underhall-{d}-all-levels.png")
    # large, two per row: 3 (today) | 4, then 5 | 6
    big = [label(level_scene(job, lv, 6), f"Level {lv}  TODAY (also shown for 4, 5, 6 today)" if lv == 3 else f"Level {lv}  NEW {d}", 34,
                 YEL if lv == 3 else (255, 255, 255)) for lv in (3, 4, 5, 6)]
    titled(f"Under Hall direction {title}: level 3 (today) and the new levels 4, 5, 6 (6x game size)",
           vstack([hstack(big[:2]), hstack(big[2:])])).save(sheets / f"underhall-{d}-large.png")
# both directions at true game size and 2x
for up in (1, 2):
    rws = [hstack([level_scene(job, lv, up) for lv in range(1, 7)], 4) for job in DIRS]
    vstack(rws, 4).save(sheets / f"underhall-gamesize-{up}x.png")
print("ok")
