"""
compare.py <IC id> <work dir> <shots dir>
Comparison pictures for the lead (build_anim.py first):
  compare-h<a>-h<b>.png  Flash beside Modern, every 4th heading, 4 headings per picture, enlarged 4x:
                         Flash idle + its walk rows | Modern idle, walk 2, walk 3, wind-up, strike
  game-size.png          all headings at the real 1x size: Flash, Modern idle, Modern walk 3, Modern strike
  game-size-x3.png       the same blown up 3x with hard pixels (what 1x looks like, easier to see)
  mirror-check.png       mirrored headings beside painted neighbours (light check), and painted
                         spare views (still/skip.txt) beside the mirrored views that replace them
  loop-h<N>.mp4          walk x2 then attack, Flash beside Modern, for two headings (needs ffmpeg)
"""
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

import common
from spec import ASSETS, SPECS, flash_column, heading_deg

mid, work, shots = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
spec = SPECS[mid]
shots.mkdir(parents=True, exist_ok=True)
D = spec["directions"]
CW, CH = spec["cell"]
PX, PT, PB = spec["anim_pad"]
ACW, ACH = CW + 2 * PX, CH + PT + PB
UP = 4
BG = (86, 92, 74)
anim = Image.open(ASSETS / f"{spec['out']}-anim@4x.png").convert("RGBA")
anim1 = Image.open(ASSETS / f"{spec['out']}-anim.png").convert("RGBA")
flash = common.flash_sheet(spec)
frows = flash.height // CH
walk_rows = [r for r in range(frows)][1:] or [0]


def modern(h, k, sheet=anim, s=UP):
    return sheet.crop((h * ACW * s, k * ACH * s, (h + 1) * ACW * s, (k + 1) * ACH * s))


def old(h, r, s=UP):
    """Flash cell (nearest Flash column, row r) in a Modern-sized frame, enlarged s times."""
    c = common.flash_cell(spec, flash_column(spec, h), r)
    f = Image.new("RGBA", (ACW, ACH))
    f.paste(c, (PX, PT))
    return f.resize((ACW * s, ACH * s), Image.NEAREST) if s != 1 else f


def label(im, text, xy=(4, 4), fill=(255, 240, 160)):
    ImageDraw.Draw(im).text(xy, text, fill=fill)


heads = list(range(0, D, 4))
W, H = ACW * UP, ACH * UP
cols = [("Flash idle", lambda h: old(h, 0))] + [(f"Flash walk {i}", (lambda r: lambda h: old(h, r))(r)) for i, r in enumerate(walk_rows[:2], 1)]
cols += [("Modern idle", lambda h: modern(h, 0)), ("walk 2", lambda h: modern(h, 2)), ("walk 3", lambda h: modern(h, 3)),
         ("wind-up", lambda h: modern(h, 8)), ("strike", lambda h: modern(h, 9))]
for g in range(0, len(heads), 4):
    hs = heads[g:g + 4]
    pic = Image.new("RGB", (W * len(cols) + 8, (H + 4) * len(hs) + 20), BG)
    for j, (name, _) in enumerate(cols):
        label(pic, name, (j * W + (8 if j >= 3 else 0) + 6, 4))
    for i, h in enumerate(hs):
        for j, (_, fn) in enumerate(cols):
            pic.paste(common.flat(fn(h), BG), (j * W + (8 if j >= 3 else 0), 20 + i * (H + 4)))
        label(pic, f"heading {heading_deg(spec, h):g} deg ({h})", (6, 20 + i * (H + 4) + H - 14))
    ImageDraw.Draw(pic).line((3 * W + 3, 0, 3 * W + 3, pic.height), fill=(20, 20, 20), width=3)
    pic.save(shots / f"compare-h{hs[0]}-h{hs[-1]}.png")

# game size
rows = [("Flash", lambda h: old(h, 0, 1)), ("Modern idle", lambda h: modern(h, 0, anim1, 1)),
        ("Modern walk 3", lambda h: modern(h, 3, anim1, 1)), ("Modern strike", lambda h: modern(h, 9, anim1, 1))]
