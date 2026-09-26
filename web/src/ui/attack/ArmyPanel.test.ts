// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { AttackSession } from "@/game/attack/AttackSession";
import type { AttackRoster, AttackTarget } from "@/game/attack/attackTarget";
import { Bucket } from "@/game/attack/bucket";
import { bucketCost, flingerPayload } from "@/game/combat/rules";
import {
  ArmyPanel,
  HOLD_DELAY_MS,
  HOLD_FAST_MS,
  HOLD_START_MS,
  holdInterval,
  monsterName,
  championName,
} from "./ArmyPanel";

/**
 * The army panel (`docs/design/attack-flow.md` §F2, §4.6): a row per housed
 * type in roster order with the monster's name and level, `+`/`-` that step
 * once on a press and keep stepping while held, a number box that takes a
 * typed figure and the arrow keys, one champion at a time, and a capacity bar
 * that follows Fill all.
 */

// Resolved from the module's path string rather than `new URL(..., import.meta.url)`:
// under jsdom the global URL is jsdom's own class, which Node's fileURLToPath refuses.
const sandbox = JSON.parse(
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../test/fixtures/baseload-sandbox-yard.json"),
    "utf8",
  ),
) as BaseLoadResponse;

/**
 * A roster from its parts. Asserted rather than typed so the fixture survives
 * the roster gaining fields the panel does not read (sources, siege).
 */
const rosterOf = (over: Partial<AttackRoster>): AttackRoster =>
  ({
    monsters: { C1: 30 },
    levels: {},
    champions: [],
    flingerLevel: 4,
    catapultLevel: 0,
    sources: [],
    siege: null,
    ...over,
  }) as AttackRoster;

const sandboxRoster = (): AttackRoster => {
  const housed = (sandbox.monsters?.housed ?? {}) as Record<string, number>;
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(sandbox.academy ?? {})) {
    if (typeof entry?.level === "number") levels[id] = entry.level;
  }
  return rosterOf({
    monsters: housed,
    levels,
    champions: sandbox.champion ?? [],
    flingerLevel: 4,
    catapultLevel: 1,
  });
};

const towerYard = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: { "1": { id: 1, t: 20, l: 1, X: 0, Y: 0 } },
    buildinghealthdata: {},
    resources: { r1: 1000, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
  }) as unknown as BaseLoadResponse;

const sessionWith = (roster: AttackRoster): AttackSession => {
  const target: AttackTarget = {
    baseid: "3502",
    kind: "wild",
    cell: { col: 241, row: 208 },
    name: "Kozu",
    roster,
  };
  const session = new AttackSession({ target, seed: 1 });
  session.load(towerYard());
  session.start();
  return session;
};

const panels: ArmyPanel[] = [];

afterEach(() => {
  while (panels.length > 0) panels.pop()?.destroy();
  document.body.replaceChildren();
  vi.useRealTimers();
});

interface Fixture {
  readonly session: AttackSession;
  readonly bucket: Bucket;
  readonly panel: ArmyPanel;
}

const mount = (roster: AttackRoster = sandboxRoster()): Fixture => {
  const session = sessionWith(roster);
  const bucket = new Bucket(session, { storage: null, playerKey: "test" });
  const panel = new ArmyPanel(bucket).mount(document.body);
  panels.push(panel);
  return { session, bucket, panel };
};

const rows = (panel: ArmyPanel): HTMLElement[] => [
  ...panel.element.querySelectorAll<HTMLElement>(".attack-army__row"),
];

const rowFor = (panel: ArmyPanel, id: string): HTMLElement => {
  const row = rows(panel).find((candidate) => candidate.dataset["id"] === id);
  if (!row) throw new Error(`no row ${id}`);
  return row;
};

const control = <T extends HTMLElement>(row: HTMLElement, selector: string): T => {
  const element = row.querySelector<T>(selector);
  if (!element) throw new Error(`no ${selector}`);
  return element;
};

const pointer = (element: HTMLElement, type: string): void => {
  element.dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 1 }),
  );
};

const key = (element: HTMLElement, name: string): void => {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
};

const radios = (panel: ArmyPanel): HTMLInputElement[] => [
  ...panel.element.querySelectorAll<HTMLInputElement>(".attack-army__champion-pick"),
];

