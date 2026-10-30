"""loop_diff.py : which pixels change during an animation loop. Only the parts that move in Flash may change.

    python loop_diff.py "work/anim6/*.png" -o L6-loop-diff.png
    python loop_diff.py L6-anim.mp4 -o L6-loop-diff.png            (needs ffmpeg on PATH)

Writes the first frame darkened with every pixel that changes at any point in the loop painted red, and prints
how many pixels change and the box around them. Anything red outside the saw/gear/wheel (or whatever moves in
Flash) is a fault: a still part is flickering, the shadow is moving, or the camera shifted.
--tolerance N ignores changes of N or less per channel (default 0; video files need about 12 for compression noise).
"""
import argparse
import glob
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image


def frames(src):
    if src.lower().endswith((".mp4", ".mov", ".webm", ".gif")):
        tmp = Path(tempfile.mkdtemp(prefix="loopdiff-"))
        subprocess.run(["ffmpeg", "-v", "error", "-i", src, str(tmp / "%04d.png")], check=True)
        files = sorted(tmp.glob("*.png"))
    else:
        files = sorted(Path(p) for p in glob.glob(src))
    if len(files) < 2:
        sys.exit(f"need at least 2 frames, found {len(files)} for {src}")
    return files


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help='frame pattern in quotes ("dir/*.png") or a video file')
    ap.add_argument("-o", "--out", default="loop-diff.png")
    ap.add_argument("--tolerance", type=int, default=0)
    a = ap.parse_args()

    files = frames(a.src)
    first = np.array(Image.open(files[0]).convert("RGBA")).astype(np.int16)
    changed = np.zeros(first.shape[:2], bool)
    for f in files[1:]:
        im = np.array(Image.open(f).convert("RGBA")).astype(np.int16)
        if im.shape != first.shape:
            sys.exit(f"{f.name} is {im.shape[1]}x{im.shape[0]}, the first frame is {first.shape[1]}x{first.shape[0]}")
        changed |= (np.abs(im - first) > a.tolerance).any(axis=2)

    base = Image.open(files[0]).convert("RGBA")
    view = Image.new("RGBA", base.size, (24, 24, 24, 255))
    view.alpha_composite(base)
    out = (np.array(view.convert("RGB")).astype(np.float32) * 0.45).astype(np.uint8)
    out[changed] = (255, 30, 30)
    Image.fromarray(out).save(a.out)
    n = int(changed.sum())
    if n:
        ys, xs = np.nonzero(changed)
        print(f"{len(files)} frames, {n} pixels change, inside box x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()} -> {a.out}")
    else:
        print(f"{len(files)} frames, nothing changes -> {a.out}")


if __name__ == "__main__":
    main()
