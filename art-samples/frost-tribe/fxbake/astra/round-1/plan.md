# Krampus frost ability animation handoff

`motion.json` is the executable specification; `cells.json` maps the two looks to the same sixteen named cells. Art was generated with the built-in image generation tool. No light sheet is needed: snow, broken ice and their negative spaces carry the effects in both looks.

## Playback and import contract

- All times are milliseconds; the simulation tick is 12.5 ms. All event boundaries and keyframes land on ticks. Render interpolation may run between ticks. One-shots use elapsed time, never frame-dependent movement.
- **`reach` means diameter in world pixels**, not radius or game units: aura 560–850 according to its actual current gameplay radius; stomp 320. Use the gameplay radius, not an invented linear level curve. A ring radius `r` places centers at `(r*cos(angle), 0.5*r*sin(angle))`. Radial movement uses the same projection.
- Non-following one-shots capture their anchor when their parent hook fires, including pieces with delayed starts. Thus the two fracture phases share the slam origin even if Krampus moves later. Following pieces update with their anchor. `caster_head` is the current heading's horn/head position, not a fixed screen offset. Ice Shards targets the flyer's elevated body, never its ground anchor.
- Sizes mean the width of the visible asset's registered sprite rectangle. Key out magenta at import and trim single-cell assets to their content bounds, with the center of that rectangle as the pivot. Use one **shared union crop and pivot for all four impact frames**, so the smaller first frame stays small and fragments expand without jumping; compute that union across both looks to preserve matching animation registration. Trim/pivot metadata is ordinary texture import work, not a new effect feature. Do not independently normalize the four frames.
- Preserve each cell's native aspect ratio unless `squash` is supplied. The frost fracture is painted round overhead and uses `squash: 0.5`. Impact art is approximately round; the stomp impact also uses 0.5. Other ground pieces already have the camera angle baked in: do not squash them again. Ground pieces keep their upper-left lighting; ring placement does not automatically rotate their art.
- Flipbooks play once over their stated life: four frames, 50 ms each, in a 200 ms life. There is no looping impact animation and no frame crossfade. The last frame fades with the piece.
- `peak`, `fade_in_ms` and `hold` in JSON are authoritative. Fade linearly from zero to peak during fade-in, hold until `hold * life_ms`, then fade to zero at death. Zero fade-in means immediate peak. `hold: 1` preserves peak to the end. Held `pulse: true` interpolates start size → end size → start size over each loop; the fade-in applies only on acquisition. Held `hold: 1` stays at peak until release; the six banks alone use a quiet, phase-offset looping fade. Adjacent bank phase offsets are one sixth of the loop.
- `fly_to` with `spread_deg` is the supplied fanned-flight mode: the three trajectories spread around the flight line, then converge on the same elevated target at 200 ms. They are one damaging attack with three decorative sprites. All start together; no delayed extra damage or staggered landing. Face the RIGHT-pointing lance along each trajectory's tangent. Refresh the destination for a moving flyer; do not reset elapsed flight time.
- All colored artwork uses white multiplicative tint, `#ffffff`. Every sheet sprite uses normal blending in both looks. Modern adds only the specified small body flash and screen shake. Classic omits shake and the added-light flash; its body scale keys and all effect timing remain identical.
- Repeated applications refresh the existing target hold and its gameplay timer without adding another held sprite or restarting its loop. Aura hold begins immediately on entry and lasts while inside; Ice Shards hold begins at impact and lasts 2000 ms; stomp hold begins at slam and lasts 3000 ms. All holds then fade for 200 ms. On destruction, remove the affected object's attached pieces. Krampus's death releases his aura and tower visors over 200 ms.
- The supplied hooks do not include an aura-held defending-monster visual. The cold field communicates that area; existing status UI and actual movement show monster slowdown. Do not invent a freeze-block effect or modify Frostbite.

## Frost aura — a moving bank of biting cold

