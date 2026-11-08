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
 *
 * Each relation has its own line as well as its colour (`relationLook.ts`, owner 8 Nov 2026), so
 * colour-blind players can tell them apart: yours thick, neutral thin with a softer glow, friends a
 * double line (pinned friends a bolder one with a stronger glow), hostile dashed. Every line sits
 * on a thin dark rim (`uRim`), which keeps the bright colours readable on sand and pale grass.
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
uniform vec3 uHostile;
uniform vec3 uFriend;
uniform vec3 uPinned;
uniform vec3 uPinnedCentre;
uniform vec3 uRim;          // the dark rim under every line
uniform float uRimAlpha;

const float SQRT3 = 1.7320508;

// Shares of a cell's width: the line's distance in from the edge, its half width, the glow's
// reach either side of it, and how far the haze fades in.
const float LINE_INSET = 0.04;
const float LINE_HALF = 0.013;
const float GLOW = 0.05;
const float HAZE = 0.22;
// The dark rim's width either side of the line, a share of a cell's width.
const float RIM = 0.012;

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
  // along: how far along the nearest side, 0..1 corner to corner, for the hostile dashes.
  float d = 1e9;
  float along = 0.0;
  for (int k = 0; k < 6; k++) {
    if ((mask & (1 << k)) == 0) continue;
    vec2 m = centreOf(STEPS[k]) * 0.5;
    vec2 t = vec2(-m.y, m.x) / length(m) * 0.5;
    vec2 a = (m - t) * uUnit;
    vec2 e = (m + t) * uUnit - a;
    float s = clamp(dot(p - a, e) / dot(e, e), 0.0, 1.0);
    float dist = length(p - a - s * e);
    if (dist < d) {
      d = dist;
      along = s;
    }
  }

  // The relation's colour and line: 1 yours, 2 alliance, 3 neutral, 4 hostile, 5 friend, 6 pinned.
  vec3 colour = uOther;
  float halfK = 1.0;
  float glowK = 1.0;
  float hazeK = 1.0;
  float doubleGap = 0.0;
  bool dashed = false;
  bool triple = false;
  if (relation == 1) { colour = uYou; halfK = 1.5; }
  else if (relation == 2) { colour = uAlliance; }
  else if (relation == 3) { colour = uOther; halfK = 0.8; glowK = 0.6; hazeK = 0.5; }
  else if (relation == 4) { colour = uHostile; halfK = 1.2; dashed = true; }
  else if (relation == 5) { colour = uFriend; halfK = 0.7; doubleGap = 0.018; }
  else { colour = uPinned; halfK = 0.75; doubleGap = 0.034; glowK = 1.35; triple = true; }

  float cellPts = uCellPoints;
  float haze = uQuality > 0.5 ? HAZE * hazeK * cellPts : 0.0;
  float glowReach = (uQuality > 0.5 ? GLOW : GLOW * 0.6) * cellPts;
  float gap = doubleGap * cellPts;
  if (d > max(haze, (LINE_INSET + GLOW + RIM) * cellPts + gap)) discard;

  // The line: at least about one pixel wide however far out the camera is. A double line is two
  // strokes either side of the line's middle; zoomed far out they merge into one.
  float pixel = max(fwidth(d), 1e-4);
  float fromCentre = abs(d - LINE_INSET * cellPts);
  float fromLine = abs(fromCentre - gap);
  // A pinned friend adds a third stroke down the middle: three lines to a friend's two.
  if (triple) fromLine = min(fromLine, fromCentre);
  float half_ = max(LINE_HALF * halfK * cellPts, 0.9 * pixel);
  float line = 1.0 - smoothstep(half_ - 0.5 * pixel, half_ + 0.75 * pixel, fromLine);
  // The dark rim round the whole band (and between a double line's strokes).
  float rimOuter = gap + half_ + max(RIM * cellPts, pixel);
  float rim = 1.0 - smoothstep(rimOuter - 0.5 * pixel, rimOuter + 0.75 * pixel, fromCentre);

  // Hostile: dashes, one at each corner and two along each side; solid-ish once too small to see.
  float on = 1.0;
  if (dashed) {
    float u = along * 3.0;
    float w = max(fwidth(u), 1e-4);
    on = 1.0 - smoothstep(0.3 - w, 0.3 + w, abs(u - floor(u + 0.5)));
    on = mix(on, 0.75, smoothstep(0.12, 0.3, w));
  }
  line *= on;
  rim *= on;

  float glow = exp(-pow(fromLine / max(glowReach, pixel), 2.0) * 2.2) * on;
  float hazeA = haze > 0.0 ? (1.0 - smoothstep(0.0, haze, d)) * 0.2 : 0.0;

  float pulse = 1.0 + 0.22 * (uPulse - 0.5) * 2.0 * step(1.5, uQuality);
  // The glow gives way where the rim is, so the dark edge shows.
  float glowA = clamp(glow * 0.75 * glowK * pulse, 0.0, 1.0) * (1.0 - 0.75 * rim);
  float a = max(max(line, glowA), hazeA);
  // The middle of the line runs towards white, as a glowing tube does.
  vec3 rgb = mix(colour, mix(colour, vec3(1.0), 0.4), line);
  // A pinned friend's middle stroke is gold: the green triple with a gold heart.
  if (triple) {
    float heart = (1.0 - smoothstep(half_ - 0.5 * pixel, half_ + 0.75 * pixel, fromCentre)) * on;
    rgb = mix(rgb, mix(uPinnedCentre, vec3(1.0), 0.2), heart);
  }
  // The colour over the rim, premultiplied.
  float rimA = rim * uRimAlpha;
  float outA = a + rimA * (1.0 - a);
  finalColor = vec4(rgb * a + uRim * rimA * (1.0 - a), outA);
}
`;
