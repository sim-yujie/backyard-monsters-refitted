/**
 * Hands the painted look's programs, compiled in the background (`shaderWarmup.ts`), to Pixi, so it
 * draws with them instead of compiling the same text again when it first draws.
 *
 * Pixi keeps each linked program in its shader system, by the program's key; when it draws a
 * program it has not seen, it compiles it (`generateProgram`) and waits for the result. This does
 * what `generateProgram` does after the link (the program's attributes, uniforms and uniform
 * blocks, read with Pixi's own helpers) and files the result where Pixi looks for it. Firefox has no
 * shader cache, so before this every program was compiled twice there, the second time with the
 * page frozen (the owner's 15-30 s Map Room open, 4 Nov 2026).
 */
import {
  defaultValue,
  extractAttributesFromGlProgram,
  getUboData,
  getUniformData,
  GlProgram,
  GlProgramData,
  type Renderer,
} from "pixi.js";
import type { ProgramHost, ProgramSource } from "./shaderWarmup";

/** Pixi's own table of linked programs (GlShaderSystem's, by `GlProgram._key`). */
type ProgramTable = Record<string, GlProgramData | undefined>;

/** The renderer's table, or null where it is not a WebGL renderer laid out as Pixi 8.x's is. */
const tableOf = (renderer: Renderer): ProgramTable | null => {
  const table = (renderer as { shader?: { _programDataHash?: unknown } }).shader?._programDataHash;
  return table !== null && typeof table === "object" ? (table as ProgramTable) : null;
};

/** As Pixi's `generateProgram`: a WebGL1-style vertex shader has its attributes sorted. */
const VERSION_300 = /^[ \t]*#[ \t]*version[ \t]+300[ \t]+es[ \t]*$/m;

/** Fills in what Pixi's `generateProgram` works out after the link, and returns Pixi's record of it. */
export const programData = (gl: WebGL2RenderingContext, program: GlProgram, linked: WebGLProgram): GlProgramData => {
  program._attributeData = extractAttributesFromGlProgram(linked, gl, !VERSION_300.test(program.vertex ?? ""));
  program._uniformData = getUniformData(linked, gl);
  program._uniformBlockData = getUboData(linked, gl);
  const uniforms: Record<string, { location: WebGLUniformLocation; value: unknown }> = {};
  for (const name in program._uniformData) {
    const data = program._uniformData[name]!;
    uniforms[name] = { location: gl.getUniformLocation(linked, name)!, value: defaultValue(data.type, data.size) };
  }
  return new GlProgramData(linked, uniforms as never);
};

/** The host for Pixi's WebGL renderer: what it already has is ready, and it takes what was compiled. */
export const pixiProgramHost = (renderer: Renderer, gl: WebGL2RenderingContext): ProgramHost => ({
  has(source: ProgramSource): boolean {
    const table = tableOf(renderer);
    return source instanceof GlProgram && table !== null && table[source._key] !== undefined;
  },
  adopt(source: ProgramSource, linked: WebGLProgram): boolean {
    const table = tableOf(renderer);
    // Pixi compiled it itself meanwhile, or the context was replaced: Pixi's own stays.
    if (!(source instanceof GlProgram) || table === null || table[source._key] !== undefined) return false;
    if ((renderer as { gl?: unknown }).gl !== gl) return false;
    table[source._key] = programData(gl, source, linked);
    return true;
  },
});

/** WebGL's MAX_TEXTURE_MAX_ANISOTROPY_EXT (EXT_texture_filter_anisotropic). */
const MAX_ANISOTROPY = 0x84ff;

/**
 * Makes `gl` answer the largest anisotropy from memory after the first time. Pixi asks for it each
 * time it sets up a texture, and where programs compile one at a time in another process (Firefox),
 * asking waits for the compile under way: up to ~10 s for the High ground. The answer never changes
 * for a context. Only this one question is remembered; every other call goes to WebGL as before.
 */
export const rememberAnisotropy = (gl: WebGL2RenderingContext): void => {
  const marked = gl as WebGL2RenderingContext & { __mr2Anisotropy?: boolean };
  if (marked.__mr2Anisotropy) return;
  marked.__mr2Anisotropy = true;
  const ask = gl.getParameter.bind(gl);
  let known: unknown;
  gl.getParameter = ((name: GLenum): unknown => {
    if (name !== MAX_ANISOTROPY) return ask(name);
    if (known === undefined || known === null) known = ask(name);
    return known;
  }) as typeof gl.getParameter;
};