Six broken snow-crusted banks drift slowly around Krampus's reach while a smaller wind-combed frost patch travels beneath his feet, identifying him as the source without covering the yard. A tower catches a sharp frost snap and gains a small hanging icicle visor across its upper mechanism, making loss of sight readable immediately; disconnected banks suggest the reach without a continuous circle. The power comes from the cold taking hold across several towers at once, while the long loops and open ground keep the persistent effect calm.

The six bank centers sit at 92% of the gameplay radius; their irregular outer tips may overhang it by roughly 12–23 px. This is a soft visual boundary, not a targeting outline: the per-tower visor and existing status icon identify actual membership. One bank is 76–92 px wide (38–46 px on a half-scale phone); the 36 px visor retains a substantial white ridge and dark teeth.

| Time ms | Piece | Where | Size, world px | Motion | Opacity | Colour | Blend | Layer |
|---|---|---|---|---|---|---|---|---|
| 0 → hold end; loop 3000 | `rime_bank` ×6 | `caster_feet`, ring `reach*0.46` | 76 → 92 → 76 | Follow; orbit 2°/s; adjacent phases 1/6 loop | Enter 250; peak .50; hold .80 of loop, then fade | Painted blue/snow; tint white | Normal | Ground |
| 0 → hold end; loop 2000 | `cold_wake` | Feet + [0,9] | 92 → 108 → 92 | Follow, no rotation | Enter 250; peak .48, constant after entry | Painted blue/snow; tint white | Normal | Ground |
| Tower entry 0–375 | `sight_snap` | Tower top + [0,8] | 18 → 44 | Ease-out growth | Enter 25; peak .90; hold .25, fade to 375 | Painted blue/snow; tint white | Normal | Air |
| Tower entry → exit; loop 2000 | `sight_visor` | Tower top + [0,8] | 36 → 38 → 36 | Follow; gentle size pulse | Enter 125; peak .78; constant | Painted blue/snow; tint white | Normal | Air |
| Exit 0–200 | Existing held pieces | Last/current attachment as applicable | Continue current phase | Continue follow until removed | Current opacity → 0 | Same | Normal | Same |

The visor sits below the status-icon rail and over the top of the mechanism, not on the icon. It is a narrow snowy obstruction, never an eye symbol or a full encasement. Classic substitutes dusty gray-blue ice, off-white snow, rough shading and deep navy shadow sides; all sizes, loops, motion and opacity are identical.

## Ice Shards — horn-splinter volley

A brief three-prong release at the horns establishes the throw, followed by three long, sharply pointed ice lances that fan outward and converge on the flying target in exactly 200 ms. The hit breaks from a tight contact core into a hollow spray of fragments, the flyer flinches, and two icy cuffs remain beside its body for the chill. The sharp silhouettes, directional flight and burst-to-fragments progression make the attack read as cutting ice rather than a projectile ball.

There is no invented pre-launch delay: the launch snap is the visible release cue in the available hook. The projectile art includes trailing fragments, so a separate costly trail emitter is unnecessary. In low effects, the one remaining lance retains those fragments and the full hit progression.

