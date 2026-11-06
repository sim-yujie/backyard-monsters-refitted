// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, ShopBuyReport, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { YardStore, type YardActionResult } from "@/game/yard/YardStore";
import { Hud } from "./Hud";
import { Notices } from "./maproom/Notices";

/**
 * A tapped resource's Shiny offers (Flash's "+" beside each resource,
 * `UI_TOP.as:526-536`, issue #393): the bubble under the number carries
 * +10%, +50% and Fill on the own yard, tap then tap again, and stays up
 * while they are there.
 */

const T0 = 2_000_000;
const never = <R>() => new Promise<R>(() => undefined);

const setup = () => {
  const store = new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      caps: { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 },
      credits: 1_000,
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
      buildinghealthdata: {},
      storedata: {},
      lockerdata: {},
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });
  const hud = new Hud({ scenes: [], onSceneSelect: () => {} }).mount(document.body);
  hud.setResources({ r1: 0, r2: 0, r3: 0, r4: 0 });
  hud.bindYard({ store, scene: { selectBuilding: () => {} }, notices: new Notices() });
  const button = (key: string) =>
    hud.element.querySelector<HTMLButtonElement>(`.hud__resource-button[data-resource="${key}"]`)!;
  const offers = () => [...document.querySelectorAll<HTMLButtonElement>(".hud__exact .hud__offer")];
  return { hud, store, button, offers };
};

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("the HUD's resource offers (issue #393)", () => {
  it("shows +10%, +50% and Fill under a tapped resource on the own yard, and keeps the bubble up", () => {
    vi.useFakeTimers();
    const { hud, button, offers } = setup();
    button("r1").click();
    expect(offers().map((one) => one.querySelector(".shiny-button__label")!.textContent)).toEqual(["+10%", "+50%", "Fill"]);
    expect(offers().map((one) => one.dataset["item"])).toEqual(["BR11", "BR12", "BR13"]);
    vi.advanceTimersByTime(10_000);
    expect(document.querySelector(".hud__exact")).not.toBeNull();
    hud.destroy();
  });

  it("buys on the second tap at the price shown", async () => {
    const { hud, store, button, offers } = setup();
    const buy = vi.spyOn(store, "buy").mockImplementation(
      (): Promise<YardActionResult<ShopBuyReport>> => Promise.resolve({ ok: false, refusal: { reason: "storageFull", message: "No room." } } as unknown as YardActionResult<ShopBuyReport>),
    );
    button("r2").click();
    const tenth = offers()[0]!;
    tenth.click();
    expect(buy).not.toHaveBeenCalled();
    tenth.click();
    expect(buy).toHaveBeenCalledWith("BR21", 58);
    await vi.waitFor(() => expect(document.querySelector(".hud__offers-note")?.textContent).toBe("No room."));
    hud.destroy();
  });

  it("offers nothing on the Shiny counter, nor once the yard is unbound", () => {
    const { hud, button, offers } = setup();
    button("shiny").click();
    expect(offers()).toHaveLength(0);
    button("shiny").click();
    hud.bindYard(null);
    button("r1").click();
    expect(document.querySelector(".hud__exact")).not.toBeNull();
    expect(offers()).toHaveLength(0);
    hud.destroy();
  });
});
