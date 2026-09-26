# Monster sprite sheets

How the Flash client drew creeps and champions on the battlefield, which sheets exist, and how
the web client should reuse them. All paths below are relative to the repo root; `.as` paths
are under `client/scripts/`.

**Bottom line:** monster animation is fully recoverable. The Flash client never used vector
MovieClips for monsters in the yard. Every creep and champion is a pre-rendered PNG sprite
sheet loaded by URL, and every sheet `SPRITES.as` references is already in
`server/public/assets/monsters/` (61 of 61 checked). No SWF extraction is needed.

## 1. How Flash drew monsters

### Loading

- `SPRITES.as:17-96` (`Setup()`) builds one `SpriteData` per sprite key, for example
  `SPRITES.as:25`: `_sprites.C1 = new SpriteData("monsters/sprite.1.v1.png", 24, 21, 8, 14);`
- `SPRITES.as:102-104` (`SetupSprite`) calls `ImageCache.GetImageWithCallBack(key, ...)`.
- `com/monsters/display/ImageCache.as:176-178` loads it:
  `req_str = l.shouldPrepend ? prependImagePath + l.key : l.key;`
  `l.loader.load(new URLRequest(req_str), ...)`. The key is a path under the assets root, so
  `monsters/fink.png` is served today as `server/public/assets/monsters/fink.png`.

### `SpriteData` fields (`com/monsters/display/SpriteData.as`)

`new SpriteData(url, frameW, frameH, anchorX, anchorY)`

| Arg | Meaning |
| --- | --- |
| `url` | Sheet path, used as the ImageCache key. |
| `frameW`, `frameH` | Size of one cell. Stored in `rect.width/height`. |
| `anchorX`, `anchorY` | Pixel inside the cell that sits on the monster's ground point. Stored as `middle`. |

The constructor also stores `offset = (FUBAR_X - anchorX, FUBAR_Y - anchorY)` with
`FUBAR_X = 26`, `FUBAR_Y = 36`. Creeps copy the cell into a 52x50 canvas at `offset`, and the
canvas is placed at (-26, -36) from the creep (`creeps/CreepBase.as:131-136`, full path
`com/monsters/monsters/creeps/`). Net effect: **cell top-left = creep position - (anchorX,
anchorY)**. `CREEPS.as:315-321` uses `middle` and `width` for overlap tests.

Champions differ: the canvas is exactly one cell (`champions/ChampionBase.as:239-243`) and it
is placed at per-level `offset_x` / `offset_y` from `CHAMPIONCAGE.as` (`:74`, `:117`, `:163`,
`:208`, `:254`). Their `SpriteData` anchors are all 26,36, which makes `offset` zero, so use the
CHAMPIONCAGE offsets as the anchor for G1-G5.

### Frame selection

`SPRITES.GetFrame` (`SPRITES.as:382-393`) copies the rectangle at
`x = frameW * column`, `y = frameH * row`. **Columns are facing directions, rows are animation
frames.** `SPRITES.GetSprite(canvas, key, action, rotation, frameNumber, lastFrame)`
(`SPRITES.as:119-380`) decides column and row:

- Rotation: `MonsterBase.as:591` sets `_targetRotation = atan2(yd, xd) * 57.29 - 90`, and
  `:608-612` adds 90 and normalises to 0-360. So `rotation` is the screen-space heading in
  degrees, 0 = east (+x), increasing clockwise because screen y points down.
  `GetSprite` adds 360 to negative values (`:127-129`).
- **30 directions, 12 degrees each** (`rotation / 12`): the default branch (`SPRITES.as:373-378`),
  worker, C9, C12, C13, C19, IC3, IC5, C200.
- **32 directions, 11.25 degrees each** (`rotation / 11.25`): C14, C15, C16, IC1, rocket.
- **16 directions, 22.5 degrees each** (`int((rotation - 45) / 22.5)`): all champions. The -45
  comes from the callers, `champions/ChampionBase.as:1539-1545`.
- **Frame advance:** row index uses `frameNumber / 8 % N`, so the animation steps once every 8
  ticks. `_frameNumber` increments once per tick in `MonsterBase.as:557-558`.
