import {
  BOULDER_FRAME,
  CANOPY_SHARE,
  CLEARING_CUT,
  CLEARING_INNER,
  CLEARING_OUTER,
  CROWN_BUMP,
  CROWN_GRID,
  EDGE_WANDER,
  FEATURE_GRID,
  FEATURE_RADIUS,
  CATTAIL_FRAME,
  GOO_CHANCE,
  GOO_DEEP,
  GOO_FLAT,
  GOO_GRID,
  GOO_SIZE,
  ISLET_INNER,
  ISLET_LIFT,
  ISLET_OUTER,
  LILY_FRAME,
  LOG_FRAME,
  LOW_REEDS_FRAME,
  MARSH_FADE,
  MARSH_GRID,
  MARSH_PIECES,
  MARSH_WATER_LEVEL,
  MARSH_WATER_SCALE,
  PINE_FRAME,
  REED_TUFT_FRAME,
  ROCK_FADE,
  SHORE_CUT,
  SHORE_END,
  SHORE_START,
  TREE_FRAME,
  WET_ROCK_FRAME,
} from "./canopy";
import { Ground, LandFeature } from "./groundKinds";

const f = (value: number): string => value.toFixed(4);

/**
 * The ground shader's canopy forests, rock fields and goo marsh (plan step 6; `canopy.ts` has the
 * rules and their TypeScript twin). Pasted into `groundShader.ts` before `main`, which calls
 * `featuresNear`, `canopyEdge`, `canopyColour`, `marshColour`, `drawFeatures` and `drawMarsh`.
 */
