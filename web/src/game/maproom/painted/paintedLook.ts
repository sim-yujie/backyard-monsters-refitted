/**
 * The painted look's code in one piece, which `MapRenderer` fetches with `import()` the first time a
 * map opens with the painted look on (MR2 plan step 10): Classic players, and players without the
 * painted look, never download its shaders or layers. The art itself is fetched later still, by each
 * layer's `load`, at the player's Quality.
 */
import { borderProgram } from "./BorderLayer";
import { cloudProgram } from "./CloudLayer";
import { groundProgram } from "./PaintedGround";
import { warmPrograms } from "./shaderWarmup";

export { BorderLayer } from "./BorderLayer";
export { CloudLayer, FOG_UNDER_CLOUD } from "./CloudLayer";
export { PaintedGround } from "./PaintedGround";

/** Which of the painted look's programs this browser compiled and linked. */
export interface PaintedPrograms {
  /** The ground (with its rivers, canopy, hills and sprites) and the borders: the look needs both. */
  readonly ground: boolean;
  /** The painted fog; without it fog cells stay the ground's flat fog colour. */
  readonly clouds: boolean;
}

/**
 * Compiles the look's programs in the map's WebGL2 context without freezing the page
 * (`shaderWarmup.ts`), so the layers built after it draw at once.
 */
export const preparePrograms = async (gl: WebGL2RenderingContext): Promise<PaintedPrograms> => {
  const [ground, borders, clouds] = await warmPrograms(gl, [groundProgram(), borderProgram(), cloudProgram()]);
  return { ground: Boolean(ground && borders), clouds: Boolean(clouds) };
};
