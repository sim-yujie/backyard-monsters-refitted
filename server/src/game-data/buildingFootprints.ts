/**
 * Building footprints, in yard units, one entry per building type id.
 *
 * The server has no building props table of its own — every building stat in
 * this project comes from the Flash client (`docs/specs/base-building.md` §3,
 * "Where the numbers live"). This table is therefore derived from two sources
 * and must agree with both:
 *
 * - `web/src/game/yard/buildingArtData.ts` — the generated props extract. Its
 *   `size` column is the props table's `size`, which is a build-menu size class
 *   for most buildings but *is* the footprint for decorations
 *   (`client/scripts/BDECORATION.as:20-25`). The per-row comment also carries
 *   the props `type`, which is what `decoration` below is taken from.
 * - `docs/specs/base-building.md` §2, "Footprints" — the per-class `_footprint`
 *   rectangles, which override `size` for every non-decoration. Mirrored in
 *   `web/src/game/yard/YardGrid.ts` as `FOOTPRINT_GROUPS`.
 *
 * Resolution order, identical to `footprintOf()` in `YardGrid.ts`:
 * type 127 is the only non-square (190 x 160, `client/scripts/INFERNOPORTAL.as:37`),
 * then the per-class footprint if the type has one, then the props `size`, then
 * a 40 x 40 fallback for a type with neither.
 *
 * Four ids are absent from the art extract because it covers the Map Room 2
 * main yard only, and are carried here from the spec's footprint table:
 * 7 (mushroom), 112 (outpost core), 128 (Housing Bunker), 130 (an Inferno tower).
 *
 * `decoration` drives two rules the Yard Planner needs: a decoration may be
 * placed outside the plot boundary (`client/scripts/BASE.as:4635-4640`), and a
 * decoration left unplaced does not block Apply
 * (`client/scripts/com/monsters/baseplanner/popups/BasePlannerPopup.as:127-142`).
 */
export interface Footprint {
  /** Extent along +X from the building's origin, in yard units. */
  w: number;
  /** Extent along +Y from the building's origin, in yard units. */
  h: number;
  /** Props `type == "decoration"`: ids 28-50, 55-111, 120, 121, 131 and 135. */
  decoration: boolean;
}