- Nothing is mirrored. Every direction is its own pre-rendered column.

Row meanings per family (all from `SPRITES.as`):

| Family | Rows used | Line |
| --- | --- | --- |
| Classic single pose: C1-C8, C10, C11, C12, C12Gold, IC2, IC4, IC6, IC7, IC8 | row 0 only; they glide | default `:373` |
| worker | row 0; row 1 when the hard-hat store item `BST` is owned | `:130-141` |
| C9 Brain | row 0 walking, row 1 when `action == "invisible"` | `:142-153` |
| C13 Wormzer (orig.) | row 0 walking, row 4 burrowed, rows 1-3 transition | `:160-179` |
| C14, C16 | 3-row wing flap, `(frame % 9) / 3` | `:180-191` |
| C15 Zafreeti | row 0 only, 32 dirs | `:205-210` |
| C19 Rezghul | row 1 idle, rows 1-5 moving | `:192-204` |
| IC1 Spurtz | rows 1-2 walk | `:211-216` |
| IC3 Malphus | rows 1-8 walk | `:217-222` |
| IC5 Balthazar | rows 1-6 walk | `:223-228` |
| G1 ape, G2 dragon | row 0 idle, rows 1-7 walk, attack rows 8-14 (levels 1-3) or 8-15 (levels 4-6) | `:229-247` |
| G3 fly | row 0 idle, walk rows 1-7 (L1), 1-8 (L2), 1-6 (L3+) | `:248-264` |
| G4 Korath | walk rows 0-7 (L1-2), 0-8 (L3), 0-9 (L4+); attack 8-16 / 8-16 / 9-18 / 10-19; `stomp` rows 20-29 | `:265-313` |
| G5 Krallen | walk and idle rows 0-9, attack rows 10-15 | `:314-337` |
| C200 looter | row 0 empty, row 1 carrying | `:346-354` |

C17 and C18 (Slimeattikus) have 6-row sheets but fall into the default branch, which only
reads row 0. Their extra rows are unused by `GetSprite` in this build.

### Who calls it

- `creeps/CreepBase.as:1709-1728` (`getNextSprite`) draws shadows, then calls
  `CreepSkinManager.instance.GetSprite(_graphic, _creatureID, spriteAction, m_rotation,
  _frameNumber, ...)`. `spriteAction` defaults to `"walking"` (`MonsterBase.as:74`); abilities
  change it, for example `components/abilities/Invisibility.as:41` and `creeps/Rezghul.as:61-64`.
- C14 and C16 switch to `"landed"` at 0 health (`CreepBase.as:1714-1719`).
- `champions/ChampionBase.as:1539-1548` passes `"idle"`, the attack mode, or `"walking"`.
- **Skins:** `com/monsters/display/CreepSkinManager.as:22-38` maps a creature ID to an
  alternative sheet key (for example `C12Gold`) and substitutes it before calling `SPRITES`.

### Flyers and shadows

- Flying creeps draw a separate shadow: `flyingshadow.png` for IC5 and `fly`/`fly_low`
  movers, and `zafreeti-shadow.png` for C15 and champions (`CreepBase.as:1710-1722`,
  `ChampionBase.as:1548`). Ground sheets have the shadow baked in.
- **Hover bob:** `CreepBase.as:262-264`:
  `bob = sin(frameNumber / 50) * 5; altitude = altitudeMax - bob; graphic.y = -altitude - 36 + bob`.
- Landing and take-off are TweenLite tweens on `graphic.y` (`CreepBase.as:155-190`, `:286`).

### Death

There are no per-monster death frames. `MonsterBase.die()` (`MonsterBase.as:1186-1201`)
drops flyers to the ground with a 0.4 s Sine tween, then `dieFinish()` (`:1203-1216`) plays a
`monsterland1-3` sound and calls `deathSplat()` (`:1232-1234`), which runs
`EFFECTS.CreepSplat` (`EFFECTS.as:54-79`). That spawns `ParticleSplat` clips
(`ParticleSplat.as`, a vector MovieClip in the game SWF, `EFFECTS.as:81-83`) and
`GIBLETS.Create(...)` (`EFFECTS.as:78`). The splat is generic, not per monster.

