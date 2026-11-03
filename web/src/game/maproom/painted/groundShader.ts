import { Ground, GroundTexture, OCCUPIED_FLAG, SHADER_TEXTURES } from "./groundKinds";

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
const float EDGE_FREQ = 2.2;
const float EDGE_NOISE = 0.8;
const float BAND = 0.08;
const float BAND_LOW = 0.05;

// Coast and sea (hex units unless said): the beach's width on the land side; how far into the sea
// the turquoise reaches (as the land's share of the weights); the plain sea's mix towards the
// shallows colour before it deepens; the surf lines' spacing and speed (lines a second).
const float BEACH = 0.65;
const float SHALLOWS_REACH = 0.38;
const float MID_SEA = 0.5;
const float SURF_SPACING = 0.2;
const float SURF_SPEED = 0.22;
const vec3 FOAM_WHITE = vec3(0.97, 0.99, 1.0);

// Sprites: grid squares and frame sizes as shares of a cell's width; the sheet's rows; the hex
// distance round an occupied cell's middle kept clear of details; how far (claim units) a detail's
// foot must be inside its ground and inland of the coast, and a rock's out from it; the share of
// grid squares with a rock near the coast and further out, and of details on Medium.
const float DECAL_GRID = 0.21;
const float DECAL_SIZE = 0.18;
const float ROCK_GRID = 0.4;
const float ROCK_SIZE = 0.3;
const float SPRITE_ROWS = 5.0;
const float CLEAR = 0.66;
const float DECAL_MARGIN = 0.22;
const float DECAL_SHORE = 0.45;
const float ROCK_OFFSHORE = 0.4;
const float ROCKS_NEAR = 0.6;
const float ROCKS_FAR = 0.07;
const float DECALS_MEDIUM = 0.45;

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
};

Blend blendAt(vec2 h) {
  Blend b;
  // The point is pushed about by smooth noise first, so grounds wander across the hex sides (on
  // Low too: it is a little arithmetic and no texture reads, and without it Low looked like tiles).
  vec2 hp = h + WARP * (vec2(fbm(h * 0.6), fbm(h * 0.6 + 19.7)) - 0.5) * 2.0;

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
  ivec2 cell0 = toOffset(qr);
  ivec2 cell1 = toOffset(qr + dir1);
  ivec2 cell2 = toOffset(qr + dir2);
  vec4 t0 = cellAt(cell0);
  vec4 t1 = cellAt(cell1);
  vec4 t2 = cellAt(cell2);
  b.g = ivec3(groundOf(t0), groundOf(t1), groundOf(t2));
  b.height = vec3(t0.r, t1.r, t2.r) * 255.0;

  // Each cell's claim: its weight, roughened by a noise of its own (continuous, as it hangs on the
  // cell and the world position only).
  b.claim = b.bary;
  if (uQuality > 0.5) {
    vec2 p = h * EDGE_FREQ;
    b.claim += EDGE_NOISE * (vec3(
      fbm(p + vec2(cell0) * 0.37),
      fbm(p + vec2(cell1) * 0.37),
      fbm(p + vec2(cell2) * 0.37)) - 0.5);
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

// Which ground detail (sprite frame 0..8) a ground wears for hash r, or -1 for none: 0 1 2
// flower patches, 3 tall tuft, 4 tuft, 5 seed tuft, 6 pebbles, 7 sand slabs, 8 mossy stone.
int decalFrame(int g, float r) {
  if (g == ${Ground.MEADOW} || g == ${Ground.MEADOW_PLAIN}) {
    return r < 0.17 ? 0 : r < 0.31 ? 1 : r < 0.46 ? 2 : r < 0.63 ? 4 : r < 0.74 ? 3 : r < 0.84 ? 5 : r < 0.93 ? 6 : 8;
  }
  if (g == ${Ground.LUSH}) return r < 0.3 ? 4 : r < 0.5 ? 3 : r < 0.64 ? 0 : r < 0.78 ? 2 : r < 0.9 ? 5 : 8;
  if (g == ${Ground.SAND}) return r < 0.25 ? 7 : r < 0.7 ? 6 : r < 0.9 ? 8 : 4;
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
  if (g == ${Ground.SAND}) return 0.32;
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
      vec2 foot = (id + vec2(hash12(id + 17.3), hash12(id + 41.9))) * grid;
      float s = base * (0.85 + 0.3 * hash12(id + 5.17));
      vec2 local = (p - foot) / s + vec2(0.5, 1.0);
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) continue;
      vec2 off;
      vec4 t = trueCellAt((foot - vec2(0.0, 0.5 * s)) / uUnit, off);
      if (!isLand(groundOf(t))) continue;
      if (occupiedOf(t) && length(off) < CLEAR) continue;
      Blend fb = blendAt(foot / uUnit);
      Coast fc = coastOf(fb);
      if (!fc.known || (fc.both && fc.s > -0.12)) continue;
      int k = fb.claim.x >= fb.claim.y && fb.claim.x >= fb.claim.z ? 0 : fb.claim.y >= fb.claim.z ? 1 : 2;
      int g = fb.g[k];
      // On the beach band, beach details (pebbles, stones, sand slabs) whatever the ground.
      if (fc.both && fc.s > -DECAL_SHORE) g = ${Ground.SAND};
      float other = -9.0;
      for (int m = 0; m < 3; m++) {
        if (fb.g[m] != fb.g[k]) other = max(other, fb.claim[m]);
      }
      if (fb.claim[k] - other < DECAL_MARGIN) continue;
      if (pick > decalDensity(g) * density) continue;
      int frame = decalFrame(g, hash12(id + 63.1));
      if (frame < 0) continue;
      vec4 sprite = spriteSample(frame, p, foot, s, hash12(id + 9.9) < 0.5, wdx, wdy) * fade;
      colour = colour * (1.0 - sprite.a) + sprite.rgb;
    }
  }
  return colour;
}

