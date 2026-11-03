import { Ground } from "./groundKinds";
import { CLIFF_DROP, CLIFF_STRIPS, HILL_LIGHT, HILL_RADIUS } from "./hills";

/**
 * Hills and cliffs for the painted ground (Map Room 2 Modern look, plan step 5), GLSL included by
 * `groundShader.ts` after its hex helpers (`cellAt`, `roundAxial`, `NEIGHBOURS`, `Blend` ...).
 * `hills.ts` is the TypeScript twin of these sums, for the tests.
 *
 * Rolling hills: the cells' heights are blended into one smooth height field (a soft bump of
 * radius {@link HILL_RADIUS} hex units round every cell centre, so heights swell over several
 * cells with no steps), and the ground is lit by that field's slope from the top-left: slopes
 * facing the light brighten, the far sides darken. No walls.
 *
 * Rocky cliffs: where a cell is {@link CLIFF_DROP} or more above its neighbour, a painted cliff face
 * (one of the Codex strips in `cliffs@4x.webp`, grass hanging over its top, stones at its foot)
 * hangs down the screen from the high ground's rim. The rim is a signed distance like the coast's:
 * the two cells' claims (their blend weights roughened by noise) meet on a line that wanders with
 * the ground edges, not along the hex sides. A face is drawn fully where the high ground is up the
 * screen (the camera sees it), narrower where the drop runs sideways, and where the high ground is
 * down the screen (the face looks away) only a rocky lip with a shadow below it is shown.
 */
