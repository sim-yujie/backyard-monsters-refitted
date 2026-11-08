/**
 * Graphics switched off: the player's browser will not give the page WebGL
 * (hardware acceleration off, WebGL blocked by a setting, a work or school
 * policy, or a privacy add-on). The game cannot draw without it, so `App`
 * stops with a {@link GraphicsOffError} and `main.ts` shows a plain-HTML
 * message (`ui/GraphicsOffNotice.ts`) instead of a broken screen.
 */

/** The renderer could not start because the browser has graphics off. */
export class GraphicsOffError extends Error {
  override readonly name = "GraphicsOffError";
}

/**
 * Why this browser gives the page no WebGL, or null when it does.
 * Some browsers return no context, others throw ("WebGL is disabled due to
 * your security policy"); the browser's own words are kept as evidence. The
 * test context is let go at once so it does not hold one of the browser's few
 * WebGL slots.
 */
export const webglBlockedReason = (
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): string | null => {
  try {
    const canvas = makeCanvas();
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
      (canvas.getContext("webgl") as WebGLRenderingContext | null);
    if (!gl) return "no WebGL context";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/**
 * What a failed renderer start means: a {@link GraphicsOffError} when the
 * browser has WebGL off, otherwise the original error (a real fault, shown as
 * before). The message names both the browser's reason and Pixi's words.
 */
export const graphicsStartError = (error: unknown, blockedReason: () => string | null = webglBlockedReason): unknown => {
  const reason = blockedReason();
  if (reason === null) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new GraphicsOffError(`Graphics off: ${reason} (${detail})`);
};
