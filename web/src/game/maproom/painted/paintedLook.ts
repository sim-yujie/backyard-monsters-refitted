/**
 * The painted look's code in one piece, which `MapRenderer` fetches with `import()` the first time a
 * map opens with the painted look on (MR2 plan step 10): Classic players, and players without the
 * painted look, never download its shaders or layers. The art itself is fetched later still, by each
 * layer's `load`, at the player's Quality.
 */
import { Assets, type Renderer } from "pixi.js";
import { borderProgram } from "./BorderLayer";
import { CloudLayer as Clouds, cloudProgram } from "./CloudLayer";
import { groundProgram, PaintedGround } from "./PaintedGround";
import { pixiProgramHost, rememberAnisotropy } from "./pixiPrograms";
import { ProgramWarmer } from "./shaderWarmup";
import { quality, type Quality } from "@/game/quality";

export { BorderLayer } from "./BorderLayer";
export { CloudLayer, FOG_UNDER_CLOUD } from "./CloudLayer";
export { PaintedGround } from "./PaintedGround";

/** Which of the painted look's programs this browser compiled and linked. */
export interface PaintedPrograms {
  /** The ground (its Low program, with its rivers, canopy and hills) and the borders: the look needs both. */
  readonly ground: boolean;
  /** The painted fog; without it fog cells stay the ground's flat fog colour. */
  readonly clouds: boolean;
  /** Compiles the rest in the background: the player's own Quality and the sprite placements. */
  readonly warmer: ProgramWarmer | null;
}

/**
 * One warmer per renderer, kept while the game runs: the programs it compiled stay in Pixi, so a map
 * opened again finds them ready and compiles nothing (Firefox compiled them all again on every open).
 */
const WARMERS = new WeakMap<Renderer, ProgramWarmer>();

const warmerFor = (renderer: Renderer, gl: WebGL2RenderingContext): ProgramWarmer => {
  let warmer = WARMERS.get(renderer);
  if (!warmer) {
    // Without background compile (Firefox), Pixi's texture setup must not wait for a compile.
    if (!gl.getExtension("KHR_parallel_shader_compile")) rememberAnisotropy(gl);
    warmer = new ProgramWarmer(gl, undefined, pixiProgramHost(renderer, gl));
    WARMERS.set(renderer, warmer);
  }
  return warmer;
};

/**
 * Compiles the look's first programs in the map's WebGL2 context without freezing the page
 * (`shaderWarmup.ts`), so the layers built after it draw at once: the ground's Low program (a few
 * seconds the first time on Windows), the borders and the fog. A program compiled on an earlier
 * visit is ready at once, so the player's own Quality shows straight away then. The rest follows
 * with {@link warmRest} once the look is built.
 */
export const preparePrograms = async (renderer: Renderer, gl: WebGL2RenderingContext): Promise<PaintedPrograms> => {
  const warmer = warmerFor(renderer, gl);
  const own = groundProgram(quality());
  // Already compiled, or (where programs compile one at a time) still compiling from the yard's
  // warm-up (`warmAhead`): there a fresh Low compile would only queue behind it. Where they compile
  // side by side, the Low one may well finish first, so it goes as before.
  const first = warmer.ready(own) || (warmer.serial && warmer.compiling(own)) ? own : groundProgram("low");
  const [ground, borders, clouds] = await warmer.warmAll([first, borderProgram(), cloudProgram()]);
  return { ground: Boolean(ground && borders), clouds: Boolean(clouds), warmer };
};

/**
 * Compiles the rest once the look is built: the sprite placement programs (quick, and the Low look's
 * trees and rocks need them), then the player's own Quality's ground program, which takes over when
 * it is ready (`PaintedGround.prepare`). Where programs compile one at a time (Firefox), they wait
 * for `loaded` (the look's art) first: while one compiles there, setting up a texture waits for it,
 * and the High ground takes ~10 s.
 */
export const warmRest = (warmer: ProgramWarmer, loaded: Promise<unknown>): void => {
  warmer.hold(loaded);
  void warmer.warmAll([...PaintedGround.placementPrograms(), groundProgram(quality())]);
};

/* ── Ahead of the map (MR2 open speed, 7 Nov 2026) ─────────────────────── */

/**
 * Compiles, while the player is idle in their yard, the programs the map will want at this Quality,
 * in the same WebGL context and into the same renderer the map uses, so its first open finds them
 * ready (the owner's first open spent 7.8 s compiling the High ground and 2.9 s the Low one): the
 * borders, the fog and the sprite placements (quick), then the ground. `mr2Prewarm.ts` decides when.
 */
export const warmAhead = (renderer: Renderer, gl: WebGL2RenderingContext, level: Quality): Promise<boolean[]> => {
  const warmer = warmerFor(renderer, gl);
  return warmer.warmAll([borderProgram(), cloudProgram(), ...PaintedGround.placementPrograms(), groundProgram(level)]);
};

/** Every picture the painted look fetches at this Quality: the ground's, and the clouds' on High. */
export const paintedArtUrls = (level: Quality): string[] => [
  ...PaintedGround.artUrls(level),
  ...(level === "high" ? [Clouds.artUrl(level)] : []),
];

/**
 * Fetches the look's pictures one after another into `Assets`' cache, where the map's layers find
 * them (they keep them there after the first open anyway). One at a time, and only while `go`
 * says so, so a yard that becomes busy again gets its line back. Resolves to how many arrived.
 */
export const prefetchArt = async (level: Quality, go: () => boolean = () => true): Promise<number> => {
  let arrived = 0;
  for (const url of paintedArtUrls(level)) {
    if (!go()) break;
    try {
      await Assets.load(url);
      arrived += 1;
    } catch {
      // The map tries again when it opens.
    }
  }
  return arrived;
};
