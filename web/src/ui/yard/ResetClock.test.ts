// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BaseLoadResponse, YardResponse } from "@/api/types";
import type { YardApi } from "@/api/yard";
import { resetEventsFeed, setEventsFeed } from "@/game/events/eventsFeed";
import { resetWeekend } from "@/game/weekend";
import type { YardMounts } from "@/game/yard/yardPlugins";
import { resetClockPlugin } from "@/game/yard/plugins/resetClock";
import { YardStore } from "@/game/yard/YardStore";
import type { ResetRow } from "@/game/resetClock";
import { ResetClock, type ResetClockTimers } from "./ResetClock";

/** Sunday 15 Nov 2026, 05:59:00 UTC (the mock-up's moment). */
const T0 = Date.parse("2026-11-15T05:59:00Z") / 1000;
const never = <R>() => new Promise<R>(() => undefined);

/** Timers run by hand. */
const manualTimers = (): ResetClockTimers & { fire(): void; stopped: boolean } => {
  let callback: (() => void) | null = null;
  const timers = {
    stopped: false,
    every: (next: () => void) => {
      callback = next;
      return 1;
    },
    stop: () => {
      timers.stopped = true;
    },
    fire: () => callback?.(),
  };
  return timers;
};

const ROWS: ResetRow[] = [
  { id: "daily", title: "Daily", detail: "quests", at: T0 + 18 * 3600 + 60, phase: "reset" },
  { id: "krallen", title: "Krallen Hunt", detail: null, at: T0 + 2 * 86_400, phase: "ends" },
];

afterEach(() => {
  document.body.replaceChildren();
  resetEventsFeed();
  resetWeekend();
});

