"""The frost tribe's avatar, both looks, from Codex call art-samples/frost-tribe/av1/avatar.png (3 cells of 512x1024:
Modern cel-shaded figure, Classic painted figure, Classic face icon).

Run from the worktree root:  python web/tools/frost-kit/frost_avatar.py
Writes, beside the other tribes' art:
  web/public/tribes/frost-256.png                       Modern map avatar (`tribeAvatars.ts`), 256 px, transparent
  server/public/assets/popups/tribe_frost.v2.png         Classic full figure (as tribe_kozu.v2.png, 150 px tall)
  server/public/assets/monsters/tribe_frost_50.v2.jpg    Classic 50 px face icon (and tribe_frost_50.jpg)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from krampus_sheets import key_magenta  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
SRC = REPO / "art-samples" / "frost-tribe" / "av1" / "avatar.png"


def trimmed(im):
    al = np.asarray(im)[..., 3].copy()
    al[:6], al[-6:], al[:, :6], al[:, -6:] = 0, 0, 0, 0
    im.putalpha(Image.fromarray(al))
    ys, xs = np.where(al > 8)
    return im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def fit(im, w, h):
    s = min(w / im.width, h / im.height)
    small = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.alpha_composite(small, ((w - small.width) // 2, h - small.height))
    return out


def main():
    sheet = Image.open(SRC).convert("RGB").resize((1536, 1024), Image.LANCZOS)
    modern = trimmed(key_magenta(sheet.crop((0, 0, 512, 1024))))
    fit(modern, 244, 250).crop((0, 0, 244, 250))
    canvas = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(fit(modern, 236, 246), (10, 5))
    canvas.save(REPO / "web" / "public" / "tribes" / "frost-256.png", optimize=True)
    classic = trimmed(key_magenta(sheet.crop((512, 0, 1024, 1024))))
    fit(classic, 120, 142).save(REPO / "server" / "public" / "assets" / "popups" / "tribe_frost.v2.png", optimize=True)
    face = sheet.crop((1024 + 8, 8, 1536 - 8, 512 - 8)).resize((50, 50), Image.LANCZOS)
    for name in ("tribe_frost_50.v2.jpg", "tribe_frost_50.jpg"):
        face.save(REPO / "server" / "public" / "assets" / "monsters" / name, quality=90)
    print("frost tribe avatar written")


if __name__ == "__main__":
    main()
