# Krampus Frost aura — connected rime

Krampus carries a branching blue-white frost network whose connected roots meet beneath his hooves and fork into a broad, irregular outer fringe, making both ownership and approximate reach readable at a glance. Open gaps expose the grass, all ground frost draws beneath combatants and buildings, and only a tiny icicle brow marks each blinded tower; the field stays steady through the fight while the small root knot breathes almost imperceptibly. Opaque blue-white ice faces and blue shadow sides use normal blending in both looks, retaining their cold colour over green grass.

## Keyframes

`D = reach` is the actual aura DIAMETER, 560–850 world px; never pass its radius as reach. Time for held sprites is measured from attachment, and entry time is measured independently for each newly affected tower. Widths below describe the full square cell, including its padding; height follows squash.

| Time ms | Piece | Where | Size, world px | Motion | Opacity | Colour | Blend | Layer |
|---|---|---|---|---|---|---|---|---|
| 0 | frost_network | caster_feet, offset [0,0] | 1.08D wide × 0.54D high | Attached immediately; fixed size and orientation | 0.92 immediately | Painted blue-white; white tint | normal | ground |
| 0–6000; repeat | frost_network | Follows caster_feet | Unchanged | No orbit, spin, displacement or boundary pulse | Constant 0.92; hold 1 | Unchanged | normal | ground |
| 0 | hoof_rime | caster_feet, offset [0,0] | 120 × 60 | Attached beneath hooves, above frost_network | 0.94 immediately | Painted blue-white; white tint | normal | ground |
| 3000 | hoof_rime | Follows caster_feet | 124 × 62 | Midpoint of gentle size pulse | Constant 0.94 | Unchanged | normal | ground |
| 6000; repeat | hoof_rime | Follows caster_feet | Returns to 120 × 60 | Completes out-and-back pulse | Constant 0.94; hold 1 | Unchanged | normal | ground |
| Tower entry 0 | rime_brow | tower_top, offset [0,0] | 46 × 46 cell; visible brow about 40 × 15 | Fixed, attached immediately | 0.96 immediately | Painted blue-white; white tint | normal | air |
| Entry 0 → 20 → 64 → 320 | ice_snap | tower_top, offset [0,0] | 24 → 48 square cell, ease out; visible cluster about 15 → 30 | One short outward size expansion; no travel or rotation | 0 → 0.90 → 0.90 → 0; gone at 320 | Painted blue-white; white tint | normal | air |
| Every 6000 while held | rime_brow | Follows tower_top | Constant 46 × 46 cell | No movement, no flashing | Constant 0.96; hold 1 | Unchanged | normal | air |
| Tower exit 0 → 200 | rime_brow | Last/following tower_top | Unchanged | Toolkit release | Current opacity → 0 | Unchanged | normal | air |
| Krampus falls 0 → 200 | frost_network, hoof_rime, all remaining rime_brow | Their anchors | Freeze size at release | Toolkit release | Current opacity → 0 | Unchanged | normal | ground / air |

## Art and integration

- Both sheets are 1024 × 1024, a 2 × 2 grid with 512 × 512 cells. Reading order: frost_network, hoof_rime, rime_brow, ice_snap. Each sprite has clear keyed space around it. The sheets contain only solid art; no light sheet is needed.
- Remove exact RGB #ff00ff before filtering/mipmap generation. Use the entire 512-square cell with a centered pivot (0.5, 0.5). Do not recenter, auto-crop, or stretch the visible ice to the requested width: padding is included in the sizes above. If the atlas packer trims, preserve the original frame dimensions and center via trim metadata. Extrude non-magenta edge colours into transparent texels after keying to prevent sampling fringes.
- Both ground cells are painted round in TOP VIEW. Apply squash 0.5 once, to obtain the game's ground-plane projection. The other cells retain their square frames with squash 1; their artwork already has its intended narrow or scattered silhouette.
- The main field's art spans approximately 92% of its square. The 1.08D frame compensates for that gutter: its widest painted tips span approximately D, or 560–850 × 280–425 world px after projection. The irregular recesses fall inside this envelope and indicate an approximate boundary, not altered gameplay geometry. The authoritative tower-middle distance check remains unchanged.
- The network is ONE complete connected sprite, including its outer branches. Never distribute its cell as repeated patches. Keep its center at the caster's feet and orientation fixed in world axes across all eight headings. Follow translation every frame. There is no persistent trail left behind him.
- Draw frost_network first, hoof_rime second, then all monsters/buildings above the ground layer. Draw rime_brow and ice_snap in the air layer below health bars and existing status icons. The brow's visible strip is only about 15 world px high and covers a narrow part of the tower top; it never wraps or blankets the tower body.
- All held sprites use hold 1 and zero fade-in: they are present on the first rendered active frame and cannot blink at loop boundaries. Only hoof_rime changes size, by 3.3% over six seconds; the field boundary and the tower marker never move. Any entry snap still alive at tower exit should be released by the toolkit's 200 ms cancellation fade, without restarting it.
- One entry snap per false→true affected transition. Reuse an existing marker during rapid edge re-entry, reversing its release fade instead of spawning duplicate held sprites. An in-flight snap is reused/restarted on re-entry rather than stacked. This keeps the sprite budget bounded and prevents border jitter from accumulating flashes.
- Full-effects budget with eight towers: 2 caster sprites + 8 brows = 10 persistent sprites; 8 simultaneous entry snaps bring the maximum to 18. Releasing instances count in that budget; reuse the same per-tower slots on re-entry. No repeated count/ring groups are used, so the stated 40% reduction of repeated copies on low effects removes none of the reach information. Do not cull the only field or the held tower markers.
- At half scale the network still spans approximately 280–425 screen px, its broad branches remain substantial, the visible hoof knot is about 41 px across, and the brow is about 20 × 7.5 px. Frost should read from those silhouettes rather than from tiny texture detail.

