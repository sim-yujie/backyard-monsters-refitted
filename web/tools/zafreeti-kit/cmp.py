"""Run inside a batch folder: writes cmp.png (old frames | new frames side by side)."""
from PIL import Image

a = Image.open("frames.png")
b = Image.open("frames-new.png").convert("RGB")
b = b.resize((a.width, int(b.height * a.width / b.width)))
g = Image.new("RGB", (a.width * 2, max(a.height, b.height)))
g.paste(a, (0, 0))
g.paste(b, (a.width, 0))
g.save("cmp.png")