gs = Image.new("RGB", (ACW * D, ACH * len(rows)), BG)
for i, (_, fn) in enumerate(rows):
    for h in range(D):
        gs.paste(common.flat(fn(h), BG), (h * ACW, i * ACH))
gs.save(shots / "game-size.png")
gs.resize((gs.width * 3, gs.height * 3), Image.NEAREST).save(shots / "game-size-x3.png")

# light check for the mirrored headings
painted = {int(p.stem[1:]) for p in (work / "still" / "cuts").glob("h*.png")}
seq = [6, 7, 8, 9, 10, 22, 23, 24, 25, 26]
mc = Image.new("RGB", (W * len(seq), H + 20), BG)
for i, h in enumerate(seq):
    mc.paste(common.flat(modern(h, 0), BG), (i * W, 20))
    label(mc, f"h{h} {'painted' if h in painted else 'mirrored'}", (i * W + 4, 4))
spare = []
sk = work / "still" / "skip.txt"
if sk.exists():
    for line in sk.read_text().split("\n"):
        if line.strip():
            b, h = line.split()
            hs_ = [int(x) for x in b.split("-")[1:]]
            cell = common.grid_cells(work / "still" / b / "frames-new.png", 2, 2)[hs_.index(int(h))]
            spare.append((int(h), common.key_cell(cell, despill=spec.get("despill"))))
if spare:
    st = Image.open(ASSETS / f"{spec['out']}-repaint@4x.png").convert("RGBA")
    sw, sh = CW * UP, CH * UP
    row2 = Image.new("RGB", (sw * 2 * len(spare) + 10 * len(spare), sh + 20), BG)
    for i, (h, cut) in enumerate(spare):
        mirrored = st.crop((h * sw, 0, (h + 1) * sw, sh))
        k = (common.solid(mirrored).sum() / common.solid(cut).sum()) ** 0.5
        real = common.premul_resize(cut, (round(cut.width * k), round(cut.height * k)))
        cell = Image.new("RGBA", (sw, sh))
        cell.paste(real, ((sw - real.width) // 2, sh - real.height - 10))
        x = i * (2 * sw + 10)
        row2.paste(common.flat(mirrored, BG), (x, 20))
        row2.paste(common.flat(cell, BG), (x + sw, 20))
        label(row2, f"h{h}: used (mirror) | painted spare", (x + 4, 4))
    both = Image.new("RGB", (max(mc.width, row2.width), mc.height + row2.height + 6), BG)
    both.paste(mc, (0, 0))
    both.paste(row2, (0, mc.height + 6))
    mc = both
mc.save(shots / "mirror-check.png")

# loops
if shutil.which("ffmpeg"):
    for h in spec.get("loops", (4, 12)):
        tmp = Path(tempfile.mkdtemp(dir=shots))
        seqf = [("walk", k, 8) for _ in range(3) for k in range(1, 7)] + [("attack", k, 4) for _ in range(2) for k in list(range(7, 12)) + [0, 0, 0]]
        n = 0
        for kind, k, ticks in seqf:
            fr = Image.new("RGB", (W * 2 + 8, H + 20), BG)
            fl_row = walk_rows[(k - 1) % len(walk_rows)] if kind == "walk" else 0
            fr.paste(common.flat(old(h, fl_row), BG), (0, 20))
            fr.paste(common.flat(modern(h, k), BG), (W + 8, 20))
            label(fr, f"Flash  h{h}", (4, 4))
            label(fr, f"Modern {kind}", (W + 12, 4))
            for _ in range(ticks // 4):  # 1 picture per 4 game ticks
                fr.save(tmp / f"f{n:04d}.png")
                n += 1
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", "10", "-i", str(tmp / "f%04d.png"),
                        "-vf", "scale=iw*2:ih*2:flags=neighbor,pad=ceil(iw/2)*2:ceil(ih/2)*2", "-pix_fmt", "yuv420p",
                        str(shots / f"loop-h{h}.mp4")], check=True)
        shutil.rmtree(tmp)
print("wrote", sorted(p.name for p in shots.iterdir()))