## 2. Sheets referenced by `SPRITES.as`

Every file is in `server/public/assets/monsters/`. Anchor is `anchorX,anchorY` after
resolving `FUBAR_X/Y` to 26/36. Grid is file size divided by cell size. "Line" is the
`SPRITES.as` line.

| Key | File | Cell | Anchor | File px | Cols x rows | Animation | Line |
| --- | --- | --- | --- | --- | --- | --- | --- |
| worker | `worker.png` | 27x27 | 9,19 | 810x54 | 30x2 | hard-hat variant row | 20 |
| worker (Inferno) | `inferno_worker.v2.png` | 64x55 | 32,36 | 1920x55 | 30x1 | none | 23 |
| C1 Pokey | `sprite.1.v1.png` | 24x21 | 8,14 | 720x21 | 30x1 | none | 25 |
| C2 Octo-ooze | `octoooze.png` | 39x28 | 19,15 | 1170x28 | 30x1 | none | 26 |
| C3 Bolt | `sprite.3.v2.png` | 30x28 | 7,20 | 900x28 | 30x1 | none | 27 |
| C4 Fink | `fink.png` | 34x32 | 15,21 | 1020x32 | 30x1 | none | 28 |
| C5 Eye-ra | `eyera.png` | 26x23 | 11,15 | 780x23 | 30x1 | none | 29 |
| C6 Ichi | `ichi.png` | 27x26 | 11,17 | 810x26 | 30x1 | none | 30 |
| C7 Bandito | `bandito.png` | 29x28 | 11,17 | 870x28 | 30x1 | none | 31 |
| C8 Fang | `fang.png` | 34x31 | 16,19 | 1020x31 | 30x1 | none | 32 |
| C9 Brain | `brain.v2.png` | 34x24 | 16,13 | 1020x48 | 30x2 | invisible row | 33 |
| C10 Crabatron | `crabatron.png` | 37x27 | 15,18 | 1110x27 | 30x1 | none | 34 |
| C11 Project X | `sprite.11.v2.png` | 48x35 | 24,22 | 1440x34 | 30x1 | none (file 1 px short) | 35 |
| C12 D.A.V.E. | `sprite.12.v2.png` | 53x46 | 21,27 | 1590x46 | 30x1 | none | 36 |
| C12Gold | `sprite.12.gold.png` | 53x46 | 21,27 | 1590x46 | 30x1 | skin | 37 |
| C13 Wormzer | `13.png` | 40x26 | 19,17 | 1280x27 | 32x1 | burrow rows in code, sheet has 1 | 38 |
| C14 Teratorn | `14.v1.png` | 28x28 | 15,14 | 896x84 | 32x3 | flap | 39 |
| C15 Zafreeti | `zafreeti.v2.png` | 56x70 | 28,35 | 1792x70 | 32x1 | none, bob | 40 |
| C16 Vorg | `vorg_anim.png` | 40x40 | 26,36 | 1280x120 | 32x3 | flap | 41 |
| C17 Slimeattikus | `slimeattikus_anim.png` | 48x31 | 26,15 | 1536x186 | 32x6 | rows unused | 42 |
| C18 mini Slimeattikus | `slimeattikusmini_anim.png` | 30x20 | 15,11 | 960x116 | 32x6 | rows unused | 43 |
| C19 Rezghul | `rezghul.png` | 48x43 | 26,36 | 1536x258 | 32x6 | idle, move | 44 |
| IC1 Spurtz | `spurtz.png` | 24x28 | 12,14 | 720x84 | 30x3 | walk | 45 |
| IC2 Zagnoid | `zagnoid.png` | 64.4x46 | 26,28 | 1933x46 | 30x1 | none | 46 |
| IC3 Malphus | `malphus.png` | 51x35 | 25,17 | 1530x315 | 30x9 | walk | 47 |
| IC4 Valgos | `valgos.png` | 55x32 | 11,15 | 1650x32 | 30x1 | none | 48 |
| IC5 Balthazar | `balthazar.png` | 56x37 | 33,18.5 | 1680x259 | 30x7 | walk | 49 |
| IC6 Grokus | `grokus.v2.png` | 57x39 | 28,20 | 1718x39 | 30x1 | none | 50 |
| IC7 Sabnox | `sabnox.png` | 42x34 | 21,17 | 1260x34 | 30x1 | none | 51 |
| IC8 King Wormzer | `wormzer.png` | 58x42 | 29,21 | 1740x42 | 30x1 | none | 52 |
| G1_1 Gorgo | `ape_1.png` | 96x69 | 26,36 | 1536x1035 | 16x15 | idle, walk, attack | 53 |
| G1_2 | `ape_2.png` | 89x73 | 26,36 | 1424x1095 | 16x15 | idle, walk, attack | 54 |
| G1_3 | `ape_3.png` | 103x88 | 26,36 | 1648x1320 | 16x15 | idle, walk, attack | 55 |
| G1_4 | `ape_4.png` | 148x127 | 26,36 | 2368x2032 | 16x16 | idle, walk, attack | 56 |
| G1_5 | `ape_5.png` | 160x137 | 26,36 | 2560x2192 | 16x16 | idle, walk, attack | 57 |
| G1_6 | `ape_6.png` | 140x120 | 26,36 | 2240x1920 | 16x16 | idle, walk, attack | 58 |
| G2_1 Drull | `dragon_1.png` | 64x41 | 26,36 | 1024x615 | 16x15 | idle, walk, attack | 59 |
| G2_2 | `dragon_2.png` | 87x58 | 26,36 | 1392x870 | 16x15 | idle, walk, attack | 60 |
| G2_3 | `dragon_3.png` | 114x85 | 26,36 | 1824x1275 | 16x15 | idle, walk, attack | 61 |
| G2_4 | `dragon_4.png` | 131x93 | 26,36 | 2096x1488 | 16x16 | idle, walk, attack | 62 |
| G2_5 | `dragon_5.png` | 156x117 | 26,36 | 2496x1872 | 16x16 | idle, walk, attack | 63 |
| G2_6 | `dragon_6.png` | 171x125 | 26,36 | 2736x2000 | 16x16 | idle, walk, attack | 64 |
| G3_1 Fomor | `fly_1.png` | 53x40 | 26,36 | 848x320 | 16x8 | idle, fly | 65 |
| G3_2 | `fly_2.png` | 63x46 | 26,36 | 1008x414 | 16x9 | idle, fly | 66 |
| G3_3 | `fly_3.png` | 98x81 | 26,36 | 1568x567 | 16x7 | idle, fly | 67 |
| G3_4 | `fly_4.png` | 120x92 | 26,36 | 1920x644 | 16x7 | idle, fly | 68 |
| G3_5 | `fly_5.png` | 133x105 | 26,36 | 2128x735 | 16x7 | idle, fly | 69 |
| G3_6 | `fly_6.png` | 124x105 | 26,36 | 1984x735 | 16x7 | idle, fly | 70 |
| G4_1 Korath | `korath_1.png` | 72x49 | 26,36 | 1152x833 | 16x17 | walk, attack | 71 |
| G4_2 | `korath_2.png` | 119x81 | 26,36 | 1904x1377 | 16x17 | walk, attack | 72 |
| G4_3 | `korath_3.png` | 128x102 | 26,36 | 2048x1836 | 16x18 | walk, attack | 73 |
| G4_4 | `korath_4.png` | 153x123 | 26,36 | 2448x2460 | 16x20 | walk, attack | 74 |
| G4_5 | `korath_5.png` | 199x162 | 26,36 | 3184x4860 | 16x30 | walk, attack, stomp | 75 |
| G4_6 | `korath_6.png` | 202x167 | 26,36 | 3232x5010 | 16x30 | walk, attack, stomp | 76 |
| G5_1 Krallen | `krallen_1_rev_65.png` | 130x80 | 26,36 | 2080x1280 | 16x16 | walk, attack | 77 |
| G5_2 | `krallen_2_rev_65.png` | 131x90 | 26,36 | 2096x1440 | 16x16 | walk, attack | 78 |
| G5_3 | `krallen_3_rev_65.png` | 142x100 | 26,36 | 2272x1600 | 16x16 | walk, attack | 79 |
| C200 looter | `looter.png` | 51x47 | 7,33 | 1581x94 | 31x2 | empty, carrying | 80 |
| shadow | `flyingshadow.png` | 31x20 | 15,10 | 31x20 | 1x1 | static | 81 |
| bigshadow | `zafreeti-shadow.png` | 48x32 | 24,16 | 48x32 | 1x1 | static | 82 |
| rocket | `daverocket.png` | 16x16 | 26,36 | 512x16 | 32x1 | D.A.V.E. rocket | 83 |

