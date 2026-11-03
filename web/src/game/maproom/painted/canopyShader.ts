import {
  BOULDER_FRAME,
  CANOPY_SHARE,
  CLEARING_CUT,
  CLEARING_INNER,
  CLEARING_OUTER,
  CROWN_BUMP,
  CROWN_GRID,
  EDGE_WANDER,
  FEATURE_RADIUS,
  GOO_FRAME,
  LOG_FRAME,
  MARSH_FADE,
  PINE_FRAME,
  REED_FRAME,
  ROCK_FADE,
  SHORE_CUT,
  SHORE_END,
  SHORE_START,
  TREE_FRAME,
} from "./canopy";
import { Ground, LandFeature } from "./groundKinds";

const f = (value: number): string => value.toFixed(4);

/**
 * The ground shader's canopy forests, rock fields and goo marsh (plan step 6; `canopy.ts` has the
 * rules and their TypeScript twin). Pasted into `groundShader.ts` before `main`, which calls
 * `featuresNear`, `canopyEdge`, `canopyColour`, `marshColour` and `drawFeatures`.
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
// The sprite pieces' grid (a share of a cell's width); a piece is at most two squares wide and tall.
const float FEATURE_GRID = 0.13;
// The canopy's shadow on the meadow: cast down and right (the sun is top-left), hex units.
const vec2 CANOPY_SHADOW = vec2(0.1, 0.16);
// The marsh's murky water and its bright goo.
const vec3 MURK = vec3(0.2, 0.27, 0.15);
const vec3 GOO = vec3(0.56, 0.9, 0.12);
const vec3 GOO_LIGHT = vec3(0.86, 1.0, 0.45);

struct Features {
  vec3 share;     // forest, rocks, marsh (0..1)
  float water;    // the water's share
  float clearing; // how much of a camp's clearing in a forest (0..1)
};

// The features' smooth shares round hex point h (canopy.ts featureShares).
Features featuresNear(vec2 h) {
  Features fe;
  fe.share = vec3(0.0);
  fe.water = 0.0;
  fe.clearing = 0.0;
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
    else if (lf == ${LandFeature.MARSH}) fe.share.z += w;
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

// The canopy's colour: its texture (one lookup, so its crowns stay crisp), patches of lighter
// yellow-green and deeper green across the mass, and the crowns darker towards its edge.
vec3 canopyColour(vec2 uv, vec2 dx, vec2 dy, vec2 h, float e) {
  vec3 c = sampleGround(${Ground.CANOPY}, uv, dx, dy);
  float patchy = valueNoise(h * 0.55 + 3.0);
  c *= mix(vec3(0.8, 0.88, 0.84), vec3(1.07, 1.05, 0.92), smoothstep(0.2, 0.8, patchy));
  float dome = crowns(h * 1.0 + 0.37);
  c *= 0.9 + 0.16 * dome;
  c *= mix(0.68, 1.0, smoothstep(0.0, 0.16, e));
  return c;
}

// The marsh: wet mud (its texture) with murky puddles and bright goo pools; deep is how far inside
// the marsh (0 at its fading edge, 1 well in), so the pools keep off its edge.
vec3 marshColour(vec3 mud, vec2 h, float deep) {
  float n = fbm(h * 1.7 + 77.0);
  float murk = smoothstep(0.52, 0.58, n) * smoothstep(0.2, 0.6, deep);
  vec3 c = mix(mud, MURK, murk * 0.75);
  // Goo: the highest ground of the noise, with a dark muddy rim and a lighter glossy middle.
  float m = n + 0.12 * (deep - 1.0);
  float rim = smoothstep(0.6, 0.63, m);
  float goo = smoothstep(0.635, 0.65, m);
  c = mix(c, c * 0.55, rim * (1.0 - goo));
  vec3 g = mix(GOO, GOO_LIGHT, smoothstep(0.68, 0.74, m) * 0.6 + 0.4 * smoothstep(0.5, 0.9, valueNoise(h * 9.0 + 2.0)) * goo);
  return mix(c, g, goo);
}

// Edge trees, pines, boulders, stones, goo pools, reeds and logs on a jittered grid, each kept only
// where its foot suits it (checked with the same shares as the pixel). near fades the small pieces
// out as cells get small, trees fades the trees; density is the Quality's share (canopy.ts).
vec3 drawFeatures(vec3 colour, vec2 p, vec2 wdx, vec2 wdy, float trees, float near, float density) {
  float grid = FEATURE_GRID * uCellPoints;
  vec2 first = floor(p / grid) - vec2(1.0, 0.0);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 id = first + vec2(float(i), float(j));
      float pick = hash12(id * 0.77 + 5.3);
      if (pick > density) continue;
      vec2 foot = (id + vec2(hash12(id + 21.7), hash12(id + 33.1))) * grid;
      float s = grid * (1.55 + 0.45 * hash12(id + 12.4));
      vec2 local = (p - foot) / s + vec2(0.5, 1.0);
      if (local.x < 0.0 || local.x > 1.0 || local.y < 0.0 || local.y > 1.0) continue;
      vec2 fh = foot / uUnit;
      vec2 off;
      vec4 t = trueCellAt(fh, off);
      if (!isLand(groundOf(t))) continue;
      Features fe = featuresNear(fh);
      if (fe.water > 0.01 || max(fe.share.x, max(fe.share.y, fe.share.z)) < 0.12) continue;
      if (riverAt(foot).y > -0.04) continue;
      bool occupied = occupiedOf(t);
      float roll = hash12(id + 47.9);
      float kind = hash12(id + 63.1);
      int frame = -1;
      float size = 1.0;
      float cut = 1.0;   // the share of the frame shown from the top (pines poke out of the canopy)
      float fade = near;
      if (fe.share.x > 0.05) {
        float e = canopyEdge(fh, fe);
        bool clear = occupied && length(off) < CLEARING_INNER + 0.08;
        if (e > 0.1) {
          if (roll < 0.09) { frame = ${PINE_FRAME} + int(kind * 4.0); cut = 0.7; size = 0.95; fade = trees; }
        } else if (e < -0.005 && e > -0.12 && !clear) {
          if (roll < 0.8) { frame = kind < 0.75 ? ${TREE_FRAME} + int(kind / 0.75 * 4.0) : ${PINE_FRAME} + int((kind - 0.75) * 16.0); fade = trees; }
        } else if (e <= -0.12 && e > -0.34 && !clear) {
          if (roll < 0.22 * (1.0 + e / 0.34)) { frame = kind < 0.6 ? ${TREE_FRAME} + int(kind / 0.6 * 4.0) : ${PINE_FRAME} + int((kind - 0.6) * 10.0); size = 0.85; fade = trees; }
        }
      }
      if (frame < 0 && fe.share.y > 0.2 && !(occupied && length(off) < 0.45)) {
        float rocky = smoothstep(0.25, 0.8, fe.share.y);
        if (roll < 0.28 * rocky) { frame = ${BOULDER_FRAME} + int(kind * 4.0); size = 0.75 + 0.25 * rocky; }
        else if (roll < 0.62 * rocky) { frame = kind < 0.5 ? 6 : 8; size = 0.55; }
      }
      if (frame < 0 && fe.share.z > 0.2 && !(occupied && length(off) < 0.45)) {
        float wet = smoothstep(0.25, 0.75, fe.share.z);
        if (fe.share.z > 0.6 && roll < 0.12) { frame = ${GOO_FRAME} + int(kind * 4.0); }
        else if (roll < 0.5 * wet) { frame = ${REED_FRAME} + int(kind * 3.0); size = 0.7 + 0.3 * hash12(id + 2.2); }
        else if (fe.share.z > 0.7 && roll < 0.53) { frame = ${LOG_FRAME}; }
        else if (roll < 0.58 * wet) { frame = ${BOULDER_FRAME} + int(kind * 4.0); size = 0.6; }
      }
      if (frame < 0 || fade <= 0.0) continue;
      // A smaller piece keeps its foot where it was; it shrinks inside the same frame.
      vec2 at = vec2(0.5 + (local.x - 0.5) / size, 1.0 - (1.0 - local.y) / size);
      if (at.x < 0.0 || at.x > 1.0 || at.y < 0.0 || at.y > 1.0) continue;
      vec4 sprite = spriteSample(frame, p, foot, s * size, hash12(id + 9.9) < 0.5, wdx, wdy) * fade;
      if (cut < 1.0) sprite *= 1.0 - smoothstep(cut - 0.1, cut + 0.04, at.y);
      if (frame == 6 || frame == 8) sprite.rgb = darken(sprite, STONE_GAMMA);
      colour = colour * (1.0 - sprite.a) + sprite.rgb;
    }
  }
  return colour;
}
`;
