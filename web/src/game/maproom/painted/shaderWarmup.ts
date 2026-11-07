import { noteShader } from "../openMarks";

/**
 * Compiles the painted map's shaders without freezing the page (MR2 plan step 10; the owner's
 * "Map Room crashed" report, 4 Nov 2026; Firefox taking 15-30 s every open, 4 Nov 2026).
 *
 * The ground shader is big: on Windows the browser turns it into Direct3D code, which takes seconds
 * (Low ~4 s, High 12-23 s on an RTX 3070 the first time). Pixi compiles a program the first time it
 * draws it and waits for the result, so the whole page stood still that long.
 *
 * Here each program is compiled and linked in the map's own WebGL context without asking whether it
 * is done (that question is what waits): Chrome answers it in the background through
 * `KHR_parallel_shader_compile`; Firefox has no such extension, but compiles in its GPU process
 * anyway, so a fence placed after the link tells when it is done (measured: page never stalled more
 * than 16 ms while High compiled for 16 s). Meanwhile the map shows today's tiles.
 *
 * The linked program is then handed to the renderer ({@link ProgramHost}), which uses it as is.
 * Before, it was deleted and Pixi compiled the same text again: Chrome found it in its shader cache,
 * but Firefox has none and compiled it all again, with the page frozen. A browser that compiles
 * only when asked (neither of the above) still stalls once, after the tiles had a chance to draw.
 */

/** A program's two sources, exactly as Pixi will compile them (`GlProgram.vertex` / `.fragment`). */
export interface ProgramSource {
  readonly vertex?: string;
  readonly fragment?: string;
}

/** Where linked programs go, so the renderer never compiles the same text a second time. */
export interface ProgramHost {
  /** Whether the renderer already has this program (linked earlier, maybe on an earlier map visit). */
  has(source: ProgramSource): boolean;
  /** Takes a linked program for this source; false if it cannot (the program is then deleted). */
  adopt(source: ProgramSource, program: WebGLProgram): boolean;
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

/** The parallel-compile extension's one constant. */
interface ParallelCompile {
  readonly COMPLETION_STATUS_KHR: number;
}

const parallelOf = (gl: WebGL2RenderingContext): ParallelCompile | null =>
  gl.getExtension("KHR_parallel_shader_compile") as ParallelCompile | null;

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
  // Linking without waiting: nothing blocks until the status is read.
  gl.linkProgram(program);
  return { program, shaders };
};

/**
 * Reads whether the program linked and frees its shaders. The program itself goes to `keep`
 * when it linked and `keep` takes it; otherwise it is deleted.
 */
const finish = (gl: WebGL2RenderingContext, started: Started | null, keep: (program: WebGLProgram) => boolean): boolean => {
  if (!started) return false;
  const linked = !gl.isContextLost() && Boolean(gl.getProgramParameter(started.program, gl.LINK_STATUS));
  for (const shader of started.shaders) {
    gl.detachShader(started.program, shader);
    gl.deleteShader(shader);
  }
  if (!linked || !keep(started.program)) gl.deleteProgram(started.program);
  return linked;
};

/**
 * Waits, without blocking, until everything sent to the context so far is done: a fence after the
 * links. Where the browser compiles in another process (Firefox), this is when the compile ends;
 * elsewhere it may come at once, and the status read after it takes the stall. False when fences
 * are missing here.
 */
const fenceWait = async (gl: WebGL2RenderingContext, wait: Wait): Promise<boolean> => {
  const fence = typeof gl.fenceSync === "function" ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
  if (!fence) return false;
  gl.flush();
  do await wait();
  while (!gl.isContextLost() && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED);
  if (!gl.isContextLost()) gl.deleteSync(fence);
  return true;
};

/**
 * Compiles and links each program in `gl` and resolves, once all are done, to whether each one
 * linked. Never touches the context's bound state, so Pixi's state tracking stays right. `keep`
 * may take each linked program (by its index); the rest are deleted.
 */
