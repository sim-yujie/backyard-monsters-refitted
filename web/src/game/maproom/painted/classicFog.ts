import type { Renderer } from "pixi.js";
import { cloudProgram } from "./CloudLayer";
import { pixiProgramHost, rememberAnisotropy } from "./pixiPrograms";
import { ProgramWarmer } from "./shaderWarmup";

/**
 * The painted fog on its own, for Classic on Quality High (owner, 5 Nov 2026: the clouds cover the
 * undiscovered map). Fetched on first use by `MapRenderer`, so Classic never downloads the painted
 * ground's much larger shaders. It compiles in the background like the painted look's programs.
 */
export { CloudLayer } from "./CloudLayer";
export { GroundData } from "./GroundData";

/** Compiles the fog's program without freezing the page; resolves whether it is usable here. */
export const prepareFog = async (renderer: Renderer, gl: WebGL2RenderingContext): Promise<boolean> => {
  // Without background compile (Firefox), Pixi's texture setup must not wait for a compile.
  if (!gl.getExtension("KHR_parallel_shader_compile")) rememberAnisotropy(gl);
  const warmer = new ProgramWarmer(gl, undefined, pixiProgramHost(renderer, gl));
  const [clouds] = await warmer.warmAll([cloudProgram()]);
  return Boolean(clouds);
};
