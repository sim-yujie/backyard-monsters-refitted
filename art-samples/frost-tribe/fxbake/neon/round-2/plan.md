# Krampus — Frost Aura (Round 2 Design Plan)

## The Idea

Krampus walks inside a living **creeping frost domain**: a sculpted patch of cracked glacial ice and snow-white rime under his hooves (`core_permafrost`), bridged by jagged mid-zone frost patches (`mid_frost_patch`) out to a full-reach ragged frost-front mist (`frost_zone_ring`) anchored by eight alternating 3D snow shelves and crystal-tooth banks (`rime_bank_wide` × 5, `rime_bank_crest` × 3) plus three sparse drifting snowflake clusters overhead (`frost_air_motes`). Because the jagged frost-front and sculpted rime banks trace the full reach organically—never a smooth drawn circle or isolated puddles—players tell in under a second that the cold belongs to Krampus and exactly which towers fall inside it, while every `held` piece uses `hold: 1` with slow glacial drift (`1.8–4.5 deg/s`) and gentle size breathing so it stays steady and restful across a 1–3 minute fight without ever fading out or obstructing monsters or buildings. Every piece draws with `blend: "normal"` (never `add`) using crisp snow-white and high-blue, low-green glacial cobalt/sapphire hues (`#7cb0ff`, `#4a84e8`, `#ffffff` over painted ice-blue), guaranteeing unmistakably frosty blue-and-white contrast over green grass with zero mint, teal, or lime shift.

When a tower enters the aura (`on_each`, 440 ms), a frost-mist ring expands around its base while a crisp 6-point crystalline snap-burst and three flying ice chips pop at its turret, locking an open-centered U-shaped icy visor and hanging icicle collar (`tower_frost_crown`) around the front of the turret (`held_each`) so blinded towers read at a glance—even at phone scale—while keeping cannon barrels and health bars unobstructed.

---

## Keyframe Table

### `held` — Continuous Frost Zone Around Krampus (16 pieces alive; 7 on low-effects)

| time ms | piece | where | size (world px) | motion | opacity | colour (Modern / Classic) | blend | layer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0–5600 (loop, `hold: 1`) | `frost_zone_ring` (1) | `caster_feet`, follow | `reach*0.96` ↔ `reach*1.00`, `squash: 0.5`, `pulse: true` | `spin_deg_s: 1.8` (glacial turn) | fade in 350 ms → steady `0.70` | `#7cb0ff` / `#7aa2d4` | `normal` | `ground` |
| 0–4000 (loop, `hold: 1`) | `core_permafrost` (1) | `caster_feet`, follow | `reach*0.29` ↔ `reach*0.31`, `squash: 0.5`, `pulse: true` | anchored under hooves, gentle breath | fade in 250 ms → steady `0.86` | `#ffffff` / `#ffffff` | `normal` | `ground` |
| 0–4400 (loop, `hold: 1`) | `rime_bank_wide` (5) | `caster_feet`, `ring: reach*0.48`, follow | `92` ↔ `102`, `pulse: true` | `orbit_deg_s: 2`, `phase_stagger: 0.2` | fade in 300 ms → steady `0.88` | `#ffffff` / `#ffffff` | `normal` | `ground` |
| 0–3800 (loop, `hold: 1`) | `rime_bank_crest` (3) | `caster_feet`, `ring: reach*0.43`, follow | `72` ↔ `80`, `pulse: true` | `orbit_deg_s: 2`, `phase_stagger: 0.333` | fade in 300 ms → steady `0.90` | `#ffffff` / `#ffffff` | `normal` | `ground` |
| 0–4800 (loop, `hold: 1`) | `mid_frost_patch` (3) | `caster_feet`, `ring: reach*0.26`, follow | `64` ↔ `70`, `pulse: true` | `orbit_deg_s: -1.8`, `phase_stagger: 0.333` | fade in 300 ms → steady `0.84` | `#ffffff` / `#ffffff` | `normal` | `ground` |
| 0–3400 (loop, `hold: 1`) | `frost_air_motes` (3) | `caster_feet`, `ring: reach*0.28`, `z: 20`, follow | `54` ↔ `60`, `pulse: true` | `orbit_deg_s: -4.5`, `spin_deg_s: 8`, `phase_stagger: 0.333` | fade in 300 ms → steady `0.88` | `#e4f0ff` / `#c8d8e8` | `normal` | `air` |

### `on_each` — Freeze-Snap When a Tower Enters the Aura (total 440 ms)

| time ms | piece | where | size (world px) | motion | opacity | colour (Modern / Classic) | blend | layer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0–420 | `frost_zone_ring` (1) | `tower_base` | `32` → `76`, `ease: out`, `squash: 0.5` | rapid ground cold-puff expansion | fade in 25 ms → `0.72` (`hold: 0.25`) → 0 | `#8ec0ff` → `#5c94ec` / `#8aaed6` → `#5c7ea6` | `normal` | `ground` |
| 0–360 | `frost_snap_burst` (1) | `tower_top`, offset `[0, 4]` | `20` → `72`, `ease: out` | `spin_deg_s: 20`, crisp starburst flash | fade in 20 ms → `0.90` (`hold: 0.25`) → 0 | `#f0f6ff` → `#88bcff` → `#4a84e8` / `#d8e4f0` → `#8caed4` → `#5476a0` | `normal` | `air` |
| 20–440 | `ice_chip_pop` (3) | `tower_top`, offset `[0, 4]`, `ring: 10` | `16` → `10` | `radial_speed: 55`, `vz: 48`, `gravity: 190`, `stagger_ms: 20`, `jitter: 0.3`, `spin_deg_s: 220` | fade in 15 ms → `0.95` (`hold: 0.5`) → 0 | `#ffffff` / `#ffffff` | `normal` | `air` |

