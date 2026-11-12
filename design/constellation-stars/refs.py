# Reference sheet of REAL painted game icons + a monster card, for the Codex star call.
from PIL import Image
import sys
W = "C:/Coding/BYMR/worktrees/star-art/web/public"
icons = ["eventcoin", "levelup", "gift", "shield", "alliance", "production", "health", "time"]
cell = 192
sheet = Image.new("RGB", (cell * 4, cell * 2 + 260), (30, 30, 40))
for i, n in enumerate(icons):
    im = Image.open(f"{W}/ui/icons/{n}-64.webp").convert("RGBA").resize((cell - 24, cell - 24), Image.LANCZOS)
    sheet.paste(im, ((i % 4) * cell + 12, (i // 4) * cell + 12), im)
card = Image.open(f"{W}/portraits/C13.webp").convert("RGB")
card = card.resize((int(card.width * 240 / card.height), 240), Image.LANCZOS)
sheet.paste(card, (12, cell * 2 + 10))
sheet.save("refs/ref-icons.png")
print(sheet.size)
