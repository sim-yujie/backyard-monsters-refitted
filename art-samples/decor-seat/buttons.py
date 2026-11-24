"""Flash-style build buttons for the new decorations, from their Classic yard picture (+ first strip cell)."""
import re, sys
from pathlib import Path
from PIL import Image
sys.path.insert(0, "/home/yujiesim/Coding/backyard-monsters-refitted/.claude/skills/game-art/scripts")
from make_game_files import flash_button
REPO = Path("/home/yujiesim/Coding/backyard-monsters-refitted/worktrees/decor-wire")
A = REPO / "server/public/assets"
src = (REPO / "web/src/game/yard/revampDecorations.ts").read_text()
rows = re.findall(r'\[(\d+), "[^"]+", "([^"]+)", \[\n\s*\[1, \["([^"]+)", (-?\d+), (-?\d+)\][^\n]*(?:\n\s*\[\["([^"]+)", (-?\d+), (-?\d+), (\d+), (\d+), \d+\]\]\])?', src)
for t, folder, top, x, y, an, ax, ay, aw, ah in rows:
    t = int(t)
    if t < 207: continue
    def load(name):
        im = Image.open(A / folder / name).convert("RGBA")
        return im if "@2x" in name else im.resize((im.width * 2, im.height * 2), Image.LANCZOS)
    parts = [(load(top), int(x), int(y))]
    if an:
        strip = load(an)
        parts.append((strip.crop((0, 0, int(aw) * 2, int(ah) * 2)), int(ax), int(ay)))
    x0 = min(p[1] for p in parts); y0 = min(p[2] for p in parts)
    x1 = max(p[1] + p[0].width // 2 for p in parts); y1 = max(p[2] + p[0].height // 2 for p in parts)
    c = Image.new("RGBA", ((x1 - x0) * 2, (y1 - y0) * 2), (0, 0, 0, 0))
    for im, px, py in parts:
        c.alpha_composite(im, ((px - x0) * 2, (py - y0) * 2))
    c = c.crop(c.getchannel("A").getbbox())
    flash_button(c, A / "buildingbuttons" / f"{t}.jpg")
    print(t, c.size)