describe("ArmyPanel rows", () => {
  it("draws one row per housed type in roster order, named and levelled", () => {
    const { panel } = mount();
    expect(rows(panel).map((row) => row.dataset["id"])).toEqual(["C14", "C15"]);
    const teratorn = rowFor(panel, "C14");
    expect(control(teratorn, ".attack-army__name").textContent).toBe("Teratorn");
    expect(control(teratorn, ".attack-army__level").textContent).toBe("L6");
    expect(control(teratorn, ".attack-army__housed").textContent).toBe("25 housed");
    expect(control<HTMLInputElement>(teratorn, ".attack-army__count").value).toBe("0");
    expect(control<HTMLImageElement>(teratorn, ".attack-army__icon img").getAttribute("src")).toBe(
      "/assets/monsters/C14-small.png",
    );
    expect(control(rowFor(panel, "C15"), ".attack-army__name").textContent).toBe("Zafreeti");
  });

  it("knows the names, and falls back to the id", () => {
    expect(monsterName("C1")).toBe("Pokey");
    expect(monsterName("IC5")).toBe("Balthazar");
    expect(monsterName("C999")).toBe("C999");
    expect(championName(5)).toBe("Krallen");
    expect(championName(3)).toBe("Fomor");
    expect(championName(9)).toBe("G9");
  });

  it("steps once on a click of plus or minus, never below zero", () => {
    const { panel, bucket } = mount();
    const row = rowFor(panel, "C14");
    const plus = control<HTMLButtonElement>(row, ".attack-army__step--plus");
    const minus = control<HTMLButtonElement>(row, ".attack-army__step--minus");
    expect(minus.disabled).toBe(true);
    plus.click();
    plus.click();
    expect(bucket.count("C14")).toBe(2);
    expect(control<HTMLInputElement>(row, ".attack-army__count").value).toBe("2");
    expect(minus.disabled).toBe(false);
    minus.click();
    minus.click();
    expect(bucket.count("C14")).toBe(0);
    expect(minus.disabled).toBe(true);
  });

  it("keeps stepping while plus is held, faster the longer it is held", () => {
    vi.useFakeTimers();
    // Three hundred Pokeys: enough headroom that the ceiling never interrupts.
    const { panel, bucket } = mount(rosterOf({ monsters: { C1: 300 } }));
    const plus = control<HTMLButtonElement>(rowFor(panel, "C1"), ".attack-army__step--plus");

    pointer(plus, "pointerdown");
    expect(bucket.count("C1")).toBe(1);
    vi.advanceTimersByTime(HOLD_DELAY_MS - 1);
    expect(bucket.count("C1")).toBe(1);
    vi.advanceTimersByTime(1);
    expect(bucket.count("C1")).toBe(2);
    vi.advanceTimersByTime(HOLD_START_MS);
    expect(bucket.count("C1")).toBe(3);

    // Well past two seconds, every repeat is at the fast rate.
    vi.advanceTimersByTime(3000);
    const before = bucket.count("C1");
    expect(before).toBeGreaterThan(20);
    vi.advanceTimersByTime(HOLD_FAST_MS * 5);
    expect(bucket.count("C1")).toBe(before + 5);

    pointer(plus, "pointerup");
    const released = bucket.count("C1");
    vi.advanceTimersByTime(2000);
    expect(bucket.count("C1")).toBe(released);
  });

  it("ramps the repeat interval from the start rate to the fast rate", () => {
    expect(holdInterval(0)).toBe(HOLD_START_MS);
    expect(holdInterval(HOLD_DELAY_MS)).toBe(HOLD_START_MS);
    expect(holdInterval(HOLD_DELAY_MS + 1000)).toBeLessThan(HOLD_START_MS);
    expect(holdInterval(HOLD_DELAY_MS + 1000)).toBeGreaterThan(HOLD_FAST_MS);
    expect(holdInterval(10_000)).toBe(HOLD_FAST_MS);
  });

  it("stops a hold when the pointer leaves or is cancelled, and stops at the ceiling", () => {
    vi.useFakeTimers();
    const { panel, bucket } = mount();
    const plus = control<HTMLButtonElement>(rowFor(panel, "C15"), ".attack-army__step--plus");

    pointer(plus, "pointerdown");
    vi.advanceTimersByTime(HOLD_DELAY_MS);
    expect(bucket.count("C15")).toBe(2);
    expect(plus.disabled).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(bucket.count("C15")).toBe(2);
    pointer(plus, "pointercancel");

    const minus = control<HTMLButtonElement>(rowFor(panel, "C15"), ".attack-army__step--minus");
    pointer(minus, "pointerdown");
    expect(bucket.count("C15")).toBe(1);
    pointer(minus, "pointerleave");
    vi.advanceTimersByTime(5000);
    expect(bucket.count("C15")).toBe(1);
  });

  it("takes a typed figure, clamps it, and rewrites the box on change", () => {
    const { panel, bucket } = mount();
    const input = control<HTMLInputElement>(rowFor(panel, "C14"), ".attack-army__count");
    input.value = "12";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(bucket.count("C14")).toBe(12);

    input.value = "999";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(bucket.count("C14")).toBe(25);
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(input.value).toBe("25");

    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(bucket.count("C14")).toBe(25);
  });

  it("steps by one on the arrows and ten on page up and down", () => {
    const { panel, bucket } = mount();
    const input = control<HTMLInputElement>(rowFor(panel, "C14"), ".attack-army__count");
    key(input, "ArrowUp");
    key(input, "ArrowUp");
    expect(bucket.count("C14")).toBe(2);
    key(input, "PageUp");
    expect(bucket.count("C14")).toBe(12);
    key(input, "ArrowDown");
    expect(bucket.count("C14")).toBe(11);
    key(input, "PageDown");
    key(input, "PageDown");
    expect(bucket.count("C14")).toBe(0);
    expect(input.value).toBe("0");
  });

  it("fills one row with its own Fill", () => {
    const { panel, bucket } = mount();
    const row = rowFor(panel, "C14");
    const fill = control<HTMLButtonElement>(row, ".attack-army__fill");
    fill.click();
    expect(bucket.count("C14")).toBe(25);
    expect(fill.disabled).toBe(true);
    expect(bucket.count("C15")).toBe(0);
  });

  it("stops Fill at the payload, not the housing, when the housing is larger", () => {
    const { panel, bucket } = mount(rosterOf({ monsters: { C19: 20 } }));
    control<HTMLButtonElement>(rowFor(panel, "C19"), ".attack-army__fill").click();
    const unit = bucketCost({ C19: 1 }, {});
    expect(bucket.count("C19")).toBe(Math.floor(flingerPayload() / unit));
    expect(panel.element.querySelector(".attack-army__meter--full")).not.toBeNull();
  });
});