export const CANOPY_GLSL = `
const float FEATURE_RADIUS = ${f(FEATURE_RADIUS)};
const float CANOPY_SHARE = ${f(CANOPY_SHARE)};
const float EDGE_WANDER = ${f(EDGE_WANDER)};
const float CROWN_BUMP = ${f(CROWN_BUMP)};
const float CROWN_GRID = ${f(CROWN_GRID)};
const float CLEARING_INNER = ${f(CLEARING_INNER)};
const float CLEARING_OUTER = ${f(CLEARING_OUTER)};
const float CLEARING_CUT = ${f(CLEARING_CUT)};
const float SHORE_START = ${f(SHORE_START)};
const float SHORE_END = ${f(SHORE_END)};
const float SHORE_CUT = ${f(SHORE_CUT)};
const vec2 ROCK_FADE = vec2(${f(ROCK_FADE[0])}, ${f(ROCK_FADE[1])});
const vec2 MARSH_FADE = vec2(${f(MARSH_FADE[0])}, ${f(MARSH_FADE[1])});
const float MARSH_WATER_SCALE = ${f(MARSH_WATER_SCALE)};
const vec2 MARSH_WATER_LEVEL = vec2(${f(MARSH_WATER_LEVEL[0])}, ${f(MARSH_WATER_LEVEL[1])});
const float ISLET_INNER = ${f(ISLET_INNER)};
const float ISLET_OUTER = ${f(ISLET_OUTER)};
const float ISLET_LIFT = ${f(ISLET_LIFT)};
const float GOO_GRID = ${f(GOO_GRID)};
const float GOO_CHANCE = ${f(GOO_CHANCE)};
const vec2 GOO_SIZE = vec2(${f(GOO_SIZE[0])}, ${f(GOO_SIZE[1])});
const float GOO_FLAT = ${f(GOO_FLAT)};
const float GOO_DEEP = ${f(GOO_DEEP)};
const float MARSH_GRID = ${f(MARSH_GRID)};
// The sprite pieces' grid (a share of a cell's width); a piece is at most two squares wide and tall.
const float FEATURE_GRID = ${f(FEATURE_GRID)};
// The canopy's shadow on the meadow: cast down and right (the sun is top-left), hex units.
const vec2 CANOPY_SHADOW = vec2(0.1, 0.16);
const float CANOPY_SCALE = 0.62;
// The marsh (mock-up B): wet mossy banks, dark wet mud at the water's edge, shallow water lighter
// by the bank, and the glowing lime goo with its dark outline, glow and rings.
const vec3 MARSH_BANK = vec3(0.33, 0.45, 0.13);
const vec3 MARSH_MUD = vec3(0.19, 0.22, 0.09);
const vec3 MARSH_SHALLOW = vec3(0.35, 0.45, 0.19);
const vec3 MARSH_WATER = vec3(0.2, 0.3, 0.15);
const vec3 MARSH_WATER_TEX = vec3(0.286, 0.38, 0.184);
const vec3 MARSH_REFLECT = vec3(0.46, 0.56, 0.46);
const vec3 GOO_EDGE = vec3(0.47, 0.78, 0.03);
const vec3 GOO = vec3(0.64, 0.93, 0.04);
const vec3 GOO_LIGHT = vec3(0.86, 1.0, 0.42);
const vec3 GOO_RIM = vec3(0.16, 0.32, 0.06);
const vec3 GOO_GLOW = vec3(0.5, 0.82, 0.12);

struct Features {
  vec3 share;     // forest, rocks, marsh (0..1)
  float water;    // the water's share
  float clearing; // how much of a camp's clearing in a forest (0..1)
  float islet;    // how much of a camp's mossy island in a marsh (0..1)
};

// The features' smooth shares round hex point h (canopy.ts featureShares).
Features featuresNear(vec2 h) {
  Features fe;
  fe.share = vec3(0.0);
  fe.water = 0.0;
  fe.clearing = 0.0;
  fe.islet = 0.0;
  vec2 qr = roundAxial(axialOf(h));
  float sw = 0.0;
  for (int k = 0; k < 7; k++) {
    vec2 cell = k == 6 ? qr : qr + NEIGHBOURS[k];
    vec2 d = h - centreOf(cell);
    float r2 = dot(d, d) / (FEATURE_RADIUS * FEATURE_RADIUS);
    if (r2 >= 1.0) continue;
    vec4 t = cellAt(toOffset(cell));
    int g = groundOf(t);
    if (g >= ${Ground.FOG}) continue;
    float u = 1.0 - r2;
    float w = u * u * u;
    sw += w;
    if (isWater(g)) { fe.water += w; continue; }
    int lf = int(t.g * 255.0 + 0.5);
    if (lf == ${LandFeature.FOREST}) {
      fe.share.x += w;
      if (occupiedOf(t)) fe.clearing = max(fe.clearing, 1.0 - smoothstep(CLEARING_INNER, CLEARING_OUTER, length(d)));
    }
    else if (lf == ${LandFeature.ROCKS}) fe.share.y += w;
    else if (lf == ${LandFeature.MARSH}) {
      fe.share.z += w;
      if (occupiedOf(t)) fe.islet = max(fe.islet, 1.0 - smoothstep(ISLET_INNER, ISLET_OUTER, length(d)));
    }
  }
  if (sw > 1e-4) {
    fe.share /= sw;
    fe.water /= sw;
  }
  return fe;
}

// Rounded treetops: a dome (0..1) on each jittered crown, the highest one round h.
float crowns(vec2 h) {
  vec2 p = h / CROWN_GRID;
  vec2 base = floor(p);
  float best = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = base + vec2(float(i), float(j));
      vec2 c = id + 0.2 + 0.6 * vec2(hash12(id + 3.1), hash12(id + 8.7));
      float r = 0.6 + 0.3 * hash12(id + 5.5);
      float d = length(p - c) / r;
      best = max(best, sqrt(max(0.0, 1.0 - d * d)));
    }
  }
  return best;
}

// The canopy's edge value at hex point h (> 0 is canopy): canopy.ts canopyEdge plus its wander and
// crowns. The crowns are skipped far from any forest, where they cannot matter.
float canopyEdge(vec2 h, Features fe) {
  float e = fe.share.x - CANOPY_SHARE - CLEARING_CUT * fe.clearing
    - SHORE_CUT * smoothstep(SHORE_START, SHORE_END, fe.water);
  if (fe.share.x < 0.02) return e;
  e += EDGE_WANDER * (fbm(h * 1.1 + 61.0) - 0.5) * 2.0;
  e += CROWN_BUMP * (crowns(h) - 0.5);
  return e;
}

// The canopy's treetops (mock-up B): jittered domes on a grid of the given size (hex units), radius
// rMin..rMin + rSpan of a grid square. Returns how far up the front dome the point is (0 at its rim
// or in a gap, 1 at its top); n is its surface's slant, crease the line where two domes meet (1 on
// it), roll the dome's own random number. A dome lower on the screen stands in front of the one
// above it.
float dome(vec2 p, float rMin, float rSpan, float seed, out vec2 n, out float crease, out float roll) {
  vec2 base = floor(p);
  float best = -1.0;
  float second = -1.0;
  float top = 0.0;
  n = vec2(0.0);
  roll = 0.5;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 id = base + vec2(float(i), float(j));
      vec2 c = id + 0.2 + 0.6 * vec2(hash12(id + 3.1 + seed), hash12(id + 8.7 + seed));
      float r = rMin + rSpan * hash12(id + 5.5 + seed);
      vec2 d = (p - c) / r;
      float d2 = dot(d, d);
      if (d2 >= 1.0) continue;
      float z = sqrt(1.0 - d2);
      float rank = z * r + 0.3 * c.y;
      if (rank > best) {
        second = best;
        best = rank;
        top = z;
        n = d;
        roll = hash12(id + 13.3 + seed);
      } else if (rank > second) second = rank;
    }
  }
  crease = second > -1.0 ? 1.0 - smoothstep(0.0, 0.16, best - second) : 0.0;
  return top;
}

const vec3 CROWN_LIGHT = vec3(-0.5, -0.62, 0.6);

// The canopy's colour (mock-up B): big rounded treetops with deep shade in the gaps between them,
// sunlit and warmer on their top-left sides; the canopy texture's small painted crowns are the leaf
// clumps on each. Patches of lighter and deeper green run across the mass, and the crowns darken
// towards its edge.
vec3 canopyColour(vec2 uv, vec2 dx, vec2 dy, vec2 h, float e, float cellPixels) {
  // Lumpy crown outlines: the crowns' grid warped a little at the clumps' size, and on High a finer
  // fringe of leaves (faded as the cells get small, before it can shimmer).
  vec2 warp = vec2(valueNoise(h * 9.0 + 1.3), valueNoise(h * 9.0 + 7.9)) - 0.5;
  if (uQuality > 1.5) warp += 0.4 * smoothstep(90.0, 160.0, cellPixels) * (vec2(valueNoise(h * 31.0 + 4.1), valueNoise(h * 31.0 + 2.6)) - 0.5);
  vec2 cn;
  float crease;
  float roll;
  float top = dome(h / CROWN_GRID + 0.22 * warp, 0.58, 0.3, 0.0, cn, crease, roll);
  vec3 c = sampleGround(${Ground.CANOPY}, uv * CANOPY_SCALE, dx * CANOPY_SCALE, dy * CANOPY_SCALE);
  c = pow(c, vec3(1.22, 1.12, 1.0)) * 0.88;
  vec3 n = normalize(vec3(cn, max(top, 0.05) * 0.75));
  float lit = max(0.0, dot(n, normalize(CROWN_LIGHT)));
  float ao = mix(0.24, 1.0, smoothstep(0.0, 0.6, top)) * (1.0 - 0.34 * crease);
  c *= mix(0.56, 1.5, lit) * ao;
  // Sunlit tops turn warmer, yellow-green; the shade bluer.
  c = mix(c * vec3(0.88, 0.96, 1.1), c * vec3(1.2, 1.08, 0.64), smoothstep(0.4, 0.85, lit));
  // Each crown its own green: some yellower, some bluer.
  c *= mix(vec3(0.92, 0.98, 1.06), vec3(1.08, 1.03, 0.86), roll);
  float patchy = valueNoise(h * 0.55 + 3.0);
  c *= mix(vec3(0.84, 0.9, 0.92), vec3(1.05, 1.04, 0.96), smoothstep(0.2, 0.8, patchy));
  c *= mix(0.8, 1.0, smoothstep(0.0, 0.16, e));
  return c;
}

// A smooth two-octave noise for the marsh's water: rounded pools and banks, not ragged ones.
float marshNoise(vec2 p) {
  return 0.7 * valueNoise(p) + 0.3 * valueNoise(p * 2.1 + 5.0);
}

// How deep into the marsh a point is (0 at its fading edge, 1 well in), from its share and a ragged noise.
float marshDeep(float share, float ragged) {
  return smoothstep(0.55, 0.95, share + 0.3 * ragged);
}

// The marsh's water at hex point h (canopy.ts marshWaterLevel): > 0 is water, < 0 the bank.
float marshWet(vec2 h, float deep, float islet) {
  float level = mix(MARSH_WATER_LEVEL.x, MARSH_WATER_LEVEL.y, deep) + ISLET_LIFT * islet;
  return marshNoise(h * MARSH_WATER_SCALE + 77.0) - level;
}

// The goo pool of grid square id (canopy.ts gooPool): its distance at h in the pool's own round space
// (the camera's slant undone, so its rings come out as flat ovals), < 0 inside; centre is its middle.
float gooSquare(vec2 id, vec2 h, out vec2 centre) {
  centre = vec2(1e4);
  if (hash12(id + 71.3) > GOO_CHANCE) return 1e4;
  float rx = mix(GOO_SIZE.x, GOO_SIZE.y, hash12(id + 1.7));
  float room = max(0.0, GOO_GRID * 0.5 - 1.7 * rx);
  centre = (id + 0.5) * GOO_GRID + room * (2.0 * vec2(hash12(id + 2.9), hash12(id + 4.3)) - 1.0) * vec2(1.0, 0.6);
  vec2 q = (h - centre) * vec2(1.0, 1.0 / GOO_FLAT);
  float dist = length(q) - rx;
  float turn = hash12(id + 6.1) * 6.2832;
  float side = 3.1416 * (0.75 + 0.5 * hash12(id + 8.9));
  for (int k = 0; k < 2; k++) {
    float angle = turn + (k == 0 ? 0.0 : side);
    float r = rx * (0.55 + 0.15 * cos(angle * 3.0));
    float lobe = length(q - vec2(cos(angle), sin(angle)) * rx * 0.95) - r;
    float m = clamp(0.5 + 0.5 * (lobe - dist) / 0.08, 0.0, 1.0);
    dist = mix(lobe, dist, m) - 0.08 * m * (1.0 - m);
  }
  // A slow wobble on the edge, so no pool is a clean oval.
  return dist + 0.05 * (valueNoise(q * 5.0 + id * 3.7) - 0.5);
}

// The nearest goo pool round h: the pools of the four grid squares nearest it (a pool's body stays in
// its square; its glow and rings can reach the next one).
float gooNear(vec2 h, out vec2 centre) {
  vec2 base = floor(h / GOO_GRID - 0.5);
  float best = 1e4;
  centre = vec2(1e4);
  for (int k = 0; k < 4; k++) {
    vec2 c;
    float d = gooSquare(base + vec2(float(k % 2), float(k / 2)), h, c);
    if (d < best) { best = d; centre = c; }
  }
  return best;
}

// The marsh (mock-up B): mostly shallow dark-green water (its texture), between wet mossy banks with
// dark mud at the water's edge, and glowing lime goo pools with a dark outline, a soft glow and faint
// rings on the water round them. deep is how far inside the marsh (0 at its fading edge, 1 well in).
vec3 marshColour(vec3 land, vec3 water, vec2 h, float deep, float islet) {
  vec3 c = mix(land, MARSH_BANK, 0.45) * (0.9 + 0.2 * valueNoise(h * 3.1 + 9.0));
  float wet = marshWet(h, deep, islet);
  vec2 pc;
  float goo = gooNear(h, pc);
  // A pool only well inside the marsh and off a camp's island; it always lies in water.
  if (goo < 0.45) {
    Features at = featuresNear(pc);
    float pd = marshDeep(at.share.z, valueNoise(pc * 1.3 + 5.0) - 0.5);
    if (pd < GOO_DEEP || at.islet > 0.05 || at.water > 0.01) goo = 1e4;
  }
  wet = max(wet, 0.1 - 0.45 * max(goo, 0.0));
  float aw = max(fwidth(wet), 1e-4);
  float inWater = smoothstep(-aw, aw, wet);
  float rim = smoothstep(-0.035, -0.005, wet) * (1.0 - inWater);
  c = mix(c, MARSH_MUD, 0.5 * rim);
  // The water texture is soft; mock-up B's water swings from near-black green to pale sky reflections.
  vec3 w = MARSH_WATER + clamp((water - MARSH_WATER_TEX) * 2.2, vec3(-0.2), vec3(0.1));
  float sky = smoothstep(0.55, 0.85, valueNoise(h * vec2(0.9, 2.4) + 41.0));
  w = mix(w, MARSH_REFLECT, 0.4 * sky);
  w = mix(w, MARSH_SHALLOW, 0.55 * (1.0 - smoothstep(0.0, 0.07, wet)));
  w *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.02, wet));
  c = mix(c, w, inWater);
  float ag = min(max(fwidth(goo), 1e-4), 0.05);
  if (goo > 0.4) return c;
  float outside = max(goo, 0.0);
  c = mix(c, GOO_GLOW, 0.3 * exp(-outside / 0.05) * smoothstep(-ag, ag, goo));
  float broken = smoothstep(0.25, 0.6, valueNoise(h * 4.0 + 17.0));
  float rings = (1.0 - smoothstep(0.0, 0.008 + ag, abs(goo - 0.07))) * 0.35 * broken;
  c = mix(c, GOO_LIGHT * 0.85, rings * smoothstep(0.0, 0.02, goo));
  float inner = -min(goo, 0.0);
  vec3 body = mix(GOO_EDGE, GOO, smoothstep(0.0, 0.08, inner));
  // Lighter swirls following the pool's shape (inner contours, broken up) and a wet glint.
  float swirl = valueNoise((h - pc) * vec2(5.0, 9.0) + pc * 3.0);
  float contour = (1.0 - smoothstep(0.0, 0.01 + ag, abs(inner - 0.05 - 0.03 * swirl)))
    + 0.8 * (1.0 - smoothstep(0.0, 0.01 + ag, abs(inner - 0.12 - 0.05 * swirl)));
  body = mix(body, GOO_LIGHT, 0.75 * contour * smoothstep(0.3, 0.6, swirl));
  body = mix(body, vec3(0.95, 1.0, 0.7), 0.6 * smoothstep(0.72, 0.8, swirl) * smoothstep(0.06, 0.1, inner));
  body = mix(GOO_RIM, body, smoothstep(0.004, 0.022 + ag, inner));
  return mix(c, body, smoothstep(ag, -ag, goo));
}

// The sprite pieces (edge trees, pines, boulders, stones; the marsh's pieces) stand on jittered
// grids. Which piece a grid square holds, if any, hangs on the square alone, never on the pixel, so
// it is worked out once per square by a small program of its own (PlacementLayer.ts, plan step
// 10: done per pixel, these checks made the ground shader take 40 s to compile on Windows) and the
// ground shader only reads the answer (placedAt) and draws the sprite.

// A feature square's foot and frame size (world points).
void featureSquare(vec2 id, out vec2 foot, out float s) {
  float grid = FEATURE_GRID * uCellPoints;
  foot = (id + vec2(hash12(id + 21.7), hash12(id + 33.1))) * grid;
  s = grid * (1.55 + 0.45 * hash12(id + 12.4));
}

// Which edge tree, pine, boulder or stone stands on square id, if any (each kept only where its
// foot suits it, checked with the same shares as the pixel), as a placement texel: r frame + 1, g
// size, b flags (1 cut to the frame's top 0.7: a pine poking out of the canopy; 2 a tree, which
// fades with the trees). density is the Quality's share (canopy.ts).
vec4 featurePlace(vec2 id, float density) {
  vec4 none = vec4(0.0, 0.0, 0.0, 1.0);
  float pick = hash12(id * 0.77 + 5.3);
  if (pick > density) return none;
  vec2 foot;
  float s;
  featureSquare(id, foot, s);
  vec2 fh = foot / uUnit;
  vec2 off;
  vec4 t = trueCellAt(fh, off);
  if (!isLand(groundOf(t))) return none;
  Features fe = featuresNear(fh);
  if (fe.water > 0.01 || max(fe.share.x, max(fe.share.y, fe.share.z)) < 0.12) return none;
  if (riverAt(foot).y > -0.04) return none;
  bool occupied = occupiedOf(t);
  float roll = hash12(id + 47.9);
  float kind = hash12(id + 63.1);
  int frame = -1;
  float size = 1.0;
  float flags = 0.0;
  if (fe.share.x > 0.05) {
    float e = canopyEdge(fh, fe);
    bool clear = occupied && length(off) < CLEARING_OUTER + 0.12;
    if (e > 0.1) {
      if (roll < 0.09) { frame = ${PINE_FRAME} + int(kind * 4.0); size = 1.0; flags = 3.0; }
    } else if (e < -0.005 && e > -0.12 && !clear) {
      if (roll < 0.8) { frame = kind < 0.75 ? ${TREE_FRAME} + int(kind / 0.75 * 4.0) : ${PINE_FRAME} + int((kind - 0.75) * 16.0); flags = 2.0; }
    } else if (e <= -0.12 && e > -0.34 && !clear) {
      if (roll < 0.22 * (1.0 + e / 0.34)) { frame = kind < 0.6 ? ${TREE_FRAME} + int(kind / 0.6 * 4.0) : ${PINE_FRAME} + int((kind - 0.6) * 10.0); size = 0.85; flags = 2.0; }
    }
  }
  if (frame < 0 && fe.share.y > 0.2 && !(occupied && length(off) < 0.45)) {
    float rocky = smoothstep(0.25, 0.8, fe.share.y);
    if (roll < 0.36 * rocky) { frame = ${BOULDER_FRAME} + int(kind * 4.0); size = 0.8 + 0.2 * rocky; }
    else if (roll < 0.66 * rocky) { frame = kind < 0.5 ? 6 : 8; size = 0.55; }
  }
  if (frame < 0) return none;
  return vec4(float(frame + 1) / 255.0, size, flags / 255.0, 1.0);
}

// Edge trees, pines, boulders and stones (placed by featurePlace). near fades the small pieces out
// as cells get small, trees fades the trees.
vec3 drawFeatures(vec3 colour, vec2 p, vec2 wdx, vec2 wdy, float trees, float near, float density) {
  float grid = FEATURE_GRID * uCellPoints;
  vec2 first = floor(p / grid) - vec2(1.0, 0.0);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 id = first + vec2(float(i), float(j));
      if (hash12(id * 0.77 + 5.3) > density) continue;
      vec2 foot;
      float s;
      featureSquare(id, foot, s);
      vec2 local = (p - foot) / s + vec2(0.5, 1.0);
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) continue;
      vec4 placed = placedAt(id, uFeatureRect, uPlaceAt.z);
      int frame = int(placed.r * 255.0 + 0.5) - 1;
      if (frame < 0) continue;
      int flags = int(placed.b * 255.0 + 0.5);
      float size = placed.g;
      float fade = (flags & 2) != 0 ? trees : near;
      if (fade <= 0.0) continue;
      // A smaller piece keeps its foot where it was; it shrinks inside the same frame.
      vec2 at = vec2(0.5 + (local.x - 0.5) / size, 1.0 - (1.0 - local.y) / size);
      if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) continue;
      vec4 sprite = spriteSample(frame, p, foot, s * size, hash12(id + 9.9) < 0.5, wdx, wdy) * fade;
      if ((flags & 1) != 0) sprite *= 1.0 - smoothstep(0.6, 0.74, at.y);
      if (frame == 6 || frame == 8) sprite.rgb = darken(sprite, STONE_GAMMA);
      colour = colour * (1.0 - sprite.a) + sprite.rgb;
    }
  }
  return colour;
}

// A marsh square's foot and frame size (world points).
void marshSquare(vec2 id, out vec2 foot, out float s) {
  float grid = MARSH_GRID * uCellPoints;
  foot = (id + vec2(hash12(id + 21.7), hash12(id + 33.1))) * grid;
  s = grid * (1.6 + 0.4 * hash12(id + 12.4));
}

// The marsh's pieces (mock-up B) on their own, larger jittered grid: tall cattail clumps (most by the
// water's edge), reed tufts, lily pad clusters on the water, wet rocks by the bank and now and then a
// fallen log; none on a camp's island or in a goo pool. Which one square id holds, as a placement
// texel (r frame + 1, g size); density as featurePlace.
vec4 marshPlace(vec2 id, float density) {
  vec4 none = vec4(0.0, 0.0, 0.0, 1.0);
  if (hash12(id * 0.61 + 2.9) > density) return none;
  vec2 foot;
  float s;
  marshSquare(id, foot, s);
  vec2 fh = foot / uUnit;
  vec2 off;
  vec4 t = trueCellAt(fh, off);
  if (!isLand(groundOf(t))) return none;
  Features fe = featuresNear(fh);
  if (fe.share.z < 0.3 || fe.water > 0.01 || fe.islet > 0.3) return none;
  if (riverAt(foot).y > -0.04) return none;
  float deep = marshDeep(fe.share.z, valueNoise(fh * 1.3 + 5.0) - 0.5);
  float wet = marshWet(fh, deep, fe.islet);
  vec2 pc;
  if (gooNear(fh, pc) < 0.04) return none;
  float inMarsh = smoothstep(0.3, 0.7, fe.share.z);
  float edge = 1.0 - smoothstep(0.0, 0.12, abs(wet));
  float roll = hash12(id + 47.9);
  float kind = hash12(id + 63.1);
  float reeds = ${MARSH_PIECES.reeds.toFixed(3)} * inMarsh * (0.55 + 0.9 * edge);
  float lilies = reeds + ${MARSH_PIECES.lilies.toFixed(3)} * inMarsh;
  float rocks = lilies + ${MARSH_PIECES.rocks.toFixed(3)} * inMarsh;
  float logs = rocks + ${MARSH_PIECES.log.toFixed(3)} * inMarsh;
  int frame = -1;
  float size = 1.0;
  if (roll < reeds) {
    frame = kind < 0.78 ? ${CATTAIL_FRAME} + int(kind / 0.78 * 6.0) : kind < 0.9 ? ${REED_TUFT_FRAME} : ${LOW_REEDS_FRAME};
    size = 0.82 + 0.18 * hash12(id + 2.2);
  } else if (roll < lilies) {
    if (wet <= 0.03) return none;
    frame = ${LILY_FRAME} + (kind < 0.5 ? 0 : 1);
    size = 0.62;
  } else if (roll < rocks) {
    if (abs(wet) >= 0.09) return none;
    frame = kind < 0.6 ? ${WET_ROCK_FRAME} : ${BOULDER_FRAME} + int(kind * 7.0) % 4;
    size = 0.55;
  } else if (roll < logs) {
    if (wet <= 0.0 || deep <= 0.5) return none;
    frame = ${LOG_FRAME};
    size = 0.95;
  }
  if (frame < 0) return none;
  return vec4(float(frame + 1) / 255.0, size, 0.0, 1.0);
}

// The marsh's pieces (placed by marshPlace); near as drawFeatures.
vec3 drawMarsh(vec3 colour, vec2 p, vec2 wdx, vec2 wdy, float near, float density) {
  float grid = MARSH_GRID * uCellPoints;
  vec2 first = floor(p / grid) - vec2(1.0, 0.0);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 id = first + vec2(float(i), float(j));
      if (hash12(id * 0.61 + 2.9) > density) continue;
      vec2 foot;
      float s;
      marshSquare(id, foot, s);
      vec2 local = (p - foot) / s + vec2(0.5, 1.0);
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) continue;
      vec4 placed = placedAt(id, uMarshRect, uPlaceAt.w);
      int frame = int(placed.r * 255.0 + 0.5) - 1;
      if (frame < 0) continue;
      float size = placed.g;
      vec2 at = vec2(0.5 + (local.x - 0.5) / size, 1.0 - (1.0 - local.y) / size);
      if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) continue;
      vec4 sprite = spriteSample(frame, p, foot, s * size, hash12(id + 9.9) < 0.5, wdx, wdy) * near;
      colour = colour * (1.0 - sprite.a) + sprite.rgb;
    }
  }
  return colour;
}
`;
