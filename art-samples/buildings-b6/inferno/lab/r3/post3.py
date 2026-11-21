"""post3.py : round 3's pictures and clips, from render/ (lab3.py's renders: L<n>-base.png, -alone.png and
-parts12.png at 12 px per Flash px; L<n>-parts-kk.png, the loop's layers, at 6 px per Flash px; the damaged and
destroyed stills), into the worktree's shots/r3/ folder:

  sheet-levels.png        level 1 | 2 | 3 at one scale (4 px per Flash px), feet on one line, with their shadows; under
                          them the three at the game's own art size (2 px per Flash px) shown 2x with hard pixels
  L<n>-yard.png, yard-all.png   each level set into a real Inferno yard screenshot (shots/yard/inferno-in2.png:
                          yardtester's Inferno yard, Modern look, 4 screen px per Flash px). A COMPOSITE, round 2's
                          method (same spot, same scale): the building is not in the game.
  L<n>-plot.png           the game-size picture at 2x with the building's plot drawn on it (100 yard units square)
  sheet-states.png        whole | damaged for each level, and the destroyed look (one for every level)
  L<n>-damaged.png, destroyed.png     those stills alone, at 6 px per Flash px
  lab-L<n>-loop.mp4, lab-levels-loop.mp4   the loops (three times round), at 6 px per Flash px
  loop-check-L<n>.png     the pixels that change during the loop, red on the first frame
  diff-L2.png, diff-L3.png   what a level adds to the level below (changed pixels red): the proof that nothing else moves
  crop-*.png              full-size (12 px per Flash px) crops of the joints and of every new part

    python3 post3.py [stills] [clips] [crops]        (no argument: everything)
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
R = HERE / "render"
OUT = ROOT / "shots" / "r3"
BG = (74, 42, 36, 255)
ORIGIN, FRAME, SX, SY, SZ = (0.0, 45.0), (-86, -130), 7.0711, 3.5355, 8.6603
SHOT, PX, SPOT, CROP = ROOT / "shots/yard/inferno-in2.png", 4, (1560, 960), (560, 180, 2560, 1500)
NAMES = {1: "Level 1", 2: "Level 2", 3: "Level 3"}
N = 24


def scr(u, v, z, k=12):
    """Render pixel of screen-plan point (u, v) at height z."""
    return ((ORIGIN[0] + SX * u - FRAME[0]) * k, (ORIGIN[1] + SY * v - SZ * z - FRAME[1]) * k)


def whole(lv, state=""):
    """The full picture at 12 px per Flash px: the base with the moving layers' first frame laid over it."""
    if state:
        return Image.open(R / f"L{lv}-{state}-base.png").convert("RGBA")
    b = Image.open(R / f"L{lv}-base.png").convert("RGBA")
    b.alpha_composite(Image.open(R / f"L{lv}-parts12.png").convert("RGBA"))
    return b


def on_bg(im, label=None, size=30):
    s = Image.new("RGBA", im.size, BG)
    s.alpha_composite(im)
    if label:
        ImageDraw.Draw(s).text((14, 10), label, fill=(255, 236, 200, 255), font_size=size)
    return s


def row(ims, gap=0):
    h = max(i.height for i in ims)
    s = Image.new("RGBA", (sum(i.width for i in ims) + gap * (len(ims) - 1), h), BG)
    x = 0
    for i in ims:
        s.alpha_composite(i, (x, h - i.height))
        x += i.width + gap
    return s


def col(ims):
    s = Image.new("RGBA", (max(i.width for i in ims), sum(i.height for i in ims)), BG)
    y = 0
    for i in ims:
        s.alpha_composite(i, (0, y))
        y += i.height
    return s


