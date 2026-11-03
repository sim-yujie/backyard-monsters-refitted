import {
  CLOUD_EDGE_HIGH,
  CLOUD_EDGE_LOW,
  CLOUD_KERNEL_RADIUS,
  DECK_MIN_CELLS,
  DECK_PIXELS,
  FOG_DISTANCE_CAP,
} from "./clouds";

/**
 * The painted fog (Map Room 2 Modern look, plan step 9): one quad over the world, drawn over the
 * painted ground, that covers every fog cell (outside the player's sight) with painted cloud.
 *
 * Per pixel it reads how deep into the fog its cell and the six round it are (`clouds.ts`
 * `fogDistances`, one byte a cell) and weighs them by distance with a kernel that reaches no further
 * than those seven (`clouds.ts` `fogDepth` is its TypeScript twin, with the tests), so the depth
 * changes smoothly and never jumps where the pixel crosses into the next cell. It is about 0.5 on
 * the edge of sight and rises about one a cell into the fog.
 *
 * Two layers of cloud. The low cloud follows the edge of sight: noise moves its edge between
 * `CLOUD_EDGE_LOW` and `CLOUD_EDGE_HIGH`, so it may billow a third of a cell over the seen land but
 * never leaves a fog cell bare. The high bank stands back from it by up to about 70 screen pixels
 * (fewer cells near, more far), in big billowing lobes: a bank along the edge of sight, lit from the
 * top-left (the painted ground's sun) and shaded underneath, casting its shadow on the low cloud,
 * which casts its own on the land (Medium and High). Further in the high bank covers everything, so
 * the far view and the far top of a tilted screen are a sea of cloud.
 *
 * The cloud is Codex's seamless cloud-top square (`web/tools/mr2-cloud-kit`) sampled in world
 * position at two sizes chosen by the zoom, so the heaps stay about the same size on screen from the
 * nearest zoom to the whole world. It drifts with the wind on Medium and High (`uTime`, stepped by
 * `CloudLayer.animate`); on Low it is still, with one texture read a layer and no shadows.
 *
 * The hex sums are the same as `groundShader.ts`'s (`cellShape.ts` is their TypeScript twin).
 */
