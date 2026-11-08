/**
 * The Thanksgiving yard dress-up (owner, 8 Nov 2026): three looks were made
 * for the owner to choose from, switched with `?tgskin=a`, `b` or `c` on the
 * page's address. The owner chose C ("Look C but i dont need all the
 * haybales around (30% less leaves also)", 8 Nov), so C is the default, with
 * no hay bales and 30% fewer leaves than first drawn; A and B stay behind the
 * switch for now. Each look is three parts:
 *
 * - **Ground**: the usual seven grass images, recoloured once when the yard's
 *   ground is baked (`YardGround.ts`) by a luminance gradient map mixed over
 *   the original, as the Halloween set was made, so the blend still works.
 * - **Leaves**: painted fallen leaves (Codex, `props.png`) baked into the same
 *   ground block, so they cost nothing per frame.
 * - **Props** around the plot's edge, just outside it (`YardDressUp.ts`):
 *   painted hay bales, corn shocks, pumpkin piles and cornucopias in the
 *   Modern look; Flash's own scarecrow, pumpkins, acorns and pinecones in the
 *   Classic look (`game/classicLook.ts`), so Classic stays Flash art.
 *
 * A and B (and the switch) can go once C is settled.
 */

export type ThanksgivingSkinId = "a" | "b" | "c";

/** The painted props (Modern look), by name in `props.png`. */
export type PropName = "hay" | "corn" | "pumpkins" | "cornucopia";
export type LeafName = "leaf-red" | "leaf-orange" | "leaf-yellow" | "leaf-brown";

export interface ThanksgivingSkin {
  readonly id: ThanksgivingSkinId;
  /** For the review: what the look is. */
  readonly name: string;
  /**
   * The ground's gradient map, dark to light: `[luminance 0-255, [r, g, b]]`
   * stops, mixed over the original grass by `amount` (0 keeps the grass, 1 is
   * the map alone).
   */
  readonly ground: { readonly stops: readonly (readonly [number, readonly [number, number, number]])[]; readonly amount: number };
  /** The flat fill under the tiles, shown until they arrive. */
  readonly fill: number;
  /** Leaves per 1000 x 500 ground block, and which leaves (repeat a name to weight it). */
  readonly leaves: { readonly count: number; readonly kinds: readonly LeafName[] };
  /** The props laid along the plot edge, in turn, and the gap between them (world px). */
  readonly props: { readonly pattern: readonly PropName[]; readonly spacing: number };
}

export const SKINS: Readonly<Record<ThanksgivingSkinId, ThanksgivingSkin>> = {
  a: {
    id: "a",
    name: "Golden harvest: straw-gold grass, a light scatter of leaves, hay bales and corn shocks all round",
    ground: {
      stops: [
        [0, [44, 40, 16]],
        [90, [124, 112, 40]],
        [160, [180, 158, 66]],
        [255, [236, 216, 140]],
      ],
      amount: 0.62,
    },
    fill: 0x8a7e3c,
    leaves: { count: 36, kinds: ["leaf-orange", "leaf-red", "leaf-yellow", "leaf-brown"] },
    props: { pattern: ["hay", "corn", "pumpkins", "corn", "hay", "cornucopia"], spacing: 96 },
  },
  b: {
    id: "b",
    name: "Maple carpet: the grass stays green but warmer, thick red and orange leaves, pumpkin piles",
    ground: {
      stops: [
        [0, [36, 50, 18]],
        [110, [104, 116, 40]],
        [190, [164, 160, 70]],
        [255, [214, 204, 128]],
      ],
      amount: 0.38,
    },
    fill: 0x5e7a34,
    leaves: { count: 150, kinds: ["leaf-red", "leaf-red", "leaf-orange", "leaf-orange", "leaf-yellow", "leaf-brown"] },
    props: { pattern: ["pumpkins", "corn", "pumpkins", "cornucopia"], spacing: 130 },
  },
  c: {
    id: "c",
    name: "Late autumn: russet-brown ground, brown and orange leaves, nothing round the edge",
    ground: {
      stops: [
        [0, [44, 28, 16]],
        [90, [112, 70, 36]],
        [170, [168, 114, 60]],
        [255, [222, 180, 116]],
      ],
      amount: 0.7,
    },
    fill: 0x7a5432,
    // Owner, 8 Nov: 30% fewer leaves than the 80 first drawn, and nothing
    // round the yard (the corn shocks read as hay bales too).
    leaves: { count: 56, kinds: ["leaf-brown", "leaf-brown", "leaf-orange", "leaf-red", "leaf-yellow"] },
    props: { pattern: [], spacing: 115 },
  },
};