describe("ArmyPanel capacity bar", () => {
  it("shows cost against payload and follows Fill all", () => {
    const { panel, bucket } = mount();
    expect(panel.capacityText).toBe("0 / 2,250");
    const meter = control(panel.element, ".attack-army__meter");
    expect(meter.getAttribute("aria-valuemax")).toBe("2250");

    control<HTMLButtonElement>(panel.element, ".attack-army__fill-all").click();
    const cost = bucketCost({ C14: 25, C15: 2 }, sandboxRoster().levels);
    expect(bucket.cost()).toBe(cost);
    expect(panel.capacityText).toBe(`${cost.toLocaleString("en-US")} / 2,250`);
    expect(meter.getAttribute("aria-valuenow")).toBe(String(cost));
    expect(control(panel.element, ".attack-army__meter-fill").style.width).toBe(
      `${((cost / 2250) * 100).toFixed(1)}%`,
    );
    expect(control<HTMLButtonElement>(panel.element, ".attack-army__fill-all").disabled).toBe(true);
  });

  it("empties on Clear", () => {
    const { panel, bucket } = mount();
    const clear = control<HTMLButtonElement>(panel.element, ".attack-army__clear");
    expect(clear.disabled).toBe(true);
    control<HTMLButtonElement>(panel.element, ".attack-army__fill-all").click();
    expect(clear.disabled).toBe(false);
    clear.click();
    expect(bucket.isEmpty()).toBe(true);
    expect(panel.capacityText).toBe("0 / 2,250");
  });
});

describe("ArmyPanel champion", () => {
  it("lists every champion as a radio and picks one at a time", () => {
    const { panel, bucket } = mount();
    const [krallen, fomor] = radios(panel);
    if (!krallen || !fomor) throw new Error("two champions expected");
    expect(krallen.value).toBe("5");
    expect(fomor.value).toBe("3");
    expect(krallen.closest("label")?.querySelector(".attack-army__name")?.textContent).toBe(
      "Krallen",
    );

    krallen.click();
    expect(bucket.champion()).toEqual({ t: 5, l: 5 });
    expect(krallen.checked).toBe(true);
    fomor.click();
    expect(bucket.champion()).toEqual({ t: 3, l: 6 });
    expect(fomor.checked).toBe(true);
    expect(krallen.checked).toBe(false);
  });

  it("un-picks with a second click on the picked one", () => {
    const { panel, bucket } = mount();
    const [krallen] = radios(panel);
    if (!krallen) throw new Error("a champion expected");
    krallen.click();
    expect(bucket.champion()?.t).toBe(5);
    krallen.click();
    expect(bucket.champion()).toBeNull();
    expect(krallen.checked).toBe(false);
  });

  it("disables a hurt champion and says why", () => {
    const roster = sandboxRoster();
    const { panel } = mount({
      ...roster,
      champions: [{ ...roster.champions[0]!, hp: 0 }, roster.champions[1]!],
    });
    const [hurt, fine] = radios(panel);
    expect(hurt?.disabled).toBe(true);
    expect(hurt?.closest("label")?.querySelector(".attack-army__note")?.textContent).toBe("Hurt");
    expect(fine?.disabled).toBe(false);
  });

  it("hides the group when the attacker owns no champion", () => {
    const { panel } = mount({ ...sandboxRoster(), champions: [] });
    expect(panel.element.querySelector<HTMLElement>(".attack-army__champions")?.hidden).toBe(true);
  });
});

