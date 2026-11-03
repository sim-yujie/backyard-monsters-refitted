/**
 * The painted map's player borders (plan step 8), drawn by one quad over the world like the
 * ground (`groundShader.ts`, whose vertex shader it shares). Each pixel finds its cell, reads the
 * cell's relation and border sides from `uData` (`borders.ts`), and if the cell has border sides
 * draws, inside the owner's land only:
 *   - a thin bright line a little inside the edge, its colour mixed towards white in the middle;
 *   - a soft glow round that line;
 *   - a faint haze fading inwards (mock-up B's "soft haze inside the edge").
 * Distances are to the border sides as segments, in world points, so an outline turning inwards
 * rounds its corner. Two players' lands that touch each show their own colour on their own side.
 *
 * Quality: High adds a slow pulse (`uPulse`, stepped by `BorderLayer.animate`); Low draws the line
 * and a narrower glow, no haze. The line never gets thinner than about a pixel when zoomed out.
 */
export const BORDER_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
in vec2 vWorld;
out vec4 finalColor;

uniform highp sampler2D uData;
uniform float uShape;       // 0 flat-top (odd-q), 1 pointy-top (odd-r)
uniform vec2 uUnit;         // world points per regular-hex unit (corner radius 1)
uniform vec2 uWorldCells;   // the world's size in cells
uniform float uCellPoints;  // a cell's width, world points
uniform float uQuality;     // 2 High, 1 Medium, 0 Low
uniform float uPulse;       // 0..1, the slow pulse (0 off High)
uniform vec3 uYou;
uniform vec3 uAlliance;
uniform vec3 uOther;
uniform vec3 uAttacker;

const float SQRT3 = 1.7320508;

// Shares of a cell's width: the line's distance in from the edge, its half width, the glow's
// reach either side of it, and how far the haze fades in.
const float LINE_INSET = 0.04;
const float LINE_HALF = 0.013;
const float GLOW = 0.05;
const float HAZE = 0.22;

const vec2 STEPS[6] = vec2[6](
  vec2(1.0, 0.0), vec2(1.0, -1.0), vec2(0.0, -1.0), vec2(-1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0));

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

float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 e = b - a;
  float t = clamp(dot(p - a, e) / dot(e, e), 0.0, 1.0);
  return length(p - a - t * e);
}

void main() {
  vec2 h = vWorld / uUnit;
  vec2 qr = roundAxial(axialOf(h));
  ivec2 cell = toOffset(qr);
  if (cell.x < 0 || cell.y < 0 || float(cell.x) >= uWorldCells.x || float(cell.y) >= uWorldCells.y) discard;
  vec4 data = texelFetch(uData, cell, 0);
  int relation = int(data.r * 255.0 + 0.5);
  int mask = int(data.g * 255.0 + 0.5);
  if (relation == 0 || mask == 0) discard;

  // World points from the cell's centre, and to the nearest border side.
  vec2 p = (h - centreOf(qr)) * uUnit;
  float d = 1e9;
  for (int k = 0; k < 6; k++) {
    if ((mask & (1 << k)) == 0) continue;
    vec2 m = centreOf(STEPS[k]) * 0.5;
    vec2 t = vec2(-m.y, m.x) / length(m) * 0.5;
    d = min(d, segmentDistance(p, (m - t) * uUnit, (m + t) * uUnit));
  }

  float cellPts = uCellPoints;
  float haze = uQuality > 0.5 ? HAZE * cellPts : 0.0;
  float glowReach = (uQuality > 0.5 ? GLOW : GLOW * 0.6) * cellPts;
  if (d > max(haze, (LINE_INSET + GLOW) * cellPts)) discard;

  // The line: at least about one pixel wide however far out the camera is.
  float pixel = max(fwidth(d), 1e-4);
  float fromLine = abs(d - LINE_INSET * cellPts);
  float half_ = max(LINE_HALF * cellPts, 0.9 * pixel);
  float line = 1.0 - smoothstep(half_ - 0.5 * pixel, half_ + 0.75 * pixel, fromLine);
  float glow = exp(-pow(fromLine / max(glowReach, pixel), 2.0) * 2.2);
  float hazeA = haze > 0.0 ? (1.0 - smoothstep(0.0, haze, d)) * 0.2 : 0.0;

  float pulse = 1.0 + 0.22 * (uPulse - 0.5) * 2.0 * step(1.5, uQuality);
  vec3 colour = relation == 1 ? uYou : relation == 2 ? uAlliance : relation == 3 ? uOther : uAttacker;
  float glowA = clamp(glow * 0.75 * pulse, 0.0, 1.0);
  float a = max(max(line, glowA), hazeA);
  // The middle of the line runs towards white, as a glowing tube does.
  vec3 rgb = mix(colour, mix(colour, vec3(1.0), 0.4), line);
  finalColor = vec4(rgb * a, a);
}
`;
