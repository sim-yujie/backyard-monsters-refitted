/**
 * Compiles the painted map's shaders without freezing the page (MR2 plan step 10; the owner's
 * "Map Room crashed" report, 4 Nov 2026).
 *
 * The ground shader is big: on Windows Chrome turns it into Direct3D code, and that took 41 s on an
 * RTX 3070 the first time (12 s with Quality fixed at Low). Pixi compiles a program the first time
 * it draws it and waits for the result, so the whole page stood still that long, twice (once for the
 * old "does it compile" check, once for Pixi), and Chrome offered to kill the page.
 *
 * Here each program is compiled and linked in the map's own WebGL context with
 * `KHR_parallel_shader_compile`, which lets the browser do it in the background while the page is
 * polled every {@link POLL_MS}; the map shows today's tiles meanwhile. The browser keeps the linked
 * result (ANGLE's program cache, and Chrome's shader cache on disk), so Pixi's own compile of the
 * same source a moment later is quick, and the next visit is quick too.
 * Without the extension the compile still stalls, once, after the tiles had a chance to draw.
 */

/** A program's two sources, exactly as Pixi will compile them (`GlProgram.vertex` / `.fragment`). */
export interface ProgramSource {
  readonly vertex?: string;
  readonly fragment?: string;
}

/** How often the compile is asked whether it is done. */
export const POLL_MS = 100;

/** Waits a little before asking again; replaceable for the tests. */
export type Wait = () => Promise<void>;

const pause: Wait = () => new Promise((resolve) => setTimeout(resolve, POLL_MS));

interface Started {
  readonly program: WebGLProgram;
  readonly shaders: readonly WebGLShader[];
}

const start = (gl: WebGL2RenderingContext, source: ProgramSource): Started | null => {
  const program = gl.createProgram();
  if (!program) return null;
  const shaders: WebGLShader[] = [];
  for (const [type, text] of [
    [gl.VERTEX_SHADER, source.vertex ?? ""],
    [gl.FRAGMENT_SHADER, source.fragment ?? ""],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) continue;
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    shaders.push(shader);
  }
  // Linking without waiting: with the extension, nothing blocks until the status is read.
  gl.linkProgram(program);
  return { program, shaders };
};

const finish = (gl: WebGL2RenderingContext, started: Started | null): boolean => {
  if (!started) return false;
  const linked = !gl.isContextLost() && Boolean(gl.getProgramParameter(started.program, gl.LINK_STATUS));
  for (const shader of started.shaders) {
    gl.detachShader(started.program, shader);
    gl.deleteShader(shader);
  }
  gl.deleteProgram(started.program);
  return linked;
};

/**
 * Compiles and links each program in `gl` and resolves, once all are done, to whether each one
 * linked. Never touches the context's bound state, so Pixi's state tracking stays right.
 */
export const warmPrograms = async (
  gl: WebGL2RenderingContext,
  programs: readonly ProgramSource[],
  wait: Wait = pause,
): Promise<boolean[]> => {
  const parallel = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  const started = programs.map((source) => start(gl, source));
  if (parallel) {
    const done = (entry: Started | null): boolean =>
      entry === null || gl.isContextLost() || Boolean(gl.getProgramParameter(entry.program, parallel.COMPLETION_STATUS_KHR));
    while (!started.every(done)) await wait();
  } else {
    // No background compile here: let the tiles draw first, then take the stall once.
    await wait();
  }
  return started.map((entry) => finish(gl, entry));
};

/**
 * Remembers which programs have been compiled in one WebGL context, and compiles more in the
 * background on request (plan step 10): the ground's Low program first, the player's own Quality's
 * and the sprite placement programs after it, and another Quality's when the player changes it.
 * Each program is compiled once; asking again returns the same answer.
 */
export class ProgramWarmer {
  private readonly linked = new Map<string, boolean>();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly wait: Wait = pause,
  ) {}

  /** Each source object's key, so asking every frame does not rebuild and rehash ~100 kB of text. */
  private readonly keys = new WeakMap<ProgramSource, string>();

  private key(source: ProgramSource): string {
    let key = this.keys.get(source);
    if (key === undefined) {
      key = `${source.vertex ?? ""}\u0000${source.fragment ?? ""}`;
      this.keys.set(source, key);
    }
    return key;
  }

  /** Whether the program has compiled and linked here (false while it compiles, or if it failed). */
  ready(source: ProgramSource): boolean {
    return this.linked.get(this.key(source)) === true;
  }

  /** Compiles the program in the background (once) and resolves to whether it linked. */
  warm(source: ProgramSource): Promise<boolean> {
    const key = this.key(source);
    const known = this.linked.get(key);
    if (known !== undefined) return Promise.resolve(known);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = warmPrograms(this.gl, [source], this.wait).then(([ok]) => {
        this.linked.set(key, Boolean(ok));
        this.pending.delete(key);
        return Boolean(ok);
      });
      this.pending.set(key, pending);
    }
    return pending;
  }

  /** Compiles several at once (in parallel where the browser can) and resolves to each one's answer. */
  warmAll(sources: readonly ProgramSource[]): Promise<boolean[]> {
    return Promise.all(sources.map((source) => this.warm(source)));
  }
}
