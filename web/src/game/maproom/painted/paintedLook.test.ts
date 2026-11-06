import { DOMAdapter, type Renderer } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { borderProgram } from "./BorderLayer";
import { cloudProgram } from "./CloudLayer";
import { groundProgram } from "./PaintedGround";
import { preparePrograms, warmRest } from "./paintedLook";
import { PLACEMENT_GRIDS, placementProgram } from "./PlacementLayer";

// GlProgram reads the GPU's float precision from a test canvas; these tests run without a DOM.
DOMAdapter.set({ ...DOMAdapter.get(), createCanvas: () => ({ getContext: () => null }) as unknown as HTMLCanvasElement });

const COMPLETION_STATUS_KHR = 0x91b1;
const LINK_STATUS = 4;

/**
 * A stand-in WebGL2 context that logs, in order, each fragment shader handed to it (by name) and
 * each program whose link status was read; every program takes two status checks to compile.
 */
const loggingGl = (names: Map<string, string>) => {
  const log: string[] = [];
  let made = 0;
  const asked = new Map<object, number>();
  const gl = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    LINK_STATUS,
    createShader: vi.fn((type: number) => ({ type })),
    shaderSource: vi.fn((shader: { type: number }, text: string) => {
      if (shader.type === 2) log.push(`compile ${names.get(text) ?? "?"}`);
    }),
    compileShader: vi.fn(),
    createProgram: vi.fn(() => ({ index: made++ })),
    attachShader: vi.fn(),
    detachShader: vi.fn(),
    linkProgram: vi.fn(),
    isContextLost: vi.fn(() => false),
    getProgramParameter: vi.fn((program: object, name: number) => {
      if (name === COMPLETION_STATUS_KHR) {
        const count = (asked.get(program) ?? 0) + 1;
        asked.set(program, count);
        return count >= 2;
      }
      if (name === LINK_STATUS) {
        log.push("linked");
        return true;
      }
      return null;
    }),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    getExtension: vi.fn((name: string) => (name === "KHR_parallel_shader_compile" ? { COMPLETION_STATUS_KHR } : null)),
  };
  return { gl, log };
};

/** A stand-in for Pixi's WebGL renderer: its table of linked programs, which the warm-up fills. */
const fakeRenderer = (gl: object) => ({ gl, shader: { _programDataHash: {} as Record<string, unknown> } });

const programNames = (): Map<string, string> => {
  const text = (program: { fragment?: string }): string => program.fragment ?? "";
  return new Map<string, string>([
    [text(groundProgram("low")), "ground-low"],
    [text(groundProgram("medium")), "ground-medium"],
    [text(groundProgram("high")), "ground-high"],
    [text(borderProgram()), "borders"],
    [text(cloudProgram()), "clouds"],
    ...PLACEMENT_GRIDS.map((grid): [string, string] => [text(placementProgram(grid)), `place-${grid}`]),
  ]);
};

describe("the painted look's warm-up order (MR2 plan step 10)", () => {
  it("compiles Low, the borders and the fog first, then the placements and the player's own Quality", async () => {
    vi.useFakeTimers();
    try {
      const { gl, log } = loggingGl(programNames());
      const renderer = fakeRenderer(gl);
      const prepared = preparePrograms(renderer as unknown as Renderer, gl as unknown as WebGL2RenderingContext);
      await vi.runAllTimersAsync();
      const programs = await prepared;
      expect(programs.ground).toBe(true);
      expect(programs.clouds).toBe(true);
      // Nothing more until the look is built and asks for the rest.
      expect(log.filter((entry) => entry.startsWith("compile"))).toHaveLength(3);
      warmRest(programs.warmer!, Promise.resolve());
      await vi.runAllTimersAsync();

      expect(log.slice(0, 3)).toEqual(["compile ground-low", "compile borders", "compile clouds"]);
      // The placements and the player's Quality (High here: no saved choice) start only once the
      // first three have linked, so they never slow the Low ground down.
      const rest = log.indexOf("compile place-decals");
      expect(log.slice(0, rest).filter((entry) => entry === "linked")).toHaveLength(3);
      expect(log.slice(rest).filter((entry) => entry.startsWith("compile"))).toEqual([
        ...PLACEMENT_GRIDS.map((grid) => `compile place-${grid}`),
        "compile ground-high",
      ]);
      await vi.runAllTimersAsync();
      expect(programs.warmer?.ready(groundProgram("high"))).toBe(true);
      expect(log).not.toContain("compile ground-medium");
      // Every linked program went to Pixi, so Pixi never compiles them again.
      expect(Object.keys(renderer.shader._programDataHash)).toHaveLength(8);
      expect(renderer.shader._programDataHash[groundProgram("high")._key]).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("compiles nothing on the next open, and starts on the player's own Quality", async () => {
    vi.useFakeTimers();
    try {
      const { gl, log } = loggingGl(programNames());
      const renderer = fakeRenderer(gl);
      const first = preparePrograms(renderer as unknown as Renderer, gl as unknown as WebGL2RenderingContext);
      await vi.runAllTimersAsync();
      warmRest((await first).warmer!, Promise.resolve());
      await vi.runAllTimersAsync();
      const compiled = log.length;
      const again = preparePrograms(renderer as unknown as Renderer, gl as unknown as WebGL2RenderingContext);
      await vi.runAllTimersAsync();
      const programs = await again;
      expect(programs.ground).toBe(true);
      expect(log.length).toBe(compiled);
      expect(programs.warmer?.ready(groundProgram("high"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