describe("ArmyPanel after a drop", () => {
  it("keeps the figure, greys a clamped row with what is left, and disables an exhausted one", () => {
    const { panel, bucket, session } = mount();
    bucket.setCount("C14", 20);
    bucket.setCount("C15", 2);
    const [krallen] = radios(panel);
    krallen?.click();

    // Send 10 Teratorn and both Zafreeti with the champion.
    session.appendFling({ x: 100, y: 100, monsters: { C14: 10, C15: 2 }, champion: { t: 5, l: 5 } });
    bucket.afterDrop();

    const teratorn = rowFor(panel, "C14");
    expect(teratorn.classList.contains("attack-army__row--clamped")).toBe(true);
    expect(control<HTMLInputElement>(teratorn, ".attack-army__count").value).toBe("20");
    expect(control(teratorn, ".attack-army__note").textContent).toBe("15 left");
    expect(control(teratorn, ".attack-army__housed").textContent).toBe("15 housed");

    const zafreeti = rowFor(panel, "C15");
    expect(zafreeti.classList.contains("attack-army__row--exhausted")).toBe(true);
    expect(control<HTMLInputElement>(zafreeti, ".attack-army__count").value).toBe("0");
    expect(control<HTMLInputElement>(zafreeti, ".attack-army__count").disabled).toBe(true);
    expect(control<HTMLButtonElement>(zafreeti, ".attack-army__step--plus").disabled).toBe(true);
    expect(control(zafreeti, ".attack-army__note").textContent).toBe("None left");

    // The champion is on the field: un-picked and no longer pickable.
    for (const radio of radios(panel)) {
      expect(radio.checked).toBe(false);
      expect(radio.disabled).toBe(true);
    }
    expect(krallen?.closest("label")?.querySelector(".attack-army__note")?.textContent).toBe(
      "On the field",
    );
  });

  it("disables everything once the attack ends", () => {
    const { panel, session } = mount();
    session.retreat();
    expect(control<HTMLButtonElement>(panel.element, ".attack-army__fill-all").disabled).toBe(true);
    for (const row of rows(panel)) {
      expect(control<HTMLInputElement>(row, ".attack-army__count").disabled).toBe(true);
      expect(control<HTMLButtonElement>(row, ".attack-army__step--plus").disabled).toBe(true);
    }
    expect(control(panel.element, ".attack-army__hint").textContent).toBe("The attack is over.");
  });
});

describe("ArmyPanel last army", () => {
  it("recalls the saved army, and says so when there is none", () => {
    const map = new Map<string, string>();
    const storage = {
      length: 0,
      clear: () => map.clear(),
      getItem: (k: string) => map.get(k) ?? null,
      key: () => null,
      removeItem: (k: string) => {
        map.delete(k);
      },
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    } as Storage;

    const session = sessionWith(sandboxRoster());
    const bucket = new Bucket(session, { storage, playerKey: "2503" });
    const panel = new ArmyPanel(bucket).mount(document.body);
    panels.push(panel);
    const load = control<HTMLButtonElement>(panel.element, ".attack-army__load-last");
    load.click();
    expect(load.disabled).toBe(true);
    expect(bucket.isEmpty()).toBe(true);

    bucket.setCount("C14", 7);
    bucket.saveLast();
    bucket.clear();

    const again = new ArmyPanel(new Bucket(session, { storage, playerKey: "2503" })).mount(
      document.body,
    );
    panels.push(again);
    control<HTMLButtonElement>(again.element, ".attack-army__load-last").click();
    expect(again.inputFor("C14")?.value).toBe("7");
  });
});