| Time ms from throw | Piece | Where | Size, world px | Motion | Opacity | Colour | Blend | Layer |
|---|---|---|---|---|---|---|---|---|
| 0–125 | `horn_fan` | Caster head at release | 16 → 34 | Ease-out growth; fixed release position | Peak .95; hold .20, then fade | Painted blue/snow; tint white | Normal | Air |
| 0–200 | `ice_lance` ×3 | Head → target body | 30 → 36 | 14° fan, zero stagger, arc 10; face flight | Peak 1; hold 1; removed at hit | Painted blue/snow; tint white | Normal | Air |
| 200–250 | `impact_1` | Target body, following | Shared 54-wide flipbook extent | Tight contact, first quarter of flipbook | Peak 1 | Painted blue/white; tint white | Normal | Air |
| 250–300 | `impact_2` | Target body, following | Same 54 extent | Large angular burst | Peak 1 | Same | Normal | Air |
| 300–350 | `impact_3` | Target body, following | Same 54 extent | Broken core; chunks separate | 1 → .5 | Same | Normal | Air |
| 350–400 | `impact_4` | Target body, following | Same 54 extent | Sparse fragments; empty center | .5 → 0 | Same | Normal | Air |
| 225–525 | `ice_splinter`, left | Hit position + [-5,0] | 15 → 8 | Velocity [-70,45] px/s; drag .4; rotation 145°; spin +180°/s | Peak .90; hold .20, then fade | Painted blue/white; tint white | Normal | Air |
| 225–525 | `ice_splinter`, right | Hit position + [5,0] | 13 → 7 | Velocity [70,30] px/s; drag .4; rotation 30°; spin −150°/s | Peak .90; hold .20, then fade | Same | Normal | Air |
| 200–2200; loop 1000 | `chill_cuffs` | Target body + [0,3] | 38 → 41 → 38 | Follow; open center leaves flyer readable | Enter 100; peak .80; constant, then fade 2200–2400 | Painted blue/white; tint white | Normal | Air |
| 200 / 250 / 325 / 400 | Target body | Flyer, existing sprite | Scale (1,1) / (1.12,.88) / (.97,1.04) / (1,1) | Short compression and return | Unchanged | Unchanged | Existing | Existing |

The JSON impact clock is local to landing, so impact `start_ms: 25` means absolute throw time 225. `body_target.start_ms: 200` is on the throw clock, with key times relative to that start. All one-shots end at 525 ms, leaving 175 ms before the next usual throw; only the refreshed chill marker persists. Classic has muted rough ice and small soft highlights; it preserves the same contact-to-breakup animation and flinch.

## Blizzard Stomp — pressure in, fractured ice out

While Krampus rears, four frost tongues draw inward beneath him and a small horn crest gathers; the slam reverses that motion into a branching ground fracture and eight staggered-looking, irregular ice eruptions racing outward. A central shatter, broad snow spray and short body compression make the impact heavy, while every slowed tower immediately catches an upward ice bite and keeps a broken frost collar around its footing. The open, branching footprint identifies the affected area in 150 ms without hiding buildings behind a disk or implying a full freeze.

Gameplay damage and slowing happen at the slam, independent of the decorative wave. Eruption centers travel from radius 24 to 129 px over their 525 ms life, with about 31 px of half-width at the end; snow centers travel 35 → 126 px with 34 px half-width. Their maximum visible footprint is therefore roughly the 160 px radius, with tiny fixed jitter for organic spacing; the complete 320×160 fracture gives the range cue first.

