# Monster Academy 3D: handoff package

Everything needed to rebuild, re-render and edit the current 3D Monster Academy (Flash building 26, art levels 1-4),
with the Flash originals and the current renders kept as a baseline. Nothing here changes how it looks: the model,
materials, camera and lights are exactly those of commit `6fcfc1211` (tag `academy-3d-baseline-2026-11-01`, branch
`art/buildings-3d-academy`).

The working source this was copied from is `art-samples/buildings-b6/academy-v1/` (same branch). That folder also
holds the damaged/destroyed looks (`damage/`), the full-size detail crops (`crops/`) and the older check pictures;
they are not part of this package.

## Folder

| path | what |
| --- | --- |
| `src/academy.py` | **entry script**: builds the scene in Blender and renders it (one level per run) |
| `src/stack.py` | the numbers of each level: dome size, origin, bands, glass, portholes, windows, ribs |
| `src/post.py` | the comparison pictures and loop videos, from `src/render/` and the Flash art (plain Python) |
| `src/fref.py`, `src/flashart.py` | read the Flash sprites from `flash/raw/` in the game's pixel frame |
| `src/fit.py`, `measure.py`, `crops.py`, `view.py`, `blockcol.py`, `colcmp.py` | small checking tools used while fitting (outline overlap, colour samples, crops) |
| `src/run.sh` | one Blender run of `academy.py`, output filtered to errors and `DONE` |
| `src/render_all.sh` | every level's still and loop, then the comparison pictures |
| `src/compare_baseline.py` | pixel difference of a fresh render against `baseline/render/` |
| `flash/raw/` | **the Flash originals**, byte-for-byte copies of `server/public/assets/buildings/academy/` (native size, transparent PNG; the shadows are Flash's multiply JPEGs) |
| `flash/academy-artdata.json` | the game's art data for the Academy (`web/src/game/yard/buildingArtData.ts` row 26): which file each level uses and its offset |
| `flash/L<n>.png` | Flash level n as the game draws it (top sprite + loop cell 0), 1x, transparent, 170 x 136, in the same frame as the 3D renders |
| `flash/L<n>-shadow.png`, `-with-shadow.png` | Flash's ground shadow as black + alpha, and the building over it |
| `baseline/L<n>-3d.png` | **the current 3D render of level n**: the whole building at loop frame 0 with its ground shadow, transparent, 2040 x 1632 (12 render px per Flash px) |
| `baseline/render/` | the raw renders those come from: `L<n>-base.png` (still parts + shadow, 384 samples), `L<n>-alone.png` (whole building, no shadow, 32 samples), `L<n>-parts-00.png` (the turning cogs only, frame 0, 256 samples) |
| `baseline/academy-levels.png` | **the comparison image**: Flash L1-L4 on top, 3D below, one scale, dashed lines through the parts every level shares; `academy-levels-clean.png` without the lines |
| `baseline/academy-game.png` | Flash and 3D at the game's own size (1x) and 2x |
| `baseline/L<n>-side.png`, `L<n>-anim.mp4` | Flash and 3D side by side, large; the loop (cogs turning) at the game's speed |
| `blend/academy-L<n>.blend` | the built scene of each level, saved by `academy.py <n> save` (see "The .blend files") |

`src/render/`, `src/work/` and the pictures `post.py` writes into `src/` are git-ignored.

## Software

- Blender **5.2.3 LTS** (build 2026-10-22), `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`. Only
  built-in modules (`bpy`, `bmesh`, `mathutils`); always run with `--factory-startup`.
- Python 3.14 with Pillow 12.2 and numpy 2.4 for `post.py` and the other plain-Python tools; ffmpeg 8.1 on PATH for the
  loop videos.
- GPU: `academy.py` renders on an NVIDIA card through OptiX (then CUDA), else on the CPU. The baseline was rendered with
  OptiX on an RTX 3070. A CPU render or another card gives the same picture up to sampling noise.

## Commands

From `art-samples/academy-3d/src/` in Git Bash (the paths in the scripts are relative to `src/`, so any working
directory works for Blender; `post.py` needs `src/` as the working directory):

```sh
cd art-samples/academy-3d/src
BL="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"

# one level (n = 1, 2, 3 or 4)
"$BL" -b --factory-startup -P academy.py -- 2 still   # render/L2-base.png, L2-alone.png, L2-parts-00.png
"$BL" -b --factory-startup -P academy.py -- 2 anim    # render/L2-parts-00..20.png, the 21 loop frames
"$BL" -b --factory-startup -P academy.py -- 2 fit     # work/fit-L2.png: quick, 4 px per Flash px, no shadow
"$BL" -b --factory-startup -P academy.py -- 2 save    # ../blend/academy-L2.blend, no render
sh run.sh 2 still                                     # the same as the first line, output filtered

# all four levels, stills and loops, then the comparison pictures (about 11 minutes)
sh render_all.sh

# pictures (plain Python, from src/)
python post.py levels        # academy-levels.png and academy-levels-clean.png (needs all four levels rendered)
python post.py side 2        # L2-side.png
python post.py anim 2        # L2-anim.mp4 (needs the "anim" frames)
python post.py game          # academy-game.png
python post.py outline 2     # L2-outline.png: Flash's outline in red on the 3D, and the overlap score
python compare_baseline.py 2 # how far render/ is from baseline/render/
```

On the owner's PC only one Blender may run at a time: take the lock with `mkdir D:/Coding/BYMR/blender-lock` (if it
fails, someone else is rendering; wait), and `rmdir` it as soon as your run ends.

