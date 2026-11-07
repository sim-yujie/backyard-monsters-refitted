"""make.py <painted.png> <out.webp> : the gift wish marker (#391) from a Codex painting.

Cleans the painting's alpha, crops it to the object, centres it on a square and
writes a 112 px webp (shown at 24-36 px, sharp up to 3x screens). Prints where
the red centre disc sits, as the CSS lift for the rank number (`--wish-mark-lift`
in web/src/ui/friends/friends.css).

Painted with run.sh (one Codex call, prompt.txt, the badges' style sheet).
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SIZE = 112

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
a = np.array(im)
a[..., 3][a[..., 3] <= 8] = 0
im = Image.fromarray(a)
im = im.crop(im.getchannel("A").getbbox())
side = max(im.size)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.alpha_composite(im, ((side - im.width) // 2, (side - im.height) // 2))
sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
sq.save(out, "WEBP", quality=92, method=6)

# The red disc: deep red, opaque pixels. Its centre against the square's middle.
p = np.array(sq).astype(int)
red = (p[..., 0] > 110) & (p[..., 1] < 40) & (p[..., 2] < 50) & (p[..., 3] > 200)
lab, n = ndimage.label(red)
biggest = 1 + int(np.argmax(ndimage.sum(red, lab, range(1, n + 1))))  # the disc, not the ribbons
ys, xs = np.nonzero(lab == biggest)
cy, cx = ys.mean(), xs.mean()
print(f"disc centre x={cx:.1f} y={cy:.1f} of {SIZE}; lift {(cy - SIZE / 2) / SIZE:+.3f}, dx {(cx - SIZE / 2) / SIZE:+.3f}, "
      f"disc width {(xs.max() - xs.min() + 1) / SIZE:.2f}")
