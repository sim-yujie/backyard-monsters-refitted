"""gcrop.py <img> x0 y0 x1 y1 [out] : crop a 10x grid picture (fref grid) to Flash px x0..x1, y0..y1."""
import sys
from PIL import Image
import fref
im = Image.open(sys.argv[1])
x0, y0, x1, y1 = map(float, sys.argv[2:6])
k = im.width / (fref.FRAME[2] - fref.FRAME[0])
im.crop((int((x0 - fref.FRAME[0]) * k), int((y0 - fref.FRAME[1]) * k), int((x1 - fref.FRAME[0]) * k),
         int((y1 - fref.FRAME[1]) * k))).save(sys.argv[6] if len(sys.argv) > 6 else "work/crop.png")
