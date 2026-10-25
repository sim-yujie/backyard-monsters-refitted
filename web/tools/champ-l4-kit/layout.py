"""Sheet layouts for the champion sheets (from monsterSpriteData.ts on origin/revamp).
KIT = the shared champion kit in art-trials (old sheets, portraits); OUT = this worktree's art-samples/champions;
L3 = the approved level 3 repaints (4x) that ship in revamp, used as the colour and style reference for levels 4-6."""
from pathlib import Path
from PIL import Image
KIT = Path("D:/Coding/BYMR/art-trials/champions/_kit")
REPO = Path(__file__).resolve().parents[3]
OUT = REPO / "art-samples" / "champions"


def l3_sheet(fam):
    return Image.open(REPO / "server" / "public" / "assets" / "monsters" / f"{fam}_3-repaint@4x.png").convert("RGBA")
# name: (file, fw, fh, walk_first, walk_count)
L = {
 "ape_1": (96, 69, 1, 7), "ape_2": (89, 73, 1, 7), "ape_3": (103, 88, 1, 7), "ape_4": (148, 127, 1, 7), "ape_5": (160, 137, 1, 7), "ape_6": (140, 120, 1, 7),
 "dragon_1": (64, 41, 1, 7), "dragon_2": (87, 58, 1, 7), "dragon_3": (114, 85, 1, 7), "dragon_4": (131, 93, 1, 7), "dragon_5": (156, 117, 1, 7), "dragon_6": (171, 125, 1, 7),
 "fly_1": (53, 40, 1, 7), "fly_2": (63, 46, 1, 8), "fly_3": (98, 81, 1, 6), "fly_4": (120, 92, 1, 6), "fly_5": (133, 105, 1, 6), "fly_6": (124, 105, 1, 6),
 "krallen_1": (130, 80, 0, 10), "krallen_2": (131, 90, 0, 10), "krallen_3": (142, 100, 0, 10),
}
def cell(name, col, row, sheet=None):
    fw, fh = L[name][:2]
    im = Image.open(KIT / "sheets" / f"{sheet or name}.png").convert("RGBA")
    return im.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))
def on(bg, im):
    b = Image.new("RGBA", im.size, bg + (255,)); b.alpha_composite(im); return b.convert("RGB")
