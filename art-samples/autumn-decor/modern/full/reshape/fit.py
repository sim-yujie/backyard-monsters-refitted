"""Cut one cell of a Codex sheet and fit it EXACTLY into the Flash picture's visible box (width and height,
so the outline lines up), then write the Modern game files at Flash's anchor.
    python fit.py <sheet> <cols> <rows> <cell index> <type> <name> [--sat 0.85 ...cut_sheet tone args]
Prints the art row for decorationModernArt.ts and how much the cut was stretched each way."""
import json, os, re, subprocess, sys
from PIL import Image
S = "C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts"
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "../../../../.."))
DECOR = os.path.join(REPO, "server/public/assets/buildings/decorations")
FLASH = {102: ("pool", "top.png", -65, 8, 100), 104: ("zengarden", "top.png", -72, -5, 100),
         106: ("japaneseteagarden", "top.png", -62, -38, 100), 100: ("statue-eiffeltower", "top.v2.png", -60, -121, 70)}


def vis_box(im):
    return im.getchannel("A").point(lambda p: 255 if p > 40 else 0).getbbox()


def main():
    sheet, cols, rows, idx, t, name, *extra = sys.argv[1:]
    cols, rows, idx, t = int(cols), int(rows), int(idx), int(t)
    folder, top, fx, fy, size = FLASH[t]
    fl = Image.open(os.path.join(DECOR, folder, top)).convert("RGBA")
    b = vis_box(fl); fw, fh = b[2] - b[0], b[3] - b[1]
    bottom, centre = fy + b[3], fx + (b[0] + b[2]) / 2
    out = os.path.join(HERE, "out"); os.makedirs(out, exist_ok=True)
    names = ",".join(name if i == idx else "-" for i in range(cols * rows))
    subprocess.run([sys.executable, f"{S}/cut_sheet.py", sheet, "--cols", str(cols), "--rows", str(rows), "--out", out,
                    f"--names={names}", *extra], check=True, capture_output=True)
    cut = Image.open(os.path.join(out, f"{name}.full.png")).convert("RGBA")
    cut = cut.crop(vis_box(cut))
    sx, sy = 2 * fw / cut.width, 2 * fh / cut.height
    print(f"{name}: cut {cut.size}, Flash {fw}x{fh}; aspect cut {cut.width / cut.height:.3f} Flash {fw / fh:.3f} "
          f"-> width stretched {sx / sy * 100 - 100:+.1f}% relative to height")
    cut.resize((2 * fw, 2 * fh), Image.LANCZOS).save(os.path.join(out, f"{name}@2x.png"))
    cut.resize((fw, fh), Image.LANCZOS).save(os.path.join(out, f"{name}.png"))
    res = subprocess.run([sys.executable, f"{S}/make_game_files.py", "--src", out, "--suffix", ".modern", "--format",
                          "webp", "--out", os.path.join(DECOR, folder), "--item", f"{t}:{name}:{size}:{bottom}:{centre}"],
                         check=True, capture_output=True, text=True).stdout
    m = re.search(r'(\[".*?\])\s+(\[".*?\])', res)
    print(f"  {t}: modernLook({m.group(1)}, {m.group(2)}),")


main()
