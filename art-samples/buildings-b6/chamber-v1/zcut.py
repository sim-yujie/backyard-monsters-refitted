"""zcut.py : a Flash area enlarged with tick labels (Flash px around the origin). python zcut.py x0 y0 x1 y1 zoom name"""
import sys
from PIL import Image, ImageDraw
import fref


def cut(a, b, c, d, z, name, im=None):
    im = im or fref.flash_rgba()
    x0, y0 = fref.FRAME[:2]
    c_ = im.crop((a - x0, b - y0, c - x0, d - y0))
    bg = Image.new("RGBA", c_.size, (96, 140, 60, 255))
    bg.alpha_composite(c_)
    big = bg.convert("RGB").resize((c_.width * z, c_.height * z), Image.LANCZOS)
    dr = ImageDraw.Draw(big)
    for x in range(a, c):
        if x % 5 == 0:
            dr.line(((x - a) * z, 0, (x - a) * z, 10 if x % 10 == 0 else 4), fill=(255, 0, 0))
            if x % 10 == 0:
                dr.text(((x - a) * z + 2, 6), str(x), fill=(255, 255, 0))
    for y in range(b, d):
        if y % 5 == 0:
            dr.line((0, (y - b) * z, 10 if y % 10 == 0 else 4, (y - b) * z), fill=(0, 0, 255))
            if y % 10 == 0:
                dr.text((8, (y - b) * z - 5), str(y), fill=(0, 255, 255))
    big.save("work/" + name)


if __name__ == "__main__":
    a = sys.argv
    cut(*map(int, a[1:6]), a[6])
