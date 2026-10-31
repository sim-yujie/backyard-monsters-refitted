"""Look sheets (Flash on top, 3D below, one crop) and part crops (Flash left, 3D right, enlarged) for bone v6."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
D = Path(r"D:/Coding/BYMR/worktrees/buildings-3d-inferno/art-samples/buildings-b6/inferno")
sys.path.insert(0, str(D))
import ipost
ipost.D = D / "bone"
ipost.C = ipost.load(ipost.D)
OUT = D / "bone" / "v6"
OUT.mkdir(exist_ok=True)
BOX = {1: (40, 40, 1260, 1240), 3: (40, 40, 1260, 1240)}
CROPS = {1: {"dropper": (300, 120, 600, 460), "belt": (720, 580, 420, 620), "crusher": (300, 380, 640, 400)},
         3: {"dropper": (560, 60, 560, 640), "gear": (780, 680, 440, 600), "crusher": (260, 480, 680, 460)}}


def pair(lv):
    m = ipost.on_ground(ipost.frame3d(lv, 0)).convert("RGB")
    f = ipost.flash(lv, 0, m.size)
    f = ipost.on_ground(f).convert("RGB") if f.mode == "RGBA" else f.convert("RGB")
    return f, m


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle((0, 0, 12 + 9 * len(text), 26), fill=(20, 20, 20))
    d.text((6, 6), text, fill=(255, 255, 255))
    return im


for lv in (1, 3):
    f, m = pair(lv)
    x0, y0, x1, y1 = BOX[lv]
    a, b = f.crop((x0, y0, x1, y1)), m.crop((x0, y0, x1, y1))
    sh = Image.new("RGB", (a.width, a.height * 2 + 8), (255, 255, 255))
    sh.paste(label(a, f"Look {lv} Flash"), (0, 0))
    sh.paste(label(b, f"Look {lv} 3D v6"), (0, a.height + 8))
    sh.save(OUT / f"bone-v6-look{lv}.jpg", quality=92)
    for name, (x, y, w, h) in CROPS[lv].items():
        k = 2 if max(w, h) < 520 else 1.5
        W, H = int(w * k), int(h * k)
        pic = Image.new("RGB", (W * 2 + 8, H), (255, 255, 255))
        pic.paste(label(f.crop((x, y, x + w, y + h)).resize((W, H), Image.LANCZOS), "Flash"), (0, 0))
        pic.paste(label(m.crop((x, y, x + w, y + h)).resize((W, H), Image.LANCZOS), "3D v6"), (W + 8, 0))
        pic.save(OUT / f"L{lv}-{name}.jpg", quality=92)
    print("look", lv, "done")