describe("ResetClock", () => {
  it("counts down to the next daily reset on the clock it is given", () => {
    let now = T0;
    const timers = manualTimers();
    const clock = new ResetClock({ now: () => now, rows: () => ROWS, timers });
    const button = clock.element.querySelector("button");
    // An hourglass only: the countdown is in its label and its list.
    expect(button?.textContent).toBe("");
    expect(button?.getAttribute("aria-label")).toBe("Daily reset in 18h 01m. Show every reset");
    now = T0 + 18 * 3600 + 30;
    timers.fire();
    expect(button?.getAttribute("aria-label")).toBe("Daily reset in 0m 30s. Show every reset");
    clock.destroy();
    expect(timers.stopped).toBe(true);
  });

  it("a tap opens the list of resets, each with its own countdown; another shuts it", () => {
    const clock = new ResetClock({ now: () => T0, rows: () => ROWS, timers: manualTimers() });
    document.body.append(clock.element);
    const button = clock.element.querySelector<HTMLButtonElement>(".reset-clock__button")!;
    const list = clock.element.querySelector<HTMLElement>(".reset-clock__list")!;
    expect(list.hidden).toBe(true);

    button.click();
    expect(list.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(list.querySelector(".reset-clock__heading")?.textContent).toBe("Resets (server time 05:59)");
    const rows = [...list.querySelectorAll<HTMLElement>(".reset-clock__row")];
    expect(rows.map((row) => row.dataset["reset"])).toEqual(["daily", "krallen"]);
    expect(rows.map((row) => row.querySelector(".reset-clock__left")?.textContent)).toEqual([
      "18h 01m",
      "ends in 2d 0h",
    ]);
    expect(rows[0]?.querySelector(".reset-clock__detail")?.textContent).toBe("quests");
    expect(rows[1]?.querySelector(".reset-clock__detail")).toBeNull();

    button.click();
    expect(list.hidden).toBe(true);
    clock.destroy();
  });

  it("a press elsewhere or Escape shuts the list", () => {
    const clock = new ResetClock({ now: () => T0, rows: () => ROWS, timers: manualTimers() });
    document.body.append(clock.element);
    clock.show();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(clock.open).toBe(false);
    clock.show();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(clock.open).toBe(false);
    clock.destroy();
  });

  it("hidden, it shuts its list and will not open", () => {
    const clock = new ResetClock({ now: () => T0, rows: () => ROWS, timers: manualTimers() });
    clock.show();
    clock.setHidden(true);
    expect(clock.element.hidden).toBe(true);
    expect(clock.open).toBe(false);
    clock.show();
    expect(clock.open).toBe(false);
    clock.destroy();
  });
});

describe("reset clock CSS", () => {
  const css = readFileSync(resolve(__dirname, "../styles/reset-clock.css"), "utf8");
  const skin = readFileSync(resolve(__dirname, "../styles/skin.css"), "utf8");
  const tips = readFileSync(resolve(__dirname, "../styles/tips.css"), "utf8");

  it("the hidden attribute wins over the button's own display", () => {
    expect(css).toMatch(/\.reset-clock\[hidden\][^{]*\{\s*display: none;/);
  });

  it("the hourglass is the \"?\"'s round twin: same size, same look in every style", () => {
    expect(css).toMatch(/--reset-clock-width: var\(--reset-help-size\);/);
    expect(tips).toMatch(/:is\(\.guide-help--float, \.reset-clock__button\) \{[^}]*border-radius: 50%;/);
    expect(skin).toContain(":root[data-skin] :is(.guide-help--float, .reset-clock__button) {");
    // Not a square plate: the skins' plate list paints only its list.
    const plate = skin.slice(skin.indexOf(":root[data-skin] :is(\n  .hud:not(.hud--corner)"));
    const list = plate.slice(0, plate.indexOf("\n) {"));
    expect(list).not.toContain(".reset-clock__button");
    expect(list).toContain(".reset-clock__list");
  });

  it("the status strip starts after the button while it shows", () => {
    expect(css).toContain(".overlay__layer:has(> .reset-clock:not([hidden])) > .hud--corner > .hud-status.hud-status");
  });

  it("on a phone on its side the strip starts after the Events door", () => {
    const side = css.slice(css.indexOf("@media (min-width: 621px) and (max-height: 500px) {"));
    expect(side.slice(0, side.indexOf("\n}\n"))).toContain("left: calc(226px + var(--events-door-side-width)");
    // The door with its label: Classic's 76px plate, Modern's 68px.
    expect(css).toMatch(/:root \{[^}]*--events-door-side-width: 76px;/);
    expect(css).toMatch(/:root\[data-skin="scrap"\] \{\s*--events-door-side-width: 68px;/);
  });

  it("the row lines up: one height, one top, one left edge for the \"?\", the strip, World chat and the lists", () => {
    const status = readFileSync(resolve(__dirname, "../styles/yard-status.css"), "utf8");
    const yardHelp = css.slice(css.indexOf(".overlay__layer:has(> .reset-clock) > .guide-help--float {"));
    const help = yardHelp.slice(0, yardHelp.indexOf("}"));
    expect(help).toContain("top: var(--corner-row-top);");
    expect(help).toContain("left: var(--corner-row-left);");
    expect(help).toContain("height: var(--reset-help-size);");
    // World chat: its left edge is the row's, a step under it.
    expect(css).toMatch(/> \.chat-box \{\s*--chat-top: calc\(var\(--corner-row-top\) \+ var\(--reset-help-size\) \+ var\(--space-2\)\);\s*left: var\(--corner-row-left\);/);
    // Both lists hang at the same place.
    for (const text of [css.slice(css.indexOf(".reset-clock__list {")), status.slice(status.indexOf(".hud-status__list {"))]) {
      const rule = text.slice(0, text.indexOf("}"));
      expect(rule).toContain("position: fixed;");
      expect(rule).toContain("top: var(--corner-list-top);");
      expect(rule).toContain("left: var(--corner-row-left);");
    }
    // The plates paint their frame on the box's edge, as the round buttons do.
    expect(skin).toMatch(/:root\[data-skin\] :is\(\.hud-status__chip, \.chat-box__tab\) \{\s*border-image-outset: var\(--skin-bar-bleed, 0\);/);
    // One plain style for the shield's time and the boosts' count.
    expect(status).toMatch(/\.hud-status__time,\s*\.hud-status__count \{/);
    expect(status).not.toMatch(/\.hud-status__count \{[^}]*background/);
  });
});

const storeWith = (guide: "pending" | "active" | "done" | null) =>
  new YardStore({
    save: {
      error: 0,
      currenttime: T0,
      savetime: T0,
      resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
      credits: 0,
      buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 3 } },
      buildinghealthdata: {},
      storedata: {},
      lockerdata: {},
      ...(guide ? { onboarding: { guide: { state: guide } } } : {}),
    } as unknown as BaseLoadResponse,
    api: { state: vi.fn(() => never<YardResponse<null>>()) } as unknown as YardApi,
    clock: () => T0,
    timers: { set: () => 0, clear: () => undefined },
  });

const mount = (store: YardStore) => {
  const content = document.createElement("div");
  content.className = "overlay__layer";
  document.body.append(content);
  const teardown = resetClockPlugin({ store, overlay: { content } } as unknown as YardMounts);
  return { content, teardown: teardown ?? (() => undefined) };
};

describe("resetClockPlugin", () => {
  it("puts the hourglass on the yard, on the store's server clock", () => {
    const { content, teardown } = mount(storeWith("done"));
    const clock = content.querySelector<HTMLElement>(".reset-clock");
    expect(clock?.hidden).toBe(false);
    expect(clock?.querySelector("button")?.getAttribute("aria-label")).toContain("18h 01m");
    teardown();
    expect(content.querySelector(".reset-clock")).toBeNull();
  });

  it.each(["pending", "active"] as const)("is hidden while the guided start is %s", (state) => {
    const { content, teardown } = mount(storeWith(state));
    expect(content.querySelector<HTMLElement>(".reset-clock")?.hidden).toBe(true);
    teardown();
  });

  it("shows for an account without an onboarding record", () => {
    const { content, teardown } = mount(storeWith(null));
    expect(content.querySelector<HTMLElement>(".reset-clock")?.hidden).toBe(false);
    teardown();
  });

  it("prefers the events list's server clock once it is read, and lists its Krallen Hunt", () => {
    const later = T0 + 3600;
    setEventsFeed(
      [
        {
          id: "krallen-2026-11",
          title: "Krallen Hunt",
          text: "",
          kind: "krallen",
          banner: null,
          status: "active",
          startsAt: Date.parse("2026-11-15T00:00:00Z") / 1000,
          endsAt: Date.parse("2026-12-01T00:00:00Z") / 1000,
          claimUntil: null,
          locked: null,
          calendar: null,
          ladder: null,
          krallen: null,
        },
      ],
      { now: () => later },
    );
    const { content, teardown } = mount(storeWith("done"));
    expect(content.querySelector(".reset-clock__button")?.getAttribute("aria-label")).toContain("17h 01m");
    content.querySelector<HTMLButtonElement>(".reset-clock__button")?.click();
    const rows = [...content.querySelectorAll<HTMLElement>(".reset-clock__row")];
    expect(rows.map((row) => row.dataset["reset"])).toEqual(["daily", "weekly", "krallen"]);
    expect(rows[2]?.querySelector(".reset-clock__left")?.textContent).toBe("ends in 15d 17h");
    teardown();
  });
});
