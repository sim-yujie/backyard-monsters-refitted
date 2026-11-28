The **solid crystal marks** should stay **steady** for the full duration (fade in once on entry, stay at `peak` with only the size `pulse` breathing, then fade out over 200 ms when the debuff ends), while the **mist/flurry layers** are meant to **fade in and out** each loop so they drift and shimmer over the steady ice.

Exact values for the four pieces:

- **`blizzardStomp.held` → `tower_ice_clamp` (steady):** set `"hold": 1` (keep `"peak": 0.95`, `"size": [72, 76]`, `"pulse": true`; apply `"fade_in_ms": 140` once on entry only—or set `"fade_in_ms": 0` if your loop always re-runs `fade_in_ms` every cycle).
- **`blizzardStomp.held` → `frost_wisp_puff` (keep fading):** keep `"hold": 0.45`, `"peak": 0.48`, and soften `"fade_in_ms": 300` (from `160`) so the mist swells and dissipates smoothly over the solid clamp.
- **`iceShards.held` → `flyer_chill_crystals` (steady):** set `"hold": 1` (keep `"peak": 0.92`, `"size": [48, 54]`, `"pulse": true`; apply `"fade_in_ms": 120` once on entry only—or `"fade_in_ms": 0` if `fade_in_ms` repeats per loop).
- **`iceShards.held` → `snow_flurry_cluster` (keep fading):** keep `"hold": 0.45`, `"peak": 0.62`, `"phase_stagger": 0.5` (the two orbiting copies alternate so there is no dead frame), and soften `"fade_in_ms": 200` (from `120`).
exit 0