### `held_each` — Blinded Tower Mark (1 piece per tower; max 8 towers = 8 pieces)

| time ms | piece | where | size (world px) | motion | opacity | colour (Modern / Classic) | blend | layer |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0–2600 (loop, `hold: 1`) | `tower_frost_crown` (1) | `tower_top`, offset `[0, 6]`, follow | `48` ↔ `52`, `pulse: true` | steady gentle frost-visor breath (fades out over 200 ms on exit) | fade in 180 ms → steady `0.92` | `#ffffff` / `#ffffff` | `normal` | `air` |

---

## Piece Budget & Readability Notes

- **Simultaneous pieces:** `16` (`held`) + up to `8` (`held_each` across 8 blinded towers) = **24 pieces max** (under the ~25 ceiling).
- **Low-effects fallback:** When repeated pieces drop to ~40%, the 1-count `frost_zone_ring` (full reach) and `core_permafrost` (Krampus anchor) remain 100% present alongside 2 wide edge banks, 1 crystal crest, 1 mid patch, and 1 snowflake cluster—preserving full reach readability.
- **Phone readability (390×844):** Solid edge banks (`72–102` world px), bold open-centered tower crowns (`48–52` world px), and high-contrast cobalt-and-white rime patches stay clear at half desktop scale.
- **Sheet note (`lights-sheet.jpg`):** Row 1 Col 1 (`frost_fern_frame`) is unused because its frost rim hugs the square cell edges; Row 2 Col 2 (`frost_zone_ring`) is a clean, ragged, open-centered frost-vapor halo with pure black margins on all sides and drives both the full-reach ground boundary and the tower-base snap puff.

---

## Classic Look Differences & `classic-sheet.jpg` Specification

Timing, motion, sizes, and `blend: "normal"` are **identical** between Modern and Classic; only art rendering and tints differ:

- **Palette & shading (Classic):** Muted, slightly dusty natural glacial slate-blue (`#6696cc`, `#4672ac`) and chalky snow-white (`#e2eaf2`) with deep near-black indigo-navy shadow undersides (`#162644`, `#0e182a`)—matching Krampus's horns in `refs/krampus-classic-ingame.png`. Soft grainy late-2000s 3ds Max pre-rendered 3D shading with a single soft upper-left key light and small soft highlights only on slick ice bevels; no glossy cartoon sheen, no neon glow, no outlines.
- **Tints (`tint_classic`):** Light-sheet pieces shift to slightly dustier slate-frost hues (`#7aa2d4` for the ground reach ring, `#c8d8e8` for air snowflakes, `#d8e4f0 → #8caed4 → #5476a0` for the tower snap burst). Solid pieces from `classic-sheet.jpg` use `tint_classic: ["#ffffff"]` so their pre-rendered muted Classic palette and deep navy shadows display cleanly without double-darkening.
- **Exact `classic-sheet.jpg` layout (matching `modern-sheet.jpg` cell for cell):**
  - **Format:** 3:2 landscape (1536×1024), invisible uniform **3 columns × 2 rows** grid (6 equal 512×512 square cells), flat pure magenta (`#FF00FF`) background, no grid lines, no text, no ground plane, no cast shadows, ≥12% empty magenta margin inside every cell.
  - **Row 1, Col 1 — `core_permafrost`:** Straight top-down chunky 3D cracked slate-blue ice slabs and chalky snow-white hoarfrost crust radiating into irregular jagged lobes with deep dark-navy cracks.
  - **Row 1, Col 2 — `rime_bank_wide`:** 35° isometric wide (~2:1) gently curved ground shelf of crusty chalky-white snow and chunky muted slate-blue ice facets with hanging icicle fringes and dark navy underside shadow.
  - **Row 1, Col 3 — `rime_bank_crest`:** 35° isometric (~1.5:1) compact cluster of 3–4 chunky angled slate-blue crystal teeth erupting out of a crusty chalky-white frost mound.
  - **Row 2, Col 1 — `mid_frost_patch`:** 35° isometric (~2:1) flat irregular branching patch of chalky snow-white rime crust and muted blue cracked ice shoots on the ground.
  - **Row 2, Col 2 — `tower_frost_crown`:** 35° isometric (~1.5:1) open-centered U-shaped front-arc icy visor collar with chalky snow rim, muted slate-blue faceted body, 5–6 hanging icicles along the front edge, small crystal shoulder spikes, and completely empty pure `#FF00FF` magenta inside the upper-center U-curve.
  - **Row 2, Col 3 — `ice_chip_pop`:** Single bold, chunky, angular 3D muted slate-blue ice crystal shard floating in mid-air with soft upper-left key light and deep navy shadow side.
