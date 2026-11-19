// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { mapRoom1Fixture } from "@/game/maproom1/mr1Fixture";
import { readMapRoom1 } from "@/game/maproom1/mr1Model";
import { MapRoom1Ui } from "./MapRoom1Ui";

/** The Map Room 1 screen around the achievements screen (#204). */

const NOW = 1_800_000_000;

const handlers = () => ({
  onSceneSelect: vi.fn(),
  onSignOut: vi.fn(),
  onClose: vi.fn(),
  onView: vi.fn(),
  onAttack: vi.fn(),
  onAction: vi.fn(),
});

const stubOwnAchievements = (): void => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 0,
            completed: [],
            report: { achievements: [], earned: 0, total: 16, shinyEarned: 0, fresh: [] },
          }),
          { status: 200 },
        ),
      ),
    ),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe("MapRoom1Ui and the achievements screen", () => {
  it("takes the target card down when the screen opens, as it docks over it", async () => {
    stubOwnAchievements();
    const container = document.createElement("div");
    document.body.append(container);
    const ui = new MapRoom1Ui(handlers(), "maproom1", [{ id: "maproom1", label: "Map" }]).mount(container);
    ui.setData(readMapRoom1(mapRoom1Fixture(NOW), NOW), null, NOW);

    container.querySelector<HTMLButtonElement>(".mr1__toggle-button:nth-child(2)")!.click();
    container.querySelector<HTMLElement>(".mr1-row")!.click();
    expect(container.querySelector(".mr1-side .mr1-card")).not.toBeNull();

    // The neighbour's card has no achievements line (owner, 19 Nov); the screen opens from the Account menu.
    expect(container.querySelector(".mr1-side .ach-line")).toBeNull();
    container.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
    container.querySelector<HTMLButtonElement>(".account-menu__achievements")!.click();
    await vi.waitFor(() => expect(container.querySelector(".ach-screen")).not.toBeNull());
    expect(container.querySelector(".mr1-card")).toBeNull();
    ui.destroy();
  });
});
