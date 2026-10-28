#!/usr/bin/env python3
"""Make the smaller copies of every painted monster and champion sheet, for the Quality setting.

Each repaint is painted at three or four times the game's size (`name@4x.png`, `name@3x.png`); Korath 5
and 6 at two (`name@2x.png`), as more would pass the 8192 px many graphics cards cannot hold. The Quality
setting (Account settings, `web/src/game/quality.ts`) picks which copy a player downloads:

  High    name@4x.png  (or @3x, @2x)  as painted
  Medium  name@2x.png                 half the painted size (two thirds for a @3x sheet), about a quarter of the bytes;
                                      name@1.5x.png for a sheet painted at 2x
  Low     name.png                    the size Flash drew it, about a tenth of the bytes

This writes the Medium copy from the painted sheet, and `name.png` too when it is missing. A
`name.png` the sheet's own builder wrote next to the painted sheet (they all do) is never touched:
it is already the 1x copy. Each copy written here is quantised to 256 colours like the sheets
themselves and carries a `bymr-copy-of` note naming the painted sheet and its byte size, so
`web/src/game/attack/monsterSpriteData.test.ts` fails on a copy that is missing, the wrong size,
or left behind by a repaint. It then rewrites `web/src/game/attack/sheetVersions.ts`, the version number each
file is asked for with, so a browser keeping pictures for a week still fetches a repainted one.

Run it after any new or changed painted sheet (the animated kits' `shrink-sheet.py` and
`add-champ-ground-shadow.py` run it for you):

  python web/tools/sheet_copies.py                every repaint in REPAINTED_SHEETS
  python web/tools/sheet_copies.py <name@4x.png>  just these (copies are written next to them)
  python web/tools/sheet_copies.py --check        writes nothing; lists what is missing or stale, exit 1 if any

Quantising uses libimagequant when it is installed (`uv run --no-project --with imagequant
--with pillow python web/tools/sheet_copies.py`), else pngquant through `shrink-sheet.py`.
"""
import argparse
import importlib.util
from fractions import Fraction
import re
import struct
import sys
import zlib
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None  # the biggest champion sheets are ~88 million pixels

TOOLS = Path(__file__).resolve().parent
ROOT = TOOLS.parents[1]
ASSETS = ROOT / "server/public/assets"
SPRITES_TS = ROOT / "web/src/game/attack/monsterSprites.ts"
VERSIONS_TS = ROOT / "web/src/game/attack/sheetVersions.ts"
MARK = "bymr-copy-of"
PAINTED = re.compile(r"@(\d+)x\.png$")


def repaints():
    """The painted sheets the game draws, as asset paths (`monsters/pokey-anim@4x.png`)."""
    src = SPRITES_TS.read_text(encoding="utf8")
    table = src[src.index("export const REPAINTED_SHEETS"):]
    table = table[: table.index("};")]
    return [p for p in re.findall(r':\s*"([^"]+)"', table) if scale_of(p) >= 2]


def scale_of(painted):
    found = PAINTED.search(Path(painted).name)
    return int(found.group(1)) if found else 1


def medium_scale(painted):
    """The Medium copy's scale: 2, or 1.5 for a sheet painted at only 2x (as `sheetCopies` in quality.ts)."""
    return Fraction(2) if scale_of(painted) >= 3 else Fraction(3, 2)


def copy_paths(painted):
    """(half, quarter): `name@2x.png` (`name@1.5x.png`) and `name.png` beside `name@Nx.png`."""
    painted = Path(painted)
    tag = "@2x.png" if medium_scale(painted) == 2 else "@1.5x.png"
    return painted.with_name(PAINTED.sub(tag, painted.name)), painted.with_name(PAINTED.sub(".png", painted.name))


def copy_scales(painted):
    """The scales of `copy_paths`: the Medium copy's, then 1."""
    return medium_scale(painted), Fraction(1)


# ── PNG text chunks, read and written without touching the pixels ──────────────────────────


def chunks(data):
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        yield kind, data[pos + 8 : pos + 8 + length], pos, pos + 12 + length
        if kind == b"IDAT":
            return
        pos += 12 + length


def texts(path):
    """The file's tEXt notes before its pixels, as {key: value}."""
    with open(path, "rb") as f:
        head = f.read(1 << 16)
    out = {}
    for kind, body, _, _ in chunks(head):
        if kind == b"tEXt" and b"\0" in body:
            key, value = body.split(b"\0", 1)
            out[key.decode("latin1")] = value.decode("latin1")
    return out


def set_texts(path, notes):
    """Writes these tEXt notes right after IHDR, replacing any with the same keys."""
    data = Path(path).read_bytes()
    keep, ihdr_end = [], None
    for kind, body, start, end in chunks(data):
        if kind == b"IHDR":
            ihdr_end = end
        elif kind == b"tEXt" and body.split(b"\0", 1)[0].decode("latin1") in notes:
            keep.append((start, end))
    assert ihdr_end, f"{path} is not a PNG"
    for start, end in reversed(keep):
        data = data[:start] + data[end:]
    added = b""
    for key, value in notes.items():
        body = key.encode("latin1") + b"\0" + value.encode("latin1")
        added += struct.pack(">I", len(body)) + b"tEXt" + body + struct.pack(">I", zlib.crc32(b"tEXt" + body))
    Path(path).write_bytes(data[:ihdr_end] + added + data[ihdr_end:])


