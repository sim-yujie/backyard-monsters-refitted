"""iflash.py : the Flash originals of the Inferno yard's buildings (buildingArtInfernoData.ts in the main checkout, read
only), composed as the game draws them, by flashart.py.

    python iflash.py <typeId> [scale]   -> flash/i<id>-L<level>.png per art look, flash/i<id>-anim-L<level>.gif
"""
import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import flashart as F  # noqa: E402

F.DATA = F.MAIN / "web/src/game/yard/buildingArtInfernoData.ts"
HERE = Path(__file__).resolve().parent


def rows():
    return F.rows()


if __name__ == "__main__":
    tid = int(sys.argv[1])
    scale = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    row = rows()[tid]
    out = HERE / "flash"
    out.mkdir(exist_ok=True)
    for lv in row["levels"]:
        im, org = F.compose(row, lv)
        im.resize((im.width * scale, im.height * scale), Image.NEAREST).save(out / f"i{tid}-L{lv[0]}.png")
        n = F.frames_of(lv)
        if n > 1:
            fr = []
            for k in range(n):
                f, _ = F.compose(row, lv, k)
                f = f.resize((f.width * scale, f.height * scale), Image.NEAREST)
                bg = Image.new("RGBA", f.size, (60, 40, 34, 255))
                bg.alpha_composite(f)
                fr.append(bg.convert("RGB"))
            fr[0].save(out / f"i{tid}-anim-L{lv[0]}.gif", save_all=True, append_images=fr[1:], duration=1000 // 24, loop=0)
        print(row["name"], lv[0], im.size, "origin", org, "frames", n)