A 3D frame k is `render/L<n>-base.png` with `render/L<n>-parts-<k>.png` laid over it (`post.frame3d`); that is how
`baseline/L<n>-3d.png` was made (k = 0). Other modes of `academy.py`: `check` (parts that pass into each other),
`cogcheck` (the cogs at every loop frame), `gap`, `probe sx sy ...` (what the camera sees through Flash pixels).
Environment overrides: `PB_SAMPLES` (base / fit samples), `PB_PART_SAMPLES` (cog layer), `PB_K` (render px per Flash
px), `PB_FRAME` (canvas).

## Camera, light and render settings (all in `academy.py` `setup()`, line 1300)

- **Frame**: the canvas is `FRAME = (-76, -44, 94, 92)` Flash px round the building's anchor (170 x 136 Flash px), the
  same frame `flash/L<n>.png` uses. `K = 12` render px per Flash px, so stills are **2040 x 1632**, 100 %. `fit` uses
  K = 4.
- **Camera**: orthographic, sensor fit horizontal, `ortho_scale = 17.0` (170 px / 10: one world unit is 10 Flash px
  across), **30 degrees above the ground, azimuth -45** (it looks from +X -Y toward the origin), 40 units out, then
  shifted so the world origin lands on `ORIGIN` (Flash px of the dome's axis on the ground: `(2.0, 44.5)` at levels 1-2,
  `(0.0, 51.5)` at levels 3-4, in `stack.py`). `px()` / `scr()` (lines 53, 66) convert Flash px <-> world.
- **Light**: one sun, energy 4.8, angle 14 degrees, colour (1.0, 0.95, 0.86), from the viewer's upper left
  (direction to the sun (-0.85, -0.62, 1.55)). World: a sky colour (0.62, 0.68, 0.78) at strength 0.85, darkened below
  the horizon and brightened overhead by a ramp, and brighter on the sun's side (so the metals have something to
  reflect). Ground: a 40 x 40 shadow catcher at z = 0, hidden from glossy and diffuse rays.
- **Render**: Cycles, seed 7 (not animated), max bounces 6, indirect clamp 4.0, OpenImageDenoise on. Samples: base
  384, alone 32, cog layer 256, fit 24. Colour management: view transform **Standard**, look None, exposure 0. Film
  **transparent**; PNG, RGBA, 8 bit.
- **Loop**: 21 frames (Flash's). The big cog turns half a turn per loop, the riders turn on their posts (`turn()`, line
  1204). Base pictures hide the cogs from the camera; the cog layer renders only the cogs with every still part as a
  holdout, cropped to a render border round every frame's cogs, so nothing else can change between frames.

## Where each part is built

Line numbers are in `src/academy.py` unless `stack.py` is named.