/** The look shown when the address names none: the owner's choice (8 Nov). */
export const DEFAULT_SKIN: ThanksgivingSkinId = "c";

/** The look `?tgskin=` asks for in `search` (the page's query string), else the default. */
export const skinIdFrom = (search: string): ThanksgivingSkinId => {
  const asked = new URLSearchParams(search).get("tgskin")?.trim().toLowerCase();
  return asked === "a" || asked === "b" || asked === "c" ? asked : DEFAULT_SKIN;
};

/** The look for this page. */
export const thanksgivingSkin = (): ThanksgivingSkin =>
  SKINS[skinIdFrom(typeof location === "undefined" ? "" : location.search)];

/** Where the Thanksgiving pictures are served (`server/public/assets/specialevent/thanksgiving/`). */
export const THANKSGIVING_ART = "/assets/specialevent/thanksgiving/";

/** The painted props and leaves, @2x (drawn at half size): `props.png`. */
export const PROPS_ART = `${THANKSGIVING_ART}props.png`;

/** Each picture's box in `props.png` (from `art-samples/thanksgiving/build_art.py`'s `props.json`). */
export const PROP_BOXES: Readonly<Record<PropName | LeafName, { x: number; y: number; w: number; h: number }>> = {
  hay: { x: 0, y: 0, w: 128, h: 108 },
  corn: { x: 130, y: 0, w: 103, h: 168 },
  pumpkins: { x: 235, y: 0, w: 120, h: 106 },
  cornucopia: { x: 357, y: 0, w: 128, h: 119 },
  "leaf-red": { x: 487, y: 0, w: 40, h: 18 },
  "leaf-orange": { x: 529, y: 0, w: 40, h: 19 },
  "leaf-yellow": { x: 571, y: 0, w: 38, h: 19 },
  "leaf-brown": { x: 611, y: 0, w: 38, h: 17 },
};

/** The painted pictures are @2x: drawn at this scale. */
export const PROP_SCALE = 0.5;

/**
 * Classic look: Flash's own decorations stand in for each painted prop, as a
 * small group (picture, offset from the spot in world px). Flash pictures are
 * drawn at their own size.
 */
const FLASH_DECOR = "/assets/buildings/decorations/";
export const CLASSIC_PROPS: Readonly<Record<PropName, readonly { readonly url: string; readonly dx: number; readonly dy: number }[]>> = {
  corn: [{ url: `${FLASH_DECOR}scarecrow/top.png`, dx: 0, dy: 0 }],
  hay: [
    { url: `${FLASH_DECOR}pumpkins_2/top.png`, dx: -12, dy: 0 },
    { url: `${FLASH_DECOR}pumpkins/top.png`, dx: 12, dy: 4 },
  ],
  pumpkins: [
    { url: `${FLASH_DECOR}pumpkins/top.png`, dx: -14, dy: -2 },
    { url: `${FLASH_DECOR}pumpkins_2/top.png`, dx: 10, dy: -4 },
    { url: `${FLASH_DECOR}pumpkins/top.png`, dx: 0, dy: 8 },
  ],
  cornucopia: [
    { url: `${FLASH_DECOR}acorn/top.png`, dx: -16, dy: 0 },
    { url: `${FLASH_DECOR}pinecone/top.png`, dx: 8, dy: -6 },
    { url: `${FLASH_DECOR}walnut/top.png`, dx: 4, dy: 10 },
  ],
};

