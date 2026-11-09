// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ChampionSaveEntry } from "@/api/types";
import type { AttackRoster } from "@/game/attack/attackTarget";
import { setClassicLook } from "@/game/classicLook";
import {
  ATTACK_WINDOW_TEXT,
  attackWindowModel,
  bombSlots,
  championSlots,
  confirmAttackWindow,
  showsAttackWindow,
} from "./AttackWindow";

const champion = (t: number, extra: Partial<ChampionSaveEntry> = {}): ChampionSaveEntry => ({
  t,
  hp: 1000,
  l: 3,
  ft: 0,
  fd: 0,
  fb: 0,
  pl: 0,
  status: 0,
  ...extra,
});

const roster = (extra: Partial<AttackRoster> = {}): AttackRoster => ({
  monsters: { C12: 4, C2: 30, C1: 12, IC1: 2 },
  levels: { C1: 3 },
  champions: [champion(1)],
  flingerLevel: 3,
  catapultLevel: 2,
  sources: [],
  siege: { decoy: { level: 0, quantity: 0 }, vacuum: { level: 4, quantity: 1 }, jars: { level: 2, quantity: 1 } },
  resources: { r1: 150_000, r2: 50_000, r3: 5_000_000, r4: 0 },
  ...extra,
});

afterEach(() => {
  document.body.replaceChildren();
  setClassicLook(false);
});

describe("bombSlots", () => {
  it("shows the biggest bomb the resources pay for, as Flash did", () => {
    const slots = bombSlots(3, { r1: 150_000, r2: 2_500_000, r3: 20_000_000 });
    expect(slots.map((slot) => [slot.id, slot.size, slot.state])).toEqual([
      ["tw1", "Big", "ready"],
      ["pb2", "Huge", "ready"],
      ["pu3", "Massive", "ready"],
    ]);
  });

  it("greys a resource the Catapult has not reached, with the level it needs", () => {
    const slots = bombSlots(1, { r1: 10_000, r2: 99_999_999, r3: 99_999_999 });
    expect(slots.map((slot) => [slot.id, slot.state, slot.needs])).toEqual([
      ["tw0", "ready", 1],
      ["pb0", "locked", 2],
      ["pu0", "locked", 3],
    ]);
  });

  it("greys the smallest bomb when even that cannot be paid for", () => {
    const [twigs] = bombSlots(3, { r1: 9_999 });
    expect(twigs).toMatchObject({ id: "tw0", size: "Small", state: "poor" });
    expect(bombSlots(0, null).every((slot) => slot.state === "locked")).toBe(true);
  });
});

describe("championSlots", () => {
  it("lists healthy champions only: one ordinary one and Krallen beside it", () => {
    const slots = championSlots([
      champion(2, { hp: 0 }),
      champion(3, { status: 1 }),
      champion(1, { l: 4 }),
      champion(4),
      champion(5, { l: 2 }),
    ]);
    expect(slots.map((slot) => [slot.id, slot.level])).toEqual([
      ["G1", 4],
      ["G5", 2],
    ]);
  });
});

describe("attackWindowModel", () => {
  it("sorts the monsters C1, C2 … C12, then the Inferno's, and sums them", () => {
    const model = attackWindowModel(roster());
    expect(model.monsters.map((monster) => monster.id)).toEqual(["C1", "C2", "C12", "IC1"]);
    expect(model.monsters[0]).toMatchObject({ count: 12, level: 3 });
    expect(model.monsters[1]).toMatchObject({ level: null });
    expect(model.total).toBe(48);
  });

  it("offers the one siege weapon the attack will, the first in stock", () => {
    expect(attackWindowModel(roster()).siege).toEqual({ id: "vacuum", name: "Vacuum", level: 4 });
    expect(attackWindowModel(roster({ siege: null })).siege).toBeNull();
  });
});

