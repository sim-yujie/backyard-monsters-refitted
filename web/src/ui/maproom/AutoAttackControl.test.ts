// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { AutoAttackPlanResponse } from "@/api/autoAttack";
import type { WildMonsterCell } from "@/api/types";
import { AutoAttackControl, SCRATCH_CHIP_TEXT } from "./AutoAttackControl";
import { CellPanel, type CellPanelOptions } from "./CellPanel";

/**
 * The camp panel says when an attack would not save a Repeat plan, and why
 * (patch 8.3, owner's B): from the server's `fresh` flag, so a camp scratched
 * below 1% warns too, and an older server with no flag warns about nothing.
 */

const camp = (overrides: Partial<WildMonsterCell> = {}): WildMonsterCell => ({
  uid: 0,
  b: 1,
  i: 150,
  bid: "2000241208",
  n: "Abunakki",
  l: 35,
  dm: 0,
  d: 0,
  ...overrides,
});

const answerOf = (overrides: Partial<AutoAttackPlanResponse> = {}): AutoAttackPlanResponse =>
  ({
    error: 0,
    baseid: "2000241208",
    plan: null,
    missing: [],
    moves: [],
    movesKey: null,
    noRoom: null,
    yards: {},
    outOfRange: false,
    underAttack: false,
    damage: 0,
    fee: 2_000_000,
    ...overrides,
  }) as AutoAttackPlanResponse;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await Promise.resolve();
};

const open = async (payload: WildMonsterCell, answer: AutoAttackPlanResponse) => {
  const control = new AutoAttackControl({ plan: vi.fn(async () => answer), onRepeat: vi.fn() });
  const options: CellPanelOptions = {
    onClose: vi.fn(),
    onBookmark: vi.fn(),
    canBookmark: () => true,
    onViewYard: vi.fn(),
    attackRefusal: () => null,
    onAttack: vi.fn(),
    reach: () => ({ text: "In range · next to your yard", inRange: true }),
    ownFlinger: () => ({ level: 4, reach: 10 }),
    onRangeToggle: vi.fn(),
    extraAction: control,
  };
  const host = document.createElement("div");
  const panel = new CellPanel(options).mount(host);
  panel.show({ col: 241, row: 208 }, payload);
  await flush();
  return { panel, host, control };
};

/** The chips a player sees, in order. */
const chips = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>(".mr2-cell__chips > *")]
    .filter((chip) => !chip.hidden)
    .map((chip) => chip.textContent ?? "");

const line = (host: HTMLElement) => host.querySelector<HTMLElement>(".auto-attack-action")!;

describe("the camp panel's Repeat-plan line (patch 8.3)", () => {
  it("a fresh camp says how to save a plan, plainly", async () => {
    const { host } = await open(camp(), answerOf({ fresh: true }));
    expect(line(host).textContent).toBe("Attack a full-health camp with monsters to save a Repeat plan.");
    expect(line(host).classList.contains("auto-attack-action--warn")).toBe(false);
    expect(chips(host)).not.toContain(SCRATCH_CHIP_TEXT);
  });

  it("a damaged camp warns that it won't save a plan, and names a camp that would", async () => {
    const { host } = await open(camp({ dm: 12 }), answerOf({ fresh: false, damage: 12 }));
    expect(line(host).textContent).toBe("Won't save a Repeat plan. Pick a full-health Lv 35 Abunakki camp.");
    expect(line(host).classList.contains("auto-attack-action--warn")).toBe(true);
    expect(line(host).querySelector("svg")).not.toBeNull();
    // The panel's own chip says the damage; the scratch chip stays out.
    expect(chips(host)).toContain("Damaged 12%");
    expect(chips(host)).not.toContain(SCRATCH_CHIP_TEXT);
  });

  it("a camp scratched below 1% reads 0%, but warns, with a Damaged chip after the range chip", async () => {
    const { host, panel } = await open(camp({ dm: 0 }), answerOf({ fresh: false, damage: 0 }));
    expect(line(host).textContent).toBe("Won't save a Repeat plan. Pick a full-health Lv 35 Abunakki camp.");
    expect(chips(host).slice(0, 2)).toEqual(["In range · next to your yard", SCRATCH_CHIP_TEXT]);
    expect(host.querySelector<HTMLElement>(".auto-attack-scratch")!.title).toBe("Damaged below 1%");
    // The panel rebuilds its chips on every update; the chip stays.
    panel.update(camp({ dm: 0 }));
    await flush();
    expect(chips(host)).toContain(SCRATCH_CHIP_TEXT);
  });

  it("an older server sends no flag: every camp reads as fresh, so nothing warns", async () => {
    const { host } = await open(camp({ dm: 12 }), answerOf({ damage: 12 }));
    expect(line(host).textContent).toBe("Attack a full-health camp with monsters to save a Repeat plan.");
    expect(line(host).classList.contains("auto-attack-action--warn")).toBe(false);
    expect(chips(host)).not.toContain(SCRATCH_CHIP_TEXT);
  });

  it("the scratch chip goes when the camp shown changes to a fresh one", async () => {
    const answers = [answerOf({ fresh: false }), answerOf({ fresh: true, baseid: "2000242208" })];
    const control = new AutoAttackControl({ plan: vi.fn(async () => answers.shift()!), onRepeat: vi.fn() });
    const host = document.createElement("div");
    const panel = new CellPanel({
      onClose: vi.fn(),
      onBookmark: vi.fn(),
      canBookmark: () => true,
      onViewYard: vi.fn(),
      attackRefusal: () => null,
      onAttack: vi.fn(),
      reach: () => null,
      ownFlinger: () => ({ level: 4, reach: 10 }),
      onRangeToggle: vi.fn(),
      extraAction: control,
    }).mount(host);
    panel.show({ col: 241, row: 208 }, camp());
    await flush();
    expect(chips(host)).toContain(SCRATCH_CHIP_TEXT);
    panel.show({ col: 242, row: 208 }, camp({ bid: "2000242208" }));
    await flush();
    expect(chips(host)).not.toContain(SCRATCH_CHIP_TEXT);
  });
});
