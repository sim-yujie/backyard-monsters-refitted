"""export_sniper.py : exports only the Sniper's three 3D tiers into the game (square body, 2 Nov 2026).

    python -I art-samples/sniper-3d/export_sniper.py

web/tools/tower-tiers/export3d.py rewrites turretAimData.ts whole, so it needs every tower's rendered pieces. This runs
its `export` for the Sniper alone (pictures into server/public/assets/buildings/snipertower/), prints the rows for
buildingArtTiers.ts, and replaces only the "21.t1"-"21.t3" entries of turretAimData.ts (formatted with prettier).
"""
import json
import re
import runpy
import subprocess
import sys
from pathlib import Path

WT = Path(__file__).resolve().parents[2]
sys.argv = ["export3d.py", str(WT), "sniper"]
X = runpy.run_path(str(WT / "web" / "tools" / "tower-tiers" / "export3d.py"), run_name="export3d")
lines = []
for tier in (1, 2, 3):
    row, aim = X["export"]("sniper", tier, write=True)
    print(json.dumps(row))
    lines.append(f'  "21.t{tier}": {json.dumps(aim, separators=(", ", ": "))},')
aim_ts = Path(X["AIM_TS"])
tmp = aim_ts.with_name("_sniper_aim_tmp.ts")
tmp.write_text(X["AIM_HEAD"] + "\n".join(lines) + "\n} satisfies Readonly<Record<string, TurretAim>>;\n", encoding="utf-8")
subprocess.run(["npx", "prettier", "--write", str(tmp)], cwd=WT / "web", check=True, shell=True, capture_output=True)
new = tmp.read_text(encoding="utf-8")
tmp.unlink()
block = re.search(r'^  "21\.t1": \{.*?^  "21\.t3": \{.*?^  \},\n', new, re.S | re.M).group(0)
old = aim_ts.read_text(encoding="utf-8")
pat = re.compile(r'^  "21\.t1": \{.*?^  "21\.t3": \{.*?^  \},\n', re.S | re.M)
assert len(pat.findall(old)) == 1
aim_ts.write_text(pat.sub(lambda m: block, old), encoding="utf-8")
print("# replaced 21.t1-21.t3 in", aim_ts.name)