| Time ms from slam | Piece | Where | Size, world px | Motion | Opacity | Colour | Blend | Layer |
|---|---|---|---|---|---|---|---|---|
| −600–0 | `cold_wake` ×4 | Caster feet, radius 56 | 26 → 18 | Follow; inward radial speed −70 px/s, finishing radius 14 | Enter 100; peak .72; hold .65, then fade | Painted blue/snow; tint white | Normal | Ground |
| −250–0 | `horn_fan` | Caster head | 16 → 32 | Follow; linear growth | Enter 50; peak .85; hold .90, fade | Painted blue/snow; tint white | Normal | Air |
| 0–150 | `stomp_fracture` | Captured slam origin | 44 → 320; height = width/2 | Ease-out expansion | Peak .78, constant | Painted blue/snow; tint white | Normal | Ground |
| 150–1000 | `stomp_fracture` replacement | Same captured origin | 320×160, fixed | No movement; replace preceding piece on same tick | Peak .78; hold .10, then fade | Same | Normal | Ground |
| 0–200, four 50 ms frames | `impact_1…4` | Slam origin + [0,5] | Shared 86×43 extent | Contact → burst → breakup → chips | Peak 1; hold .50, then fade | Same | Normal | Ground |
| 25–550 | `ice_eruption` ×8 | Slam origin, radius 24 | 42 → 62 | Radial +200 px/s; jitter .06; zero stagger; ease-out growth | Enter 25; peak .95; hold .35, fade | Same | Normal | Ground |
| 75–725 | `snow_spray` ×4 | Slam origin, radius 35 | 44 → 68 | Radial +140 px/s; jitter .05; zero stagger; ease-out growth | Enter 50; peak .64; hold .20, fade | Same | Normal | Ground |
| 0–350 per affected tower | `ice_eruption` | Tower base + [0,−6] | 30 → 54 | Ease-out growth, fixed | Enter 25; peak .90; hold .30, fade | Same | Normal | Air |
| 0–3000; loop 1250 | `brake_collar` | Tower base + [0,−4] | 52 → 55 → 52 | Follow; subtle pulse; open center | Enter 150; peak .85; constant; fade 3000–3200 | Same | Normal | Air |
| 0 / 37.5 / 125 / 225 | Caster body | Existing sprite, feet pivot | Scale (1,1) / (1.08,.90) / (.98,1.03) / (1,1) | Compress then recover after existing rear animation | Unchanged | Unchanged | Existing | Existing |
| 0–75 | Body flash, Modern only | Existing caster silhouette | Same as body | No extra sprite asset | Peak .22 → 0 | #c8efff | Add | Body overlay |
| 0–150 | Camera shake, Modern only | Screen | Strength 3 world px before camera scale | Standard engine shake envelope | — | — | — | — |

Place the field pieces below all units/buildings; the per-tower bite and collar render over only the footing, ensuring the important status cue remains visible. The collar does not cover the tower's body, barrel or status icons. The caster's existing −600 ms rear animation is untouched; added scaling begins only at contact. All field one-shots end by +1000 ms, well inside +1400 ms. Classic swaps to rough dusty ice, omits camera shake and flash, and uses exactly the same motion, timing and scale keys.

## Budgets and small-screen behavior

Counts include temporary acquisition pieces and held status marks, for eight affected towers. A flipbook is one live sprite. No particle emitters or hidden trail sprites are implied.

| Ability | Full effects, worst live count | Low effects count | Breakdown |
|---|---:|---:|---|
| Aura | 23 | 19 | 6 banks + 1 wake + 8 visors + 8 entry snaps. Low: 2 banks + 1 wake + same status pieces. Steady state is 15 / 11. |
| Ice Shards, one volley | 4 | 2 | Launch fan + 3 lances, or hit flipbook + 2 chips + 1 cuff. Low: fan + 1 lance; omit both chips, retain flipbook + cuff. An already chilled target adds one cuff during a fresh flight: 5 / 3. |
| Stomp | 30 | 23 | 1 fracture + 1 impact + 8 eruptions + 4 snow sprays + 8 tower bites + 8 collars. Low: 3 eruptions + 2 sprays; same singletons and tower marks. |

For low effects round repeated counts to the nearest integer after multiplying by .4, with minimum 1: 6→2, 8→3, 4→2, 3→1. Preserve coverage by redistributing survivors evenly across their original ring/fan. Low mode omits the two separately listed Ice Shards chips as decorative secondary debris; do not shrink essential shapes or change timings. The aura keeps status cues at full count because they identify actual affected towers.

Use the game's normal effect-pool priority to keep aura at 25 sprites even during exceptional simultaneous entry/exit transitions: skip new entry snaps first, then reduce boundary-bank copies, while preserving the 200 ms exit fades and current held status marks. No gameplay change accompanies visual culling. In unusual crowded stomps, preserve tower collars and the single fracture, then shed snow copies and tower-entry bites before eruption copies to stay within about 40. The supplied eight-tower case needs no culling.