def tone(im):
    px = [q for q in im.convert("RGBA").get_flattened_data() if q[3] > 230]
    lum = sorted((0.299 * r + 0.587 * g + 0.114 * b) / 255 for r, g, b, _ in px)
    n = len(lum)
    sat = sum((max(q[:3]) - min(q[:3])) / max(1, max(q[:3])) for q in px) / n
    return "brightness %.3f (90%%: %.3f)  saturation %.3f  bright pixels %.1f%%" % (
        sum(lum) / n, lum[9 * n // 10], sat, 100 * sum(v > 0.7 for v in lum) / n)


def changed(a, b, tol):
    """Where pictures a and b differ by more than tol in any channel: a mask (255 = changed), and the greatest
    difference."""
    d = ImageChops.difference(a, b)
    m = None
    for ch in d.split():
        m = ch if m is None else ImageChops.lighter(m, ch)
    return m.point(lambda v: 255 if v > tol else 0), m.getextrema()[1]


def redden(pic, mask):
    red = Image.blend(pic.convert("RGB"), Image.new("RGB", pic.size, (255, 30, 30)), 0.62)
    return Image.composite(red, pic.convert("RGB"), mask)


BOX = (0, 60, 2560, 2712)           # the part of the 12 px canvas the sheets show (the building and its shadow)


def stills():
    OUT.mkdir(parents=True, exist_ok=True)
    big, small, yards = [], [], []
    for lv in (1, 2, 3):
        w = whole(lv)
        alone = Image.open(R / f"L{lv}-alone.png").convert("RGBA")
        c = w.crop(BOX)
        big.append(on_bg(c.resize((c.width // 3, c.height // 3), Image.LANCZOS), NAMES[lv]))
        g = c.resize((c.width // 6, c.height // 6), Image.LANCZOS)
        small.append(on_bg(g).resize((g.width * 2, g.height * 2), Image.NEAREST))
        print("%-8s" % NAMES[lv], tone(alone.resize((alone.width // 6, alone.height // 6), Image.LANCZOS)))
        al = alone.getchannel("A").point(lambda v: 255 if v > 128 else 0)
        x0, y0, x1, y1 = al.getbbox()
        print("   building, Flash px from the origin: x %.0f..%.0f (plot -71..71), top %.0f, bottom %.0f (plot's front "
              "corner 35)" % (x0 / 12 + FRAME[0] - ORIGIN[0], x1 / 12 + FRAME[0] - ORIGIN[0],
                              y0 / 12 + FRAME[1] - ORIGIN[1], y1 / 12 + FRAME[1] - ORIGIN[1]))
        # the plot: 100 yard units square = 10 world units, centred on the origin
        g2 = w.resize((w.width // 6, w.height // 6), Image.LANCZOS)
        s = on_bg(g2.resize((g2.width * 2, g2.height * 2), Image.LANCZOS))
        pts = [((ORIGIN[0] + SX * (X + Y) - FRAME[0]) * 4, (ORIGIN[1] + SY * (X - Y) - FRAME[1]) * 4)
               for X, Y in ((5, 5), (5, -5), (-5, -5), (-5, 5), (5, 5))]
        ImageDraw.Draw(s).line(pts, fill=(120, 255, 255, 255), width=2)
        s.convert("RGB").save(OUT / f"L{lv}-plot.png")
        # the yard composite (round 2's shots2.py)
        yard = Image.open(SHOT).convert("RGBA")
        edge = Image.new("RGBA", w.size, (0, 0, 0, 0))
        edge.paste(w.crop((6, 6, w.width - 6, w.height - 6)), (6, 6))
        ramp = Image.new("L", w.size, 0)
        for k in range(60):
            ImageDraw.Draw(ramp).rectangle((k, k, w.width - 1 - k, w.height - 1 - k), fill=round(255 * (k + 1) / 60))
        edge.putalpha(ImageChops.multiply(edge.getchannel("A"), ramp))
        im = edge.resize((w.width * PX // 12, w.height * PX // 12), Image.LANCZOS)
        yard.alpha_composite(im, (round(SPOT[0] - (ORIGIN[0] - FRAME[0]) * PX), round(SPOT[1] - (ORIGIN[1] - FRAME[1]) * PX)))
        c = yard.crop(CROP).convert("RGB")
        ImageDraw.Draw(c).text((16, 12), NAMES[lv] + " (set into a yardtester Inferno yard screenshot)",
                               fill=(255, 236, 200), font_size=30)
        c.save(OUT / f"L{lv}-yard.png")
        yards.append(c.convert("RGBA"))
    col([row(big), row(small)]).convert("RGB").save(OUT / "sheet-levels.png")
    col(yards).convert("RGB").save(OUT / "yard-all.png")
    # what each level adds
    for lv in (2, 3):
        cur = Image.open(R / f"L{lv}-alone.png").convert("RGBA")
        d, _ = changed(Image.open(R / f"L{lv - 1}-alone.png").convert("RGBA"), cur, 40)
        print("level %d against level %d: %d changed pixels (of %d), box %s" % (
            lv, lv - 1, d.histogram()[255], d.width * d.height, d.getbbox()))
        im = redden(on_bg(cur), d).crop(BOX)
        im.resize((im.width // 3, im.height // 3), Image.LANCZOS).save(OUT / f"diff-L{lv}.png")
    # the states
    rows = []
    for lv in (1, 2, 3):
        pair = []
        for st in ("", "damaged"):
            c = whole(lv, st).crop(BOX)
            pair.append(on_bg(c.resize((c.width // 3, c.height // 3), Image.LANCZOS),
                              NAMES[lv] + (" damaged" if st else "")))
            if st:
                on_bg(c.resize((c.width // 2, c.height // 2), Image.LANCZOS)).convert("RGB").save(OUT / f"L{lv}-damaged.png")
        rows.append(row(pair))
    c = whole(1, "destroyed").crop(BOX)
    on_bg(c.resize((c.width // 2, c.height // 2), Image.LANCZOS)).convert("RGB").save(OUT / "destroyed.png")
    d = on_bg(c.resize((c.width // 3, c.height // 3), Image.LANCZOS), "Destroyed (one look for every level)")
    col([row(rows[:2]), row([rows[2], d])]).convert("RGB").save(OUT / "sheet-states.png")


def frames(lv):
    out = HERE / "frames"
    out.mkdir(exist_ok=True)
    b = Image.open(R / f"L{lv}-base.png").convert("RGBA")
    b = b.resize((b.width // 2, b.height // 2), Image.LANCZOS)
    fs = []
    for k in range(N + 1):
        f = b.copy()
        f.alpha_composite(Image.open(R / f"L{lv}-parts-{k:02d}.png").convert("RGBA"))
        fs.append(on_bg(f).convert("RGB").crop((BOX[0] // 2, BOX[1] // 2, BOX[2] // 2, BOX[3] // 2)))
    return fs


def clips():
    OUT.mkdir(parents=True, exist_ok=True)
    allf = {}
    for lv in (1, 2, 3):
        fs = frames(lv)
        allf[lv] = fs
        _, close = changed(fs[N], fs[0], 0)
        d = None
        for x in fs[1:N]:
            m, _ = changed(x, fs[0], 12)
            d = m if d is None else ImageChops.lighter(d, m)
        print("level %d loop: frame %d against frame 0, greatest difference %d of 255; %d pixels change during the "
              "loop, box %s (6 px per Flash px, sheet crop)" % (lv, N, close, d.histogram()[255], d.getbbox()))
        redden(fs[0], d).save(OUT / f"loop-check-L{lv}.png")
        write_mp4([f for f in fs[:N]], OUT / f"lab-L{lv}-loop.mp4")
    trio = []
    for k in range(N):
        trio.append(row([allf[lv][k].convert("RGBA") for lv in (1, 2, 3)]).convert("RGB"))
    write_mp4(trio, OUT / "lab-levels-loop.mp4", scale=0.6)


def write_mp4(fs, path, scale=1.0, loops=3):
    tmp = HERE / "frames" / path.stem
    tmp.mkdir(parents=True, exist_ok=True)
    i = 0
    for _ in range(loops):
        for f in fs:
            if scale != 1.0:
                f = f.resize((round(f.width * scale), round(f.height * scale)), Image.LANCZOS)
            f = f.crop((0, 0, f.width // 2 * 2, f.height // 2 * 2))
            f.save(tmp / f"{i:03d}.png")
            i += 1
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "13.333", "-i", str(tmp / "%03d.png"),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "15", str(path)], check=True)


def crop_at(im, u, v, z, w, h, k=12):
    x, y = scr(u, v, z, k)
    return on_bg(im.crop((round(x - w / 2), round(y - h / 2), round(x + w / 2), round(y + h / 2))))


def crops():
    OUT.mkdir(parents=True, exist_ok=True)
    w = {lv: whole(lv) for lv in (1, 2, 3)}
    spots = {
        # level 1: the joints the owner asked to be checked, and the wear
        "L1-horn-bases": (1, [(-3.82, 0.6, 12.2, 620, 760), (3.82, 0.6, 12.2, 620, 760)]),
        "L1-horn-tips-coil": (1, [(0.0, -1.4, 14.3, 1000, 700)]),
        "L1-bells-deck": (1, [(0.0, 0.0, 10.4, 1500, 620)]),
        "L1-dome-pipes": (1, [(0.0, 0.5, 6.6, 1500, 640)]),
        "L1-wall-left": (1, [(-6.2, 1.6, 2.2, 760, 760)]),
        "L1-wall-right": (1, [(6.2, 1.6, 2.2, 760, 760)]),
        "L1-columns-door": (1, [(0.0, 2.6, 2.2, 1000, 760)]),
        "L1-deck-corners": (1, [(-8.3, 0.6, 5.4, 560, 520), (8.3, 0.6, 5.4, 560, 520)]),
        # level 2's parts
        "L2-canisters": (2, [(-5.4, 2.6, 2.7, 560, 760), (5.4, 2.6, 2.7, 560, 760)]),
        "L2-bell-coils-horns": (2, [(-4.9, 1.0, 11.6, 700, 800), (4.9, 1.0, 11.6, 700, 800)]),
        # level 3's parts
        "L3-crown": (3, [(0.0, -1.4, 16.2, 760, 760)]),
        "L3-flasks": (3, [(-5.9, 1.75, 10.2, 520, 520), (5.9, 1.75, 10.2, 520, 520)]),
        "L3-channel": (3, [(0.0, 4.4, 0.3, 1500, 560)]),
    }
    for name, (lv, boxes) in spots.items():
        row([crop_at(w[lv], *b) for b in boxes], gap=8).convert("RGB").save(OUT / f"crop-{name}.png")


if __name__ == "__main__":
    what = sys.argv[1:] or ["stills", "clips", "crops"]
    for k in what:
        {"stills": stills, "clips": clips, "crops": crops}[k]()
