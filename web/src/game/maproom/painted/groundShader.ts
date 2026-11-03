import { Ground, SHADER_TEXTURES } from "./groundKinds";

/**
 * The painted ground's WebGL2 shader (Map Room 2 Modern look, plan step 2).
 *
 * One quad over the world. Per pixel it finds its hex (`cellShape.ts` is the TypeScript twin of
 * these sums), reads the cell and the cell across its nearest side from the data texture
 * (`GroundData.ts`), and paints their ground textures sampled in world position, so neighbours
 * with the same ground join with no seam. The point used to pick the cell is pushed about by
 * smooth noise, so where two grounds meet the line wanders across the hex sides instead of
 * following them, and a fine noise breaks the meeting line into a painted, ragged edge. Last, the
 * faint hex lines (mock-up B strength: light cream, about 30%, 1-2 screen pixels) are drawn by the
 * true (un-pushed) point's distance to its hex side.
 *
 * Quality: High blends two lookups of each texture at different scales (hides the repeat) and
 * varies the light; Medium one lookup; Low no wandering edge and only the cell's own ground.
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

  // The cell whose ground this pixel shows: the point is pushed about by smooth noise first, so
  // grounds wander across the hex sides (not on Low).
  vec2 hp = h;
  if (uQuality > 0.5) {
    hp += 0.32 * (vec2(fbm(h * 0.9), fbm(h * 0.9 + 19.7)) - 0.5) * 2.0;
  }
  vec2 qr = roundAxial(axialOf(hp));
  vec2 centre = centreOf(qr);
  vec2 normal;
  float side = nearestSide(hp - centre, normal);
  float inset = max(0.0, 1.0 - side / APOTHEM);
  ivec2 cellA = toOffset(qr);
  int gA = groundAt(cellA);
  vec3 colour;
  if (uQuality < 0.5) {
    colour = paint(gA, uv, dx, dy);
  } else {
    ivec2 cellB = toOffset(roundAxial(axialOf(centre + normal * 2.0 * APOTHEM)));
    int gB = groundAt(cellB);
    colour = paint(gA, uv, dx, dy);
    if (gB != gA) {
      // Own weight 1 inside, 0.5 on the side; a fine noise roughens the meeting line, with its
      // sign fixed by the cells' order so both sides of a side agree.
      float own = 0.5 + 0.5 * smoothstep(0.0, 0.5, inset);
      float rough = (valueNoise(vWorld / (uTexScale.x * 0.025)) - 0.5) * 0.9;
      bool first = cellA.y < cellB.y || (cellA.y == cellB.y && cellA.x < cellB.x);
      float w = clamp((own - 0.5 + (first ? rough : -rough)) * 2.5 + 0.5, 0.0, 1.0);
      if (w < 0.999) colour = mix(paint(gB, uv, dx, dy), colour, w);
    }
    if (uQuality > 1.5) {
      // Soft light and shade drifting over the land, as in a painting.
      colour *= 0.94 + 0.12 * valueNoise(vWorld / (uTexScale * 2.3) + 5.0);
    }
  }

  // Faint hex lines by the true point's distance to its side, in screen pixels; they fade out
  // when cells get too small to read.
  vec2 qr0 = roundAxial(axialOf(h));
  vec2 n0;
  float edge = APOTHEM - nearestSide(h - centreOf(qr0), n0);
  float pixels = edge / max(fwidth(edge), 1e-6);
  float line = 1.0 - smoothstep(0.6, 1.6, pixels);
  float cellPixels = 1.0 / max(length(fwidth(h)), 1e-6);
  line *= smoothstep(5.0, 12.0, cellPixels);
  colour = mix(colour, uLine.rgb, uLine.a * line);

  finalColor = vec4(colour, 1.0);
}
`;
