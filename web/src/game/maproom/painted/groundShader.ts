import { Ground, GroundTexture, OCCUPIED_FLAG, SHADER_TEXTURES } from "./groundKinds";
import { HILLS_GLSL } from "./hillsShader";

/**
 * The painted ground's WebGL2 shader (Map Room 2 Modern look, plan step 2).
 *
 * One quad over the world. Per pixel it finds its hex (`cellShape.ts` is the TypeScript twin of
 * these sums) and the two neighbours it leans towards; the three cell centres make a triangle, and
 * the point's place in it weighs the three cells' grounds (data texture, `GroundData.ts`). Ground
 * textures are sampled in world position, so neighbours with the same ground join with no seam.
 * The point is pushed about by smooth noise first, and each cell's claim is roughened by a noise of
 * its own, so where two grounds meet the line wanders across the hex sides as a painted edge
 * instead of following them. Every weight changes smoothly, so there are no seams at hex corners.
 * Last, the faint hex lines (mock-up B strength: light cream, about 30%, 1-2 screen pixels) are
 * drawn by the true (un-pushed) point's distance to its hex side.
 *
 * Coast and sea (plan step 3): the shallows and deep cells are one water, turquoise near the land
 * and deepening to blue by the cells' heights (smoothly, across the three cells). The coast is
 * where the water's and the land's claims meet, so it wanders with the ground edge; a signed
 * distance to it (the claim difference over its slope) lays a sand beach on the land side and white
 * surf on the water side, with surf lines rolling in. Sea rocks and islets and the ground details
 * (flowers, tufts, pebbles) are sprites from one sheet placed on jittered world grids: a hash of the
 * grid square says whether one is there, which, where and how big, so every computer draws the same.
 * Each is kept only where the ground at its foot suits it (checked with the same blend as the
 * pixel), and details keep clear of the camp or yard picture in an occupied cell's middle.
 *
 * Quality: High blends two lookups of each texture at different scales (hides the repeat), varies
 * the light and draws all details; Medium one lookup and fewer details; Low no edge noise, a short
 * plain fade, no details, and still surf. The water and surf move with `uTime` (stepped by
 * `PaintedGround.animate`).
 */
