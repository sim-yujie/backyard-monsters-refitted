/**
 * The painted look's code in one piece, which `MapRenderer` fetches with `import()` the first time a
 * map opens with the painted look on (MR2 plan step 10): Classic players, and players without the
 * painted look, never download its shaders or layers. The art itself is fetched later still, by each
 * layer's `load`, at the player's Quality.
 */
import { borderProgram } from "./BorderLayer";
import { cloudProgram } from "./CloudLayer";
import { groundProgram, PaintedGround } from "./PaintedGround";
import { ProgramWarmer } from "./shaderWarmup";
import { quality } from "@/game/quality";

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
 * Compiles the look's first programs in the map's WebGL2 context without freezing the page
 * (`shaderWarmup.ts`), so the layers built after it draw at once: the ground's Low program (a few
 * seconds the first time on Windows), the borders and the fog, with the sprite placement programs
 * (under a second each) alongside. The player's own Quality's ground program starts after them (it
 * would slow the Low one down) and takes over when it is ready (`PaintedGround.prepare`).
 */
export const preparePrograms = async (gl: WebGL2RenderingContext): Promise<PaintedPrograms> => {
  const warmer = new ProgramWarmer(gl);
  const [ground, borders, clouds] = await warmer.warmAll([
    groundProgram("low"),
    borderProgram(),
    cloudProgram(),
    ...PaintedGround.placementPrograms(),
  ]);
  void warmer.warm(groundProgram(quality()));
  return { ground: Boolean(ground && borders), clouds: Boolean(clouds), warmer };
};