describe("showsAttackWindow", () => {
  const cell = { col: 10, row: 12 };
  it("opens for a Map Room 2 yard, outpost or camp", () => {
    expect(showsAttackWindow({ cell, kind: "main" })).toBe(true);
    expect(showsAttackWindow({ cell, kind: "outpost" })).toBe(true);
    expect(showsAttackWindow({ cell, kind: "wild" })).toBe(true);
  });

  it("not for Map Room 1, the Inferno, or an attack with no map cell", () => {
    expect(showsAttackWindow({ cell, kind: "wild", mapversion: 1 })).toBe(false);
    expect(showsAttackWindow({ kind: "main", mapversion: 1 })).toBe(false);
    expect(showsAttackWindow({ cell, kind: "main", infernoPlayer: true })).toBe(false);
    expect(showsAttackWindow({ cell, kind: "main", descentYard: 1 })).toBe(false);
    expect(showsAttackWindow({ kind: "main" })).toBe(false);
  });
});

describe("confirmAttackWindow", () => {
  const open = (extra: Partial<AttackRoster> = {}): { host: HTMLElement; answer: Promise<boolean> } => {
    const host = document.createElement("div");
    document.body.append(host);
    const answer = confirmAttackWindow(host, { name: "Kozu", kind: "outpost", roster: roster(extra) });
    return { host, answer };
  };
  const button = (host: HTMLElement, label: string): HTMLButtonElement =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === label)!;

  it("is a game window: the skinned panel on a scrim, titled Attack, naming the target", () => {
    const { host } = open();
    const panel = host.querySelector(".popup-backdrop > .panel.attack-window");
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.querySelector(".panel__title")?.textContent).toBe(ATTACK_WINDOW_TEXT.title);
    expect(panel?.querySelector(".attack-window__name")?.textContent).toBe("Kozu");
    expect(panel?.querySelector(".attack-window__kind")?.textContent).toBe("Outpost");
    // No "Flung from" list (owner, 9 Nov).
    expect(panel?.textContent).not.toMatch(/flung/i);
  });

  it("shows the bombs, the siege weapon, the champion and each monster with its count", () => {
    const { host } = open();
    const bombs = [...host.querySelectorAll<HTMLElement>("[data-bomb]")];
    expect(bombs.map((tile) => [tile.dataset["bomb"], tile.dataset["state"]])).toEqual([
      ["tw1", "ready"],
      ["pb0", "ready"],
      ["pu0", "locked"],
    ]);
    expect(bombs[2]?.classList.contains("attack-window__tile--off")).toBe(true);
    expect(bombs[2]?.textContent).toBe("Lv 3");
    expect(bombs[2]?.title).toBe("Putty bombs: need a level 3 Catapult");

    const siege = host.querySelector<HTMLElement>("[data-siege]");
    expect(siege?.dataset["siege"]).toBe("vacuum");
    expect(siege?.querySelector("img")?.getAttribute("src")).toBe("/assets/siegebuttons/vacuum.png");
    expect(siege?.textContent).toBe("Lv 4");

    const champ = host.querySelector<HTMLElement>("[data-champion]");
    expect(champ?.dataset["champion"]).toBe("G1");
    expect(champ?.textContent).toBe("Lv 3");

    const monsters = [...host.querySelectorAll<HTMLElement>("[data-monster]")];
    expect(monsters.map((tile) => [tile.dataset["monster"], tile.textContent])).toEqual([
      ["C1", "×12"],
      ["C2", "×30"],
      ["C12", "×4"],
      ["IC1", "×2"],
    ]);
    expect(monsters[0]?.title).toMatch(/level 3\) ×12$/);
    // The chip counts the "×N" tiles, in their own sign; the tooltip names the champion too.
    expect(host.querySelector(".attack-window__total")?.textContent).toBe("×48");
    expect(host.querySelector<HTMLElement>(".attack-window__total")?.title).toBe("48 monsters, plus the champion");
  });

  it("draws the painted portraits in Modern and the Flash originals in Classic", () => {
    const modern = open();
    expect(modern.host.querySelector("[data-monster='C1'] img")?.getAttribute("src")).toMatch(/portraits\/C1-icon\.webp$/);
    // Modern: each painted portrait is the whole tile, one painted card.
    expect(modern.host.querySelector("[data-monster='C1']")?.classList.contains("attack-window__tile--painted")).toBe(true);
    // The champion is the same card: its painted cut-out on a painted-ground backdrop.
    const champ = modern.host.querySelector("[data-champion]");
    expect(champ?.querySelector("img")?.getAttribute("src")).toMatch(/portraits\/G1-L3-icon\.webp$/);
    expect(champ?.classList.contains("attack-window__tile--painted")).toBe(true);
    expect(champ?.classList.contains("attack-window__tile--cutout")).toBe(true);
    document.body.replaceChildren();
    setClassicLook(true);
    const classic = open();
    expect(classic.host.querySelector("[data-monster='C1'] img")?.getAttribute("src")).toBe("/assets/monsters/C1-small.png");
    expect(classic.host.querySelector("[data-monster='C1']")?.classList.contains("attack-window__tile--painted")).toBe(false);
    expect(classic.host.querySelector("[data-champion]")?.classList.contains("attack-window__tile--painted")).toBe(false);
  });

  it("puts Cancel and Attack under the body, so they stay in sight when it scrolls", () => {
    const { host } = open();
    const panel = host.querySelector(".attack-window")!;
    const actions = panel.querySelector(".attack-window__actions")!;
    expect(actions.parentElement).toBe(panel);
    expect(panel.querySelector(".panel__body")?.contains(actions)).toBe(false);
    expect([...actions.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Attack"]);
    expect(document.activeElement).toBe(button(host, "Attack"));
  });

  it("fades the body's edge where more is hidden, so it reads as scrolling", () => {
    const { host } = open();
    const body = host.querySelector<HTMLElement>(".attack-window > .panel__body")!;
    const at = (top: number): void => {
      Object.defineProperty(body, "scrollHeight", { configurable: true, value: 300 });
      Object.defineProperty(body, "clientHeight", { configurable: true, value: 100 });
      body.scrollTop = top;
      body.dispatchEvent(new Event("scroll"));
    };
    at(0);
    expect(body.classList.contains("attack-window__body--more-below")).toBe(true);
    expect(body.classList.contains("attack-window__body--more-above")).toBe(false);
    at(100);
    expect(body.classList.contains("attack-window__body--more-below")).toBe(true);
    expect(body.classList.contains("attack-window__body--more-above")).toBe(true);
    at(200);
    expect(body.classList.contains("attack-window__body--more-below")).toBe(false);
    expect(body.classList.contains("attack-window__body--more-above")).toBe(true);
  });

  it("resolves true on Attack and closes", async () => {
    const { host, answer } = open();
    button(host, ATTACK_WINDOW_TEXT.attack).click();
    expect(await answer).toBe(true);
    expect(host.querySelector(".attack-window")).toBeNull();
  });

  it("resolves false on Cancel, and on the close disc", async () => {
    const first = open();
    button(first.host, ATTACK_WINDOW_TEXT.cancel).click();
    expect(await first.answer).toBe(false);
    const second = open();
    second.host.querySelector<HTMLButtonElement>(".panel__titlebar > .btn[aria-label='Close']")!.click();
    expect(await second.answer).toBe(false);
  });

  it("names a wild camp as the map's cell panel does: \"Kozu camp\"", () => {
    const host = document.createElement("div");
    document.body.append(host);
    void confirmAttackWindow(host, { name: "Kozu", kind: "wild", roster: roster() });
    expect(host.querySelector(".attack-window__name")?.textContent).toBe("Kozu camp");
    expect(host.querySelector(".attack-window__kind")?.textContent).toBe("Wild monsters");
  });

  it("with only the champion in range shows no monster count", () => {
    const { host } = open({ monsters: {} });
    expect(host.querySelectorAll("[data-monster]")).toHaveLength(0);
    expect(host.querySelector("[data-champion]")).not.toBeNull();
    expect(host.querySelector(".attack-window__total")).toBeNull();
  });
});

