"""pilfix.py : this PC's Pillow (12.1.1, Ubuntu's) fails on resize(..., NEAREST) ("returned NULL without setting an
exception"). Importing this makes NEAREST resizes use BOX, which gives the same hard pixels for whole-number enlargements.
    sh py.sh <script.py> [args]      runs a script with the fix in place
"""
from PIL import Image

_resize = Image.Image.resize


def resize(self, size, resample=None, *a, **k):
    if resample in (Image.NEAREST, Image.Resampling.NEAREST):
        resample = Image.Resampling.BOX
    return _resize(self, size, resample, *a, **k)


try:
    Image.new("RGB", (2, 2)).resize((4, 4), Image.Resampling.NEAREST)
except SystemError:
    Image.Image.resize = resize
