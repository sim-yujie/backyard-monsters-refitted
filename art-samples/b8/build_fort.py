"""build_fort.py : cut the Codex fortification sheets (fA1, fB1, fC1: 4 columns = fortify 1-4, top row back halves,
bottom row front halves, magenta ground; the chosen rounds are in DIRS), fit them on Flash's ring (same corners), write game-size pieces (@2x) and
the owner's comparison sheets: each direction on the Modern Town Hall and the Modern Cannon Tower, today's look beside.
Proposal only: nothing here is wired into the game. Run: python3 build_fort.py   (from art-samples/b8)
"""
import json

from PIL import Image

from b8lib import B, HERE, artlib, despill_magenta, ends_bottom, hstack, label, multiply, resize_pm, titled, vstack

FORT = HERE / "fortification"
# the chosen Codex round of each direction (round 1 was too thick and hid the building: fortification/round1/;
# fA2 was lumpy, fA3 hung its front tusks downward)
DIRS = {"fA4": "A  Thorn and Bone", "fB2": "B  Stone and Iron Rampart", "fC2": "C  Brass Machine Guard"}
GRASS = (98, 132, 72)
# Flash offsets (web/src/game/yard/fortArt.ts): [front x, front y, back x, back y] per tier
TOWER = [[-73, 21, -70, -10], [-69, 22, -65, -12], [-72, 10, -68, -12], [-70, -11, -61, -36]]
HALL = [[-127, 46, -122, -10], [-124, 48, -120, -15], [-124, 32, -110, -11], [-124, 15, -116, -49]]
# building shown: (name, fort size, offsets, top file, x, y, shadow file, x, y, view box 1x (w, h, ox, oy))
SHOW = {
    "townhall": ("Town Hall level 5", 130, HALL, "townhall/top.new5@2x.webp", -67, -64, "townhall/shadow.5.jpg", -67, 33, (300, 250, 150, 105)),
    "tower": ("Cannon Tower level 4", 70, TOWER, "cannontower/top.t2@2x.webp", -33, -33, "cannontower/shadow.t2.jpg", -31, 17, (190, 170, 92, 78)),
}


