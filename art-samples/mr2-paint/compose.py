#!/usr/bin/env python3
"""Side-by-side: a mock-up B crop beside a real game shot crop, scaled so their cells match.

  python compose.py <game.png> <game box x0,y0,x1,y1> <game cell px> <mock box x0,y0,x1,y1> <out.jpg>
                    [--shrink-mock] [--label "text"]

`game cell px` is the width of one cell in the game shot; mock-up B's near cells are about 300 px
wide in its 2000 px picture. By default the game crop is scaled by 300 / game cell px; with
--shrink-mock the mock-up crop is scaled down to the game's cell size instead (for middle zoom
shots, where enlarging the game shot would only blur it).
"""
import sys

from PIL import Image, ImageDraw, ImageFont

MOCKUP = "C:/Coding/BYMR/worktrees/mr2-mockup2/art-samples/mr2-mockup2/variant-B-soft-lines.jpg"
MOCK_CELL = 300

args = sys.argv[1:]
shrink_mock = "--shrink-mock" in args
label = "Game: painted ground, switch on"
if "--label" in args:
    at = args.index("--label")
    label = args[at + 1]
    del args[at:at + 2]
args = [a for a in args if a != "--shrink-mock"]
game_path, game_box, game_cell, mock_box, out = args[:5]

gb = tuple(int(v) for v in game_box.split(","))
mb = tuple(int(v) for v in mock_box.split(","))
mock = Image.open(MOCKUP).convert("RGB").crop(mb)
game = Image.open(game_path).convert("RGB").crop(gb)
scale = MOCK_CELL / float(game_cell)
if shrink_mock:
    mock = mock.resize((round(mock.width / scale), round(mock.height / scale)), Image.LANCZOS)
else:
    game = game.resize((round(game.width * scale), round(game.height * scale)), Image.LANCZOS)
height = max(mock.height, game.height)
sheet = Image.new("RGB", (mock.width + game.width + 30, height + 44), (24, 26, 30))
sheet.paste(mock, (0, 44))
sheet.paste(game, (mock.width + 30, 44))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("arialbd.ttf", 26)
except OSError:
    font = ImageFont.load_default()
draw.text((10, 8), "Mock-up B (target)", fill=(240, 240, 240), font=font)
draw.text((mock.width + 40, 8), label, fill=(240, 240, 240), font=font)
sheet.save(out, quality=88)
print(out, sheet.size)
