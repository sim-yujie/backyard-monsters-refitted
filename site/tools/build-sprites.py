"""
Cuts the website's animated monster strips out of the game's repainted sprite
sheets (server/public/assets/monsters/*@4x.png).

Each output is one horizontal strip of equal frames, played in CSS by sliding
the strip one frame at a time (steps()). Two kinds:

- spin-<id>.webp: the monster turning a full circle (every second heading),
  flapping as it turns if it flies. Used on the "Meet the monsters" cards.
- walk-<id>.webp: the walk (or flap) cycle facing right. Used in the hero.

Sheet layout, from web/src/game/attack/monsterSprites.ts: columns are headings
clockwise from "moving right"; the animated repaints have 12 rows (0 idle,
1-6 walk, 7-11 attack); flyers have 3 wing rows. Cells are 4x the Flash size.

Run from site/:  python tools/build-sprites.py
"""

import json
from pathlib import Path

from PIL import Image

SHEETS = Path(__file__).resolve().parents[2] / "server" / "public" / "assets" / "monsters"
OUT = Path(__file__).resolve().parents[1] / "public" / "images" / "sprites"
# Frame sizes for the Sprite component, so the page knows each strip's layout.
MANIFEST = Path(__file__).resolve().parents[1] / "src" / "data" / "sprites.json"

# id: (sheet, cell width, cell height, columns, kind); sizes are the @4x cells.
MONSTERS = {
    "C1": ("pokey-anim", 144, 116, 30, "walker"),
    "C2": ("octo-anim", 220, 144, 30, "walker"),
    "C3": ("bolt-repaint", 120, 112, 30, "still"),
    "C4": ("fink-repaint", 136, 128, 30, "still"),
    "C5": ("eyera-repaint", 104, 92, 30, "still"),
    "C6": ("ichi-repaint", 108, 104, 30, "still"),
    "C7": ("bandito-anim", 164, 160, 30, "walker"),
    "C8": ("fang-repaint", 136, 124, 30, "still"),
    "C9": ("brain-repaint", 136, 96, 30, "still"),
    "C10": ("crabatron-repaint", 148, 108, 30, "still"),
    "C14": ("14-repaint", 112, 112, 32, "flyer"),
    "C16": ("vorg-repaint", 160, 160, 32, "flyer"),
}

# The hero parade: these walk (or fly) across the bottom of the hero.
WALKERS = ["C1", "C2", "C7", "C14"]

MAX_HEIGHT = 100  # px; frames are scaled down to this if taller after cropping
WALK_MAX_HEIGHT = 160  # the hero shows the walkers bigger, and there are only a few frames
SPIN_STEP = 2  # use every second heading: half the bytes, still a smooth turn
PAD = 3


def row_for(kind: str, i: int) -> int:
    if kind == "walker":
        return 1 + i % 6
    if kind == "flyer":
        return i % 3
    return 0


def strip(sheet: Image.Image, w: int, h: int, cells: list[tuple[int, int]], name: str, max_height: int) -> dict:
    frames = [sheet.crop((c * w, r * h, c * w + w, r * h + h)) for c, r in cells]
    # One crop box for every frame, so the monster does not jump around.
    boxes = [f.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox() for f in frames]
    boxes = [b for b in boxes if b]
    box = (
        max(min(b[0] for b in boxes) - PAD, 0),
        max(min(b[1] for b in boxes) - PAD, 0),
        min(max(b[2] for b in boxes) + PAD, w),
        min(max(b[3] for b in boxes) + PAD, h),
    )
    frames = [f.crop(box) for f in frames]
    fw, fh = frames[0].size
    if fh > max_height:
        scale = max_height / fh
        fw, fh = round(fw * scale), max_height
        frames = [f.resize((fw, fh), Image.LANCZOS) for f in frames]
    out = Image.new("RGBA", (fw * len(frames), fh))
    for i, f in enumerate(frames):
        out.paste(f, (i * fw, 0))
    path = OUT / f"{name}.webp"
    out.save(path, quality=70, method=6, alpha_quality=80)
    print(f"{path.name}: {len(frames)} frames of {fw}x{fh}, {path.stat().st_size // 1024} KB")
    return {"frames": len(frames), "width": fw, "height": fh}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for mid, (file, w, h, cols, kind) in MONSTERS.items():
        sheet = Image.open(SHEETS / f"{file}@4x.png").convert("RGBA")
        # Start facing the viewer (down the screen, a quarter turn from "right")
        # and turn clockwise all the way round.
        start = cols // 4
        # Walkers turn in their idle pose (a walk cycle mid-turn reads as jitter);
        # flyers keep flapping.
        spin_kind = "still" if kind == "walker" else kind
        spin = [((start + i * SPIN_STEP) % cols, row_for(spin_kind, i)) for i in range(cols // SPIN_STEP)]
        manifest[f"spin-{mid}"] = strip(sheet, w, h, spin, f"spin-{mid}", MAX_HEIGHT)
        if mid in WALKERS:
            count = 6 if kind == "walker" else 3
            cells = [(0, row_for(kind, i)) for i in range(count)]
            manifest[f"walk-{mid}"] = strip(sheet, w, h, cells, f"walk-{mid}", WALK_MAX_HEIGHT)
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
