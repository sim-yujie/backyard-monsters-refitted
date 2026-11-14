"""post.py : the Strongbox's pictures and loop from strongbox.py's renders (needs numpy and Pillow).

python post.py fit [k]     work/cmp-fit.png: Flash cell k beside the quick fit render (work/fit-L1.png)
python post.py mp4         strongbox-unlocking.mp4 (Flash beside 3D, the loop three times) and
                           strongbox-unlocking-3d.mp4 (3D alone), and strongbox-idle.png (frame 0)
python post.py sheets      sheet-idle.png, sheet-unlocking.png (Flash beside 3D at the render's full size) and the
                           crop-*.png close-ups of the busiest joints

The frames are whole renders (render/f-NN.png, strongbox.py -- 1 full). The canvas is strongbox.py's: Flash px
x -70..90, y -52..98, the building's anchor at (0, 0). Flash has no ground shadow picture for this building.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

D = Path(__file__).resolve().parent
FLASH = D.parents[3] / "server/public/assets/buildings/imonsterlab"
FRAME = (-70, -52, 90, 98)
N = 30
BG = (96, 60, 52, 255)                  # a dark Inferno ground
W, H = FRAME[2] - FRAME[0], FRAME[3] - FRAME[1]
CROP = (-62, -48, 86, 92)               # the building and its shadow, in Flash px


def font(n):
    try:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", n)
    except OSError:
        return ImageFont.load_default()


def flash(i=0):
    """Flash's Strongbox, cell i of its strip, on the canvas at 1x."""
    top = Image.open(FLASH / "top.1.v2.png").convert("RGBA")
    a = Image.open(FLASH / "anim.1.v2.png").convert("RGBA")
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    im.alpha_composite(top, (-56 - FRAME[0], 8 - FRAME[1]))
    im.alpha_composite(a.crop((86 * i, 0, 86 * i + 86, 88)), (-42 - FRAME[0], -41 - FRAME[1]))
    return im


def on(im, bg=BG):
    out = Image.new("RGBA", im.size, bg)
    out.alpha_composite(im)
    return out


def label(im, text, size=None):
    size = size or max(16, im.width // 30)
    ImageDraw.Draw(im).text((12, 8), text, font=font(size), fill=(255, 240, 220, 255), stroke_width=2,
                            stroke_fill=(30, 20, 16, 255))
    return im


def pair(fl, m, names=("Flash", "3D"), crop=CROP, zoom=1):
    """Flash beside the 3D picture at the 3D picture's own size (Flash enlarged with hard pixels)."""
    k = m.width / W
    box = tuple(round((v - o) * k) for v, o in zip(crop, (FRAME[0], FRAME[1]) * 2))
    a = on(fl.resize(m.size, Image.NEAREST)).crop(box)
    b = on(m).crop(box)
    if zoom != 1:
        a = a.resize((a.width * zoom, a.height * zoom), Image.NEAREST)
        b = b.resize((b.width * zoom, b.height * zoom), Image.LANCZOS)
    out = Image.new("RGBA", (a.width * 2 + 8, a.height), (30, 20, 16, 255))
    out.paste(label(a, names[0]), (0, 0))
    out.paste(label(b, names[1]), (a.width + 8, 0))
    return out


def fr(k):
    return Image.open(D / "render" / f"f-{k:02d}.png").convert("RGBA")


def mp4():
    tmp = D / "render" / "mp4"
    for sub in ("pair", "solo"):
        (tmp / sub).mkdir(parents=True, exist_ok=True)
    for k in range(N):
        m = fr(k)
        pair(flash(k), m).convert("RGB").save(tmp / "pair" / f"{k:02d}.png")
        kk = m.width / W
        box = tuple(round((v - o) * kk) for v, o in zip(CROP, (FRAME[0], FRAME[1]) * 2))
        on(m).crop(box).convert("RGB").save(tmp / "solo" / f"{k:02d}.png")
    on(fr(0)).crop(box).save(D / "strongbox-idle.png")
    for sub, name in (("pair", "strongbox-unlocking.mp4"), ("solo", "strongbox-unlocking-3d.mp4")):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-stream_loop", "2", "-framerate", "25", "-i",
                        str(tmp / sub / "%02d.png"), "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-crf", "14", str(D / name)], check=True)
        print("made", D / name)


CROPS = {"lock": (-34, -46, 40, 10), "door": (-34, 30, 36, 86), "claw-left": (-40, 14, -8, 60),
         "side-right": (20, 10, 62, 76), "side-left": (-60, 10, -18, 76)}


def sheets():
    pair(flash(0), fr(0), names=("Flash (idle, cell 0)", "3D (idle, frame 0)")).save(D / "sheet-idle.png")
    k = 15
    pair(flash(k), fr(k), names=(f"Flash (unlocking, cell {k})", f"3D (unlocking, frame {k})")).save(
        D / "sheet-unlocking.png")
    for name, c in CROPS.items():
        kk = 15 if name == "lock" else 0
        pair(flash(kk), fr(kk), crop=c, zoom=2, names=(f"Flash, cell {kk}", f"3D, frame {kk}")).save(
            D / f"crop-{name}.png")
    pair(flash(0), fr(0), crop=CROPS["lock"], zoom=2, names=("Flash, cell 0", "3D, frame 0")).save(
        D / "crop-lock-idle.png")
    print("made sheets and crops in", D)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "fit":
        k = int(sys.argv[2]) if len(sys.argv) > 2 else 0
        m = Image.open(D / "work" / "fit-L1.png").convert("RGBA")
        pair(flash(k), m, zoom=2).save(D / "work" / "cmp-fit.png")
    elif cmd == "mp4":
        mp4()
    elif cmd == "sheets":
        sheets()