export const GROUND_VERTEX = `#version 300 es
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

/** The coast's own textures, by sampler index. */
const WET_SAND = SHADER_TEXTURES.indexOf(GroundTexture.WET_SAND);
const FOAM = SHADER_TEXTURES.indexOf(GroundTexture.FOAM);

const samplers = SHADER_TEXTURES.map((_, index) => `uniform sampler2D uGround${index};`).join("\n");
const sampleChain = SHADER_TEXTURES.map(
  (_, index) => `  ${index === 0 ? "if" : "else if"} (g == ${index}) c = textureGrad(uGround${index}, uv, dx, dy);`,
).join("\n");

export const GROUND_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 finalColor;

uniform highp sampler2D uData;
${samplers}
uniform float uShape;      // 0 flat-top (odd-q), 1 pointy-top (odd-r)
uniform vec2 uUnit;        // world points per regular-hex unit (corner radius 1)
uniform vec2 uTexScale;    // world points per texture repeat, x and y
uniform vec2 uWorldCells;  // the world's size in cells
uniform float uQuality;    // 2 High, 1 Medium, 0 Low
uniform vec4 uLine;        // hex line colour and strength
uniform vec3 uFog;
uniform vec3 uUnloaded;
uniform sampler2D uSprites; // ground details (rows 0..2) and sea rocks (rows 3..4), 4 frames a row
uniform float uSpritesReady; // 1 once the sprite sheet has loaded
uniform float uCellPoints;  // a cell's width, world points (sprite sizes follow it)
uniform float uTime;        // seconds of water motion (still on Low)

const float SQRT3 = 1.7320508;
const float APOTHEM = 0.8660254;

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

float fbm(vec2 p) {
  return 0.6 * valueNoise(p) + 0.3 * valueNoise(p * 2.03 + 7.1) + 0.1 * valueNoise(p * 4.1 + 3.7);
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

// The nearest side of the hex round centre c, for a point d away from it: returns |d . n| and
// writes the side's outward normal.
float nearestSide(vec2 d, out vec2 normal) {
  vec2 n0 = uShape < 0.5 ? vec2(SQRT3 / 2.0, 0.5) : vec2(1.0, 0.0);
  vec2 n1 = uShape < 0.5 ? vec2(0.0, 1.0) : vec2(0.5, SQRT3 / 2.0);
  vec2 n2 = uShape < 0.5 ? vec2(-SQRT3 / 2.0, 0.5) : vec2(-0.5, SQRT3 / 2.0);
  float a0 = dot(d, n0);
  float a1 = dot(d, n1);
  float a2 = dot(d, n2);
  normal = n0 * sign(a0);
  float best = abs(a0);
  if (abs(a1) > best) { best = abs(a1); normal = n1 * sign(a1); }
  if (abs(a2) > best) { best = abs(a2); normal = n2 * sign(a2); }
  return best;
}

// The six neighbours in axial steps (the same for both hex shapes).
const vec2 NEIGHBOURS[6] = vec2[6](
  vec2(1.0, 0.0), vec2(1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0));

// Ground blending, in hex units (corner radius 1): how far the noise pushes the point, the edge
// noise's size and strength, and the fade width on Medium/High and on Low.
const float WARP = 0.6;
const float BEND = 0.3;
const float BEND_FREQ = 1.3;
const float EDGE_FREQ = 2.2;
const float EDGE_NOISE = 0.8;
const float BAND = 0.08;
const float BAND_LOW = 0.05;
// The weight over which a cell's edge noise fades in (from 0, where it joins or leaves the three).
const float CLAIM_FADE = 0.3;

// A cell's own seed in the edge noise: far apart for neighbours, so their noises are unrelated.
vec2 cellSeed(ivec2 cell) {
  vec2 c = vec2(cell);
  return vec2(hash12(c + 0.5), hash12(c.yx + 17.3)) * 173.0;
}

// Coast and sea (hex units unless said): the beach's width on the land side; how far into the sea
// the turquoise reaches (as the land's share of the weights); the plain sea's mix towards the
// shallows colour before it deepens; the surf lines' spacing and speed (lines a second).
// The beach: it reaches inland to where the water's share round a point (waterNear) falls to
// between BEACH_FAR (where the beach is widest) and BEACH_NEAR (narrowest), about 0.5-1 hex units.
const float BEACH_FAR = 0.035;
const float BEACH_NEAR = 0.15;
const float SHALLOWS_REACH = 0.38;
const float MID_SEA = 0.5;
const float SURF_SPACING = 0.2;
const float SURF_SPEED = 0.22;
const vec3 FOAM_WHITE = vec3(0.97, 0.99, 1.0);

// Sprites: grid squares and frame sizes as shares of a cell's width; the sheet's rows; the hex
// distance round an occupied cell's middle kept clear of details; how far (claim units) a detail's
// foot must be inside its ground; the share of the beach's end (beachEnd) from which a foot wears
// beach details; how far (claim units) a rock's foot must be out from the coast; the share of
// grid squares with a rock near the coast and further out, and of details on Medium.
const float DECAL_GRID = 0.21;
const float DECAL_SIZE = 0.18;
const float ROCK_GRID = 0.45;
const float ROCK_SIZE = 0.3;
const float SPRITE_ROWS = 5.0;
const float CLEAR = 0.45;
const float DECAL_MARGIN = 0.1;
const float DECAL_SHORE = 0.8;
const float ROCK_OFFSHORE = 0.4;
const float ROCKS_NEAR = 0.6;
const float ROCKS_FAR = 0.07;
const float DECALS_MEDIUM = 0.45;
// Stones and sea rocks darkened towards mock-up B's grey (a power on the colour keeps the white
// foam white); the bigger mossy stones' size; the turquoise pool and foam ring round a rock's foot.
const float STONE_GAMMA = 1.45;
const float ROCK_GAMMA = 1.6;
const float BOULDER_SIZE = 1.3;
const float BOULDER_SHARE = 0.3;
const vec3 POOL = vec3(0.24, 0.74, 0.8);

// The weights of p in the triangle (0, b, c).
vec3 barycentric(vec2 p, vec2 b, vec2 c) {
  float d00 = dot(b, b);
  float d01 = dot(b, c);
  float d11 = dot(c, c);
  float d20 = dot(p, b);
  float d21 = dot(p, c);
  float den = d00 * d11 - d01 * d01;
  float v = (d11 * d20 - d01 * d21) / den;
  float w = (d00 * d21 - d01 * d20) / den;
  return vec3(1.0 - v - w, v, w);
}

// A cell's texel; outside the world, "not loaded".
vec4 cellAt(ivec2 cell) {
  ivec2 size = ivec2(uWorldCells);
  if (cell.x < 0 || cell.y < 0 || cell.x >= size.x || cell.y >= size.y) {
    return vec4(0.0, 0.0, 0.0, float(${Ground.UNLOADED}) / 255.0);
  }
  return texelFetch(uData, cell, 0);
}

int groundOf(vec4 texel) { return int(texel.a * 255.0 + 0.5) & 15; }
bool occupiedOf(vec4 texel) { return (int(texel.a * 255.0 + 0.5) & ${OCCUPIED_FLAG}) != 0; }
bool isWater(int g) { return g == ${Ground.SHALLOWS} || g == ${Ground.DEEP}; }
bool isLand(int g) { return g < ${Ground.SHALLOWS}; }

vec3 sampleGround(int g, vec2 uv, vec2 dx, vec2 dy) {
  if (g == ${Ground.FOG}) return uFog;
  if (g == ${Ground.UNLOADED}) return uUnloaded;
  vec4 c = vec4(uUnloaded, 1.0);
${sampleChain}
  return c.rgb;
}

// A ground's colour here: on High, two lookups at different scales mixed by a slow noise, so the
// texture's repeat does not show.
// The derivatives come from main(): this runs inside branches that differ between neighbouring
// pixels, where the GPU cannot work them out.
vec3 paint(int g, vec2 uv, vec2 dx, vec2 dy) {
  vec3 c = sampleGround(g, uv, dx, dy);
  if (uQuality > 1.5 && g < ${Ground.FOG}) {
    vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.73 + vec2(0.37, 0.61);
    mat2 turn = mat2(0.8 * 0.73, -0.6 * 0.73, 0.6 * 0.73, 0.8 * 0.73);
    vec3 c2 = sampleGround(g, uv2, turn * dx, turn * dy);
    float m = smoothstep(0.3, 0.7, valueNoise(uv / 1.7));
    c = mix(c, c2, m);
  }
  return c;
}

// The three cells round a point and how much each claims it.
struct Blend {
  ivec3 g;     // their grounds
  vec3 bary;   // their smooth weights (0 where a cell stops being one of the three)
  vec3 claim;  // the weights roughened by each cell's own noise: the strongest claim wins
  vec3 height; // their heights
  vec2 hp;     // the point after the noise push (the cells were picked here)
  vec2 cen[3]; // their centres, regular-hex units
};

Blend blendAt(vec2 h) {
  Blend b;
  // The point is pushed about by smooth noise first, so grounds wander across the hex sides (on
  // Low too: it is a little arithmetic and no texture reads, and without it Low looked like tiles).
  // A second, quicker push bends each hex side along its length, so no edge runs straight for a
  // whole side (with the slow push alone a side only moved over, still straight).
  vec2 hp = h + WARP * (vec2(fbm(h * 0.6), fbm(h * 0.6 + 19.7)) - 0.5) * 2.0
    + BEND * (vec2(valueNoise(h * BEND_FREQ + 41.3), valueNoise(h * BEND_FREQ + 77.9)) - 0.5) * 2.0;

  // The three cells round this point: its own hex and the two neighbours it leans towards. Their
  // centres make the triangle the point sits in, and the point's place in that triangle weighs the
  // three grounds. Weights only ever change smoothly, so there are no seams where the neighbours
  // change (the earlier one-neighbour blend left straight steps at the hex corners).
  vec2 qr = roundAxial(axialOf(hp));
  vec2 d = hp - centreOf(qr);
  vec2 dir1 = vec2(0.0);
  vec2 dir2 = vec2(0.0);
  float best1 = -1e9;
  float best2 = -1e9;
  for (int k = 0; k < 6; k++) {
    float along = dot(d, centreOf(NEIGHBOURS[k]));
    if (along > best1) { best2 = best1; dir2 = dir1; best1 = along; dir1 = NEIGHBOURS[k]; }
    else if (along > best2) { best2 = along; dir2 = NEIGHBOURS[k]; }
  }
  b.bary = clamp(barycentric(d, centreOf(dir1), centreOf(dir2)), 0.0, 1.0);
  b.hp = hp;
  b.cen[0] = centreOf(qr);
  b.cen[1] = centreOf(qr + dir1);
  b.cen[2] = centreOf(qr + dir2);
  ivec2 cell0 = toOffset(qr);
  ivec2 cell1 = toOffset(qr + dir1);
  ivec2 cell2 = toOffset(qr + dir2);
  vec4 t0 = cellAt(cell0);
  vec4 t1 = cellAt(cell1);
  vec4 t2 = cellAt(cell2);
  b.g = ivec3(groundOf(t0), groundOf(t1), groundOf(t2));
  b.height = vec3(t0.r, t1.r, t2.r) * 255.0;

  // Each cell's claim: its weight, roughened by a noise of its own (continuous, as it hangs on the
  // cell and the world position only). Each cell reads the noise at its own far-off seed, so two
  // neighbours' noises are unrelated and their edge wanders well off the hex side (seeds a small
  // step apart gave nearly the same noise, which cancelled out: long straight edges on the hex
  // sides). The noise fades in from a cell's zero weight, so a cell leaving the three never holds
  // a claim (no straight cut where the three change).
  b.claim = b.bary;
  if (uQuality > 0.5) {
    vec2 p = h * EDGE_FREQ;
    b.claim += EDGE_NOISE * smoothstep(0.0, CLAIM_FADE, b.bary) * (vec3(
      fbm(p + cellSeed(cell0)),
      fbm(p + cellSeed(cell1)),
      fbm(p + cellSeed(cell2))) - 0.5);
  }
  return b;
}

// Where the land meets the water among the three cells.
struct Coast {
  float s;     // the water's best claim minus the land's: 0 on the coast line, > 0 in the water
  float land;  // the land cells' share of the smooth weights
  float water; // the water cells' share
  bool both;   // land and water are both among the three
  bool known;  // none of the three is fog or not loaded
};

Coast coastOf(Blend b) {
  Coast c;
  float waterTop = -9.0;
  float landTop = -9.0;
  c.land = 0.0;
  c.water = 0.0;
  c.known = true;
  for (int k = 0; k < 3; k++) {
    int g = b.g[k];
    if (isWater(g)) { waterTop = max(waterTop, b.claim[k]); c.water += b.bary[k]; }
    else if (isLand(g)) { landTop = max(landTop, b.claim[k]); c.land += b.bary[k]; }
    else c.known = false;
  }
  c.both = waterTop > -8.0 && landTop > -8.0;
  c.s = c.both ? waterTop - landTop : (waterTop > -8.0 ? 1.0 : -1.0);
  return c;
}

// The water's share of the cells round hex point h, smooth over two hex units (a bump round each
// cell like hillAt's, which reaches 0 before the cells this point does not look at): about 0.5 on
// the coast, falling to 0 a cell inland. Unlike the coast's three cells it never stops at a line.
float waterNear(vec2 h) {
  vec2 qr = roundAxial(axialOf(h));
  float sw = 0.0;
  float sWater = 0.0;
  for (int k = 0; k < 7; k++) {
    vec2 cell = k == 6 ? qr : qr + NEIGHBOURS[k];
    vec2 d = h - centreOf(cell);
    float r2 = dot(d, d) * 0.25;
    if (r2 >= 1.0) continue;
    int g = groundOf(cellAt(toOffset(cell)));
    if (g >= ${Ground.FOG}) continue;
    float u = 1.0 - r2;
    float w = u * u * u;
    sw += w;
    if (isWater(g)) sWater += w;
  }
  return sw > 1e-4 ? sWater / sw : 0.0;
}

// The water's share where the beach ends inland, ragged along the coast (h, the true point).
float beachEnd(vec2 h) { return mix(BEACH_NEAR, BEACH_FAR, valueNoise(h * 2.3 + 31.0)); }

${HILLS_GLSL}
// The sea: shallows and deep as one water, deepening by the three cells' heights (land counts as
// the shore's height) and turquoise near the land; both textures drift slowly with uTime.
vec3 waterColour(Blend b, Coast c, vec2 uv, vec2 dx, vec2 dy) {
  vec2 drift = uTime * vec2(0.016, 0.006);
  vec3 shallow = paint(${Ground.SHALLOWS}, uv + drift * vec2(-0.7, 1.3), dx, dy);
  vec3 deep = paint(${Ground.DEEP}, uv + drift, dx, dy);
  float shoreHeight = dot(b.bary, min(b.height, vec3(100.0)));
  float depth = smoothstep(97.0, 87.0, shoreHeight);
  vec3 sea = mix(mix(deep, shallow, MID_SEA), deep, depth);
  float near = smoothstep(0.0, SHALLOWS_REACH, c.land);
  return mix(sea, shallow, near);
}

// One sprite frame (premultiplied) at world point p, for a sprite of frame size s world points
// whose foot (the frame's bottom middle) stands at foot; nothing outside the frame.
vec4 spriteSample(int frame, vec2 p, vec2 foot, float s, bool flip, vec2 wdx, vec2 wdy) {
  vec2 local = (p - foot) / s + vec2(0.5, 1.0);
  if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) return vec4(0.0);
  float sx = 1.0;
  if (flip) { local.x = 1.0 - local.x; sx = -1.0; }
  local = clamp(local, 0.004, 0.996);
  vec2 scale = vec2(0.25, 1.0 / SPRITE_ROWS);
  vec2 at = (vec2(float(frame % 4), float(frame / 4)) + local) * scale;
  vec2 grad = scale / s;
  return textureGrad(uSprites, at, wdx * grad * vec2(sx, 1.0), wdy * grad * vec2(sx, 1.0));
}

// The true (un-pushed) cell round hex point hh, and hh's offset from its centre.
vec4 trueCellAt(vec2 hh, out vec2 offset) {
  vec2 qr = roundAxial(axialOf(hh));
  offset = hh - centreOf(qr);
  return cellAt(toOffset(qr));
}

// A premultiplied sprite's colour raised to a power: greys go darker, white foam stays white.
vec3 darken(vec4 sprite, float power) {
  if (sprite.a < 0.004) return sprite.rgb;
  return pow(sprite.rgb / sprite.a, vec3(power)) * sprite.a;
}

// Which ground detail (sprite frame 0..8) a ground wears for hash r, or -1 for none: 0 1 2
// flower patches, 3 tall tuft, 4 tuft, 5 seed tuft, 6 pebbles, 7 sand slabs, 8 mossy stone.
int decalFrame(int g, float r) {
  if (g == ${Ground.MEADOW} || g == ${Ground.MEADOW_PLAIN}) {
    return r < 0.15 ? 0 : r < 0.27 ? 1 : r < 0.4 ? 2 : r < 0.54 ? 4 : r < 0.63 ? 3 : r < 0.71 ? 5 : r < 0.83 ? 6 : 8;
  }
  if (g == ${Ground.LUSH}) return r < 0.3 ? 4 : r < 0.5 ? 3 : r < 0.64 ? 0 : r < 0.78 ? 2 : r < 0.9 ? 5 : 8;
  if (g == ${Ground.SAND}) return r < 0.18 ? 7 : r < 0.55 ? 6 : r < 0.92 ? 8 : 4;
  if (g == ${Ground.ROCK}) return r < 0.5 ? 6 : r < 0.85 ? 8 : 4;
  if (g == ${Ground.MARSH}) return r < 0.45 ? 3 : r < 0.8 ? 5 : 4;
  if (g == ${Ground.FOREST_FLOOR}) return r < 0.5 ? 4 : r < 0.8 ? 3 : 8;
  return -1;
}

// The share of detail grid squares that get one, by ground (before Quality).
float decalDensity(int g) {
  if (g == ${Ground.MEADOW}) return 0.55;
  if (g == ${Ground.MEADOW_PLAIN} || g == ${Ground.LUSH}) return 0.45;
  if (g == ${Ground.ROCK} || g == ${Ground.MARSH}) return 0.4;
  if (g == ${Ground.FOREST_FLOOR}) return 0.3;
  if (g == ${Ground.SAND}) return 0.5;
  return 0.0;
}

// Flowers, tufts and pebbles on a jittered grid; each needs its foot well inside a ground that
// wears it, off the beach, and clear of an occupied cell's picture.
vec3 drawDecals(vec3 colour, vec2 p, vec2 wdx, vec2 wdy, float fade) {
  float grid = DECAL_GRID * uCellPoints;
  float base = DECAL_SIZE * uCellPoints;
  float density = uQuality > 1.5 ? 1.0 : DECALS_MEDIUM;
  vec2 first = floor(vec2(p.x / grid - 0.5, p.y / grid));
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = first + vec2(float(i), float(j));
      float pick = hash12(id * 1.13 + 0.71);
      if (pick > 0.55 * density) continue;
      // Some squares hold a bigger boulder: its foot stays near the square's middle, so the
      // boulder never reaches past the two squares each way this pixel looks at.
      bool boulder = hash12(id + 88.8) < BOULDER_SHARE;
      vec2 jitter = vec2(hash12(id + 17.3), hash12(id + 41.9));
      vec2 foot = (id + (boulder ? 0.5 + (jitter - 0.5) * vec2(0.6, 0.35) : jitter)) * grid;
      float s = base * (0.85 + 0.3 * hash12(id + 5.17)) * (boulder ? BOULDER_SIZE : 1.0);
      vec2 local = (p - foot) / s + vec2(0.5, 1.0);
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) continue;
      vec2 off;
      vec4 t = trueCellAt((foot - vec2(0.0, 0.5 * s)) / uUnit, off);
      if (!isLand(groundOf(t))) continue;
      if (occupiedOf(t) && length(off) < CLEAR) continue;
      Blend fb = blendAt(foot / uUnit);
      Coast fc = coastOf(fb);
      if (!fc.known || (fc.both && fc.s > -0.16)) continue;
      // Nothing stands on a cliff face or its rim; stones gather at its foot.
      Cliff fcl = cliffOf(fb);
      bool scree = false;
      if (fcl.on && fcl.mask > 0.2) {
        if (fcl.s > -CLIFF_CLEAR_HIGH && fcl.s < CLIFF_CLEAR_LOW) continue;
        scree = fcl.s >= CLIFF_CLEAR_LOW && fcl.s < CLIFF_CLEAR_LOW + 0.35;
      }
      int k = fb.claim.x >= fb.claim.y && fb.claim.x >= fb.claim.z ? 0 : fb.claim.y >= fb.claim.z ? 1 : 2;
      int g = fb.g[k];
      // On the beach band, beach details (pebbles, stones, sand slabs) whatever the ground;
      // elsewhere the foot must be a little inside its ground.
      if (waterNear(fb.hp) > beachEnd(foot / uUnit) * DECAL_SHORE) {
        g = ${Ground.SAND};
      } else {
        float other = -9.0;
        for (int m = 0; m < 3; m++) {
          if (fb.g[m] != fb.g[k]) other = max(other, fb.claim[m]);
        }
        if (fb.claim[k] - other < DECAL_MARGIN) continue;
      }
      if (pick > (scree ? 0.9 : decalDensity(g)) * density) continue;
      int frame = decalFrame(g, hash12(id + 63.1));
      if (boulder) frame = g == ${Ground.MARSH} ? -1 : 8;
      if (scree) frame = hash12(id + 63.1) < 0.55 ? 6 : 8;
      if (frame < 0) continue;
      vec4 sprite = spriteSample(frame, p, foot, s, hash12(id + 9.9) < 0.5, wdx, wdy) * fade;
      if (frame == 6 || frame == 8) sprite.rgb = darken(sprite, STONE_GAMMA);
      colour = colour * (1.0 - sprite.a) + sprite.rgb;
    }
  }
  return colour;
}

// Mock-up B's meadow flowers: patches (a slow noise) of tiny painted blooms, pink, lilac, white
// or yellow by patch, on a fine jittered grid. Drawn by the shader itself, no sprite: each bloom
// is a few pixels, a soft dot with a lighter middle and a little shade under it.
const float FLOWER_GRID = 0.045;    // share of a cell's width
const float FLOWER_SIZE = 0.012;
const float FLOWER_PATCH = 1.25;    // patches per cell width (about)
const vec3 FLOWER_COLOURS[4] = vec3[4](
  vec3(0.93, 0.47, 0.74), vec3(0.76, 0.56, 0.9), vec3(0.98, 0.97, 0.92), vec3(0.98, 0.86, 0.3));

vec3 drawFlowers(vec3 colour, vec2 p, float amount) {
  float grid = FLOWER_GRID * uCellPoints;
  vec2 first = floor(p / grid - 0.5);
  float patchScale = FLOWER_PATCH / uCellPoints;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = first + vec2(float(i), float(j));
      vec2 foot = (id + 0.15 + 0.7 * vec2(hash12(id + 3.7), hash12(id + 9.1))) * grid;
      // Patches: dense in their middle, thinning out at their edges.
      float patchNoise = valueNoise(foot * patchScale + 12.3);
      float density = smoothstep(0.55, 0.8, patchNoise) * amount;
      if (hash12(id * 1.37 + 0.5) > density) continue;
      float r = FLOWER_SIZE * uCellPoints * (0.8 + 0.5 * hash12(id + 1.9));
      vec2 d = p - foot;
      float dist = length(d * vec2(1.0, 1.25));
      // A little shade below and right of the bloom, then the bloom.
      float shade = 1.0 - smoothstep(r * 0.7, r * 1.3, length(d - vec2(r * 0.35, r * 0.45)));
      colour *= 1.0 - 0.25 * shade;
      float bloom = 1.0 - smoothstep(r * 0.75, r, dist);
      if (bloom <= 0.0) continue;
      vec2 cellOfPatch = floor(foot * patchScale * 1.3 + 4.0);
      int pick = int(hash12(cellOfPatch) * 4.0);
      vec3 tone = FLOWER_COLOURS[pick];
      if (hash12(id + 7.7) < 0.18) tone = FLOWER_COLOURS[2];
      tone = mix(tone, vec3(1.0), 0.35 * (1.0 - smoothstep(0.0, r * 0.5, dist)));
      colour = mix(colour, tone, bloom);
    }
  }
  return colour;
}

// Sea stacks, rocks and islets on a coarser jittered grid: mostly just off the coast, a few further
// out over the shallower water; their tops keep clear of an occupied cell's picture.
vec3 drawRocks(vec3 colour, vec2 p, vec2 wdx, vec2 wdy, float fade) {
  float grid = ROCK_GRID * uCellPoints;
  float base = ROCK_SIZE * uCellPoints;
  // Rows from a little above the pixel: the pool reaches a little below a rock's foot.
  vec2 first = floor(vec2(p.x / grid - 0.5, p.y / grid - 0.15));
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = first + vec2(float(i), float(j));
      float pick = hash12(id * 0.91 + 3.3);
      if (pick > max(ROCKS_NEAR, ROCKS_FAR)) continue;
      vec2 foot = (id + vec2(hash12(id + 2.9), hash12(id + 8.1))) * grid;
      float s = base * (0.8 + 0.35 * hash12(id + 6.6));
      vec2 local = (p - foot) / s + vec2(0.5, 1.0);
      // The pool round the foot: an ellipse a little wider than the sprite's own foam.
      float pool = length((p - foot + vec2(0.0, 0.08 * s)) / (vec2(0.55, 0.2) * s));
      bool inFrame = local.x >= 0.0 && local.x <= 1.0 && local.y >= 0.0 && local.y <= 1.0;
      if (!inFrame && pool > 1.15) continue;
      vec2 off;
      vec2 footHex = foot / uUnit;
      vec2 footCell = roundAxial(axialOf(footHex));
      if (!isWater(groundOf(cellAt(toOffset(footCell))))) continue;
      vec4 top = trueCellAt((foot - vec2(0.0, 0.85 * s)) / uUnit, off);
      if (occupiedOf(top) && length(off) < CLEAR) continue;
      Blend fb = blendAt(footHex);
      Coast fc = coastOf(fb);
      if (!fc.known || (fc.both && fc.s < ROCK_OFFSHORE)) continue;
      // Near the coast: a land cell next to the foot's cell.
      bool near = false;
      for (int k = 0; k < 6; k++) {
        if (isLand(groundOf(cellAt(toOffset(footCell + NEIGHBOURS[k]))))) near = true;
      }
      if (near && pick > ROCKS_NEAR) continue;
      if (!near && (pick > ROCKS_FAR || dot(fb.bary, min(fb.height, vec3(100.0))) < 91.0)) continue;
      float r = hash12(id + 77.7);
      int frame = near
        ? (r < 0.2 ? 0 : r < 0.38 ? 1 : r < 0.54 ? 2 : r < 0.68 ? 6 : r < 0.8 ? 3 : r < 0.9 ? 7 : r < 0.95 ? 4 : 5)
        : (r < 0.35 ? 3 : r < 0.6 ? 6 : r < 0.8 ? 4 : 5);
      // Seated in the sea: lighter turquoise water round the foot and a broken foam ring.
      float wob = valueNoise(p / s * 3.0 + vec2(uTime * 0.4, 0.0));
      float lit = (1.0 - smoothstep(0.5, 1.2, pool)) * fade;
      colour = mix(colour, POOL, lit * 0.6);
      float ring = smoothstep(0.52, 0.74, pool) * (1.0 - smoothstep(0.92, 1.12, pool)) * smoothstep(0.08, 0.4, wob);
      colour = mix(colour, FOAM_WHITE, ring * 0.95 * fade);
      if (!inFrame) continue;
      vec4 sprite = spriteSample(12 + frame, p, foot, s, hash12(id + 4.4) < 0.5, wdx, wdy) * fade;
      sprite.rgb = darken(sprite, ROCK_GAMMA);
      colour = colour * (1.0 - sprite.a) + sprite.rgb;
    }
  }
  return colour;
}

void main() {
  vec2 h = vWorld / uUnit;
  vec2 uv = vWorld / uTexScale;
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec2 wdx = dFdx(vWorld);
  vec2 wdy = dFdy(vWorld);
  float cellPixels = 1.0 / max(length(fwidth(h)), 1e-6);

  Blend b = blendAt(h);

  // The strongest claim wins; claims within the band of it share, which gives a short painted fade
  // instead of a cut.
  float band = uQuality > 0.5 ? BAND : BAND_LOW;
  float top = max(b.claim.x, max(b.claim.y, b.claim.z));
  vec3 w = max(b.claim - (top - band), 0.0);
  w /= max(w.x + w.y + w.z, 1e-5);
  ivec3 g = b.g;

  // Shallows and deep are one water (waterColour); the land grounds blend as before, the same
  // ground twice being one texture read.
  vec3 wet = vec3(isWater(g.x) ? 1.0 : 0.0, isWater(g.y) ? 1.0 : 0.0, isWater(g.z) ? 1.0 : 0.0);
  float wWater = dot(w, wet);
  vec3 wl = w * (1.0 - wet);
  if (g.y == g.x) { wl.x += wl.y; wl.y = 0.0; }
  if (g.z == g.x) { wl.x += wl.z; wl.z = 0.0; }
  else if (g.z == g.y) { wl.y += wl.z; wl.z = 0.0; }

  // The coast: a signed distance to it in hex units (the claim difference over its slope), only
  // where land and water are both among the three cells, fading to nothing before either leaves.
  Coast c = coastOf(b);
  vec2 slope = vec2(dFdx(c.s) / max(abs(dFdx(h.x)), 1e-6), dFdy(c.s) / max(abs(dFdy(h.y)), 1e-6));
  float dist = c.s / max(length(slope), 0.6);
  float coastMask = c.both && c.known ? smoothstep(0.004, 0.05, min(c.land, c.water)) : 0.0;

  vec3 land = vec3(0.0);
  float landSum = 0.0;
  if (wl.x > 0.002) { land += wl.x * paint(g.x, uv, dx, dy); landSum += wl.x; }
  if (wl.y > 0.002) { land += wl.y * paint(g.y, uv, dx, dy); landSum += wl.y; }
  if (wl.z > 0.002) { land += wl.z * paint(g.z, uv, dx, dy); landSum += wl.z; }
  land /= max(landSum, 1e-5);

  // A sand beach along the land side of the coast, wet sand at the water's edge. Its width comes
  // from the cells all round (waterNear), not the coast's three: measured from the coast line it
  // was cut off along the straight line where the water cell stopped being one of the three.
  float nearWater = landSum > 0.002 ? waterNear(b.hp) : 0.0;
  float beachEdge = beachEnd(h);
  float beach = smoothstep(beachEdge * 0.6, beachEdge, nearWater);
  if (landSum > 0.002) {
    if (beach > 0.002) {
      land = mix(land, paint(${Ground.SAND}, uv, dx, dy), beach);
      float damp = (1.0 - smoothstep(0.015, 0.08, -dist)) * coastMask;
      if (damp > 0.002) land = mix(land, paint(${WET_SAND}, uv, dx, dy), damp * 0.75);
    }
  }

  // Rolling hills: the land lit by the smooth height field's slope (plan step 5).
  vec3 hill = hillAt(h);
  land *= hillShade(hill.yz);

  vec3 colour = land;
  if (wWater > 0.002) {
    vec3 sea = waterColour(b, c, uv, dx, dy);
    colour = landSum > 0.002 ? mix(land, sea, wWater / (wWater + landSum)) : sea;
  }

  if (uQuality > 1.5) {
    // Soft light and shade drifting over the land, as in a painting.
    colour *= 0.94 + 0.12 * valueNoise(vWorld / (uTexScale * 2.3) + 5.0);
  }

  // Cliffs where neighbours' heights drop a lot: a signed distance to the rim like the coast's.
  Cliff cliff = cliffOf(b);
  float cliffDist = cliff.on ? cliff.s : 0.0;
  vec2 hdx = dFdx(h);
  vec2 hdy = dFdy(h);
  if (landSum > 0.002) {
    colour = drawCliff(colour, cliff, h, hdx, hdy);
  }

  // Surf: white foam on the water's edge and broken lines rolling in towards it.
  if (coastMask > 0.0 && dist > -0.06 && dist < 0.6) {
    vec3 foamTexture = sampleGround(${FOAM}, uv * 1.7 + uTime * vec2(0.012, 0.0), dx * 1.7, dy * 1.7);
    float white = smoothstep(0.55, 0.9, dot(foamTexture, vec3(0.299, 0.587, 0.114)));
    float wobble = valueNoise(h * 4.5 + vec2(uTime * 0.35, 0.0));
    float edgeWidth = 0.11 + 0.09 * wobble;
    float edge = smoothstep(-0.05, -0.005, dist) * (1.0 - smoothstep(edgeWidth * 0.4, edgeWidth, dist));
    float phase = fract(dist / SURF_SPACING + uTime * SURF_SPEED + 0.7 * valueNoise(h * 1.6 + 3.0));
    float crest = smoothstep(0.0, 0.1, phase) * (1.0 - smoothstep(0.18, 0.4, phase));
    float reachOut = 1.0 - smoothstep(0.2, 0.6, dist);
    float broken = smoothstep(0.15, 0.55, valueNoise(h * 3.7 + 7.0 + uTime * 0.05));
    // The lines thin out as the land cell leaves the three (no straight end where it leaves).
    float lines = crest * reachOut * broken * smoothstep(0.04, 0.09, dist) * smoothstep(0.0, 0.3, c.land);
    float foam = clamp(edge * (0.8 + 0.2 * white) + lines * (0.8 + 0.2 * white), 0.0, 1.0) * coastMask;
    colour = mix(colour, FOAM_WHITE, foam * 0.97);
  }

  // Meadow flowers (Medium and High), off the beach and off cliff faces; they fade out before
  // they are smaller than a couple of pixels.
  if (uQuality > 0.5 && landSum > 0.002) {
    float meadow = 0.0;
    for (int k = 0; k < 3; k++) {
      int gk = g[k];
      meadow += wl[k] * (gk == ${Ground.MEADOW} ? 1.0 : gk == ${Ground.LUSH} ? 0.55 : gk == ${Ground.MEADOW_PLAIN} ? 0.45 : 0.0);
    }
    meadow *= smoothstep(70.0, 130.0, cellPixels) * (uQuality > 1.5 ? 1.0 : 0.6);
    meadow *= 1.0 - smoothstep(beachEdge * 0.2, beachEdge * 0.5, nearWater);
    if (cliff.on) meadow *= 1.0 - step(-0.4, cliffDist) * step(cliffDist, CLIFF_CLEAR_LOW) * cliff.mask;
    if (meadow > 0.01) colour = drawFlowers(colour, vWorld, meadow);
  }

  // Ground details and sea rocks, once their sheet is in; details fade out as cells get small.
  if (uSpritesReady > 0.5) {
    float detailFade = smoothstep(26.0, 60.0, cellPixels);
    if (uQuality > 0.5 && detailFade > 0.0 && landSum > 0.002) {
      colour = drawDecals(colour, vWorld, wdx, wdy, detailFade);
    }
    float rockFade = smoothstep(7.0, 16.0, cellPixels);
    if (rockFade > 0.0) colour = drawRocks(colour, vWorld, wdx, wdy, rockFade);
  }

  // Faint hex lines by the true point's distance to its side, in screen pixels. Each cell draws
  // half the line; the whole line is about 1% of a cell wide like mock-up B's (1.2 to 3 pixels),
  // and it fades out when cells get too small to read.
  vec2 qr0 = roundAxial(axialOf(h));
  vec2 n0;
  float edgeIn = APOTHEM - nearestSide(h - centreOf(qr0), n0);
  float pixels = edgeIn / max(fwidth(edgeIn), 1e-6);
  float halfWidth = clamp(0.008 * cellPixels, 0.6, 1.5);
  float line = 1.0 - smoothstep(halfWidth, halfWidth + 1.0, pixels);
  line *= smoothstep(5.0, 12.0, cellPixels);
  colour = mix(colour, uLine.rgb, uLine.a * line);

  finalColor = vec4(colour, 1.0);
}
`;