Notes on the table:

- Korath's `stomp` reads rows 20-29, so only `korath_5/6` (30 rows) can play it. Levels 1-4
  would read off the sheet.
- C13 reads burrow rows 1-4 but its sheet has one row, and it computes 30 directions on a
  32-column sheet. Treat both as original bugs, not as missing art.
- Champion display names above (Gorgo, Drull, Fomor, Korath, Krallen) should be checked against
  the language strings before use in UI.

## 3. Recommended route for the web client

1. **Generator script (1-2 hours).** Add `web/tools/gen-monster-sprites.mjs`, modelled on
   `web/tools/gen-building-art.mjs` (which parses `client/scripts/YARD_PROPS.as`). Parse the
   `_sprites.X = new SpriteData(...)` lines with a regex, resolve `FUBAR_X/Y`, read each PNG's
   IHDR for its size, and emit a checked-in TS table:
   `{ key, url, cellW, cellH, anchorX, anchorY, cols, rows }`. Merge in the champion
   `offset_x/offset_y` arrays from `CHAMPIONCAGE.as`. Fail loudly if a file is missing.
2. **Hand-written animation table (half a day).** `GetSprite` is about 20 branches, so port it
   by hand as data rather than parsing it:
   `{ dirs: 30 | 32 | 16, dirOffsetDeg: 0 | -45, states: { walk: [firstRow, count],
   attack: [...], idle: [...] }, ticksPerFrame: 8 }`. Put per-level overrides in for G1-G5.
   Cite the `SPRITES.as` line on each entry.