export const FOOTPRINTS: Record<number, Footprint> = {
  1: { w: 70, h: 70, decoration: false }, // Twig Snapper (resource)
  2: { w: 70, h: 70, decoration: false }, // Pebble Shiner (resource)
  3: { w: 70, h: 70, decoration: false }, // Putty Squisher (resource)
  4: { w: 70, h: 70, decoration: false }, // Goo Factory (resource)
  5: { w: 90, h: 90, decoration: false }, // Flinger (special)
  6: { w: 80, h: 80, decoration: false }, // Storage Silo (special)
  7: { w: 30, h: 30, decoration: false }, // Mushroom (—)
  8: { w: 100, h: 100, decoration: false }, // Monster Locker (special)
  9: { w: 80, h: 80, decoration: false }, // Monster Juicer (special)
  10: { w: 100, h: 100, decoration: false }, // Yard Planner (special)
  11: { w: 90, h: 90, decoration: false }, // Map Room (special)
  12: { w: 70, h: 70, decoration: false }, // General Store (special)
  13: { w: 100, h: 100, decoration: false }, // Hatchery (special)
  14: { w: 130, h: 130, decoration: false }, // Town Hall (special)
  15: { w: 160, h: 160, decoration: false }, // Housing (special)
  16: { w: 100, h: 100, decoration: false }, // Hatchery Control Center (special)
  17: { w: 20, h: 20, decoration: false }, // Block (wall)
  18: { w: 20, h: 20, decoration: false }, // Stone Block (wall)
  19: { w: 80, h: 80, decoration: false }, // Wild Monster Baiter (special)
  20: { w: 70, h: 70, decoration: false }, // Cannon Tower (tower)
  21: { w: 70, h: 70, decoration: false }, // Sniper Tower (tower)
  22: { w: 90, h: 90, decoration: false }, // Monster Bunker (tower)
  23: { w: 70, h: 70, decoration: false }, // Laser Tower (tower)
  24: { w: 20, h: 20, decoration: false }, // Booby Trap (trap)
  25: { w: 70, h: 70, decoration: false }, // Tesla Tower (tower)
  26: { w: 100, h: 100, decoration: false }, // Monster Academy (special)
  27: { w: 140, h: 140, decoration: false }, // Horsey (enemy)
  28: { w: 20, h: 20, decoration: true }, // American Flag (decoration)
  29: { w: 20, h: 20, decoration: true }, // British Flag (decoration)
  30: { w: 20, h: 20, decoration: true }, // Australian Flag (decoration)
  31: { w: 20, h: 20, decoration: true }, // Brazilian Flag (decoration)
  32: { w: 20, h: 20, decoration: true }, // European Flag (decoration)
  33: { w: 20, h: 20, decoration: true }, // French Flag (decoration)
  34: { w: 20, h: 20, decoration: true }, // Indonesian Flag (decoration)
  35: { w: 20, h: 20, decoration: true }, // Italian Flag (decoration)
  36: { w: 20, h: 20, decoration: true }, // Malaysian Flag (decoration)
  37: { w: 20, h: 20, decoration: true }, // Dutch Flag (decoration)
  38: { w: 20, h: 20, decoration: true }, // New Zealand Flag (decoration)
  39: { w: 20, h: 20, decoration: true }, // Norwegian Flag (decoration)
  40: { w: 20, h: 20, decoration: true }, // Polish Flag (decoration)
  41: { w: 20, h: 20, decoration: true }, // Swedish Flag (decoration)
  42: { w: 20, h: 20, decoration: true }, // Turkish Flag (decoration)
  43: { w: 20, h: 20, decoration: true }, // Canadian Flag (decoration)
  44: { w: 20, h: 20, decoration: true }, // Danish Flag (decoration)
  45: { w: 20, h: 20, decoration: true }, // German Flag (decoration)
  46: { w: 20, h: 20, decoration: true }, // Filipino Flag (decoration)
  47: { w: 20, h: 20, decoration: true }, // Singaporean Flag (decoration)
  48: { w: 20, h: 20, decoration: true }, // Austrian Flag (decoration)
  49: { w: 20, h: 20, decoration: true }, // Pirate Flag (decoration)
  50: { w: 20, h: 20, decoration: true }, // Peace Flag (decoration)
  51: { w: 90, h: 90, decoration: false }, // Catapult (special)
  52: { w: 40, h: 40, decoration: false }, // Simple Sign (taunt)
  53: { w: 10, h: 10, decoration: false }, // hwn_pumpkin (immovable)
  54: { w: 10, h: 10, decoration: false }, // hwn_massivepumpkin (immovable)
  55: { w: 30, h: 30, decoration: true }, // bdg_acorn (decoration)
  56: { w: 40, h: 40, decoration: true }, // bdg_beehive (decoration)
  57: { w: 30, h: 30, decoration: true }, // bdg_birdhous (decoration)
  58: { w: 40, h: 40, decoration: true }, // bdg_tent (decoration)
  59: { w: 20, h: 20, decoration: true }, // bdg_jax (decoration)
  60: { w: 20, h: 20, decoration: true }, // bdg_redgnome (decoration)
  61: { w: 20, h: 20, decoration: true }, // bdg_bluegnome (decoration)
  62: { w: 20, h: 20, decoration: true }, // bdg_greengnome (decoration)
  63: { w: 40, h: 40, decoration: true }, // bdg_hammock (decoration)
  64: { w: 40, h: 40, decoration: true }, // bdg_lawnchair (decoration)
  65: { w: 30, h: 30, decoration: true }, // bdg_outhouse (decoration)
  66: { w: 30, h: 30, decoration: true }, // bdg_pinecone (decoration)
  67: { w: 30, h: 30, decoration: true }, // bdg_rock (decoration)
  68: { w: 100, h: 100, decoration: true }, // bdg_scaleelectric (decoration)
  69: { w: 40, h: 40, decoration: true }, // bdg_scarecrow (decoration)
  70: { w: 40, h: 40, decoration: true }, // bdg_sundial (decoration)
  71: { w: 20, h: 20, decoration: true }, // bdg_tikitorch (decoration)
  72: { w: 30, h: 30, decoration: true }, // bdg_walnut (decoration)
  73: { w: 40, h: 40, decoration: true }, // bdg_tombstone (decoration)
  74: { w: 20, h: 20, decoration: true }, // bdg_pokeyhead (decoration)
  75: { w: 20, h: 20, decoration: true }, // bdg_octohead (decoration)
  76: { w: 20, h: 20, decoration: true }, // bdg_bolthead (decoration)
  77: { w: 20, h: 20, decoration: true }, // bdg_banditohead (decoration)
  78: { w: 20, h: 20, decoration: true }, // bdg_brainhead (decoration)
  79: { w: 20, h: 20, decoration: true }, // bdg_crabhead (decoration)
  80: { w: 20, h: 20, decoration: true }, // bdg_davehead (decoration)
  81: { w: 20, h: 20, decoration: true }, // bdg_eyerahead (decoration)
  82: { w: 20, h: 20, decoration: true }, // bdg_fanghead (decoration)
  83: { w: 20, h: 20, decoration: true }, // bdg_finkhead (decoration)
  84: { w: 20, h: 20, decoration: true }, // bdg_ichihead (decoration)
  85: { w: 20, h: 20, decoration: true }, // bdg_projectxhead (decoration)
  86: { w: 40, h: 40, decoration: true }, // bdg_blackberrybush (decoration)
  87: { w: 40, h: 40, decoration: true }, // bdg_bonsaitree (decoration)
  88: { w: 20, h: 20, decoration: true }, // bdg_cactus (decoration)
  89: { w: 70, h: 70, decoration: true }, // bdg_flytrap (decoration)
  90: { w: 40, h: 40, decoration: true }, // bdg_thorns (decoration)
  91: { w: 20, h: 20, decoration: true }, // bdg_pinkflowers (decoration)
  92: { w: 20, h: 20, decoration: true }, // bdg_purpleflowers (decoration)
  93: { w: 20, h: 20, decoration: true }, // bdg_redflowers (decoration)
  94: { w: 20, h: 20, decoration: true }, // bdg_whiteflowers (decoration)
  95: { w: 20, h: 20, decoration: true }, // bdg_yellowflowers (decoration)
  96: { w: 40, h: 40, decoration: true }, // bdg_baseballstatue (decoration)
  97: { w: 40, h: 40, decoration: true }, // bdg_footballstatue (decoration)
  98: { w: 40, h: 40, decoration: true }, // bdg_soccerstatue (decoration)
  99: { w: 70, h: 70, decoration: true }, // bdg_libertystatue (decoration)
  100: { w: 70, h: 70, decoration: true }, // bdg_eiffelstatue (decoration)
  101: { w: 70, h: 70, decoration: true }, // bdg_bigben (decoration)
  102: { w: 100, h: 100, decoration: true }, // bdg_pool (decoration)
  103: { w: 100, h: 100, decoration: true }, // bdg_pond (decoration)
  104: { w: 100, h: 100, decoration: true }, // bdg_zengarden (decoration)
  105: { w: 70, h: 70, decoration: true }, // bdg_fountain (decoration)
  106: { w: 100, h: 100, decoration: true }, // bdg_teagarden (decoration)
  107: { w: 20, h: 20, decoration: true }, // bdg_monsterskull (decoration)
  108: { w: 20, h: 20, decoration: true }, // bdg_rubikunsolved (decoration)
  109: { w: 20, h: 20, decoration: true }, // bdg_rubiksolved (decoration)
  110: { w: 40, h: 40, decoration: true }, // bdg_halloween (decoration)
  111: { w: 20, h: 20, decoration: true }, // bdg_halloween_small (decoration)
  112: { w: 130, h: 130, decoration: false }, // Outpost core (—)
  113: { w: 80, h: 80, decoration: false }, // Radio Tower (special)
  114: { w: 160, h: 160, decoration: false }, // Champion Cage (cage)
  115: { w: 70, h: 70, decoration: false }, // Aerial Defense Tower (tower)
  116: { w: 100, h: 100, decoration: false }, // Monster Lab (special)
  117: { w: 20, h: 20, decoration: false }, // Heavy Trap (trap)
  118: { w: 70, h: 70, decoration: false }, // Railgun (tower)
  119: { w: 100, h: 100, decoration: false }, // Champion Chamber (special)
  120: { w: 70, h: 70, decoration: true }, // bdg_biggulp (decoration)
  121: { w: 40, h: 40, decoration: true }, // bdg_wmitotem1 (decoration)
  127: { w: 190, h: 160, decoration: false }, // Inferno Cavern (enemy)
  128: { w: 160, h: 160, decoration: false }, // Housing Bunker (—)
  129: { w: 70, h: 70, decoration: false }, // Quake Tower (tower)
  130: { w: 70, h: 70, decoration: false }, // Inferno tower (—)
  131: { w: 40, h: 40, decoration: true }, // bdg_wmi2totem (decoration)
  132: { w: 70, h: 70, decoration: false }, // Magma Tower (tower)
  133: { w: 100, h: 100, decoration: false }, // b_siegefactory (special)
  134: { w: 100, h: 100, decoration: false }, // b_siegeworks (special)
  135: { w: 70, h: 70, decoration: true }, // bdg_dave_trophy (decoration)
  136: { w: 70, h: 70, decoration: false }, // bi_spurtzcannon (tower)
  137: { w: 70, h: 70, decoration: false }, // bi_blackspurtzcannon (tower)
  138: { w: 130, h: 130, decoration: false }, // b_stronghold (tower)
  139: { w: 130, h: 130, decoration: false }, // b_resourceop (cage)
  140: { w: 130, h: 130, decoration: false }, // b_opdefender (special)
};

/**
 * Footprint for a type with no entry above.
 *
 * `BASE.addBuildingB` falls back to a bare `BFOUNDATION` when the props entry
 * has no `cls`, and that never assigns a footprint, so the original game has no
 * answer either. 40 x 40 matches `DEFAULT_FOOTPRINT` in `YardGrid.ts`, so the
 * client and the server agree on the guess.
 */
export const DEFAULT_FOOTPRINT: Footprint = { w: 40, h: 40, decoration: false };

/** The mushroom type id. Mushrooms are yard obstacles, not buildings. */
export const MUSHROOM_TYPE = 7;

/** Footprint for a building type, falling back to {@link DEFAULT_FOOTPRINT}. */
export const footprintOf = (type: number): Footprint =>
  FOOTPRINTS[type] ?? DEFAULT_FOOTPRINT;

/** Whether a type is a decoration, and so exempt from plot bounds and Apply's placement check. */
export const isDecoration = (type: number): boolean =>
  footprintOf(type).decoration;
