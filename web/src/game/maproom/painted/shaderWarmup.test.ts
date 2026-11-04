import { describe, expect, it, vi } from "vitest";
import { ProgramWarmer, warmPrograms } from "./shaderWarmup";

const COMPLETION_STATUS_KHR = 0x91b1;
const LINK_STATUS = 4;

/**
 * A stand-in WebGL2 context: each program finishes compiling after `polls` status checks (with the
 * parallel-compile extension), and links when `links` says so.
 */
const fakeGl = ({ parallel = true, polls = 3, links = [true], lost = false, fences = false } = {}) => {
  let made = 0;
  const asked = new Map<object, number>();
  /** Fences: each is signalled after `polls` status checks (Firefox: the GPU process finished the compile). */
  const fenceAsked = new Map<object, number>();
  const fenceGl = {
    SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
    SYNC_STATUS: 0x9114,
    SIGNALED: 0x9119,
    fenceSync: vi.fn(() => ({ fence: true })),
    flush: vi.fn(),
    getSyncParameter: vi.fn((fence: object) => {
      const count = (fenceAsked.get(fence) ?? 0) + 1;
      fenceAsked.set(fence, count);
      return count >= polls ? 0x9119 : 0x9118;
    }),
    deleteSync: vi.fn(),
  };
  const gl = {
    ...(fences ? fenceGl : {}),
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

  it("without the extension (Firefox) waits for a fence after the links, never asking the link status early", async () => {
    const gl = fakeGl({ parallel: false, fences: true, polls: 4 });
    const wait = vi.fn(async () => {
      expect(gl.getProgramParameter.mock.calls.some(([, name]) => name === LINK_STATUS)).toBe(false);
    });
    expect(await warmPrograms(gl as unknown as WebGL2RenderingContext, [source, source], wait)).toEqual([true, true]);
    expect(wait).toHaveBeenCalledTimes(4);
    expect(gl.fenceSync).toHaveBeenCalledTimes(1);
    expect(gl.flush).toHaveBeenCalled();
    expect(gl.deleteSync).toHaveBeenCalledTimes(1);
  });

  it("hands each linked program to keep, and deletes only the ones it did not take", async () => {
    const gl = fakeGl({ polls: 1, links: [true, true, false] });
    const kept: number[] = [];
    const keep = (index: number): boolean => {
      kept.push(index);
      return index === 0;
    };
    const result = await warmPrograms(gl as unknown as WebGL2RenderingContext, [source, source, source], vi.fn(async () => {}), keep);
    expect(result).toEqual([true, true, false]);
    // A failed link is never offered.
    expect(kept).toEqual([0, 1]);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteShader).toHaveBeenCalledTimes(6);
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

  it("hands linked programs to the host, and takes what the host already has as ready without compiling", async () => {
    const gl = fakeGl({ polls: 1 });
    const held = new Set<string>();
    const host = {
      has: (s: { fragment?: string }) => held.has(s.fragment ?? ""),
      adopt: vi.fn((s: { fragment?: string }) => {
        held.add(s.fragment ?? "");
        return true;
      }),
    };
    const warmer = new ProgramWarmer(gl as unknown as WebGL2RenderingContext, vi.fn(async () => {}), host);
    expect(await warmer.warm(source)).toBe(true);
    expect(host.adopt).toHaveBeenCalledTimes(1);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(warmer.ready(source)).toBe(true);
    const other = { vertex: "v", fragment: "already" };
    held.add("already");
    expect(warmer.ready(other)).toBe(true);
    expect(await warmer.warm(other)).toBe(true);
    expect(gl.linkProgram).toHaveBeenCalledTimes(1);
  });

  it("compiles again what the host lost (its context was lost and restored)", async () => {
    const gl = fakeGl({ polls: 1 });
    const held = new Set<string>();
    const host = {
      has: (s: { fragment?: string }) => held.has(s.fragment ?? ""),
      adopt: (s: { fragment?: string }) => (held.add(s.fragment ?? ""), true),
    };
    const warmer = new ProgramWarmer(gl as unknown as WebGL2RenderingContext, vi.fn(async () => {}), host);
    await warmer.warm(source);
    held.clear();
    expect(warmer.ready(source)).toBe(false);
    expect(await warmer.warm(source)).toBe(true);
    expect(gl.linkProgram).toHaveBeenCalledTimes(2);
  });

  it("without the extension compiles one program at a time, in the order asked", async () => {
    const gl = fakeGl({ parallel: false, fences: true, polls: 2 });
    const warmer = new ProgramWarmer(gl as unknown as WebGL2RenderingContext, vi.fn(async () => {}));
    const second = { vertex: "v", fragment: "second" };
    const linkedBefore: number[] = [];
    gl.linkProgram.mockImplementation(() => {
      linkedBefore.push(gl.getProgramParameter.mock.calls.filter(([, name]) => name === LINK_STATUS).length);
    });
    expect(await warmer.warmAll([source, second])).toEqual([true, true]);
    // The second program was sent only after the first one's status was read.
    expect(linkedBefore).toEqual([0, 1]);
  });
});