At half scale the banks are 38–46 px, the tower visor 18–19 px, lances 15–18 px, the impact 27 px, and tower collars 26–27.5 px. The spear's broad point, snow ridge, paired cuffs and broken collar are the primary shapes; small detached chips are secondary. No one-pixel line is required for ability recognition. Several aura fields may overlap, so opacity is deliberately modest and no whole-area overlay is drawn.

## Validation and asset provenance

Validate both JSON files, all sixteen references in both looks, positive lifetimes, hook-relative times, shared flipbook registration and the stated peak counts. These are handoff assets and animation data; in-game playback is not available in this folder, so final occlusion, anchor placement and game feel still require integration review.

The generated artwork and exact prompts are documented below. Three images were generated in total: Modern, Classic, and one attempted Modern export correction. The correction preserved the art but did not fix the export properties.

**Current export status:** the two saved PNGs are RGB, 1254×1254, with slightly varying near-magenta backgrounds. They do not yet meet the required 1024×1024 / exact #FF00FF export specification, despite explicitly requesting both from the image tool. Deterministic resize and key-background normalization are awaiting the user's exception to the tool's image-processing restriction. Do not treat these current PNGs as final import-ready atlases. The intended final layout remains 4×4 at 1024×1024 (256 px cells).

Measured checks passed: both JSON documents parse; all sixteen cell names exist in both looks and are used; all piece times align to 12.5 ms; each flight lasts exactly 200 ms; one-shot endpoints satisfy every required time box; event simulation confirms peaks of 23, 4 and 30 sprites for aura, a fresh Ice Shards volley and stomp respectively. All sixteen generated cells contain art with at least ten source pixels clear at each cell boundary. In-game playback and final normalized-pixel checks remain outstanding.

### Generation prompts
#### Modern technical correction attempt

```text
Technical sprite-atlas correction of the attached image. Keep all sixteen assets EXACTLY as painted, same silhouettes, colors, material, positions and uniform 4x4 layout. Return a PNG that is EXACTLY 1024 pixels wide by EXACTLY 1024 pixels high, NOT 1254x1254. Resize uniformly to that required canvas. Replace ALL exposed background with one perfectly flat exact #FF00FF RGB(255,0,255), including every hole and all cell margins. Background must have ZERO noise, zero texture, zero gradient, zero variation. Do not change the artwork or add anything. No shadow, no text, no grid. This is a keyed game texture, absolute pixel size and exact key color are essential.
```
#### Classic style variant

```text
Use case: style-transfer. Create the CLASSIC material variant of the attached modern game-effect sprite atlas. EXACT same 16 silhouettes, shapes, positions, four rows and four columns, centered in matching cells. Same animation registration and object sizes. Change ONLY rendering style/material. Deliver exactly 1024x1024 PNG with invisible 4x4 uniform grid, 256x256 cells. Background MUST be flat pure RGB(255,0,255) magenta everywhere outside objects and in holes. No grid, no text, no labels, no ground and NO cast shadows.
Style: authentic late-2000s Flash strategy-game VFX, small pre-rendered 3ds Max 3D ice pieces. Muted dusty desaturated blue-gray ice and dirty off-white snow. SOFT GRAINY shading with deep near-black navy shadow sides; one soft upper-left light. Low gloss, only tiny soft highlights on wet ice. Reduce the modern glassy faceting and brilliant white sheen substantially, keep massive readable shapes. No outlines, no cel shading, no vector fills, no glow. The result must be visibly darker, dustier, rougher and softer than the input but still contrast clearly at small game sizes.
Preserve reading order: row1 scalloped frost bank / swept cold ground wake / hanging icicle sight visor / diagonal ice snap; row2 rightward long ice lance with trailing chips / single rightward triangular splinter / upright three-prong horn fan / left-right separated chill cuffs; row3 round branching fracture seen overhead / upright three-wedge ice eruption / chunky physical snow spray / open two-jaw flattened ground collar; row4 four consecutive impact frames (small contact, large burst, broken hollow burst, scattered six chips). No additional assets. All are isolated objects, no environment. Each stays within its own cell leaving at least 20px magenta clearance. Preserve the small first impact frame and consistent full animation extent in the other frames.
```
#### Modern generation