# ── Making the copies ──────────────────────────────────────────────────────────────────────


def stamp(painted):
    """What a copy of this painting says it was made from: its name and byte size."""
    return f"{Path(painted).name} {Path(painted).stat().st_size}"


def quantise(img, path):
    try:
        import imagequant

        try:
            small = imagequant.quantize_pil_image(img, max_quality=95, min_quality=60)
        except RuntimeError:  # "Quality too low": a sheet with very many colours; take the best 256
            small = imagequant.quantize_pil_image(img, max_quality=95, min_quality=0)
        small.save(path, optimize=True)
    except ImportError:
        img.save(path, optimize=True)
        spec = importlib.util.spec_from_file_location("shrink_sheet", TOOLS / "shrink-sheet.py")
        shrink = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(shrink)
        shrink.shrink(str(path))


def builders_copy(painted, path):
    """Whether `path` is the 1x copy the sheet's builder wrote: no note of ours, a quarter (or third) the size."""
    if MARK in texts(path):
        return False
    n = scale_of(painted)
    with Image.open(painted) as p, Image.open(path) as q:
        return q.size == (p.width // n, p.height // n)


def stale(painted):
    """The copies of a painted sheet that are missing, the wrong size, or made from an older painting."""
    want = stamp(painted)
    out = []
    for path, scale in zip(copy_paths(painted), copy_scales(painted)):
        if not path.exists():
            out.append(path)
        elif texts(path).get(MARK) != want and not (scale == 1 and builders_copy(painted, path)):
            out.append(path)
    return out


def make_copies(painted, versions=True):
    """Writes whichever copies of `painted` are missing or stale; returns the paths written."""
    painted = Path(painted)
    n = scale_of(painted)
    want = stamp(painted)
    notes = {k: v for k, v in texts(painted).items() if k != MARK}  # e.g. Krallen's ground-shadow mark
    big = None
    written = []
    for path, scale in zip(copy_paths(painted), copy_scales(painted)):
        if path.exists() and texts(path).get(MARK) == want:
            continue
        if scale == 1 and path.exists() and builders_copy(painted, path):
            continue  # the builder's own 1x copy, written with the painting: left byte for byte
        if big is None:
            big = Image.open(painted).convert("RGBA")
        w, h = big.width * scale / n, big.height * scale / n
        assert w.denominator == h.denominator == 1, f"{painted.name}: {big.size} does not scale by {scale}/{n} to whole pixels"
        w, h = int(w), int(h)
        # Pillow resizes RGBA with the alpha premultiplied, so no dark fringes.
        quantise(big.resize((w, h), Image.LANCZOS), path)
        set_texts(path, {**notes, MARK: want})
        written.append(path)
    for path in written:
        print(f"wrote {path.name} ({path.stat().st_size / 1e6:.2f} MB)")
    if versions and written and painted.resolve().is_relative_to(ASSETS.resolve()):
        write_versions()
    return written


def version(path):
    """A file's version: its byte size in base 36. A repaint all but always changes it."""
    n, digits, out = path.stat().st_size, "0123456789abcdefghijklmnopqrstuvwxyz", ""
    while True:
        n, r = divmod(n, 36)
        out = digits[r] + out
        if n == 0:
            return out


def versions_source():
    lines = []
    for rel in repaints():
        painted = ASSETS / rel
        for path in (painted, *copy_paths(painted)):
            if path.exists():
                lines.append(f'  "{path.relative_to(ASSETS).as_posix()}": "{version(path)}",')
    body = "\n".join(lines)
    return f"""/**
 * Generated by `web/tools/sheet_copies.py`; do not edit. The version each painted
 * monster sheet and its smaller copies are asked for with (`?v=`): the file's byte
 * size in base 36. The game server lets the browser keep a picture asked for with a
 * version for a week without checking back, so a repainted sheet needs a new one;
 * `monsterSpriteData.test.ts` fails when this is out of date.
 */
export const SHEET_VERSIONS: Readonly<Record<string, string>> = {{
{body}
}};
"""


def write_versions():
    VERSIONS_TS.write_text(versions_source(), encoding="utf8", newline="\n")
    print(f"wrote {VERSIONS_TS.relative_to(ROOT).as_posix()}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("sheets", nargs="*", help="painted sheets (name@4x.png); default: every repaint the game draws")
    parser.add_argument("--check", action="store_true", help="write nothing; exit 1 if a copy is missing or stale")
    args = parser.parse_args()
    sheets = [Path(s) for s in args.sheets] or [ASSETS / rel for rel in repaints()]
    if args.check:
        bad = [p for s in sheets for p in stale(s)]
        old = VERSIONS_TS.read_text(encoding="utf8") != versions_source()
        for p in bad:
            print(f"missing or stale: {p.name}")
        if old:
            print(f"out of date: {VERSIONS_TS.relative_to(ROOT).as_posix()}")
        sys.exit(1 if bad or old else 0)
    for s in sheets:
        make_copies(s, versions=False)
    write_versions()


if __name__ == "__main__":
    main()
