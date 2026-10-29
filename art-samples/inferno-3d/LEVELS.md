# Inferno tower levels (3D) — notes for wiring them into the game

The owner approved three looks per Inferno tower (29 Oct 2026): level 1 worn, level 2 Brimstone, level 3 Forged Steel,
**each taller than the last** (the height reads as a longer range). Not exported into the game yet.

Pieces per level (same layout as `t1/`; see `infpost.py` / `levelpost.py`):

| Tower | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Blast Tower | `t1/` | `t1-look2/` | `t1-look3/` |

**The turret pivot moves up per level.** The 3D turret top is at 1.75 / 2.0 / 2.25 units above the ground for the Blast
Tower's levels 1 / 2 / 3, so the turret strip must be placed per level, not once per tower. Use each level's own
`strip.json` (`pivot`, `strip_entry`, `body_entry`, `top_entry`, muzzle data), never level 1's for all three:

| Blast Tower | body_entry (game px) | pivot (game px) | strip at (game px) |
|---|---|---|---|
| Level 1 | (-47, -30) | (0, -20.83) | (-33.0, -53.83) |
| Level 2 | (-48, -40) | (0, -28.95) | (-33.0, -61.95) |
| Level 3 | (-47, -56) | (0, -37.07) | (-33.0, -70.07) |

The file names inside `strip.json` (`body.t1-look2@2x.png` etc.) are placeholders; rename them when exporting.
The footprint and the pivot's x stay the same on every level.

Rebuild: `INFERNO_LOOK=2|3 blender -b --factory-startup -P inferno3d.py -- T body|turret|aim|clash`, then
`python levelpost.py T` (writes the pieces and `levels-tT.png`).
