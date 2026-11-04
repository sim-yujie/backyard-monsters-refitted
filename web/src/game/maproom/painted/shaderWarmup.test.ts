import { describe, expect, it, vi } from "vitest";
import { ProgramWarmer, warmPrograms } from "./shaderWarmup";

const COMPLETION_STATUS_KHR = 0x91b1;
const LINK_STATUS = 4;

/**
 * A stand-in WebGL2 context: each program finishes compiling after `polls` status checks (with the
 * parallel-compile extension), and links when `links` says so.
 */
const fakeGl = ({ parallel = true, polls = 3, links = [true], lost = false } = {}) => {
  let made = 0;
  const asked = new Map<object, number>();
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    LINK_STATUS,
    createShader: vi.fn(() => ({})),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    createProgram: vi.fn(() => ({ index: made++ })),
    attachShader: vi.fn(),
    detachShader: vi.fn(),
    linkProgram: vi.fn(),
    isContextLost: vi.fn(() => lost),
    getProgramParameter: vi.fn((program: { index: number }, name: number) => {
      if (name === COMPLETION_STATUS_KHR) {
        const count = (asked.get(program) ?? 0) + 1;
        asked.set(program, count);
        return count >= polls;
      }
      if (name === LINK_STATUS) return links[program.index] ?? true;
      return null;
    }),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    useProgram: vi.fn(),
    getExtension: vi.fn((name: string) =>
      parallel && name === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR } : null,
    ),
  };
  return gl;
};

const source = { vertex: "v", fragment: "f" };

describe("compiling the painted map's shaders ahead (the Map Room freeze)", () => {
  it("waits for the background compile without ever asking the blocking link status early", async () => {
    const gl = fakeGl({ polls: 4 });
    const wait = vi.fn(async () => {
      // While waiting, nothing may have asked for LINK_STATUS: that is the call that freezes the page.
      expect(gl.getProgramParameter.mock.calls.some(([, name]) => name === LINK_STATUS)).toBe(false);
    });
    const result = await warmPrograms(gl as unknown as WebGL2RenderingContext, [source], wait);
    expect(result).toEqual([true]);
    expect(wait).toHaveBeenCalledTimes(3);
    expect(gl.compileShader).toHaveBeenCalledTimes(2);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("says which programs failed to link, and frees everything it made", async () => {
    const gl = fakeGl({ links: [true, false, true], polls: 1 });
    const result = await warmPrograms(gl as unknown as WebGL2RenderingContext, [source, source, source], vi.fn(async () => {}));
    expect(result).toEqual([true, false, true]);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(3);
    expect(gl.deleteShader).toHaveBeenCalledTimes(6);
  });

  it("never changes the context's bound program, so Pixi's state tracking stays right", async () => {
    const gl = fakeGl({ polls: 2 });
    await warmPrograms(gl as unknown as WebGL2RenderingContext, [source], vi.fn(async () => {}));
    expect(gl.useProgram).not.toHaveBeenCalled();
  });

  it("without the extension waits one step (the tiles draw first), then checks", async () => {
    const gl = fakeGl({ parallel: false });
    const wait = vi.fn(async () => {});
    expect(await warmPrograms(gl as unknown as WebGL2RenderingContext, [source], wait)).toEqual([true]);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("stops waiting when the context is lost, and reports failure", async () => {
    const gl = fakeGl({ polls: 1000, lost: true });
    const wait = vi.fn(async () => {});
    expect(await warmPrograms(gl as unknown as WebGL2RenderingContext, [source], wait)).toEqual([false]);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe("ProgramWarmer: the painted look's programs, each compiled once in the background", () => {
  it("is not ready until the compile has finished and linked", async () => {
    const gl = fakeGl({ polls: 3 });
    const warmer = new ProgramWarmer(gl as unknown as WebGL2RenderingContext, vi.fn(async () => {}));
    expect(warmer.ready(source)).toBe(false);
    const linked = warmer.warm(source);
    expect(warmer.ready(source)).toBe(false);
    expect(await linked).toBe(true);
    expect(warmer.ready(source)).toBe(true);
  });

  it("compiles the same text once, however often (and from whichever object) it is asked", async () => {
    const gl = fakeGl({ polls: 2 });
    const warmer = new ProgramWarmer(gl as unknown as WebGL2RenderingContext, vi.fn(async () => {}));
    const [a, b] = await Promise.all([warmer.warm(source), warmer.warm({ ...source })]);
    expect([a, b]).toEqual([true, true]);
    expect(await warmer.warm(source)).toBe(true);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
    expect(warmer.ready({ vertex: "v", fragment: "f" })).toBe(true);
    expect(warmer.ready({ vertex: "v", fragment: "other" })).toBe(false);
  });

  it("remembers a failed link: never ready, and never compiled again", async () => {
    const gl = fakeGl({ polls: 1, links: [false] });
    const warmer = new ProgramWarmer(gl as unknown as WebGL2RenderingContext, vi.fn(async () => {}));
    expect(await warmer.warm(source)).toBe(false);
    expect(await warmer.warm(source)).toBe(false);
    expect(warmer.ready(source)).toBe(false);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("warms several together and answers for each", async () => {
    const gl = fakeGl({ polls: 1, links: [true, false] });
    const warmer = new ProgramWarmer(gl as unknown as WebGL2RenderingContext, vi.fn(async () => {}));
    expect(await warmer.warmAll([source, { vertex: "v", fragment: "g" }])).toEqual([true, false]);
  });
});
