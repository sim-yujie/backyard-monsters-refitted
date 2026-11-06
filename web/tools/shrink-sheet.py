"""Shrink painted monster sheets to 256 colours with pngquant, in place.

Usage: python web/tools/shrink-sheet.py <sheet.png> [<sheet.png> ...]
Same file name and pixel size; a file is left alone if pngquant makes it bigger.
A painted sheet (`name@4x.png`, `name@3x.png`) then gets its smaller copies for the
Quality setting next to it (`sheet_copies.py`).
pngquant is found via $PNGQUANT, then PATH, then the sheet-size trial install.
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

FALLBACK = "D:/Coding/BYMR/art-trials/sheet-size/node_modules/pngquant-bin/vendor/pngquant.exe"


def find_pngquant():
    return os.environ.get("PNGQUANT") or shutil.which("pngquant") or FALLBACK


def shrink(path):
    before = os.path.getsize(path)
    size = Image.open(path).size
    tmp = tempfile.mktemp(suffix=".png")
    try:
        # no minimum quality: these painted sheets always have more than 256 colours
        subprocess.run([find_pngquant(), "256", "--force", "--speed", "1", "-o", tmp, path], check=True)
        if Image.open(tmp).size != size or os.path.getsize(tmp) >= before:
            return before, before
        shutil.copyfile(tmp, path)
        return before, os.path.getsize(tmp)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        b, a = shrink(p)
        print(f"{p}: {b} -> {a}")
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import sheet_copies

    for p in sys.argv[1:]:
        if sheet_copies.PAINTED.search(p) and sheet_copies.scale_of(p) >= 3:
            sheet_copies.make_copies(p)
