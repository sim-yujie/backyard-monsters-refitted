import { DOMAdapter } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { borderProgram } from "./BorderLayer";
import { cloudProgram } from "./CloudLayer";
import { groundProgram } from "./PaintedGround";
import { preparePrograms } from "./paintedLook";
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

describe("the painted look's warm-up order (MR2 plan step 10)", () => {
  it("compiles Low, the borders, the fog and the placements first, and the player's own Quality after", async () => {
    vi.useFakeTimers();
    try {
      const text = (program: { fragment?: string }): string => program.fragment ?? "";
      const names = new Map<string, string>([
        [text(groundProgram("low")), "ground-low"],
        [text(groundProgram("medium")), "ground-medium"],
        [text(groundProgram("high")), "ground-high"],
        [text(borderProgram()), "borders"],
        [text(cloudProgram()), "clouds"],
        ...PLACEMENT_GRIDS.map((grid): [string, string] => [text(placementProgram(grid)), `place-${grid}`]),
      ]);
      const { gl, log } = loggingGl(names);
      const prepared = preparePrograms(gl as unknown as WebGL2RenderingContext);
      await vi.runAllTimersAsync();
      const programs = await prepared;
      expect(programs.ground).toBe(true);
      expect(programs.clouds).toBe(true);

      const first = log.slice(0, 7);
      expect(first).toEqual([
        "compile ground-low",
        "compile borders",
        "compile clouds",
        ...PLACEMENT_GRIDS.map((grid) => `compile place-${grid}`),
      ]);
      // The player's Quality (High here: no saved choice) starts only once all seven have linked,
      // so it never slows the Low ground down.
      const high = log.indexOf("compile ground-high");
      expect(high).toBeGreaterThan(0);
      expect(log.slice(0, high).filter((entry) => entry === "linked")).toHaveLength(7);
      await vi.runAllTimersAsync();
      expect(programs.warmer?.ready(groundProgram("high"))).toBe(true);
      expect(log).not.toContain("compile ground-medium");
    } finally {
      vi.useRealTimers();
    }
  });
});