/**
 * Recolours an RGBA pixel buffer in place by the look's gradient map: each
 * pixel's luminance picks a colour on the map, mixed over the pixel by
 * `amount`. Alpha is kept.
 */
export const recolourGround = (data: Uint8ClampedArray, skin: ThanksgivingSkin): void => {
  const { stops, amount } = skin.ground;
  // A 256-entry table, so the per-pixel work is a lookup and a mix.
  const table = new Uint8ClampedArray(256 * 3);
  for (let lum = 0; lum < 256; lum++) {
    let index = 0;
    while (index < stops.length - 2 && lum > stops[index + 1]![0]) index++;
    const [l0, c0] = stops[index]!;
    const [l1, c1] = stops[index + 1] ?? stops[index]!;
    const t = l1 === l0 ? 0 : Math.min(1, Math.max(0, (lum - l0) / (l1 - l0)));
    for (let channel = 0; channel < 3; channel++) {
      table[lum * 3 + channel] = c0[channel]! + (c1[channel]! - c0[channel]!) * t;
    }
  }
  const keep = 1 - amount;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
    data[i] = data[i]! * keep + table[lum * 3]! * amount;
    data[i + 1] = data[i + 1]! * keep + table[lum * 3 + 1]! * amount;
    data[i + 2] = data[i + 2]! * keep + table[lum * 3 + 2]! * amount;
  }
};

/** A small seeded generator (mulberry32), so one yard's leaves and props stay put between visits. */
export const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** One leaf on the ground block: which, where, turned how far (radians). */
export interface LeafSpot {
  readonly kind: LeafName;
  readonly x: number;
  readonly y: number;
  readonly angle: number;
}

/** Where the look's leaves lie on a `width` x `height` ground block, for this seed. */
export const leafSpots = (skin: ThanksgivingSkin, width: number, height: number, seed: number): LeafSpot[] => {
  const random = seeded(seed * 7919 + 17);
  const { count, kinds } = skin.leaves;
  return Array.from({ length: count }, () => ({
    kind: kinds[Math.floor(random() * kinds.length)] ?? kinds[0]!,
    x: random() * width,
    y: random() * height,
    angle: random() * Math.PI * 2,
  }));
};

/** One prop by the plot edge: which, and where its base stands (world px). */
export interface PropSpot {
  readonly prop: PropName;
  readonly x: number;
  readonly y: number;
}

/**
 * The props along the plot edge: walking each of the diamond's four sides
 * (`corners`, clockwise from the top), one every `spacing` px, pushed
 * `offset` px out from the side, with a little seeded jitter, the look's
 * pattern in turn. Corners get none, so two sides' props never pile up.
 */
export const propSpots = (
  skin: ThanksgivingSkin,
  corners: readonly { x: number; y: number }[],
  seed: number,
  offset = 34,
): PropSpot[] => {
  if (corners.length !== 4 || skin.props.pattern.length === 0) return [];
  const random = seeded(seed * 104729 + 3);
  const centre = {
    x: corners.reduce((sum, point) => sum + point.x, 0) / 4,
    y: corners.reduce((sum, point) => sum + point.y, 0) / 4,
  };
  const { pattern, spacing } = skin.props;
  const spots: PropSpot[] = [];
  let turn = 0;
  for (let side = 0; side < 4; side++) {
    const from = corners[side]!;
    const to = corners[(side + 1) % 4]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < spacing * 2) continue;
    // Outward: the side's normal that points away from the plot's centre.
    let nx = -dy / length;
    let ny = dx / length;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    if ((midX - centre.x) * nx + (midY - centre.y) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const count = Math.floor(length / spacing) - 1;
    const step = length / (count + 1);
    for (let index = 1; index <= count; index++) {
      const along = (index * step + (random() - 0.5) * spacing * 0.3) / length;
      const out = offset + random() * 14;
      spots.push({
        prop: pattern[turn++ % pattern.length]!,
        x: from.x + dx * along + nx * out,
        y: from.y + dy * along + ny * out,
      });
    }
  }
  return spots;
};
