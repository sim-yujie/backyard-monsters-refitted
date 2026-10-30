# Inferno tower levels (3D) — notes for wiring them into the game

The owner approved three looks per Inferno tower (29 Oct 2026): level 1 worn, level 2 Brimstone, level 3 Forged Steel,
**each taller than the last** (the height reads as a longer range). Not exported into the game yet.

Pieces per level (same layout as `t1/`; see `infpost.py` / `levelpost.py`):

| Tower | Level 1 | Level 2 | Level 3 |
|---|---|---|---|
| Blast Tower | `t1/` | `t1-look2/` | `t1-look3/` |
| Sharpshooter | `t2/` | `t2-look2/` | `t2-look3/` |
| Magma Tower ("Volcanic") | `t3/` | `t3-look2/` | `t3-look3/` |

**The turret pivot moves up per level.** The 3D turret top is at 1.75 / 2.0 / 2.25 units above the ground for the Blast
Tower's levels 1 / 2 / 3 (Sharpshooter: 2.6 / 2.85 / 3.1; Magma Tower: 1.55 / 1.8 / 2.05), so the turret strip must be placed per level, not once per tower. Use each level's own
`strip.json` (`pivot`, `strip_entry`, `body_entry`, `top_entry`, muzzle data), never level 1's for all three:

| Blast Tower | body_entry (game px) | pivot (game px) | strip at (game px) |
|---|---|---|---|
| Level 1 | (-47, -30) | (0, -20.83) | (-33.0, -53.83) |
| Level 2 | (-48, -40) | (0, -28.95) | (-33.0, -61.95) |
| Level 3 | (-47, -56) | (0, -37.07) | (-33.0, -70.07) |

| Sharpshooter | body_entry (game px) | pivot (game px) | strip at (game px) |
|---|---|---|---|
| Level 1 | (-37, -56) | (-2, -51.44) | (-36.0, -82.44) |
| Level 2 | (-51, -64) | (-2, -59.56) | (-36.0, -90.56) |
| Level 3 | (-50, -72) | (-2, -67.68) | (-36.0, -98.68) |

| Magma Tower | body_entry (game px) | pivot (game px) | strip at (game px) |
|---|---|---|---|
| Level 1 | (-48, -26) | (2, -20.34) | (-31.0, -58.34) |
| Level 2 | (-48, -34) | (2, -28.46) | (-31.0, -66.46) |
| Level 3 | (-48, -44) | (2, -36.58) | (-31.0, -74.58) |

The Magma Tower is the "Volcanic" look the owner picked on 29 Oct (basalt columns in a lava basin, a pot of lava with a
goose-neck spout for a head; `build_magma_b`). It is the default for T=3 now; `MAGMA_DIR=A` builds the unpicked
"Furnace" (render/t3-dirA), `MAGMA_DIR=OLD` the earlier striped column (render/t3-old). Its turret is drawn 1.2x.

The upper levels' bodies are wider too (spikes round the foot), so use each level's body_entry as well.

The file names inside `strip.json` (`body.t1-look2@2x.png` etc.) are placeholders; rename them when exporting.
The footprint and the pivot's x stay the same on every level.

Rebuild: `INFERNO_LOOK=2|3 blender -b --factory-startup -P inferno3d.py -- T body|turret|aim|clash`, then
`python levelpost.py T` (writes the pieces and `levels-tT.png`).