def pieces(job):
    """{(part, tier): RGBA cut-out at sheet size} for one Codex sheet."""
    sheet = Image.open(FORT / job / "sheet.png").convert("RGB")
    out = {}
    for n, cell in enumerate(artlib.cells(sheet, 4, 2)):
        im = despill_magenta(artlib.largest_blob_only(artlib.clean(artlib.key(cell)), 0.03))
        out[("BF"[n // 4], n % 4 + 1)] = im.crop(im.getbbox())
    return out


def ring(size, tiers):
    """Flash's ring for one size, from tier 1: centre x, corner y (where back and front meet), width."""
    fx, fy, bx, by = tiers[0]
    f = Image.open(B / f"fortifications/fort{size}_F1.png")
    b = Image.open(B / f"fortifications/fort{size}_B1.png")
    cx = (min(fx, bx) + max(fx + f.width, bx + b.width)) / 2
    return cx, by + ends_bottom(b.convert("RGBA")), max(fx + f.width, bx + b.width) - min(fx, bx)


def fit(piece, size, tiers, up=2):
    """(image at `up` x game size, x, y in game px): the piece on Flash's ring, its ends on the ring's corners."""
    cx, cy, w = ring(size, tiers)
    k = w * up / piece.width
    im = resize_pm(piece, (round(piece.width * k), round(piece.height * k)))
    return im, cx - im.width / up / 2, cy - ends_bottom(im) / up


def scene(key, job, tier, up):
    """One fortified building as the yard draws it: shadow, back, building, front. job None = today's Flash pieces."""
    name, size, tiers, top, tx, ty, sh, sx, sy, (w, h, ox, oy) = SHOW[key]
    bg = Image.new("RGB", (w, h), GRASS)
    bg = multiply(bg, Image.open(B / sh), ox + sx, oy + sy)
    c = bg.resize((w * up, h * up), Image.LANCZOS).convert("RGBA")

    def put(im, x, y):
        c.alpha_composite(im, (round((ox + x) * up), round((oy + y) * up)))

    def flash(part, x, y):
        im = Image.open(B / f"fortifications/fort{size}_{part}{tier}.png").convert("RGBA")
        put(im.resize((im.width * up, im.height * up), Image.LANCZOS), x, y)

    def new(part):
        put(*fit(CUT[job][(part, tier)], size, tiers, up))

    if tier:
        new("B") if job else flash("B", tiers[tier - 1][2], tiers[tier - 1][3])
    t = Image.open(B / top).convert("RGBA")
    put(resize_pm(t, (t.width * up // 2, t.height * up // 2)), tx, ty)
    if tier:
        new("F") if job else flash("F", tiers[tier - 1][0], tiers[tier - 1][1])
    return c.convert("RGB")


CUT = {job: pieces(job) for job in DIRS}
out = FORT / "out"
sheets = FORT / "sheets"
out.mkdir(exist_ok=True)
sheets.mkdir(exist_ok=True)

# game-size pieces (@2x) with their offsets
rows = {}
for job in DIRS:
    d = out / job[:2]
    d.mkdir(exist_ok=True)
    for (part, tier), piece in CUT[job].items():
        piece.save(d / f"cut_{part}{tier}.png")
        for size, tiers in ((70, TOWER), (130, HALL)):
            im, x, y = fit(piece, size, tiers)
            im.save(d / f"fort{size}_{part}{tier}@2x.png")
            rows[f"{job[:2]}/fort{size}_{part}{tier}@2x.png"] = [round(x, 1), round(y, 1)]
(out / "offsets.json").write_text(json.dumps(rows, indent=1))

# per direction and building: 4 rows (fortify 1-4) x [today | new], big
for key, up in (("townhall", 3), ("tower", 5)):
    for job, title in DIRS.items():
        cells = []
        for tier in (1, 2, 3, 4):
            a = label(scene(key, None, tier, up), f"Fortify {tier}  TODAY (Flash art)", fill=(255, 220, 150))
            b = label(scene(key, job, tier, up), f"Fortify {tier}  NEW  {title[0]}")
            r = Image.new("RGB", (a.width * 2 + 12, a.height), (24, 28, 24))
            r.paste(a, (0, 0)); r.paste(b, (a.width + 12, 0))
            cells.append(r)
        body = Image.new("RGB", (cells[0].width, sum(c.height + 12 for c in cells)), (24, 28, 24))
        y = 0
        for c in cells:
            body.paste(c, (0, y)); y += c.height + 12
        titled(f"Fortification {title} on the {SHOW[key][0]} ({up}x)", body, 34).save(
            sheets / f"fort-{job[1]}-{key}.png")

# overview: rows = today, A, B, C; columns = fortify 1-4, at 2x game size, both buildings
for key in SHOW:
    rws = []
    for job, title in [(None, "TODAY (Flash art)")] + list(DIRS.items()):
        cs = [label(scene(key, job, t, 2), f"{title.split('  ')[0]}  fortify {t}", 20) for t in (1, 2, 3, 4)]
        r = Image.new("RGB", (sum(c.width + 8 for c in cs), cs[0].height), (24, 28, 24))
        x = 0
        for c in cs:
            r.paste(c, (x, 0)); x += c.width + 8
        rws.append(r)
    body = Image.new("RGB", (rws[0].width, sum(r.height + 8 for r in rws)), (24, 28, 24))
    y = 0
    for r in rws:
        body.paste(r, (0, y)); y += r.height + 8
    titled(f"Fortification on the {SHOW[key][0]}: today, A, B, C (2x)", body, 28 if key == "tower" else 40).save(
        sheets / f"fort-overview-{key}.png")
    # true game size strip
    cs = [scene(key, job, t, 1) for job in [None] + list(DIRS) for t in (1, 2, 3, 4)]
    g = Image.new("RGB", (cs[0].width * 4, cs[0].height * 4))
    for n, c in enumerate(cs):
        g.paste(c, ((n % 4) * c.width, (n // 4) * c.height))
    g.save(sheets / f"fort-gamesize-{key}.png")
print("ok", len(rows))