export const warmPrograms = async (
  gl: WebGL2RenderingContext,
  programs: readonly ProgramSource[],
  wait: Wait = pause,
  keep: (index: number, program: WebGLProgram) => boolean = () => false,
): Promise<boolean[]> => {
  const parallel = parallelOf(gl);
  const started = programs.map((source) => start(gl, source));
  if (parallel) {
    const done = (entry: Started | null): boolean =>
      entry === null || gl.isContextLost() || Boolean(gl.getProgramParameter(entry.program, parallel.COMPLETION_STATUS_KHR));
    while (!started.every(done)) await wait();
  } else if (!(await fenceWait(gl, wait))) {
    // Neither: let the tiles draw first, then take the stall once.
    await wait();
  }
  return started.map((entry, index) => finish(gl, entry, (program) => keep(index, program)));
};

/**
 * Remembers which programs have been compiled in one WebGL context, and compiles more in the
 * background on request (plan step 10): the ground's Low program first, the player's own Quality's
 * and the sprite placement programs after it, and another Quality's when the player changes it.
 * Each program is compiled once; asking again returns the same answer. With a {@link ProgramHost}
 * the linked programs go to the renderer, and a program it already has is ready at once (so a map
 * opened again compiles nothing).
 *
 * Where the browser has no background-compile extension, programs are compiled one after another:
 * reading a finished program's details (which the host does) waits for every compile sent before it.
 */
export class ProgramWarmer {
  private readonly linked = new Map<string, boolean>();
  private readonly pending = new Map<string, Promise<boolean>>();
  /** The last compile in line, where they run one at a time. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly parallel: boolean;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly wait: Wait = pause,
    private readonly host: ProgramHost | null = null,
  ) {
    this.parallel = parallelOf(gl) !== null;
  }

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
    if (this.host) return this.host.has(source);
    return this.linked.get(this.key(source)) === true;
  }

  /** Compiles the program in the background (once) and resolves to whether it linked. */
  warm(source: ProgramSource): Promise<boolean> {
    if (this.host?.has(source)) return Promise.resolve(true);
    const key = this.key(source);
    const known = this.linked.get(key);
    // A program the host lost (its context was lost and restored) is compiled again.
    if (known === false || (known === true && !this.host)) return Promise.resolve(known);
    let pending = this.pending.get(key);
    if (!pending) {
      const requested = performance.now();
      const compile = (): Promise<boolean> => {
        if (this.host?.has(source)) return Promise.resolve(true);
        // Timed for the map's open (`openMarks.ts`): from when it was asked for, and when it really began.
        const started = performance.now();
        return warmPrograms(this.gl, [source], this.wait, (_index, program) => this.host?.adopt(source, program) ?? false).then(
          ([ok]) => {
            noteShader(source, requested, started, performance.now(), Boolean(ok));
            return Boolean(ok);
          },
        );
      };
      const run = this.parallel ? compile() : (this.queue = this.queue.then(compile, compile));
      pending = (run as Promise<boolean>).then((ok) => {
        this.linked.set(key, ok);
        this.pending.delete(key);
        return ok;
      });
      this.pending.set(key, pending);
    }
    return pending;
  }

  /**
   * Where programs compile one at a time (Firefox): compiles asked for from now on wait until
   * `until` settles. While a program compiles there, any call that needs an answer from the context
   * (Pixi asks one when it sets up a new texture) waits for that compile too, so the look's textures
   * are best set up first. Where the browser compiles in the background, nothing waits.
   */
  hold(until: Promise<unknown>): void {
    if (this.parallel) return;
    const settled = until.then(
      () => undefined,
      () => undefined,
    );
    this.queue = this.queue.then(
      () => settled,
      () => settled,
    );
  }

  /** Compiles several (at once where the browser can, else in this order) and resolves to each one's answer. */
  warmAll(sources: readonly ProgramSource[]): Promise<boolean[]> {
    return Promise.all(sources.map((source) => this.warm(source)));
  }
}
