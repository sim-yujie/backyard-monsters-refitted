// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideApi } from "@/api/guide";
import type { MapRoom1Response } from "@/api/maproom1";
import { readMapRoom1, type Mr1World } from "@/game/maproom1/mr1Model";
import { guideBus } from "./guideBus";
import { Mr1Guide } from "./mr1Guide";
import { LINES } from "./steps";

/**
 * Bob on Map Room 1 (issue #227, `docs/design/tutorial.md` §2.3 steps 13 to
 * 16, §5.6): the practice camp read off the map, the step moved on as the
 * map opens, and won or lost read back from the server after the attack.
 */

const answer = (step: string) => ({ error: 0, onboarding: { guide: { state: "active", step } } }) as never;

const fakeApi = () => ({
  advance: vi.fn(async (from: string) =>
    answer(from === "open-map" ? "pick-camp" : from === "attack" ? "home-goals" : from),
  ),
  finish: vi.fn(),
  army: vi.fn(async () => answer("pick-camp")),
  skip: vi.fn(async () => answer("skipped")),
});

const worldAt = (step: string | null): Mr1World =>
  readMapRoom1(
    {
      error: 0,
      now: 100,
      tribes: [],
      neighbours: [],
      ...(step && { practice: { baseid: "1", name: "Practice camp", level: 1, destroyed: 0, damage: 0, step } }),
    } as MapRoom1Response,
    100,
  );

let layer: HTMLElement;
let guide: Mr1Guide | null = null;
const text = (): string => layer.querySelector(".guide-bob__text")?.textContent ?? "";
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  layer = document.createElement("div");
  document.body.append(layer);
});

afterEach(() => {
  guide?.destroy();
  guide = null;
  guideBus.clear();
  document.body.replaceChildren();
});

describe("the Map Room 1 model", () => {
  it("reads the practice camp as the first tribe, with the guide's step", () => {
    const world = worldAt("pick-camp");
    expect(world.tribes[0]).toMatchObject({ baseid: "1", name: "Practice camp", practice: true, wrecked: false });
    expect(world.guideStep).toBe("pick-camp");
    expect(worldAt(null).guideStep).toBeUndefined();
    expect(worldAt(null).tribes.some((tribe) => tribe.practice)).toBe(false);
  });
});

describe("Mr1Guide", () => {
  it("moves on from open-map once and points at the camp", async () => {
    const api = fakeApi();
    guide = new Mr1Guide(layer, { goHome: vi.fn(), refresh: vi.fn() }, api as unknown as GuideApi);
    guide.update(worldAt("open-map"));
    guide.update(worldAt("open-map"));
    await settle();
    expect(api.advance).toHaveBeenCalledTimes(1);
    expect(api.advance).toHaveBeenCalledWith("open-map");
    expect(text()).toBe(LINES.pickCamp);
  });

  it("asks the server after the attack: a win sends Bob home with the player", async () => {
    const api = fakeApi();
    const goHome = vi.fn();
    guide = new Mr1Guide(layer, { goHome, refresh: vi.fn() }, api as unknown as GuideApi);
    guide.update(worldAt("attack"));
    await settle();
    expect(api.advance).toHaveBeenCalledWith("attack");
    expect(text()).toBe(LINES.wonHome);
    // The camp is gone from the next read; Bob keeps cheering until home.
    guide.update(worldAt(null));
    expect(text()).toBe(LINES.wonHome);
    layer.querySelector<HTMLButtonElement>(".guide-bob__action")!.click();
    expect(goHome).toHaveBeenCalledOnce();
  });

  it("a loss shows the worried Bob, and Try again gives the free retry", async () => {
    const api = fakeApi();
    api.advance.mockImplementation(async () => answer("attack-result"));
    const refresh = vi.fn();
    guide = new Mr1Guide(layer, { goHome: vi.fn(), refresh }, api as unknown as GuideApi);
    guide.update(worldAt("attack"));
    await settle();
    expect(text()).toBe(LINES.lost);
    expect(layer.querySelector<HTMLImageElement>(".guide-bob__portrait")?.dataset["mood"]).toBe("worried");
    layer.querySelector<HTMLButtonElement>(".guide-bob__action.btn--primary")!.click();
    await settle();
    expect(api.army).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalled();
    expect(text()).toBe(LINES.pickCamp);
  });

  it("points at Attack once the camp's card is open", async () => {
    const api = fakeApi();
    guide = new Mr1Guide(layer, { goHome: vi.fn(), refresh: vi.fn() }, api as unknown as GuideApi);
    guide.update(worldAt("pick-camp"));
    const attack = document.createElement("button");
    attack.setAttribute("data-tut", "target-attack");
    attack.getBoundingClientRect = () => ({ left: 0, top: 0, width: 50, height: 20 }) as DOMRect;
    document.body.append(attack);
    guideBus.emit("targetPicked", { baseid: "1", kind: "tribe" });
    expect(text()).toBe(LINES.tapAttack);
  });

  it("skips from the bubble after a warning", async () => {
    const api = fakeApi();
    guide = new Mr1Guide(layer, { goHome: vi.fn(), refresh: vi.fn() }, api as unknown as GuideApi);
    guide.update(worldAt("pick-camp"));
    layer.querySelector<HTMLButtonElement>(".guide-bob__skip")!.click();
    expect(text()).toBe(LINES.skipAsk);
    const skip = [...layer.querySelectorAll<HTMLButtonElement>(".guide-bob__action")].find(
      (button) => button.textContent === "Skip",
    )!;
    skip.click();
    await settle();
    expect(api.skip).toHaveBeenCalledOnce();
  });
});
