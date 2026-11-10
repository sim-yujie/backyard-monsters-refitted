"""The two Victory Totem Poles (121 wmitotem, 131 wmitotem2), 6 levels each, Modern look.

    python totems.py prompt      t1/prompt.txt and t2/prompt.txt (refs: tN/ref-classic.png, levels 1-6)
    python totems.py cut [cut_sheet args]   cut tN/tN.png, write game files, print the TierArt rows
Each level's picture stands where Flash's stands (bottom and centre of its visible box) at its height.
"""
import os
import re
import subprocess
import sys

from PIL import Image

S = "C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts"
HERE = os.path.dirname(os.path.abspath(__file__))
DECOR = os.path.abspath(os.path.join(HERE, "../../../../server/public/assets/buildings/decorations"))
TOTEMS = {
    "t1": (121, "wmitotem", [("top1.png", -31, -23), ("top2.png", -30, -60), ("top3.png", -30, -90),
                             ("top4.png", -30, -110), ("top5.v2.png", -30, -110), ("top6.png", -30, -110)]),
    "t2": (131, "wmitotem2", [("top1.png", -31, -25), ("top2.png", -31, -60), ("top3.png", -31, -86),
                              ("top4.png", -31, -122), ("top5.v2.png", -30, -125), ("top6.png", -31, -128)]),
}


def anchor(folder, f, x, y):
    im = Image.open(os.path.join(DECOR, folder, f)).convert("RGBA")
    b = im.getchannel("A").point(lambda p: 255 if p > 40 else 0).getbbox()
    return b[3] - b[1], y + b[3], x + (b[0] + b[2]) / 2


def prompt():
    tmpl = open(os.path.join(HERE, "prompt-template.txt"), encoding="utf-8").read()
    for t in TOTEMS:
        items = "\n".join([
            "- Cells 1-6 (row 1: levels 1, 2, 3; row 2: levels 4, 5, 6) = the SAME totem pole at levels 1 to 6, "
            "exactly as numbered in ref-classic.png: carved monster heads stacked on a square metal base plate.",
            "- The levels BUILD ON EACH OTHER: each level is the level before with more stacked on top; the base "
            "plate and every lower head are the same, in the same place, at the same size, in every level.",
            "- Levels 1-4 in carved bone/ivory with grey metal bands where the Classic has them; level 5 is level 4 "
            "in polished gold (like the approved Statue of Liberty); level 6 is level 4 in glossy black with the gold "
            "crown and jewel on top, as in the Classic one.",
            "- Every level drawn at the SAME scale (a level-1 totem is short, a level-4 totem tall), all standing on "
            "the same baseline in their row, so the heights compare like the Classic ones."])
        txt = (tmpl.replace("{N}", "6").replace("{ITEMS}", items)
               .replace("{GRID}", "1536x1024 split into 3 columns x 2 rows of equal cells (512x512 each)")
               .replace("{SAVE}", f"{t}.png").replace("numbered.", "labelled level 1 to level 6.")
               .replace("redraw EACH numbered decoration", "redraw EACH level of the decoration"))
        txt = txt.replace("filling about 70% of the cell", "the level-4 to 6 totems filling about 85% of the cell height")
        open(os.path.join(HERE, t, "prompt.txt"), "w", encoding="utf-8").write(txt)


def cut(extra):
    for t, (type_id, folder, levels) in TOTEMS.items():
        anchors = [anchor(folder, *lv) for lv in levels]
        names = ",".join(f"totem-l{i + 1}" for i in range(6))
        heights = ",".join(str(a[0]) for a in anchors)
        out = os.path.join(HERE, t, "out")
        subprocess.run([sys.executable, f"{S}/cut_sheet.py", os.path.join(HERE, t, f"{t}.png"), "--cols", "3", "--rows",
                        "2", "--out", out, f"--names={names}", "--height", heights, *extra], check=True)
        rows = []
        for i, (h, bottom, centre) in enumerate(anchors):
            res = subprocess.run([sys.executable, f"{S}/make_game_files.py", "--src", out, "--suffix", ".modern",
                                  "--format", "webp", "--out", os.path.join(DECOR, folder),
                                  "--item", f"{type_id}:totem-l{i + 1}:40:{bottom}:{centre:g}"],
                                 check=True, capture_output=True, text=True).stdout
            m = re.search(r'(\[".*?\])\s+(\[".*?\])', res)
            rows.append(f"    [{m.group(1)}, {m.group(2)}],")
        print(f"  {type_id}: modernLevels([\n" + "\n".join(rows) + "\n  ]),")


if __name__ == "__main__":
    {"prompt": prompt, "cut": lambda: cut(sys.argv[2:])}[sys.argv[1]]()