3. **PixiJS slicing (half a day).** Per sheet, create `Texture`s with
   `new Texture({ source, frame: new Rectangle(col * cellW, row * cellH, cellW, cellH) })`,
   built lazily per state and cached. Set each sprite's pivot to the anchor, so the sprite's
   position is the monster's ground point. For champions, use `-offset_x, -offset_y` as the
   pivot instead.
4. **Direction and state (included above).**
   `deg = (atan2(vy, vx) * 180 / PI + 360) % 360` from the screen-space velocity, then
   `col = floor(((deg + dirOffsetDeg + 360) % 360) / (360 / dirs))`.
   `row = firstRow + floor(tick / 8) % count`. Keep the last column while the monster is
   standing still.
5. **Flyers (1-2 hours).** Draw the shadow sprite on the ground layer and apply the sine bob
   from `CreepBase.as:262-264` to the body sprite.
6. **Death (2-4 hours).** Build one shared splat-and-gibs particle effect to replace
   `EFFECTS.CreepSplat`. Flyers drop to the ground over 0.4 s first.
7. **Sizes.** The champion sheets are large; `korath_5.png` is 3184x4860 at 6.1 MB. Load
   champion sheets on demand and consider splitting them per state or converting to WebP.
   Check them against the device's maximum texture size (4096 is a safe floor), since
   `korath_5/6` exceed it and need splitting.

**Effort:** about 1.5-2 days for animated creeps and champions with every direction plus
champion walk and attack. This does not give C1-C12 a walk cycle or any monster a death
animation, because that art never existed. Those would be new art, for example generated with
Gemini, drawn at the same cell sizes so they drop into the same table.