## Modern and Classic

Modern uses clean sculpted ice with white faces, periwinkle-blue shaded facets, medium shadows and bright restrained highlights. Classic keeps the same cell arrangement and near-identical silhouettes but uses dusty blue-grey rime, soft grain, softer highlights and deeper shadow crevices, matching the older pre-rendered pieces. Both use the same timing, placement, sizes, opacities and white tint; the coloured artwork supplies the difference, and every sprite uses normal blending.

## Delivery checks and provenance

Two images were generated with the built-in image generation tool. Final PNG packaging normalizes the generated canvases to 1024 square and the chroma background to exact #ff00ff; the ice artwork is generated, not procedurally drawn. The JSON and sprite references are checked locally, along with cell gutters, colour and dimensions; this is an art/spec delivery, not an in-game runtime test.

<details>
<summary>Exact generation prompts</summary>

### Modern sheet

Use case: stylized-concept. Asset type: production game VFX sprite atlas for Backyard Monsters, Krampus frost aura. Generate EXACTLY 1024x1024 PNG, a 2 column x 2 row equal grid of four 512x512 cells. No grid lines, no text. Background EVERYWHERE not occupied by ice is exactly flat pure magenta #FF00FF, including all holes. No ground, no cast shadows, no glow, no transparency, no gradient on background.

Modern style: crisp beautifully rendered stylized 3D ice, bevelled layered shapes, upper-left warm-neutral key, medium blue shaded sides, white highlights, blue-violet/cornflower shadows. Solid opaque blue-white frost, absolutely no turquoise, cyan-green, teal or mint. Clear chunky readable silhouettes, restrained detail for tiny game sprites.

Top left cell centered at (256,256): one complete connected ground frost network, viewed strictly TOP DOWN, roughly ROUND footprint, outermost tips contained within x=24..488 y=24..488. Like natural hoarfrost spreading on a window, NOT a snowflake icon, NOT a star, NOT a ring. About 35 percent ice and 65 percent open magenta holes INSIDE the footprint. Twelve or so broad irregular branching fern-like ice veins connected across the whole area with substantial open irregular holes between. Branches emerge around a small central blue-white frozen knot. Near the circumference they branch into broad blunt irregular rime fans at many unequal angles, making a roughly circular but deeply scalloped broken boundary. Outer edge reads all around through many nearby forked tips; absolutely no continuous circular rim, no thin circle line, no radial starburst, no giant spikes, no solid disk. Coarse sculptural ice veins and fans with thick blue edges and white frosted faces, no hairlines or tiny sparkles. This is a shallow surface coating; no tall rocks or mountains. Strong organic asymmetry. The complete form must remain readable at 80px thumbnail. It will be squashed into an ellipse in the game.

Top right cell centered at (768,256), all art inside x=548..988 y=36..476: a compact roughly ROUND shallow frost-root knot for directly below a monster's hooves, seen strictly TOP DOWN. Five or six irregular interlocking blue-white frozen lobes with a few short forked fern ends and generous magenta holes between them. Irregular organic form, NOT a star or ring, no tall crystals. It will be squashed to an ellipse in game. Similar ice material to cell one, somewhat denser. No ground.

Bottom left cell centered at (256,768), art within x=32..480 y=680..856: a very low wide gently bowed icy eyebrow, viewed from front slightly above, a thin uneven crust of white rime with exactly five short chunky downward icicles of unequal length. Solid blue-violet sides and frosty white top. Width about 430px height about 150px. No eye, no face, no tower, just the small hanging icicle trim to overlay near the top of a tower. Avoid a thick snow cap; the top band is thin.

Bottom right cell centered at (768,768), art within x=568..968 y=568..968: one sparse group of exactly five small broken chunky ice chips arranged around an EMPTY center, forming a compact irregular outward snap with wide magenta gaps. No enclosing disk or ring, no glow, no impact spikes. Each chip a simple bevelled glossy blue-white solid fragment. All four cells isolated with large clean magenta gutters.

### Classic sheet

Use case: style-transfer. Make the CLASSIC 2009 Flash-game version of this production game VFX sprite sheet. Input image is the exact layout and silhouette reference. Preserve the same four sprites in the exact same relative positions within a 2x2 equal cell grid. Output canvas EXACTLY 1024x1024. Crucial: replace background with FLAT EXACT PURE MAGENTA RGB(255,0,255) hex #FF00FF, uniformly everywhere outside the ice and inside holes. No noise or gradients on the background.

Change the rendering of ice to late-2000s 3ds Max small pre-rendered sprites: softly grainy natural rime, dusty blue-white faces, softly rounded low-relief forms, gentle upper-left key light, deep blue-grey to near-black shadow sides in crevices, very small soft highlights. Muted but definitively BLUE frost: use pale periwinkle white, slate BLUE shadows and neutral white tops, never green, mint, turquoise or teal. No faceted low-poly triangles, no flat-vector fills, no cel shading, no drawn outlines, no cartoon gloss. Do not include any ground or cast shadows. Maintain clear substantial blue-white silhouettes readable when tiny.

Top left: preserve the single connected round-footprint branching frost network with lots of open magenta holes and irregular branching lobed edge; 2D ground coating seen strictly TOP DOWN. Preserve maximum diameter about 92% of cell width, centered. No circle line, no ring, no filled disc, no snowflake icon. Top right: the compact round-footprint frost-root knot, TOP DOWN, centered, same size and silhouette. Bottom left: thin wide ice brow with five hanging icicles, same size and position. Bottom right: same five isolated chips around an empty middle, same size and position. No additional art, no lettering, no labels, no grid lines. The two upper ground sprites will be squashed to 2:1 ellipses by the game.

</details>

