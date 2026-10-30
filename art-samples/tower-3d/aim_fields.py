"""aim_fields.py : put the aim data into the tiers' strip json files (tower-3d-game-brief, 28 Oct 2026).

The tower scripts' `aim` mode measures the model (no pictures) and writes render/<tier>/aim.json; the post.py scripts call
merge() when they write a strip json, and this file run on its own merges every tower's aim.json into the strip json files
already in the tier folders:

  python art-samples/tower-3d/aim_fields.py

Fields added (one entry per cell, in strip order; the Laser's tilt strip has [tilt][heading]):
  aim_deg     the on-screen direction the barrel (lens) points, degrees, 0 = right, 90 = down (atan2(dy, dx), screen px),
              from the barrel's base to its tip as projected on screen
  muzzle      [dx, dy], game px (1x), from the turning point (pivot) to the muzzle tip (the lens' middle) on screen
  ground_deg  the on-screen direction of the cell's heading on the ground (where the turret faces, ignoring the barrel's raise)
  aim_len     the barrel's base-to-tip length on screen, game px; when short, the barrel points nearly at (or away from) the
              viewer and aim_deg says little
"""
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
KEYS = ("aim_deg", "muzzle", "ground_deg", "aim_len")
NOTE = ("aim_deg: on-screen direction the barrel points (0 = right, 90 = down), measured from the 3D model; muzzle: [dx, dy] "
        "game px from the pivot to the muzzle tip on screen; ground_deg: on-screen direction of the cell's heading on the "
        "ground; aim_len: barrel length on screen in game px (short = pointing at or away from the viewer).")


def merge(path, aim, extra=None):
    """Add the aim fields (and any extra ones) to the json file at path, keeping its other fields."""
    path = Path(path)
    d = json.loads(path.read_text())
    d.update({k: aim[k] for k in KEYS})
    d["aim_note"] = NOTE
    d.update(extra or {})
    path.write_text(dumps(d))


def dumps(d):
    """json with indent 1, but lists of numbers kept on one line."""
    s = json.dumps(d, indent=1)
    return re.sub(r"\[[\s\d.,\-]*\]", lambda m: re.sub(r"\s+", "", m.group(0)).replace(",", ", "), s)


def main():
    A = HERE.parent
    for t in ("t1", "t1b", "t2", "t3"):
        merge(A / "cannon-3d" / t / "strip32.json", json.loads((A / "cannon-3d/render" / t / "aim.json").read_text()))
    for t in ("t1", "t2", "t3"):
        merge(A / "sniper-3d" / t / "strip.json", json.loads((A / "sniper-3d/render" / t / "aim.json").read_text()))
        aim = json.loads((A / "laser-3d/render" / t / "aim.json").read_text())
        merge(A / "laser-3d" / t / "strip32.json", aim["h32"])
        merge(A / "laser-3d" / t / "strip54.json", aim["c54"])
    print("merged")


if __name__ == "__main__":
    main()
