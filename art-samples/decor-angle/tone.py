"""Small tone trims in place: tone.py <file> <brightness factor> <saturation factor>"""
import sys
from PIL import Image, ImageEnhance
p, kb, ks = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
im = Image.open(p).convert("RGBA"); a = im.getchannel("A")
rgb = ImageEnhance.Color(ImageEnhance.Brightness(im.convert("RGB")).enhance(kb)).enhance(ks); rgb.putalpha(a); rgb.save(p)
