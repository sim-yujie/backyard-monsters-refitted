# Krampus Frost Abilities — VFX Design Plan

This document specifies the animations and sprite-sheet art for Krampus's three frost abilities (**Frost Aura**, **Ice Shards**, and **Blizzard Stomp**) in both the **Modern** and **Classic** looks. All exact runtime timings and piece definitions live in `motion.json`; sprite-sheet cell mappings live in `cells.json`.

## Shared Design Conventions

- **Scale convention (`reach`)**: `"reach"` equals the ability's full ground diameter (so `"reach*0.5"` is the outer radius on the 2:1 ground ellipse, e.g., 280–425 world px for Frost Aura and ~160 world px for Blizzard Stomp).
- **Isometric ground pieces**: All top-down ground pieces (`ground_frost_star`, `stomp_ice_crater`, `frost_ground_patch`, `gathering_frost_vortex`, `impact_starburst`, `frost_shock_arc`, `aura_wind_arc`) are painted round (1:1) inside their 4×4 grid cells for maximum detail and clean perspective spinning, then laid flat on the ground via `squash: 0.5`.
- **Distinct tower status silhouettes**: Frost Aura (*blinds* sight) marks **`tower_top`** with an icy visor/icicle shroud and swirling cold fog; Blizzard Stomp (*slows* attack rate) marks **`tower_base`** with heavy jagged glacier clamps gripping the building's foot. Players read both states independently even when stacked on the same tower.
- **Phone readability**: Every silhouette uses bold, chunky crystalline shapes and clear dark-vs-light value separation against green grass so effects remain unmistakable at ~0.5x mobile scale (390×844 portrait).
- **Modern vs. Classic**: Timing, piece counts, and motion are **identical** across both looks.
  - **Modern** uses `modern-sheet.jpg` (crisp bevelled 3D translucent glacial cyan/sapphire/snow-white crystals matching Krampus's horns, warm upper-left key light, bright specular highlights, no outlines) plus `lights-sheet.jpg` rendered with `blend: "add"` and crisp luminous icy tints (`#ffffff` → `#8ee8ff` → `#38b2ff`), screen shake on Blizzard Stomp, and additive flash overlays.
  - **Classic** swaps to `classic-sheet.jpg` (late-2000s 3ds Max pre-rendered 3D style: soft grainy shading, muted dusty glacier blue `#5d8aa8`–`#3a5a74`, chalky off-white snow `#d0dae0`, deep near-black `#111c28` undersides, no outlines, no cartoon gloss) and renders `lights-sheet.jpg` with `blend: "normal"` and muted dusty frost `tint_classic` ramps (`#dce8f0` → `#98b8cc` → `#688ca6`) so mist, wind ribbons, and bursts read by value contrast rather than glow; Classic omits screen shake.

---

## 1. Frost Aura (Always-on Passive — Blinds Towers, Slows Defenders)

### Design Idea
Instead of a plain geometric circle, Krampus carries a living pocket of Arctic winter: a jagged, asymmetrical crystalline frost star creeping slowly beneath his hooves, five feathery curved snow-wind crescents sweeping organically around the outer reach with clear breathing gaps, and three drifting air-level diamond-dust flurries orbiting slowly above the grass. The broken, moving wind front lets the player gauge the aura's approximate reach in under a second while staying calm, transparent, and readable across an entire battle. Whenever a tower falls inside the cold front, a sharp frost-bloom snaps over its turret (`on_each`) and locks into a sculpted hanging-icicle frost shroud and gently swirling cold haze (`held_each`) right over its "eyes" (`tower_top`), unmistakably telegraphing reduced sight.

- **Piece budget**: 9 pieces on Krampus + 2 pieces per affected tower = **25 pieces max** at 8 towers (within the 25-piece cap).
- **One-shot `on_each` duration**: 480 ms (< 600 ms limit).

### Keyframe Timeline

| Hook / Time (ms) | Piece | Where | Size (world px) | Motion | Opacity | Colour (Modern / Classic) | Blend (Mod / Cls) | Layer |
|---|---|---|---|---|---|---|---|---|
| `held` loop 3600 ms | `ground_frost_star` (1) | `caster_feet` (follow) | `reach*0.30` ↔ `reach*0.34` (pulse, squash 0.5) | Spin 6°/s | Fade-in 300 ms, peak 0.58, hold 0.6 | Solid art (`#ffffff`) | `normal` / `normal` | `ground` |
| `held` loop 2800 ms | `aura_wind_arc` (5, ring `reach*0.46`) | `caster_feet` (follow) | 170 ↔ 210 (pulse, squash 0.5) | Orbit 15°/s, spin 15°/s, phase stagger 0.2 | Fade-in 300 ms, peak 0.50, hold 0.4 | `#dff9ff→#7ee0ff→#48b6f5` / `#d6e4ec→#96b8ce→#7094ae` | `add` / `normal` | `ground` |
| `held` loop 2400 ms | `snow_flurry_cluster` (3, ring `reach*0.25`, z=18) | `caster_feet` (follow) | 72 ↔ 94 (pulse) | Orbit −22°/s, spin 18°/s, phase stagger 0.333 | Fade-in 250 ms, peak 0.52, hold 0.45 | `#f4fdff→#b5eeff→#7bd6ff` / `#e0eaf0→#b2cad8→#8caac0` | `add` / `normal` | `air` |
| `on_each` 0–400 ms | `frost_snap_burst` (1) | `tower_top` | 22 → 88 (ease out) | Spin 28°/s | Fade-in 25 ms, peak 0.85, hold 0.25 | `#ffffff→#8ee8ff→#3ca8f0` / `#e0ecf4→#98bbd0→#688ca6` | `add` / `normal` | `air` |
| `on_each` 20–480 ms | `ice_shard_chip` (3, ring 14) | `tower_top` | 16 → 11 | Radial 68 px/s, vz 52, grav 200, spin 260°/s, stagger 20 ms, jitter 0.35 | Fade-in 20 ms, peak 0.95, hold 0.5 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `held_each` loop 1800 ms | `tower_blind_shroud` (1) | `tower_top` offset `[0, 2]` | 54 ↔ 60 (pulse) | Stationary subtle breath | Fade-in 220 ms, peak 0.88, hold 0.7 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `held_each` loop 2200 ms | `cold_mist_swirl` (1) | `tower_top` offset `[0, -2]` | 50 ↔ 62 (pulse) | Spin 32°/s | Fade-in 220 ms, peak 0.45, hold 0.5 | `#dcf8ff→#88dfff→#56bff5` / `#cedee8→#94b4c8→#7494aa` | `add` / `normal` | `air` |

**Classic differences**: `ground_frost_star`, `tower_blind_shroud`, and `ice_shard_chip` swap to the chunky unoutlined 3ds Max pre-rendered Classic art with deep slate shadows; `aura_wind_arc`, `snow_flurry_cluster`, `frost_snap_burst`, and `cold_mist_swirl` draw in `normal` blend with desaturated dusty-ice `tint_classic` palettes so they read as cool frosty mist over the grass rather than glowing light.

---

## 2. Ice Shards (Levels 4–6 — Anti-Air Volley, 200 ms Flight, 2 s Chill)

### Design Idea
Instead of a single pale dot, Krampus violently shears a lethal three-shard crystal volley straight off his glowing ice horns: a bright horn flare and splinter chips snap at `caster_head` (`launch`), launching one bold barbed crystal ice spear flanked by two staggered crystal daggers in a 24° fan, tied together by a razor-sharp frost slipstream and snow-gust wake (`pieces`, 200 ms flight) so the eye instantly connects Krampus to the flyer. On hit (`impact`), a 4-frame hand-animated ice-shatter flipbook explodes over the flyer alongside a spiky starburst flash, needle sparks, six tumbling crystal chips, and a physical squash-and-flash flinch (`body_target`), leaving jagged crystal encrustation and shivering snow motes clinging to the chilled flyer (`held`) for 2 s.

- **One-shot duration**: 200 ms flight + 340 ms impact = **540 ms total** (< 600 ms budget, clears cleanly before the next 700 ms volley).
- **Peak simultaneous pieces**: ~15 pieces (well below the 40-piece cap).

### Keyframe Timeline

*(Launch and flight times count from throw `0 ms`; impact and `body_target` times count from landing at `200 ms`.)*

| Hook / Time (ms) | Piece | Where | Size (world px) | Motion | Opacity | Colour (Modern / Classic) | Blend (Mod / Cls) | Layer |
|---|---|---|---|---|---|---|---|---|
| `launch` 0–170 ms | `horn_frost_flare` (1) | `caster_head` (follow) | 22 → 74 (ease out) | Spin 60°/s | Fade-in 15 ms, peak 0.95, hold 0.2 | `#ffffff→#9ef0ff→#38b4ff` / `#e6f0f6→#a2c2d6→#7094ae` | `add` / `normal` | `air` |
| `launch` 10–210 ms | `ice_shard_chip` (3, ring 8) | `caster_head` | 14 → 10 | Radial 85 px/s, vz 60, grav 240, spin 320°/s, stagger 12 ms, jitter 0.4 | Fade-in 15 ms, peak 0.95, hold 0.45 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `pieces` 0–200 ms | `ice_spear_main` (1) | `caster_head` → `target` | 48 → 56 (ease out) | `fly_to: target`, arc 10 px, `face_flight` | Fade-in 20 ms, peak 1.0, hold 0.9 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `pieces` 0–200 ms | `ice_shard_flank` (2, spread 24°) | `caster_head` → `target` | 32 → 36 (ease out) | `fly_to: target`, arc 16 px, `face_flight`, stagger 16 ms | Fade-in 20 ms, peak 0.95, hold 0.85 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `pieces` 0–200 ms | `frost_streak` (1) | `caster_head` → `target` | 68 → 86 (ease out) | `fly_to: target`, arc 10 px, `face_flight` | Fade-in 20 ms, peak 0.85, hold 0.7 | `#eefcff→#7ce2ff→#2ca0f0` / `#dce8f0→#9cbcd0→#6c90aa` | `add` / `normal` | `air` |
| `pieces` 15–215 ms | `blizzard_gust_plume` (1) | `caster_head` → `target` | 36 → 52 (ease out) | `fly_to: target`, arc 12 px, `face_flight` | Fade-in 20 ms, peak 0.55, hold 0.35 | `#dff8ff→#88ddff→#4ab2f0` / `#d2e0ea→#94b4c8→#6c8ea6` | `add` / `normal` | `air` |
| `impact` 0–180 ms | `impact_starburst` (1) | `target` (follow) | 28 → 102 (ease out) | Spin 35°/s | Fade-in 12 ms, peak 1.0, hold 0.2 | `#ffffff→#a8f2ff→#40b6ff` / `#e8f2f8→#a4c4d8→#7498b2` | `add` / `normal` | `air` |
| `impact` 0–260 ms | Flipbook `shatter_1..4` (1) | `target` (follow) | 54 → 86 (ease out) | 4-frame shatter burst over 260 ms | Fade-in 15 ms, peak 1.0, hold 0.6 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `impact` 10–250 ms | `snow_spark_burst` (1) | `target` | 26 → 94 (ease out) | Expanding radial spray | Fade-in 15 ms, peak 0.85, hold 0.25 | `#ffffff→#9ceeff→#50c0ff` / `#e0ecf4→#a0c0d4→#7094ae` | `add` / `normal` | `air` |
| `impact` 0–340 ms | `ice_shard_chip` (6, ring 8) | `target` | 18 → 12 | Radial 145 px/s, vz 95, grav 360, drag 0.25, spin 420°/s, stagger 8 ms, jitter 0.45 | Fade-in 15 ms, peak 1.0, hold 0.55 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `impact` 20–330 ms | `frost_wisp_puff` (1) | `target` | 36 → 86 (ease out) | Spin 40°/s | Fade-in 25 ms, peak 0.65, hold 0.2 | `#e4faff→#8ce2ff→#48b0f0` / `#d6e4ee→#98b8cc→#7092aa` | `add` / `normal` | `air` |
| `impact` 0–210 ms | `body_target` flinch + flash | `target` | Squash `1.24×0.78` at 35 ms → rebound `0.90×1.12` at 115 ms → `1.0×1.0` at 210 ms | Recoil squash-and-stretch | Flash peak 0.85, 150 ms | `#ccf6ff` flash | `add` / `normal` | target sprite |
| `held` loop 900 ms | `flyer_chill_crystals` (1) | `target` (follow) | 48 ↔ 54 (pulse) | Rides with chilled flyer | Fade-in 120 ms, peak 0.92, hold 0.7 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `held` loop 800 ms | `snow_flurry_cluster` (2, ring 14) | `target` (follow) | 34 ↔ 44 (pulse) | Orbit 55°/s, phase stagger 0.5 | Fade-in 120 ms, peak 0.62, hold 0.45 | `#eefcff→#9aeaff→#5cc8ff` / `#dce8f0→#a2c0d4→#7a9cb4` | `add` / `normal` | `air` |

**Classic differences**: The spears, 4-frame shatter burst, flying chips, and flyer chill crystals use the chunky, faceted dusty-blue 3ds Max Classic renders (matching the physical weight of the original 2009 flying rock chips); slipstream streaks and impact bursts switch to `normal` blend with chalky muted-blue `tint_classic` values so the trajectory still pops cleanly against grass and towers.

---

## 3. Blizzard Stomp (Levels 5–6 — Arctic Ground Slam, Slows Towers 30% for 3 s)

### Design Idea
Replacing Korath's orange rings and plain blue circles, Blizzard Stomp plays as a heavy three-beat Arctic earthquake. During Krampus's 600 ms rear-up (`-600` to `0 ms`), a swirling frost vortex contracts sharply inward toward his hooves while ice splinters lift off the ground and cold power flares in his chest, telegraphing the incoming slam. At `0 ms`, Krampus slams down with a crunching body squash, flash, and 5 px camera thump: a jagged shattered-lake ice crater bursts across the full 160 px blast zone, a broken crystalline frost shockwave and 4-frame swirling blizzard squall erupt outward, eight staggered 3D glacier spikes (5 tall outer + 3 broad inner) tear upward out of the dirt, and six heavy snow-capped ice boulders fly through the air and tumble across the grass. Every slowed tower gets snapped with a freezing base burst (`on_each`) and locked in heavy jagged ice clamps around its foot with sluggish drifting chill mist (`held`) for 3 s.

- **One-shot duration**: `-600 ms` to **`+1250 ms`** (< 1400 ms post-slam limit).
- **Peak simultaneous pieces**: 25 stomp pieces + 2 per affected tower (stays <= 39 even with 7 towers inside the 160 px radius; well under the 40-piece cap).

### Keyframe Timeline

*(Time `0 ms` is the hoof SLAM; negative times run during Krampus's 600 ms rear-up.)*

| Hook / Time (ms) | Piece | Where | Size (world px) | Motion | Opacity | Colour (Modern / Classic) | Blend (Mod / Cls) | Layer |
|---|---|---|---|---|---|---|---|---|
| `pieces` −600–0 ms | `gathering_frost_vortex` (1) | `caster_feet` | `reach*0.72` → `reach*0.18` (ease out, squash 0.5) | Inward contraction, spin 150°/s | Fade-in 120 ms, peak 0.68, hold 0.65 | `#7ee2ff→#ccf7ff→#ffffff` / `#7a9eb6→#a8c6da→#dce8f0` | `add` / `normal` | `ground` |
| `pieces` −480–0 ms | `ice_shard_chip` (6, ring `reach*0.24`) | `caster_feet` | 14 → 20 | Inward pull −42 px/s, vz 54, grav 35, spin 190°/s, stagger 30 ms, jitter 0.35 | Fade-in 100 ms, peak 0.85, hold 0.7 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `pieces` −260–20 ms | `horn_frost_flare` (1) | `caster_chest` (follow) | 20 → 74 (ease out) | Spin −90°/s | Fade-in 120 ms, peak 0.78, hold 0.35 | `#88e4ff→#e8fbff→#ffffff` / `#8aaec6→#bad4e4→#e0ecf4` | `add` / `normal` | `air` |
| `pieces` 0–1250 ms | `stomp_ice_crater` (1) | `caster_feet` | `reach*0.36` → `reach*0.98` (ease out, squash 0.5) | Shattered ground crater expansion | Fade-in 30 ms, peak 0.94, hold 0.58 | Solid art (`#ffffff`) | `normal` / `normal` | `ground` |
| `pieces` 0–300 ms | `impact_starburst` (1) | `caster_feet` | 44 → `reach*0.86` (ease out, squash 0.5) | Fast ground slam flash | Fade-in 15 ms, peak 0.95, hold 0.15 | `#ffffff→#9ef0ff→#38b2ff` / `#eaf4fa→#a8c8dc→#7296b0` | `add` / `normal` | `ground` |
| `pieces` 0–480 ms | `frost_shock_arc` (1) | `caster_feet` | `reach*0.24` → `reach*1.04` (ease out, squash 0.5) | Jagged shock ring, spin 18°/s | Fade-in 20 ms, peak 0.90, hold 0.25 | `#ffffff→#88e6ff→#2ca4f2` / `#e4f0f6→#9cbcd0→#688ca6` | `add` / `normal` | `ground` |
| `pieces` 10–690 ms | Flipbook `blizzard_swirl_1..4` (1) | `caster_feet` | `reach*0.30` → `reach*1.06` (ease out, squash 0.55) | 4-frame expanding blizzard squall, spin 45°/s | Fade-in 25 ms, peak 0.78, hold 0.35 | `#eefcff→#90e4ff→#46b2f2` / `#dce8f0→#9ebed2→#6e92ac` | `add` / `normal` | `air` |
| `pieces` 20–760 ms | `stomp_ice_spire` (5, ring `reach*0.38`) | `caster_feet` | 34 → 62 (ease out) | Radial 48 px/s, drag 0.45, stagger 18 ms, jitter 0.25 | Fade-in 40 ms, peak 1.0, hold 0.48 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `pieces` 35–695 ms | `stomp_ice_spire_alt` (3, ring `reach*0.22`) | `caster_feet` | 30 → 52 (ease out) | Radial 35 px/s, drag 0.5, stagger 22 ms, jitter 0.35 | Fade-in 40 ms, peak 0.98, hold 0.45 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `pieces` 10–790 ms | `ice_chunk_debris` (6, ring 22) | `caster_feet` | 24 → 18 | Radial 170 px/s, vz 165, grav 480, drag 0.2, spin 340°/s, stagger 12 ms, jitter 0.4 | Fade-in 20 ms, peak 1.0, hold 0.65 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `pieces` 40–800 ms | `frost_wisp_puff` (4, ring `reach*0.26`) | `caster_feet` | 48 → 92 (ease out) | Radial 145 px/s, drag 0.65, vz 38, spin 36°/s, stagger 16 ms, jitter 0.3 | Fade-in 35 ms, peak 0.62, hold 0.25 | `#e8fbff→#8ee2ff→#48b2f0` / `#d6e4ee→#98b8cc→#7092aa` | `add` / `normal` | `air` |
| `pieces` 90–1210 ms | `frost_ground_patch` (3, ring `reach*0.36`) | `caster_feet` | 64 → 78 (ease out, squash 0.5) | Lingering frozen turf islands, jitter 0.4 | Fade-in 80 ms, peak 0.68, hold 0.5 | Solid art (`#ffffff`) | `normal` / `normal` | `ground` |
| `shake` 0–280 ms | Camera shake | Viewport | 5 px max amplitude | Damped slam shake (Modern only) | — | — | Modern only | screen |
| `body` 0–240 ms | Krampus slam squash + flash | Krampus sprite | `0.94×1.08` (0 ms) → `1.24×0.76` (25 ms) → `0.96×1.05` (125 ms) → `1.0×1.0` (240 ms) | Heavy forefoot impact squash | Flash peak 0.65, 220 ms | `#ccf6ff` flash | `add` / `normal` | caster sprite |
| `on_each` 0–360 ms | `frost_snap_burst` (1) | `tower_base` | 30 → 102 (ease out, squash 0.55) | Base freeze clamp shock | Fade-in 20 ms, peak 0.88, hold 0.2 | `#ffffff→#90e8ff→#38aef5` / `#e0ecf4→#9abbd0→#688ca6` | `add` / `normal` | `air` |
| `on_each` 15–435 ms | `ice_shard_chip` (3, ring 14) | `tower` | 16 → 12 | Radial 82 px/s, vz 78, grav 280, spin 300°/s, stagger 15 ms, jitter 0.4 | Fade-in 15 ms, peak 0.95, hold 0.5 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `held` loop 1400 ms | `tower_ice_clamp` (1) | `tower_base` offset `[0, -10]` | 72 ↔ 76 (pulse) | Heavy clamped ice teeth gripping base | Fade-in 140 ms, peak 0.95, hold 0.7 | Solid art (`#ffffff`) | `normal` / `normal` | `air` |
| `held` loop 1600 ms | `frost_wisp_puff` (1) | `tower` offset `[0, 4]` | 54 ↔ 68 (pulse) | Slow counter-spin −18°/s | Fade-in 160 ms, peak 0.48, hold 0.45 | `#dcf8ff→#88dfff→#50b8f0` / `#cedee8→#94b4c8→#7090a6` | `add` / `normal` | `air` |

**Classic differences**: The shattered crater, erupting glacier spires, flying ice boulders, frost patches, and tower base clamps swap to the chunky, high-contrast, unoutlined 2009 3ds Max Classic renders; the gathering vortex, shock arc, and blizzard squall render in `normal` blend with dusty slate-white `tint_classic` colours, and screen shake is disabled.
