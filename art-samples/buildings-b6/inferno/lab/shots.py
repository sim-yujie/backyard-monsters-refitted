"""shots.py : the first-look pictures of the three directions, from <dir>/render/L1-base.png (12 px per Flash px,
with the ground shadow), into the worktree's shots/ folder:
  <dir>-game2x.png   the picture at the game's own art size (2 px per Flash px, as every @2x.webp), kept for the
                     yard composite (composite.py)
  <dir>-alone.png    that same picture enlarged 2x on the Inferno ground colour, cropped to the building
  <dir>-detail.png   the render at 6 px per Flash px, cropped (finer than the game ever shows: for vetting joints)
  directions.png     the three side by side at 2x, with the surface Monster Lab and three Inferno neighbours at the
                     same scale under them
"""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
OUT = ROOT / "shots"
ART = ROOT / "server/public/assets/buildings"
BG = (74, 42, 36, 255)
NAMES = {"a": "A  Brimstone Still", "b": "B  Tube Furnace", "c": "C  Specimen Tank"}


def on_bg(im, pad=16):
    box = im.getbbox()
    im = im.crop(box)
    s = Image.new("RGBA", (im.width + 2 * pad, im.height + 2 * pad), BG)
    s.alpha_composite(im, (pad, pad))
    return s


def row(ims, h=None):
    h = h or max(i.height for i in ims)
    s = Image.new("RGBA", (sum(i.width for i in ims), h), BG)
    x = 0
    for i in ims:
        s.alpha_composite(i, (x, h - i.height))
        x += i.width
    return s


OUT.mkdir(exist_ok=True)
alone = []
for d in "abc":
    base = Image.open(HERE / d / "render" / "L1-base.png").convert("RGBA")
    g = base.resize((base.width // 6, base.height // 6), Image.LANCZOS)
    g.save(OUT / f"{d}-game2x.png")
    a = on_bg(g.resize((g.width * 2, g.height * 2), Image.LANCZOS))
    a.convert("RGB").save(OUT / f"{d}-alone.png")
    alone.append(a)
    on_bg(base.resize((base.width // 2, base.height // 2), Image.LANCZOS), 30).convert("RGB").save(OUT / f"{d}-detail.png")
refs = []
for p in ("monsterlab/top.3d1@2x.webp", "hatcherycontrolcenter/top.i3d1@2x.webp", "ihatchery/top.3d1@2x.webp",
          "iacademy/top.3d2@2x.webp", "imonsterlab/top.3d1@2x.webp"):
    r = Image.open(ART / p).convert("RGBA")
    refs.append(on_bg(r.resize((r.width * 2, r.height * 2), Image.LANCZOS)))
top, bot = row(alone), row(refs)
s = Image.new("RGBA", (max(top.width, bot.width), top.height + bot.height), BG)
s.alpha_composite(top, (0, 0))
s.alpha_composite(bot, (0, top.height))
s.convert("RGB").save(OUT / "directions.png")
print(s.size, [a.size for a in alone])