| part | where |
| --- | --- |
| scene build order | `build()` 1199: `body()` then `cogs()`; `main()` 1447 builds, calls `setup()`, then the mode |
| per-level numbers | `stack.py` class `Lv` (line 31): levels 1-2 vs 3-4 (`ribbed`), L4's `TANK_RISE` (line 76), porthole and window positions (`PORTS`, `WINDOWS`), ribs (`RIBS`), and the rib/plinth constants (lines 76-91) |
| dome, opening lip, inner wall, pit, foot, gold band | `body()` 739 (one lathe profile; levels 3-4 branch adds the black band, gold ring, `tank()` and `ribs()`) |
| **gold machinery in the roof opening** (the cogs) | `cogs()` 1156, using `cog()` 1094 and `wheel()` 1117; opening radius `OPEN_R` in `stack.py` line 61, lip width `LIP` 1153; the pit is `domeinner` in `body()` |
| level 1-2 porthole plates (front left, L2 also front right) | `porthole()` 844, called from `body()` for `V.PORTS` |
| **level 2's back pair** (currently flat square windows on dark mounts, named `fin*`) | `porthole(..., name="fin", flat=True)` 844 (the `flat` branches at lines 854 and 917), placed by `stack.py` `WINDOWS` (line 71: bearing -45 -/+ 105, tilt 26), stand-off `WINDOW_OUT` (line 78) |
| **level 3-4 cyan glass** and the dark collar above it | `tank()` 792; heights `TANK_Z0`, `GLASS_Z1`, `DOME_Z0`, `TANK_R` and the L4 gold band height in `stack.py` lines 48-60; L4 lift `TANK_RISE = 2.2` |
| **supports** (levels 3-4 ribs: bend, taper, feet) | `ribs()` 1043, outline `rib_profile()` 967 (the quarter-ellipse bend, top/upright thickness), mesh `rib_mesh()` 1022; constants `RIB_*`, `PLINTH`, `SLEEVE_Z` in `stack.py` lines 81-91 |
| panel seams | `seams()` 807 |
| materials (blue-gray dome, gold, block gold, glass, ribs) | `materials()` 670 (shader builders `shiny()` 536, `painted()` 267, `glassmat()` 641, `flat()` 342) |

## The .blend files

`blend/academy-L<n>.blend` is the scene `academy.py <n> save` builds: every object, material, the camera, sun, world
and ground, the render size and colour settings. It is a snapshot for looking at and editing by hand; the script is the
source of truth. What it does not carry: the per-mode settings `main()` sets just before each render (samples,
which objects are hidden or held out for the base / alone / cog layer, the render border) and the GPU choice (a user
preference). Rendering the .blend straight gives the whole building with shadow at Blender's default samples, not the
exact baseline pictures; use the script for those.

## Verified

1 Nov 2026, 10:50-11:01, Blender 5.2.3, OptiX on an RTX 3070: `sh src/render_all.sh` (all four levels, still and
loop, then every comparison picture) ran end to end in 11 minutes (about 80 s per still, 60-75 s per 21-frame loop),
then `python compare_baseline.py` and the same comparison on the pictures:

| output | largest channel difference (0-255) | pixels differing by more than 8 |
| --- | --- | --- |
| `render/L1-L4-base.png`, `-alone.png` | 1-4 | 0 of 3,329,280 at every level |
| `render/L1-L4-parts-00.png` | 2-3 (L4: 100) | 0 (L4: 2, on the cogs' faint alpha edge) |
| all 21 loop frames vs. the source folder's renders | 9-100 | 1-13 per level across all 21 frames |
| `L<n>-3d.png` (frame 0 composite) | 2-3 | 0 |
| `academy-levels.png`, `-clean.png`, `academy-game.png`, `L<n>-side.png` | 1-3 | 0 |

So the package reproduces the baseline up to GPU sampling noise. The loop check `post.py anim` prints passed (0 px
changed outside the moving parts at every level). `blend/academy-L2.blend` opens in Blender 5.2.3 headless: 76
objects, Cycles, 2040 x 1632, orthographic camera at ortho scale 17.0, film transparent.

## Known gaps

- The Academy is not in the game yet (no `academy` entry in `web/tools/tower-tiers/export3d_buildings.py` on
  `revamp`), so there is no in-game 3D sprite to compare with; `baseline/L<n>-3d.png` is the picture the game would get.
- Only loop frame 0 of the cog layer is kept in `baseline/render/` (the 20 other frames are about 17 MB a level); the
  loop itself is in `baseline/L<n>-anim.mp4`, and `academy.py <n> anim` at the tag rebuilds them.
- The damaged and destroyed looks are not in this package; they stay in `art-samples/buildings-b6/academy-v1/damage/`
  and import the same model.
- `flash/raw/anim.1.v2.png` is the level 1 loop strip the game uses (the art data names it); `anim.3.png` serves both
  levels 3 and 4, as in Flash. The two `(1)` duplicates in the game folder are identical copies and were left out.
