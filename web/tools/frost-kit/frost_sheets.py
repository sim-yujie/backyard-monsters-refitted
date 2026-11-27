"""Write the frost tribe's battle sheets: every copy of the 8 frost monsters' sheets, recoloured (frostlib.py).

Run from the worktree root with numpy, scipy, Pillow (and imagequant if you have it):

    python web/tools/frost-kit/frost_sheets.py

Each sheet is written under `server/public/assets/monsters/frost/` with the SAME file name as the sheet it is made from,
so the game's tables keyed by file (REPAINTED_SHEETS, MIRRORED_HEADINGS, layouts, Quality copies) apply unchanged:
`monsterSprites.ts` swaps `monsters/<name>` for `monsters/frost/<name>` when a creep is drawn with the frost skin.
Written: the Flash sheet (Classic look) and the painted sheet's @4x, @2x and 1x copies (Modern, High/Medium/Low).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from frostlib import frost_rgba  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
MON = REPO / "server" / "public" / "assets" / "monsters"
OUT = MON / "frost"

# monster id: (Flash sheet, painted animated sheet base name), from monsterSpriteData.ts and REPAINTED_SHEETS
FROST_MONSTERS = {
    "C1": ("sprite.1.v1.png", "pokey-anim"),
    "C5": ("eyera.png", "eyera-anim"),
    "C6": ("ichi.png", "ichi-anim"),
    "C8": ("fang.png", "fang-anim"),
    "C9": ("brain.v2.png", "brain-anim"),
    "C10": ("crabatron.png", "crabatron-anim"),
    "C14": ("14.v1.png", "teratorn-anim"),
    "C16": ("vorg_anim.png", "vorg-anim"),
}


def quantise(im):
    try:
        import imagequant
        return imagequant.quantize_pil_image(im, dithering_level=1.0, max_colors=256)
    except ImportError:
        return im.quantize(256, method=Image.Quantize.FASTOCTREE)


def write(src, dst, scale, paletted):
    im = Image.open(src).convert("RGBA")
    out = Image.fromarray(frost_rgba(np.asarray(im), scale), "RGBA")
    if paletted:
        out = quantise(out)
    dst.parent.mkdir(parents=True, exist_ok=True)
    out.save(dst, optimize=True)
    print(f"{dst.relative_to(REPO)}  {out.size[0]}x{out.size[1]}  {dst.stat().st_size // 1024} KB")


def main():
    for mid, (flash, anim) in FROST_MONSTERS.items():
        write(MON / flash, OUT / flash, 1, Image.open(MON / flash).mode == "P")
        for suffix, scale in (("@4x", 4), ("@2x", 2), ("", 1)):
            name = f"{anim}{suffix}.png"
            write(MON / name, OUT / name, scale, True)


if __name__ == "__main__":
    main()