export const CLOUD_VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vWorld;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vWorld = aPosition;
}
`;

export const CLOUD_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 finalColor;

uniform highp sampler2D uFogDistance; // each cell's distance into the fog, cells (clouds.ts fogDistances)
uniform sampler2D uDeck;
uniform float uShape;      // 0 flat-top (odd-q), 1 pointy-top (odd-r)
uniform vec2 uUnit;        // world points per regular-hex unit (corner radius 1)
uniform vec2 uWorldCells;  // the world's size in cells
uniform float uCellPoints; // a cell's width, world points
uniform float uAspect;     // world points down per world point across for a square in hex space
uniform float uQuality;    // 2 High, 1 Medium, 0 Low
uniform float uTime;       // seconds of drift (still on Low)
uniform float uDeckReady;  // 1 once the cloud picture has loaded
uniform vec3 uDeckColour;  // its average colour, the stand-in until then

const float SQRT3 = 1.7320508;
const float KERNEL_R2 = ${(CLOUD_KERNEL_RADIUS * CLOUD_KERNEL_RADIUS).toFixed(4)};
const float DISTANCE_CAP = ${FOG_DISTANCE_CAP.toFixed(1)};
const float EDGE_LOW = ${CLOUD_EDGE_LOW.toFixed(4)};
const float EDGE_HIGH = ${CLOUD_EDGE_HIGH.toFixed(4)};
// The heaps' size on screen: one repeat of the cloud picture is about this many pixels across (its
// biggest heaps are about a third of it), but never fewer than DECK_MIN_CELLS cells, so close up a
// heap is a cell or more across, as in Civ V, not a pebble on the land.
const float DECK_PIXELS = ${DECK_PIXELS.toFixed(1)};
const float DECK_MIN_CELLS = ${DECK_MIN_CELLS.toFixed(1)};
// Big masses of cloud under the heaps, MASS_REPEATS repeats of the picture across: lit on their
// sunward side, shaded on the far side, the dips between them deeper and cooler (Medium and High).
// They give the sea depth and hide the picture's repeat.
const float MASS_REPEATS = 2.3;
const float MASS_LIGHT = 0.16;
const vec3 MASS_DIP = vec3(0.80, 0.84, 0.90);
// The low cloud's fringe thins into streaky wisps over this much depth (cells) inside its edge, so
// the bank still reaches as far over the seen land but ends in wisps, not a cut-out edge.
const float WISP_DEPTH = 0.13;
// The high bank stands back from the edge of sight by up to this many screen pixels (at least
// UPPER_MIN and at most UPPER_MAX cells), in lobes about UPPER_LOBE times that size.
const float UPPER_PIXELS = 45.0;
const float UPPER_MIN = 0.3;
const float UPPER_MAX = 5.0;
const float UPPER_LOBE = 0.9;
// The low cloud's puffs, hex units across.
const float LOW_PUFF = 1.1;
// The wind, cells a second.
const vec2 WIND = vec2(0.045, -0.012);
// Shadows fall down and to the right, away from the sun: the low cloud's on the land (hex units,
// and how dark), the high bank's on the low cloud (a share of the bank's stand-back).
const vec2 SHADOW_DIR = vec2(0.6, 0.8);
const float LAND_SHADOW = 0.3;
const float LAND_SHADOW_ALPHA = 0.32;
const float BANK_SHADOW = 0.12;
const vec3 SHADOW_COLOUR = vec3(0.08, 0.12, 0.22);
// The low cloud between the land and the high bank is in the bank's shade: bluer and darker.
const vec3 LOW_SHADE = vec3(0.93, 0.94, 0.96);
// The bank's underside and side wall along its edge (a cool neutral grey, not lavender), the sun,
// and the way a tilted camera looks (its side walls show on edges facing down the screen).
const vec3 UNDERSIDE = vec3(0.66, 0.71, 0.79);
const vec2 VIEW = vec2(0.0, 1.0);
const vec2 SUN = vec2(-0.7071, -0.7071);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

vec2 axialOf(vec2 h) {
  return uShape < 0.5
    ? vec2(2.0 / 3.0 * h.x, -1.0 / 3.0 * h.x + SQRT3 / 3.0 * h.y)
    : vec2(SQRT3 / 3.0 * h.x - 1.0 / 3.0 * h.y, 2.0 / 3.0 * h.y);
}

vec2 centreOf(vec2 qr) {
  return uShape < 0.5
    ? vec2(1.5 * qr.x, SQRT3 * (qr.y + qr.x * 0.5))
    : vec2(SQRT3 * (qr.x + qr.y * 0.5), 1.5 * qr.y);
}

vec2 roundAxial(vec2 f) {
  vec3 cube = vec3(f, -f.x - f.y);
  vec3 r = floor(cube + 0.5);
  vec3 d = abs(r - cube);
  if (d.x > d.y && d.x > d.z) r.x = -r.y - r.z;
  else if (d.y > d.z) r.y = -r.x - r.z;
  return r.xy;
}

ivec2 toOffset(vec2 qr) {
  int q = int(qr.x);
  int r = int(qr.y);
  return uShape < 0.5 ? ivec2(q, r + (q - (q & 1)) / 2) : ivec2(q + (r - (r & 1)) / 2, r);
}

const vec2 NEIGHBOURS[7] = vec2[7](vec2(0.0, 0.0),
  vec2(1.0, 0.0), vec2(1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0));

// A cell's distance into the fog; outside the world, as deep as it goes (the cloud runs on past it).
float distanceOf(ivec2 cell) {
  ivec2 size = ivec2(uWorldCells);
  if (cell.x < 0 || cell.y < 0 || cell.x >= size.x || cell.y >= size.y) return DISTANCE_CAP;
  return texelFetch(uFogDistance, cell, 0).r * 255.0;
}

// The smoothed distance into the fog round the point h (hex units), in cells: its cell and the six
// round it weighed by distance (clouds.ts fogDepth). About 0.5 on the edge of sight.
float fogDepth(vec2 h) {
  vec2 qr = roundAxial(axialOf(h));
  float sum = 0.0;
  float total = 0.0;
  for (int k = 0; k < 7; k++) {
    vec2 n = qr + NEIGHBOURS[k];
    vec2 d = h - centreOf(n);
    float t = max(0.0, 1.0 - dot(d, d) / KERNEL_R2);
    float w = t * t;
    sum += w * distanceOf(toOffset(n));
    total += w;
  }
  return sum / max(total, 1e-5);
}

vec2 hash22(vec2 p) {
  return vec2(hash12(p + 0.37), hash12(p.yx + 19.19));
}

// Round puffs: on a grid of squares "size" hex units across, each square holds a puff (a disc of
// random size round a random point) and this is the tallest puff at h, as a dome (1 at a puff's
// middle, 0 off it). An edge pushed out by it bulges in round scallops, like the side of a cumulus.
float puffs(vec2 h, float size, vec2 stir) {
  vec2 p = h / size + stir;
  vec2 base = floor(p);
  float best = 0.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      vec2 jitter = hash22(cell);
      float radius = 0.55 + 0.4 * hash12(cell + 7.7);
      vec2 d = p - (cell + jitter);
      best = max(best, sqrt(max(0.0, 1.0 - dot(d, d) / (radius * radius))));
    }
  }
  return best;
}

// The puffs at a size that follows the zoom: two sizes a doubling apart cross-fade as it changes,
// so zooming does not make the edge swim.
float puffsAtSize(vec2 h, float size, vec2 stir) {
  float level = log2(max(size, 0.05));
  float base = floor(level);
  float blend = smoothstep(0.0, 1.0, level - base);
  float a = puffs(h, exp2(base), stir);
  float b = puffs(h + 31.7, exp2(base + 1.0), stir * 0.5);
  return mix(a, b, blend);
}

// Where the low cloud's edge sits: a depth between EDGE_LOW (a puff's middle bulging over the land)
// and EDGE_HIGH (between puffs), round the edge of sight.
float lowEdge(vec2 h, vec2 stir) {
  float puff = puffs(h, LOW_PUFF, stir);
  if (uQuality > 0.5) puff = max(puff, 0.7 * puffs(h + 5.3, LOW_PUFF * 0.45, -stir));
  return mix(EDGE_HIGH, EDGE_LOW, puff);
}

// Where the high bank's edge sits: "upper" cells further into the fog between its puffs, and
// forward to the low cloud's edge at a big puff's middle.
float highEdge(vec2 h, float upper, vec2 stir) {
  return EDGE_HIGH + upper * (1.0 - puffsAtSize(h, upper * UPPER_LOBE * SQRT3, stir * 0.5));
}

// The cloud picture's repeat for this zoom, as log2 of cells (clouds.ts deckRepeatCells).
float deckLevel(float cellPixels) {
  return log2(max(DECK_PIXELS / max(cellPixels, 1e-3), DECK_MIN_CELLS));
}

// Two octaves of soft noise, 0..1.
float fbm2(vec2 p) {
  return 0.65 * valueNoise(p) + 0.35 * valueNoise(p * 2.03 + 17.1);
}

// How high the big cloud masses are at h (0 a dip, 1 a top), at sizes that follow the deck's, cross-
// fading the same way so zooming does not make them swim.
float massAt(vec2 h, float cellPixels, vec2 stir) {
  float level = deckLevel(cellPixels);
  float base = floor(level);
  // Hex units per mass at the two sizes.
  float span = exp2(base) * MASS_REPEATS * SQRT3;
  float a = fbm2(h / span + stir * 0.2);
  float b = fbm2(h / (span * 2.0) + 7.3 + stir * 0.1);
  return mix(a, b, smoothstep(0.0, 1.0, level - base));
}

// The cloud picture at world point p, at the repeat size for this zoom (two sizes cross-fading).
vec3 deckAt(vec2 p, float cellPixels, vec2 shift) {
  if (uDeckReady < 0.5) return uDeckColour;
  float level = deckLevel(cellPixels);
  float base = floor(level);
  vec2 drift = WIND * uTime * uCellPoints;
  vec2 span0 = vec2(1.0, uAspect) * uCellPoints * exp2(base);
  vec3 a = texture(uDeck, (p - drift) / span0 + shift).rgb;
  if (uQuality < 0.5) return a;
  vec3 b = texture(uDeck, (p - drift * 0.6) / (span0 * 2.0) + shift + 0.37).rgb;
  return mix(a, b, smoothstep(0.0, 1.0, level - base));
}

void main() {
  vec2 h = vWorld / uUnit;
  float cellPixels = uCellPoints / max(length(fwidth(vWorld)), 1e-6);
  vec2 stir = vec2(uTime * 0.02, uTime * -0.013);
  // How far (cells) the high bank stands back from the edge of sight at this zoom.
  float upper = clamp(UPPER_PIXELS / max(cellPixels, 1e-3), UPPER_MIN, UPPER_MAX);

  float depth = fogDepth(h);
  float eLow = depth - lowEdge(h, stir);
  float eHigh = depth - highEdge(h, upper, stir);
  float softLow = max(fwidth(eLow) * 0.8, 0.02);
  float softHigh = max(fwidth(eHigh) * 0.8, 0.05 + 0.04 * upper);
  float low = smoothstep(-softLow, softLow, eLow);
  float high = smoothstep(-softHigh, softHigh, eHigh);
  // Which way the bank lies (worked out here: derivatives are undefined inside branches).
  vec2 g = vec2(dFdx(eHigh), dFdy(eHigh));
  float facing = length(g) > 1e-9 ? dot(-normalize(g), SUN) : 0.0;
  vec2 gLow = vec2(dFdx(eLow), dFdy(eLow));
  float facingLow = length(gLow) > 1e-9 ? dot(-normalize(gLow), SUN) : 0.0;
  // Edges facing down the screen show the cloud's side wall to a tilted camera.
  float wallLow = length(gLow) > 1e-9 ? max(dot(-normalize(gLow), VIEW), 0.0) : 0.0;
  float wallHigh = length(g) > 1e-9 ? max(dot(-normalize(g), VIEW), 0.0) : 0.0;

  // The big masses (Medium and High): their height, and its slope (per mass) from the derivatives,
  // for light from the sun. Worked out here, outside any branch, for the derivatives' sake.
  float mass = 0.5;
  float massSlope = 0.0;
  if (uQuality > 0.5) {
    mass = massAt(h, cellPixels, stir);
    vec2 dh = vec2(dFdx(h.x), dFdy(h.y));
    vec2 gm = vec2(dFdx(mass), dFdy(mass)) * sign(dh) / max(abs(dh), vec2(1e-6));
    float span = exp2(floor(deckLevel(cellPixels))) * MASS_REPEATS * SQRT3;
    massSlope = dot(gm * span, SUN);
  }
  // The fringe's wisps: streaks along the wind, thinning the low cloud's last WISP_DEPTH.
  if (uQuality > 0.5) {
    float streak = valueNoise(vec2(h.x * 0.9 + h.y * 0.35, h.y * 3.2 - h.x * 0.6) * 2.2 + stir * 3.0);
    float fringe = smoothstep(0.0, WISP_DEPTH, eLow);
    low *= mix(0.25 + 0.75 * streak, 1.0, fringe);
  }

  // Shadows (Medium and High): the low cloud's on the land, the high bank's on the low cloud.
  float landShadow = 0.0;
  float bankShadow = 0.0;
  if (uQuality > 0.5 && depth < EDGE_HIGH + upper + 1.0) {
    if (low < 0.999) {
      vec2 hs = h - SHADOW_DIR * LAND_SHADOW;
      landShadow = smoothstep(-0.12, 0.08, fogDepth(hs) - lowEdge(hs, stir)) * LAND_SHADOW_ALPHA;
    }
    if (high < 0.999 && low > 0.001) {
      vec2 hb = h - SHADOW_DIR * (BANK_SHADOW * upper * SQRT3);
      bankShadow = smoothstep(-0.1 - 0.1 * upper, 0.05, fogDepth(hb) - highEdge(hb, upper, stir));
    }
  }

  vec3 colour = vec3(0.0);
  if (low > 0.001) {
    // The low cloud: in the bank's shade, darker still where the bank's shadow falls.
    vec3 lowColour = deckAt(vWorld, cellPixels, vec2(0.0)) * LOW_SHADE * mix(vec3(1.0), UNDERSIDE, 0.75 * bankShadow);
    // Its puffs round over at the edge of sight too.
    float rimLow = 1.0 - smoothstep(0.0, 0.22, eLow);
    float shadeLow = clamp(0.3 - 0.35 * facingLow + 0.3 * wallLow, 0.0, 0.75);
    lowColour = mix(lowColour, lowColour * UNDERSIDE, rimLow * shadeLow);
    lowColour += rimLow * max(facingLow, 0.0) * 0.08;
    // The high bank: its own heaps (the picture shifted), rounding over along its edge, lit where
    // it faces the sun, its underside in the shade.
    vec3 highColour = deckAt(vWorld, cellPixels, vec2(0.43, 0.21));
    float rim = 1.0 - smoothstep(0.0, 0.3 * upper + 0.12, eHigh);
    float shade = clamp(0.3 - 0.35 * facing + 0.35 * wallHigh, 0.0, 0.8);
    highColour = mix(highColour, highColour * UNDERSIDE, rim * shade);
    highColour += rim * max(facing, 0.0) * 0.09;
    colour = mix(lowColour, highColour, high);
    // The big masses: lit on the side towards the sun, cooler and darker in the dips between them.
    if (uQuality > 0.5) {
      colour *= mix(MASS_DIP, vec3(1.0), smoothstep(0.15, 0.7, mass));
      colour *= 1.0 - clamp(massSlope * MASS_LIGHT, -0.12, 0.2);
    }
  }

  // Premultiplied: the cloud over its shadow on the land.
  float alpha = low + (1.0 - low) * landShadow;
  finalColor = vec4(colour * low + SHADOW_COLOUR * (1.0 - low) * landShadow, alpha);
}
`;
