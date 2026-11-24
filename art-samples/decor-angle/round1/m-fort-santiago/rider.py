"""Fort Santiago Modern: r2 (paved courtyard) with r1's rider relief (r2 dropped the rider); same block-out, so aligned."""
from PIL import Image, ImageDraw, ImageFilter
a = Image.open("m-fort-santiago-r1/fort-santiago-modern.png").convert("RGB")
b = Image.open("m-fort-santiago/fort-santiago-modern.png").convert("RGB")
m = Image.new("L", a.size, 0); ImageDraw.Draw(m).ellipse((300 - 60, 356 - 50, 300 + 60, 356 + 50), fill=255)
m = m.filter(ImageFilter.GaussianBlur(5))
b.paste(a, (0, 0), m); b.save("m-fort-santiago/fort-santiago-modern-rider.png")
