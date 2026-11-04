"""sheets.py : the owner's pictures for the Quake Tower 3D, into shots/quake-3d/.

    python sheets.py tiers      quake-tier-option-sheet.png (Flash, then looks 1-3 at rest) and quake-tier-option-tN.png
    python sheets.py loop       quake-strike-loop.mp4: Flash's 33-cell strike (4x, hard pixels) beside the 3D's at the
                                game's pace, three strikes (ffmpeg on PATH); the cells in shots/quake-3d/loop/

Flash and 3D share one scale (the game's 4x) and one ground pixel, as compare.py's sheets.
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "shots" / "quake-3d"
FLASH = ROOT / "server" / "public" / "assets" / "buildings" / "iquaketower" / "anim.1.png"
BG = (104, 132, 84, 255)
CROP = (50, 100, 430, 740)          # the tower on the 3D's 480x760 canvas (ground middle at 240, 640)
GROUND = (240 - CROP[0], 640 - CROP[1])
LABEL_H = 48


def font(size):
    try:
        return ImageFont.truetype("arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def flash_cell(c):
    im = Image.open(FLASH).convert("RGBA").crop((c * 75, 0, c * 75 + 75, 132))
    im = im.resize((300, 528), Image.NEAREST)
    tile = Image.new("RGBA", (CROP[2] - CROP[0], CROP[3] - CROP[1]), BG)
    tile.alpha_composite(im, (GROUND[0] - 4 * 37, GROUND[1] - 4 * (75 + 35)))   # anim.1 at (-37,-75); ground (0,35)
    return tile


def model_cell(t, name):
    tile = Image.new("RGBA", (CROP[2] - CROP[0], CROP[3] - CROP[1]), BG)
    tile.alpha_composite(Image.open(HERE / "render" / f"t{t}" / name).convert("RGBA").crop(CROP))
    return tile


def labelled(tiles, labels):
    w, h = tiles[0].size
    sheet = Image.new("RGBA", (w * len(tiles), h + LABEL_H), BG)
    d = ImageDraw.Draw(sheet)
    for i, (tile, lab) in enumerate(zip(tiles, labels)):
        sheet.alpha_composite(tile, (i * w, LABEL_H))
        d.text((i * w + 12, 10), lab, fill=(255, 255, 255, 255), font=font(26))
    return sheet


def tiers():
    tiles = [flash_cell(0)] + [model_cell(t, "cell-00.png") for t in (1, 2, 3)]
    labels = ["Flash (all levels)", "3D look 1: levels 1-2", "3D look 2: levels 3-4", "3D look 3: levels 5-6"]
    labelled(tiles, labels).convert("RGB").save(OUT / "quake-tier-option-sheet.png")
    for t in (1, 2, 3):
        model_cell(t, "cell-00.png").convert("RGB").save(OUT / f"quake-tier-option-t{t}.png")


def loop(fps=40):
    """At the game's pace (engine.ts windQuake: a cell every 6 of 80 ticks, the last 4 cells one a tick), shown at 40
    fps: cells 0-28 three frames each, 29-32 one each, then half a second at rest."""
    frames = OUT / "loop"
    frames.mkdir(parents=True, exist_ok=True)
    for f in frames.glob("*.png"):
        f.unlink()
    seq = [c for c in range(29) for _ in range(3)] + [29, 30, 31, 32] + [0] * 20
    for c in range(33):
        pair = labelled([flash_cell(c), model_cell(1, f"cell-{c:02d}.png")], [f"Flash  cell {c}", "3D (all levels)"])
        pair.convert("RGB").save(frames / f"cell{c:02d}.png")
    lst = frames / "seq.txt"
    lines = [f"file 'cell{c:02d}.png'\nduration {1 / fps:.4f}\n" for c in seq * 3]
    lst.write_text("".join(lines) + "file 'cell00.png'\n")
    mp4 = OUT / "quake-strike-loop.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst), "-r", str(fps),
                    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", str(mp4)], check=True)
    lst.unlink()
    print(mp4)


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "tiers"
    tiers() if what == "tiers" else loop(int(sys.argv[2]) if len(sys.argv) > 2 else 40)
