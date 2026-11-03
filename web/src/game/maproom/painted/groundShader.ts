import { Ground, SHADER_TEXTURES } from "./groundKinds";

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
 * Quality: High blends two lookups of each texture at different scales (hides the repeat) and
 * varies the light; Medium one lookup; Low no edge noise and a short plain fade.
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

int groundAt(ivec2 cell) {
  ivec2 size = ivec2(uWorldCells);
  if (cell.x < 0 || cell.y < 0 || cell.x >= size.x || cell.y >= size.y) return ${Ground.UNLOADED};
  return int(texelFetch(uData, cell, 0).a * 255.0 + 0.5) & 15;
}

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

void main() {
  vec2 h = vWorld / uUnit;
  vec2 uv = vWorld / uTexScale;
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);

  // The point is pushed about by smooth noise first, so grounds wander across the hex sides (on
  // Low too: it is a little arithmetic and no texture reads, and without it Low looked like tiles).
  vec2 hp = h + WARP * (vec2(fbm(h * 0.6), fbm(h * 0.6 + 19.7)) - 0.5) * 2.0;

  // The three cells round this point: its own hex and the two neighbours it leans towards. Their
  // centres make the triangle the point sits in, and the point's place in that triangle weighs the
  // three grounds. Weights only ever change smoothly, so there are no seams where the neighbours
  // change (the earlier one-neighbour blend left straight steps at the hex corners).
  vec2 qr = roundAxial(axialOf(hp));
  vec2 centre = centreOf(qr);
  vec2 d = hp - centre;
  vec2 dir1 = vec2(0.0);
  vec2 dir2 = vec2(0.0);
  float best1 = -1e9;
  float best2 = -1e9;
  for (int k = 0; k < 6; k++) {
    float along = dot(d, centreOf(NEIGHBOURS[k]));
    if (along > best1) { best2 = best1; dir2 = dir1; best1 = along; dir1 = NEIGHBOURS[k]; }
    else if (along > best2) { best2 = along; dir2 = NEIGHBOURS[k]; }
  }
  vec3 bary = clamp(barycentric(d, centreOf(dir1), centreOf(dir2)), 0.0, 1.0);
  ivec2 cell0 = toOffset(qr);
  ivec2 cell1 = toOffset(qr + dir1);
  ivec2 cell2 = toOffset(qr + dir2);
  int g0 = groundAt(cell0);
  int g1 = groundAt(cell1);
  int g2 = groundAt(cell2);

  // Each cell's claim: its weight, roughened by a noise of its own (continuous, as it hangs on the
  // cell and the world position only). The strongest claim wins; claims within BAND of it share,
  // which gives a short painted fade instead of a cut.
  vec3 claim = bary;
  float band = BAND_LOW;
  if (uQuality > 0.5) {
    vec2 p = h * EDGE_FREQ;
    claim += EDGE_NOISE * (vec3(
      fbm(p + vec2(cell0) * 0.37),
      fbm(p + vec2(cell1) * 0.37),
      fbm(p + vec2(cell2) * 0.37)) - 0.5);
    band = BAND;
  }
  float top = max(claim.x, max(claim.y, claim.z));
  vec3 w = max(claim - (top - band), 0.0);
  w /= max(w.x + w.y + w.z, 1e-5);
  // The same ground twice is one texture read.
  if (g1 == g0) { w.x += w.y; w.y = 0.0; }
  if (g2 == g0) { w.x += w.z; w.z = 0.0; }
  else if (g2 == g1) { w.y += w.z; w.z = 0.0; }

  vec3 colour = vec3(0.0);
  if (w.x > 0.002) colour += w.x * paint(g0, uv, dx, dy);
  if (w.y > 0.002) colour += w.y * paint(g1, uv, dx, dy);
  if (w.z > 0.002) colour += w.z * paint(g2, uv, dx, dy);
  colour /= max(w.x * step(0.002, w.x) + w.y * step(0.002, w.y) + w.z * step(0.002, w.z), 1e-5);

  if (uQuality > 0.5) {
    if (uQuality > 1.5) {
      // Soft light and shade drifting over the land, as in a painting.
      colour *= 0.94 + 0.12 * valueNoise(vWorld / (uTexScale * 2.3) + 5.0);
    }
  }

  // Faint hex lines by the true point's distance to its side, in screen pixels. Each cell draws
  // half the line; the whole line is about 1% of a cell wide like mock-up B's (1.2 to 3 pixels),
  // and it fades out when cells get too small to read.
  vec2 qr0 = roundAxial(axialOf(h));
  vec2 n0;
  float edge = APOTHEM - nearestSide(h - centreOf(qr0), n0);
  float pixels = edge / max(fwidth(edge), 1e-6);
  float cellPixels = 1.0 / max(length(fwidth(h)), 1e-6);
  float halfWidth = clamp(0.008 * cellPixels, 0.6, 1.5);
  float line = 1.0 - smoothstep(halfWidth, halfWidth + 1.0, pixels);
  line *= smoothstep(5.0, 12.0, cellPixels);
  colour = mix(colour, uLine.rgb, uLine.a * line);

  finalColor = vec4(colour, 1.0);
}
`;