// Sea stacks, rocks and islets on a coarser jittered grid: mostly just off the coast, a few further
// out over the shallower water; their tops keep clear of an occupied cell's picture.
vec3 drawRocks(vec3 colour, vec2 p, vec2 wdx, vec2 wdy, float fade) {
  float grid = ROCK_GRID * uCellPoints;
  float base = ROCK_SIZE * uCellPoints;
  vec2 first = floor(vec2(p.x / grid - 0.5, p.y / grid));
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 id = first + vec2(float(i), float(j));
      float pick = hash12(id * 0.91 + 3.3);
      if (pick > max(ROCKS_NEAR, ROCKS_FAR)) continue;
      vec2 foot = (id + vec2(hash12(id + 2.9), hash12(id + 8.1))) * grid;
      float s = base * (0.8 + 0.35 * hash12(id + 6.6));
      vec2 local = (p - foot) / s + vec2(0.5, 1.0);
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) continue;
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
      vec4 sprite = spriteSample(12 + frame, p, foot, s, hash12(id + 4.4) < 0.5, wdx, wdy) * fade;
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

  // A sand beach along the land side of the coast, wet sand at the water's edge.
  if (landSum > 0.002 && coastMask > 0.0) {
    float reach = BEACH * (0.65 + 0.7 * valueNoise(h * 2.3 + 31.0));
    float beach = (1.0 - smoothstep(reach * 0.55, reach, -dist)) * coastMask;
    if (beach > 0.002) {
      land = mix(land, paint(${Ground.SAND}, uv, dx, dy), beach);
      float damp = (1.0 - smoothstep(0.015, 0.08, -dist)) * coastMask;
      if (damp > 0.002) land = mix(land, paint(${WET_SAND}, uv, dx, dy), damp * 0.75);
    }
  }

  vec3 colour = land;
  if (wWater > 0.002) {
    vec3 sea = waterColour(b, c, uv, dx, dy);
    colour = landSum > 0.002 ? mix(land, sea, wWater / (wWater + landSum)) : sea;
  }

  if (uQuality > 1.5) {
    // Soft light and shade drifting over the land, as in a painting.
    colour *= 0.94 + 0.12 * valueNoise(vWorld / (uTexScale * 2.3) + 5.0);
  }

  // Surf: white foam on the water's edge and broken lines rolling in towards it.
  if (coastMask > 0.0 && dist > -0.06 && dist < 0.6) {
    vec3 foamTexture = sampleGround(${FOAM}, uv * 1.7 + uTime * vec2(0.012, 0.0), dx * 1.7, dy * 1.7);
    float white = smoothstep(0.55, 0.9, dot(foamTexture, vec3(0.299, 0.587, 0.114)));
    float wobble = valueNoise(h * 4.5 + vec2(uTime * 0.35, 0.0));
    float edgeWidth = 0.07 + 0.07 * wobble;
    float edge = smoothstep(-0.05, -0.005, dist) * (1.0 - smoothstep(edgeWidth * 0.4, edgeWidth, dist));
    float phase = fract(dist / SURF_SPACING + uTime * SURF_SPEED + 0.7 * valueNoise(h * 1.6 + 3.0));
    float crest = smoothstep(0.0, 0.1, phase) * (1.0 - smoothstep(0.18, 0.4, phase));
    float reachOut = 1.0 - smoothstep(0.2, 0.6, dist);
    float broken = smoothstep(0.15, 0.55, valueNoise(h * 3.7 + 7.0 + uTime * 0.05));
    float lines = crest * reachOut * broken * smoothstep(0.04, 0.09, dist);
    float foam = clamp(edge * (0.8 + 0.2 * white) + lines * (0.8 + 0.2 * white), 0.0, 1.0) * coastMask;
    colour = mix(colour, FOAM_WHITE, foam * 0.92);
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