describe("attack-window.css", () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../styles/attack-window.css"), "utf8");

  it("keeps the window inside the screen with the buttons centred and on one line", () => {
    expect(css).toMatch(/\.attack-window \{[^}]*max-height: calc\(100dvh/);
    expect(css).toMatch(/\.attack-window__actions > \.btn \{[^}]*justify-content: center;[^}]*text-align: center;[^}]*white-space: nowrap;/);
  });

  it("keeps the bomb tiles wide enough for \"Massive\" at every size, phones on their side included", () => {
    // 64 to 68 px each ("Massive" is 58 px plus the tile's 6), four to a line
    // whenever four fit at 64 px: Classic at 390 wide no longer drops "Lv 3"
    // alone onto a second line (tester, 9 Nov).
    expect(css).toMatch(
      /\.attack-window__grid\.attack-window__weapons \{\s*grid-template-columns: repeat\(auto-fill, minmax\(clamp\(64px, calc\(\(100% - 3 \* var\(--space-2\)\) \/ 4\), 68px\), 1fr\)\);/,
    );
    // The smaller phone-on-its-side columns are for the monsters only.
    expect(css).not.toMatch(/@media \(max-height: 480px\) \{\s*\.attack-window__grid \{/);
  });

  it("centres the Classic title on the ribbon's red band, in this window only", () => {
    expect(css).toMatch(/:root\[data-skin="flash"\] \.attack-window \.panel__title \{[^}]*padding-top: 3px;/);
  });

  it("fades the scrolling edges and keeps a gap under the name line", () => {
    expect(css).toMatch(/\.attack-window__body--more-below \{[^}]*mask-image: linear-gradient\(to bottom/);
    expect(css).toMatch(/\.attack-window__body--more-above \{[^}]*mask-image: linear-gradient\(to bottom/);
    expect(css).toMatch(/\.attack-window > \.panel__head \{[^}]*padding: var\(--space-2\) var\(--space-4\) var\(--space-2\);/);
  });

  it("lets a painted portrait fill its tile, the count on a dark strip over its foot", () => {
    expect(css).toMatch(/\.attack-window__tile--painted \{[^}]*position: relative;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.attack-window__tile--painted \.attack-window__art > img \{[^}]*position: absolute;[^}]*inset: 0;[^}]*object-fit: cover;/);
    expect(css).toMatch(/\.attack-window__tile--painted \.attack-window__caption \{[^}]*background: linear-gradient/);
  });

  it("stands a champion's cut-out on a painted-ground backdrop above the strip, in its orange rim", () => {
    expect(css).toMatch(/\.attack-window__tile--champion\.attack-window__tile--painted \{[^}]*background:[^}]*linear-gradient/);
    expect(css).toMatch(/\.attack-window__tile--cutout \.attack-window__art > img \{[^}]*object-fit: contain;/);
    expect(css).toMatch(/\.attack-window__tile--champion \{[^}]*border: 2px solid var\(--colour-accent-line\);/);
  });

  it("puts the weapons beside the monsters on a phone on its side, so the monsters show unscrolled", () => {
    const sideways = css.slice(css.indexOf("@media (max-height: 480px) and (min-width: 600px)"));
    expect(sideways).toMatch(/\.attack-window > \.panel__body \{[^}]*flex-direction: row;/);
    expect(sideways).toMatch(/\.attack-window__grid\.attack-window__weapons \{[^}]*grid-auto-columns: 68px;[^}]*grid-auto-flow: column;/);
    // Wider than the base panel's 560 px cap, so the two sit side by side.
    expect(sideways).toMatch(/\.attack-window \{[^}]*width: min\(92vw, 720px\);[^}]*max-width: none;/);
  });

  it("centres the window under the top bar, so its title sign never covers the resources", () => {
    expect(css).toMatch(/\.popup-backdrop:has\(> \.attack-window\) \{[^}]*padding-top: calc\(var\(--hud-height\)/);
    expect(css).toMatch(/\.attack-window \{[^}]*max-height: calc\(100dvh - var\(--hud-height\)/);
  });

  it("sets no frame, title or button art of its own: the skin draws those", () => {
    expect(css).not.toMatch(/border-image|--skin-(frame|button|title)\s*:/);
  });
});
