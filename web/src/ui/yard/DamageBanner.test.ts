// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { RepairActions, RepairReport } from "@/api/yardRepair";
import type { YardActionResult, YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { Notices } from "@/ui/maproom/Notices";
import { DamageBanner, damageBannerText } from "./DamageBanner";

/** The post-attack banner: when it shows, what it counts, and its Repair all. */

const T0 = 1_800_000_000;

const snapper = (id: number, extra: Partial<BuildingData> = {}): BuildingData => ({
  X: 0,
  Y: 0,
  id,
  t: 1,
  ...extra,
});

describe("DamageBanner", () => {
  let notices: Notices;
  let save: BaseLoadResponse;
  let binding: YardUiBinding;
  let all: ReturnType<typeof vi.fn>;
  let actions: RepairActions;
  let banner: DamageBanner | null;

  const setBuildings = (buildings: BuildingData[]): void => {
    save = {
      ...save,
      buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    };
    banner?.refresh();
  };

  const text = (): string | null =>
    document.querySelector(".damage-banner")?.textContent ?? null;

  beforeEach(() => {
    document.body.replaceChildren();
    notices = new Notices().mount(document.body);
    save = {
      savetime: T0,
      currenttime: T0,
      buildingdata: {
        "1": snapper(1, { hp: 100 }),
        "2": snapper(2, { hp: 200 }),
        "3": snapper(3, { hp: 200, rE: 1 }),
        "4": snapper(4),
      },
      buildinghealthdata: {},
    } as unknown as BaseLoadResponse;
    const store = {
      get save() {
        return save;
      },
      now: () => T0,
    };
    binding = { store: store as unknown as YardStore, scene: { selectBuilding: () => {} }, notices };
    all = vi.fn();
    actions = { one: vi.fn(), all, now: vi.fn() } as unknown as RepairActions;
    banner = null;
  });

  afterEach(() => {
    banner?.destroy();
    notices.destroy();
  });

  it("says how many buildings are damaged and not being repaired", () => {
    expect(damageBannerText(1)).toBe("Your yard was attacked: 1 building damaged");
    banner = new DamageBanner(binding, actions);
    expect(text()).toBe("Your yard was attacked: 2 buildings damaged");
    expect(document.querySelector(".notice button.btn--ghost")?.textContent).toBe("Repair all");
  });

  it("shows nothing for an undamaged yard, and appears when damage arrives", () => {
    setBuildings([snapper(4)]);
    banner = new DamageBanner(binding, actions);
    expect(text()).toBeNull();
    setBuildings([snapper(4, { hp: 10 })]);
    expect(text()).toBe("Your yard was attacked: 1 building damaged");
  });

  it("follows the count, and goes once nothing waits for a repair", () => {
    banner = new DamageBanner(binding, actions);
    setBuildings([snapper(1, { hp: 100 }), snapper(2, { hp: 200, rE: 1 })]);
    expect(text()).toBe("Your yard was attacked: 1 building damaged");
    setBuildings([snapper(1, { hp: 100, rE: 1 })]);
    expect(text()).toBeNull();
  });

  it("stays dismissed while the damage stays", () => {
    banner = new DamageBanner(binding, actions);
    document.querySelector<HTMLButtonElement>('.notice [aria-label="Dismiss"]')!.click();
    expect(text()).toBeNull();
    setBuildings([snapper(1, { hp: 100 })]);
    expect(text()).toBeNull();
    // Once the yard is whole, the next attack's damage shows again.
    setBuildings([snapper(1)]);
    setBuildings([snapper(1, { hp: 50 })]);
    expect(text()).toBe("Your yard was attacked: 1 building damaged");
  });

  it("Repair all sends one request and says what started", async () => {
    const report: RepairReport = { started: [1, 2], skipped: [], doneBy: T0 + 24 };
    all.mockImplementation(() => {
      setBuildings([snapper(1, { hp: 100, rE: 1 }), snapper(2, { hp: 200, rE: 1 })]);
      return Promise.resolve({ ok: true, report, completed: [] } satisfies YardActionResult<RepairReport>);
    });
    banner = new DamageBanner(binding, actions);
    document.querySelector<HTMLButtonElement>(".notice button.btn--ghost")!.click();
    await vi.waitFor(() => expect(all).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(document.querySelector(".notice")?.textContent).toContain("Repairing 2 buildings."),
    );
    expect(text()).toBeNull();
  });
});