export const HILLS_GLSL = `
uniform sampler2D uCliffs;     // the three cliff face strips stacked, then scree and peak pieces
uniform float uCliffsReady;    // 1 once the cliff sheet has loaded

const float HILL_RADIUS = ${HILL_RADIUS.toFixed(3)};
const float HILL_LIGHT = ${HILL_LIGHT.toFixed(4)};
const float CLIFF_DROP = ${CLIFF_DROP.toFixed(1)};
// A full face's depth (hex units, along the drop) for the tallest strip; the share of it drawn into
// the high cell (the rim sits that far back from the claims' line); the strip's repeat along the
// cliff (hex units); the lip's width and the shadow's reach where the face looks away.
const float FACE = 1.5;
const float FACE_BACK = 0.3;
const float FACE_REPEAT = 4.5;
const float LIP = 0.11;
// The third cell keeps a cliff going (instead of tapering it off) when it stands this share of
// CLIFF_DROP above the low cell: runs of cliff read as one long rock face, as in mock-up B.
const float CLIFF_CARRY = 0.6;
const float SHADE_REACH = 0.32;
// The claim gaps (about hex units) round the rim kept clear of ground details: into the high
// ground, and down the low side to the face's foot.
const float CLIFF_CLEAR_HIGH = 0.35;
const float CLIFF_CLEAR_LOW = 0.9;
// The three strips' rows in the sheet (top, height, as shares of the sheet's height) and depths.
const vec4 STRIP_ROWS[3] = vec4[3](
  vec4(${CLIFF_STRIPS[0]!.top.toFixed(5)}, ${CLIFF_STRIPS[0]!.height.toFixed(5)}, ${CLIFF_STRIPS[0]!.depth.toFixed(3)}, 0.0),
  vec4(${CLIFF_STRIPS[1]!.top.toFixed(5)}, ${CLIFF_STRIPS[1]!.height.toFixed(5)}, ${CLIFF_STRIPS[1]!.depth.toFixed(3)}, 0.0),
  vec4(${CLIFF_STRIPS[2]!.top.toFixed(5)}, ${CLIFF_STRIPS[2]!.height.toFixed(5)}, ${CLIFF_STRIPS[2]!.depth.toFixed(3)}, 0.0));
const vec3 HILL_SUN = vec3(-0.55, -0.7, 0.75);

// The smooth height field at hex point h and its slope (height per hex unit): every known cell
// within HILL_RADIUS adds a bump (1 - (d/R)^2)^3, which reaches 0 with no kink before the cells
// this point does not look at. Water counts as the shore's height, fog and unloaded cells not at all.
vec3 hillAt(vec2 h) {
  vec2 qr = roundAxial(axialOf(h));
  float sw = 0.0;
  float sh = 0.0;
  vec2 sg = vec2(0.0);
  vec2 sgh = vec2(0.0);
  for (int k = 0; k < 7; k++) {
    vec2 cell = k == 6 ? qr : qr + NEIGHBOURS[k];
    vec2 d = h - centreOf(cell);
    float r2 = dot(d, d) / (HILL_RADIUS * HILL_RADIUS);
    if (r2 >= 1.0) continue;
    vec4 t = cellAt(toOffset(cell));
    int g = groundOf(t);
    if (g >= ${Ground.FOG}) continue;
    float height = max(t.r * 255.0, 98.0);
    float u = 1.0 - r2;
    float w = u * u * u;
    vec2 gw = (-6.0 / (HILL_RADIUS * HILL_RADIUS)) * u * u * d;
    sw += w;
    sh += w * height;
    sg += gw;
    sgh += gw * height;
  }
  if (sw < 1e-4) return vec3(100.0, 0.0, 0.0);
  float hh = sh / sw;
  return vec3(hh, (sgh - hh * sg) / sw);
}

// How the light falls on a slope, as a multiplier on the ground's colour (1 on the flat).
float hillShade(vec2 slope) {
  vec3 n = normalize(vec3(-slope * HILL_LIGHT, 1.0));
  vec3 sun = normalize(HILL_SUN);
  return clamp(dot(n, sun) / sun.z, 0.72, 1.22);
}

// The cliff round a point, from its three cells (Blend): the strongest pair of a high and a low cell
// CLIFF_DROP or more apart. The rim is the line half way between their centres (in the pushed
// point's space, so it wanders with the grounds' edges), straight and exact: no screen derivatives.
struct Cliff {
  bool on;
  float s;      // signed distance to the rim (hex units), > 0 on the low side
  vec2 n;       // unit direction from the high cell to the low one
  float drop;   // the height between them
  float mask;   // fades the cliff out where either cell stops being one of the three
  float pick;   // 0..1, which strip
};

Cliff cliffOf(Blend b) {
  Cliff c;
  c.on = false;
  c.s = 0.0;
  c.n = vec2(0.0, 1.0);
  c.drop = 0.0;
  c.mask = 0.0;
  c.pick = 0.0;
  int k = b.claim.x >= b.claim.y && b.claim.x >= b.claim.z ? 0 : b.claim.y >= b.claim.z ? 1 : 2;
  if (!isLand(b.g[k])) return c;
  // The other cell nearest in claim that stands CLIFF_DROP above or below the winner.
  int m = -1;
  float best = -9.0;
  for (int i = 0; i < 3; i++) {
    if (i == k || !isLand(b.g[i]) || abs(b.height[i] - b.height[k]) < CLIFF_DROP) continue;
    if (b.claim[i] > best) { best = b.claim[i]; m = i; }
  }
  if (m < 0) return c;
  int j = 3 - k - m;
  bool kHigh = b.height[k] > b.height[m];
  vec2 high = kHigh ? b.cen[k] : b.cen[m];
  vec2 low = kHigh ? b.cen[m] : b.cen[k];
  c.on = true;
  c.n = normalize(low - high);
  c.s = dot(b.hp - 0.5 * (high + low), c.n);
  c.drop = abs(b.height[k] - b.height[m]);
  c.mask = smoothstep(0.0, 0.14, min(b.bary[k], b.bary[m]));
  // The third cell carries the cliff on when it stands on the winner's side of the same drop;
  // otherwise the face tapers off before the line between the winner and it.
  bool carries = isLand(b.g[j]) && abs(b.height[j] - b.height[m]) >= CLIFF_DROP * CLIFF_CARRY
    && (b.height[j] > b.height[m]) == kHigh;
  if (!carries) c.mask *= smoothstep(0.0, 0.16, b.claim[k] - b.claim[j]);
  c.pick = fract((b.height[m] + b.height[k]) * 0.6180339);
  return c;
}

// One strip's colour (premultiplied) at (u along the cliff, v down the face 0..1).
vec4 stripSample(int strip, float u, float v, vec2 gx, vec2 gy) {
  if (v < 0.0 || v > 1.0) return vec4(0.0);
  vec4 row = STRIP_ROWS[strip];
  vec2 at = vec2(u, row.x + clamp(v, 0.004, 0.996) * row.y);
  vec4 c = textureGrad(uCliffs, at, gx * vec2(1.0, row.y), gy * vec2(1.0, row.y));
  return c;
}

// The cliff's face, lip and shadows over the ground colour. h is the hex point, hdx and hdy its
// screen derivatives.
vec3 drawCliff(vec3 colour, Cliff c, vec2 h, vec2 hdx, vec2 hdy) {
  if (!c.on || c.mask <= 0.0) return colour;
  vec2 n = c.n;
  float dist = c.s;
  // How much of the face the camera sees: all of it when the high ground is up the screen.
  float facing = clamp(n.y * 0.85 + 0.35, 0.0, 1.0);
  int strip = c.drop >= CLIFF_DROP + 12.0 || c.pick < 0.4 ? 0 : c.pick < 0.7 ? 1 : 2;
  float tall = mix(0.85, 1.15, smoothstep(CLIFF_DROP, CLIFF_DROP + 30.0, c.drop));
  float depth = FACE * STRIP_ROWS[strip].z * tall * facing;
  float lipShare = 1.0 - smoothstep(0.1, 0.5, facing);
  // The face hangs straight down the screen from the rim: how far below the rim this point is.
  float ny = max(n.y, 0.3);
  float down = dist / ny;
  // Along the rim (the strip's u), and its screen derivatives.
  vec2 along = vec2(n.y, -n.x) / FACE_REPEAT;
  float u = dot(h, along);
  vec2 gu = vec2(dot(hdx, along), dot(hdy, along));

  // The shadow the high ground throws on the low side's foot (and below a lip).
  float foot = depth * (1.0 - FACE_BACK);
  float shadow = (1.0 - smoothstep(foot, foot + SHADE_REACH, down)) * step(-0.02, dist);
  colour *= 1.0 - 0.22 * shadow * c.mask;

  // The rocky lip where the face looks away: a band of rock on the high side's rim, ragged at
  // its top where the grass hangs over.
  if (lipShare > 0.0 && dist < 0.0 && dist > -LIP * 1.6 && uCliffsReady > 0.5) {
    float ragged = LIP * (0.7 + 0.6 * valueNoise(h * 6.0 + 3.1));
    float inLip = 1.0 - smoothstep(ragged * 0.85, ragged, -dist);
    float v = 0.35 + 0.5 * clamp(-dist / ragged, 0.0, 1.0);
    vec4 rock = stripSample(0, u, v, vec2(gu.x, 0.0), vec2(gu.y, 0.0));
    vec3 lipColour = rock.a > 0.01 ? rock.rgb / rock.a : colour;
    colour = mix(colour, lipColour * 0.92, inLip * lipShare * c.mask * rock.a);
  }

  // The face itself.
  if (depth > 0.03 && uCliffsReady > 0.5) {
    float top = -FACE_BACK * depth;
    float v = (down - top) / depth;
    if (v > -0.01 && v < 1.01) {
      vec2 gv = vec2(dot(hdx, n), dot(hdy, n)) / (ny * depth);
      vec4 face = stripSample(strip, u, v, vec2(gu.x, gv.x), vec2(gu.y, gv.y));
      // Lit a little by which way it faces (the strips carry their own top-left light).
      float lit = dot(normalize(vec3(n, 0.5)), normalize(HILL_SUN));
      face.rgb *= clamp(0.98 + 0.25 * lit, 0.82, 1.08);
      face *= c.mask;
      colour = colour * (1.0 - face.a) + face.rgb;
    }
  }
  return colour;
}
`;
