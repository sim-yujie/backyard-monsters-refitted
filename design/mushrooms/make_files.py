"""Bakes every mushroom option into yard pictures (mushroom + its shadow, anchored at its foot) and installs
the chosen one per look into the game.

    python -I make_files.py                       # all options -> options/<look>-<x>/v1..v6 (+ anchors.json)
    python -I make_files.py --install classic-a modern-a   # also writes the game files, prints the TS table

Options:
  classic-a  Flash's own mushrooms (client/images 1683..1693) with Flash's own shadows (1670..1680), 1x.
  classic-b  Codex, Flash style, each group its own natural cap colour (c2/), Flash's shadows, 2x.
  classic-c  Codex, Flash style, red toadstools (c3/), Flash's shadows, 2x.
  modern-a   Codex, Modern look of Flash's six (m1/), the Modern decorations' cast shadow, 2x.
  modern-b   Codex, Modern, each group its own natural cap colour (m2/), 2x.
  modern-c   Codex, Modern, red toadstools (m3/), 2x.
A picture's anchor is the mushroom's spot in the yard: the foot of its stalk(s).
"""
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageChops

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, "C:/Coding/BYMR/backyard-monsters-refitted/.claude/skills/game-art/scripts")
import make_game_files as mgf  # noqa: E402
from mushlib import bake, fit_shadow, foot, shadow_alpha  # noqa: E402

REPO = HERE.parent.parent
ASSETS = REPO / "server" / "public" / "assets" / "buildings" / "mushrooms"
# Modern decorations cast a sheared shadow (make_game_files.py); on a mushroom it fell faint and off to one side,
# so both looks use Flash's own mushroom shadows (a contact blob per stalk), fitted under each group.
CAST_SHADOW = False
VARIANTS = range(1, 7)  # Flash drew 1..5 (`MUSHROOMS.as:166`); 6, its tall one, only on the sheets

OPTIONS = {
    "classic-a": ("flash", 1),
    "classic-b": ("c2", 2),
    "classic-c": ("c3", 2),
    "modern-a": ("m1", 2),
    "modern-b": ("m2", 2),
    "modern-c": ("m3", 2),
}


def flash_shadow(i, scale):
    s = shadow_alpha(HERE / "flash" / f"shadow-{i}.jpg")
    return s if scale == 1 else s.resize((s.width * scale, s.height * scale), Image.LANCZOS)


def cast_shadow(top, scale):
    """The Modern decorations' shadow (game-art make_game_files.py), made at the picture's own scale."""
    one = top.resize((top.width // scale, top.height // scale), Image.LANCZOS) if scale > 1 else top
    mask, sx, sy = mgf.shadow_mask(one.getchannel("A"), dark=mgf.YARD_DARK, blur_px=mgf.YARD_BLUR,
                                   floor=mgf.YARD_FLOOR)
    if scale > 1:
        mask = mask.resize((mask.width * scale, mask.height * scale), Image.LANCZOS)
    black = Image.new("RGBA", mask.size, (0, 0, 0, 0))
    black.putalpha(mask)
    # Offset of the shadow's top-left from the top's top-left (sx, sy are from the art's bottom-left).
    return black, sx * scale, top.height + sy * scale


def build(name):
    src, scale = OPTIONS[name]
    out = HERE / "options" / name
    out.mkdir(parents=True, exist_ok=True)
    anchors = {}
    for i in VARIANTS:
        if src == "flash":
            top = Image.open(HERE / "flash" / f"mushroom-{i}.png").convert("RGBA")
        else:
            p = HERE / src / "out" / f"v{i}@2x.png"
            if not p.exists():
                return None
            top = Image.open(p).convert("RGBA")
        f = foot(top)
        if CAST_SHADOW and name.startswith("modern"):
            shadow, dx, dy = cast_shadow(top, scale)
        else:
            shadow = flash_shadow(i, scale)
            # Fit at 1x (Flash's shadow belongs to Flash's own picture of the same group), then scale up.
            small = top if scale == 1 else top.resize((top.width // scale, top.height // scale), Image.LANCZOS)
            dx, dy = fit_shadow(small, shadow_alpha(HERE / "flash" / f"shadow-{i}.jpg"))
            dx, dy = dx * scale, dy * scale
        pic, ax, ay = bake(top, shadow, f, (f[0] - dx, f[1] - dy))
        suffix = "@2x" if scale == 2 else ""
        pic.save(out / f"v{i}{suffix}.png")
        # In game px: the picture's top-left relative to the mushroom's spot.
        anchors[i] = {"file": f"v{i}{suffix}.png", "x": -ax / scale, "y": -ay / scale,
                      "w": pic.width / scale, "h": pic.height / scale,
                      "top": [-f[0] / scale, -f[1] / scale, top.width / scale, top.height / scale]}
    (out / "anchors.json").write_text(json.dumps(anchors, indent=1))
    return anchors


def install(name, anchors):
    look = name.split("-")[0]
    src, scale = OPTIONS[name]
    ASSETS.mkdir(parents=True, exist_ok=True)
    rows = []
    for i in range(1, 6):
        a = anchors[i]
        pic = Image.open(HERE / "options" / name / a["file"]).convert("RGBA")
        if scale == 2:
            fname = f"{look}-{i}@2x.webp"
            pic.save(ASSETS / fname, lossless=False, quality=92, method=6, alpha_quality=100)
        else:
            fname = f"{look}-{i}.png"
            pic.save(ASSETS / fname, optimize=True)
        rows.append(f'  ["{fname}", {a["x"]:g}, {a["y"]:g}],')
    print(f"{look} ({name}):")
    print("\n".join(rows))


def main():
    want = sys.argv[sys.argv.index("--install") + 1:] if "--install" in sys.argv else []
    built = {}
    for name in OPTIONS:
        a = build(name)
        print(name, "built" if a else "skipped (no cut yet)")
        if a:
            built[name] = a
    for name in want:
        install(name, built[name])


if __name__ == "__main__":
    main()