```text
Use case: stylized-concept. Production game VFX sprite atlas for Krampus frost abilities, crisp modern rendered 3D game art. Create exactly ONE square 1024x1024 PNG, an invisible uniform 4 columns by 4 rows grid, each cell 256x256. Sixteen isolated ice/snow assets. Every asset centered at its cell center, constrained within central 200x200, with at least 28 px untouched margin per cell. Entire background EXACT flat pure magenta RGB(255,0,255), including holes between fragments. No alpha. No gradients on background, no ground, NO cast shadows, no grid lines, no labels, no words, no numbers. NO characters, buildings, icons, rings or balls. Internal material shading is required.
Style: clean beveled stylized 3D ice, rich glacier blue, cyan-white tops, warm upper-left key, medium blue shadow facets, glossy crisp specular edges, no outlines, no cel shading, no flat vector fills. Large simple silhouettes that survive 20-80px rendering; avoid hairline detail. Snow is opaque physical granules, NEVER transparent mist or glow against magenta.
Reading order is mandatory:
Row 1 col 1: a short irregular scalloped frost bank, five joined low crystalline ridges and white snow crust, an open uneven horizontal crescent PATCH, not a ring, seen at 35-degree elevated game view, about 190 wide x80 high.
Row 1 col 2: three wind-combed icy snow tongues merged at their bases, swept left, broad horizontal floor patch at 35-degree view, 190x90.
Row 1 col 3: snowy sight-obscuring VISOR strip, one arched horizontal ridge with five thick hanging icicle teeth, no eye, no actual helmet, 180x80.
Row 1 col 4: fragmented ice snap, irregular diagonal comb of five short ice spikes with a central snow clump, 150x130.
Row 2 col 1: a vicious long SINGLE ice lance pointing EXACTLY RIGHT, broad chisel tip at right, two small detached ice chips behind at left, 190x65. Blue dark underside, bright sharp top.
Row 2 col 2: one thick irregular triangular ice splinter pointing right, 145x90.
Row 2 col 3: horn release fan, three curved tapering icy blades splaying upward from one compact snowy base, 170x140. Physical ice, not magical light.
Row 2 col 4: two separated jagged icy cuff patches left and right, empty magenta gap in middle for a flying creature's body, together 175x110. No closed ring.
Row 3 col 1: branching ground frost fracture, seven chunky jagged radial branches with white ice crust and dark blue recesses, irregular star footprint painted ROUND from directly ABOVE (will be vertically squashed in engine); open magenta gaps, not solid disc, about190x190.
Row 3 col 2: asymmetric ice eruption cluster, three big rising wedges with shorter broken spikes and frosty base, 175x145, elevated game camera, readable broad wedges.
Row 3 col 3: compact windblown physical SNOW spray, three chunky scalloped snow lobes tapering to two loose snow chips, 180x100, no smoke or transparency.
Row 3 col 4: broken jagged frozen collar for tower footing, two thick opposing frost jaws with wide open center, irregular flattened ellipse in game perspective, 190x95. Not a geometric ring.
Row 4 is a FOUR-FRAME ice impact flipbook at the SAME camera and scale, centered consistently, each cell 200x200 virtual extent. Frame1 col1: tight 70px-wide jagged white-blue ice contact core, with two short cracks. Frame2 col2: core explodes to 155px-wide angular five-pronged white-blue ice burst with several big blue chips. Frame3 col3: 190px-wide broken burst, central hole opens and six chunks separate outward. Frame4 col4: 195px-wide sparse six separated blue-white chips, center fully empty. NO circular glow, no outlined comic stars. Keep frame1 much smaller than frame2. All four frames share the exact same centered registration.
Output only the atlas.
```

