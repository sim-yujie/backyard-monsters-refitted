// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { MapCell, PlayerCell, WildMonsterCell } from "@/api/types";
import { setDevDetails } from "@/app/devDetails";
import { CellPanel, type CellPanelOptions } from "./CellPanel";

/**
 * The slim cell panel (issue #174): a picture, a name and level, what and
 * where, chips only for what is true, and the actions; the rest behind "More
 * about this yard", and the old debugging rows gone.
 */

const camp = (overrides: Partial<WildMonsterCell> = {}): WildMonsterCell => ({
  uid: 0,
  b: 1,
  i: 150,
  bid: "2000241208",
  n: "Kozu",
  l: 38,
  dm: 0,
  d: 0,
  ...overrides,
});

const player = (overrides: Partial<PlayerCell> = {}): PlayerCell => ({
  uid: 77,
  b: 2,
  i: 150,
  bid: "3510",
  aid: null,
  n: "Bramblefoot",
  l: 24,
  v: 123_456,
  f: 3,
  c: 2,
  dm: 0,
  d: 0,
  lo: 0,
  p: 0,
  mine: 0,
  pic_square: "/avatars/bee.webp",
  pi: 0,
  fr: 0,
  ...overrides,
});

const open = (
  payload: MapCell | undefined,
  overrides: Partial<CellPanelOptions> = {},
  cell = { col: 241, row: 208 },
) => {
  const options: CellPanelOptions = {
    onClose: vi.fn(),
    onBookmark: vi.fn(),
    canBookmark: () => true,
    onViewYard: vi.fn(),
    attackRefusal: () => null,
    onAttack: vi.fn(),
    reach: () => ({ text: "In range · next to your yard", inRange: true }),
    ownFlinger: () => ({ level: 4, reach: 10, bonus: 0 }),
    onRangeToggle: vi.fn(),
    ...overrides,
  };
  const host = document.createElement("div");
  const panel = new CellPanel(options).mount(host);
  panel.show(cell, payload);
  return { panel, host, options };
};

const text = (host: HTMLElement, selector: string): string =>
  host.querySelector(selector)?.textContent ?? "";

const shown = (host: HTMLElement, selector: string): HTMLElement[] =>
  [...host.querySelectorAll<HTMLElement>(selector)].filter((node) => !node.closest("[hidden]"));

const buttonNamed = (host: HTMLElement, name: string): HTMLButtonElement | undefined =>
  shown(host, "button").find((node) => node.textContent?.trim() === name) as
    | HTMLButtonElement
    | undefined;

describe("a wild monster camp", () => {
  it("shows its tribe picture, name, level and where, with the range chip", () => {
    const { host } = open(camp());
    expect(text(host, ".mr2-cell__title")).toBe("Kozu camp");
    expect(text(host, ".mr2-cell__level")).toBe("Level 38");
    expect(text(host, ".mr2-cell__subtitle")).toBe("Wild monsters · 241, 208");
    expect(host.querySelector<HTMLImageElement>(".mr2-cell__picture img")?.src).toContain(
      "tribes/kozu-256.png",
    );
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toEqual([
      "In range · next to your yard",
    ]);
    expect(buttonNamed(host, "Attack")?.disabled).toBe(false);
    expect(buttonNamed(host, "Look inside")).toBeDefined();
    expect(shown(host, "[aria-label='Bookmark']")).toHaveLength(1);
  });

  it("drops the old debugging rows", () => {
    const { host } = open(camp({ dm: 0 }));
    const all = host.textContent ?? "";
    for (const gone of ["Axial", "Terrain height", "Base id", "Coordinates", "Damage0%", "None"]) {
      expect(all).not.toContain(gone);
    }
    expect(shown(host, ".mr2-cell__more")).toHaveLength(0);
  });

  it("says out of range as a warning chip, and a destroyed camp as a chip", () => {
    const { host } = open(camp({ d: 1, dm: 100 }), {
      reach: () => ({ text: "Out of range · 2 cells too far", inRange: false }),
      attackRefusal: () => "None of your flingers can reach this cell.",
    });
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toEqual([
      "Out of range · 2 cells too far",
      "Destroyed",
    ]);
    expect(shown(host, ".mr2-chip--warning")).toHaveLength(1);
    expect(buttonNamed(host, "Attack")?.disabled).toBe(true);
    // The chip already says why; the refusal is not repeated under the button.
    expect(shown(host, ".mr2-cell__note")).toHaveLength(0);
  });

  it("says any other refusal once, under the button", () => {
    const { host } = open(camp(), { attackRefusal: () => "You have no monsters in range." });
    expect(shown(host, ".mr2-cell__note").map((node) => node.textContent)).toEqual([
      "You have no monsters in range.",
    ]);
  });
});

describe("another player's yard", () => {
  it("shows their critter picture (#175), name and level, and only the chips that are true", () => {
    const { host } = open(player({ dm: 35, p: 1, lo: 9 }));
    expect(text(host, ".mr2-cell__title")).toBe("Bramblefoot");
    expect(text(host, ".mr2-cell__subtitle")).toBe("Main yard · 241, 208");
    expect(host.querySelector<HTMLImageElement>(".mr2-cell__picture img")?.src).toContain(
      "avatars/bee.webp",
    );
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toEqual([
      "In range · next to your yard",
      "Damaged 35%",
      "Protected",
      "Busy",
    ]);
    expect(buttonNamed(host, "View yard")).toBeDefined();
  });

  it("keeps empire value, alliance, Flinger and Catapult behind More about this yard", () => {
    const { host } = open(player({ aid: 12 }));
    const more = host.querySelector<HTMLDetailsElement>(".mr2-cell__more")!;
    expect(more.hidden).toBe(false);
    expect(more.open).toBe(false);
    expect([...more.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
      "Empire value",
      "Alliance",
      "Flinger",
      "Catapult",
    ]);
    expect(host.textContent).not.toContain("user 77");
    expect(host.textContent).not.toContain("/avatars/");
  });

  it("shows a player no alliance id, which names nothing (#150)", () => {
    setDevDetails(false);
    try {
      const { host } = open(player({ aid: 12 }));
      const more = host.querySelector<HTMLDetailsElement>(".mr2-cell__more")!;
      expect([...more.querySelectorAll("dt")].map((node) => node.textContent)).toEqual([
        "Empire value",
        "Flinger",
        "Catapult",
      ]);
      expect(host.textContent).not.toContain("#12");
    } finally {
      setDevDetails(null);
    }
  });

  it("counts protection down when the server says when it ends (#187)", () => {
    const now = Date.now() / 1000;
    const { host, panel } = open(player({ p: 1, pe: now + 7_300 }));
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Protected 2h 1m");
    panel.tick(now + 7_290);
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Protected 10s");
  });

  it("counts a truce down", () => {
    const now = Date.now() / 1000;
    const { host, panel } = open(player({ t: now + 3_700 }));
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Truce 1h 1m");
    panel.tick(now + 3_590);
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain("Truce 1m 50s");
  });
});

describe("the ground an outpost stands on", () => {
  it("says the tower range and income bonus of a hill on an outpost, and the height behind More", () => {
    const { host } = open(player({ b: 3, i: 150 }));
    expect(shown(host, ".mr2-chip").map((chip) => chip.textContent)).toContain(
      "High ground: tower range +20%, income −17%",
    );
    expect(host.textContent).toContain("50 m");
  });

  it("says nothing of the ground on a main yard", () => {
    const { host } = open(player({ b: 2, i: 150 }));
    expect(host.textContent).not.toContain("High ground");
  });
});

describe("another player's achievements (#204)", () => {
  const line = () =>
    vi.fn((payload: PlayerCell) => {
      const node = document.createElement("button");
      node.className = "ach-line";
      node.textContent = `Achievements of ${payload.n}`;
      return node;
    });

  const expand = (host: HTMLElement): void => {
    const more = host.querySelector<HTMLDetailsElement>(".mr2-cell__more")!;
    more.open = true;
    more.dispatchEvent(new Event("toggle"));
  };

  it("makes the line only once More about this yard is open, under the facts", () => {
    const achievementsLine = line();
    const { host } = open(player(), { achievementsLine });
    expect(achievementsLine).not.toHaveBeenCalled();
    expand(host);
    expect(achievementsLine).toHaveBeenCalledTimes(1);
    expect(achievementsLine.mock.calls[0]![0].uid).toBe(77);
    const slot = host.querySelector(".mr2-cell__more .mr2-cell__achievements")!;
    expect(slot.previousElementSibling?.matches("dl")).toBe(true);
    expect(text(host, ".ach-line")).toBe("Achievements of Bramblefoot");
  });

  it("keeps the same player's line through a refresh, and makes a new one for the next", () => {
    const achievementsLine = line();
    const { host, panel } = open(player(), { achievementsLine });
    expand(host);
    const first = host.querySelector(".ach-line");
    panel.update(player({ dm: 20 }));
    expect(host.querySelector(".ach-line")).toBe(first);
    expect(achievementsLine).toHaveBeenCalledTimes(1);
    // Another cell closes the section; its line waits for it to open again.
    panel.show({ col: 1, row: 2 }, player({ uid: 88, n: "Thornback" }));
    expect(achievementsLine).toHaveBeenCalledTimes(1);
    expand(host);
    expect(text(host, ".ach-line")).toBe("Achievements of Thornback");
  });

  it("shows none on the player's own yard, a camp, or without the option", () => {
    const achievementsLine = line();
    const own = open(player({ mine: 1 }), { achievementsLine });
    expand(own.host);
    expect(own.host.querySelector(".ach-line")).toBeNull();
    const wild = open(camp(), { achievementsLine });
    expect(wild.host.querySelector(".ach-line")).toBeNull();
    expect(achievementsLine).not.toHaveBeenCalled();
    const plain = open(player());
    expand(plain.host);
    expect(plain.host.querySelector(".ach-line")).toBeNull();
  });

  it("drops the line when the shown cell stops being another player's", () => {
    const achievementsLine = line();
    const { host, panel } = open(player(), { achievementsLine });
    expand(host);
    panel.show({ col: 3, row: 4 }, camp());
    expect(host.querySelector(".ach-line")).toBeNull();
  });
});

describe("the player's own yards", () => {
  it("shows how far the Flinger reaches, the range switch and Open yard", () => {
    const { host, options, panel } = open(player({ mine: 1, n: "agenttester", l: 12 }), {
      ownFlinger: () => ({ level: 4, reach: 12, bonus: 2 }),
    });
    expect(text(host, ".mr2-cell__title")).toBe("Your yard");
    expect(text(host, ".mr2-cell__flinger-title")).toBe("Your Flinger reaches 12 cells");
    expect(text(host, ".mr2-cell__flinger-detail")).toBe(
      "Flinger level 4 (10) + 2 Declare War bonus",
    );
    expect(buttonNamed(host, "Attack")).toBeUndefined();
    expect(shown(host, ".mr2-chip")).toHaveLength(0);
    const openYard = buttonNamed(host, "Open yard")!;
    openYard.click();
    expect(options.onViewYard).toHaveBeenCalledTimes(1);

    const toggle = host.querySelector<HTMLButtonElement>("[role='switch']")!;
    panel.setRangeOn(false);
    toggle.click();
    expect(options.onRangeToggle).toHaveBeenCalledWith(true);
    expect(toggle.getAttribute("aria-checked")).toBe("true");
  });

  it("opens an own outpost as one (#146)", () => {
    const { host } = open(player({ mine: 1, b: 3 }));
    expect(text(host, ".mr2-cell__title")).toBe("Your outpost");
    expect(text(host, ".mr2-cell__subtitle")).toBe("Outpost · 241, 208");
    const openOutpost = buttonNamed(host, "Open outpost")!;
    expect(openOutpost.title).toBe("Open your outpost");
  });
});

describe("water and loading", () => {
  it("offers only a bookmark on water", () => {
    const { host, options } = open({ i: 60 } as MapCell);
    expect(text(host, ".mr2-cell__title")).toBe("Water");
    expect(buttonNamed(host, "Attack")).toBeUndefined();
    shown(host, "[aria-label='Bookmark']")[0]!.click();
    expect(options.onBookmark).toHaveBeenCalledWith({ col: 241, row: 208 });
  });

  it("waits for the zone", () => {
    const { host } = open(undefined);
    expect(text(host, ".mr2-cell__title")).toBe("Loading…");
    expect(shown(host, "button").map((node) => node.getAttribute("aria-label"))).toEqual(["Close"]);
  });
});

it("closes on its button, once", () => {
  const { host, options } = open(camp());
  host.querySelector<HTMLButtonElement>("[aria-label='Close']")!.click();
  expect(options.onClose).toHaveBeenCalledTimes(1);
  expect(host.children).toHaveLength(0);
});

it("hosts Take over under Attack, with its line under the actions (#82)", () => {
  const action = {
    button: Object.assign(document.createElement("button"), { textContent: "Take over" }),
    detail: document.createElement("p"),
    setCell: vi.fn(),
    tick: vi.fn(),
  };
  const { host } = open(camp({ d: 1, dm: 100 }), { extraAction: action });
  const actions = host.querySelector(".mr2-cell__actions")!;
  expect([...actions.children].indexOf(action.button)).toBeGreaterThan(0);
  expect(action.setCell).toHaveBeenCalledWith({ col: 241, row: 208 }, camp({ d: 1, dm: 100 }));
  expect(action.detail.parentElement).toBe(host.firstElementChild);
});

describe("moving between the player's yards (#186)", () => {
  it("shows neither move without outposts", () => {
    const { host } = open(player({ mine: 1 }), {
      ownMoves: () => ({ monsters: false, relocate: false }),
    });
    expect(buttonNamed(host, "Move monsters")).toBeUndefined();
    expect(buttonNamed(host, "Move main yard here")).toBeUndefined();
  });

  it("offers Move monsters on the main yard once there is an outpost", () => {
    const onMoveMonsters = vi.fn();
    const payload = player({ mine: 1 });
    const { host } = open(payload, {
      ownMoves: () => ({ monsters: true, relocate: false }),
      onMoveMonsters,
    });
    buttonNamed(host, "Move monsters")!.click();
    expect(onMoveMonsters).toHaveBeenCalledWith({ col: 241, row: 208 }, payload);
    expect(buttonNamed(host, "Move main yard here")).toBeUndefined();
  });

  it("offers both on an own outpost", () => {
    const onRelocate = vi.fn();
    const payload = player({ mine: 1, b: 3 });
    const { host } = open(payload, {
      ownMoves: () => ({ monsters: true, relocate: true }),
      onRelocate,
    });
    expect(buttonNamed(host, "Move monsters")).toBeDefined();
    buttonNamed(host, "Move main yard here")!.click();
    expect(onRelocate).toHaveBeenCalledWith({ col: 241, row: 208 }, payload);
  });

  it("never offers them on someone else's yard or a camp", () => {
    const ownMoves = () => ({ monsters: true, relocate: true });
    for (const payload of [player(), camp()]) {
      const { host } = open(payload, { ownMoves });
      expect(buttonNamed(host, "Move monsters")).toBeUndefined();
      expect(buttonNamed(host, "Move main yard here")).toBeUndefined();
    }
  });
});

describe("Message (#193)", () => {
  const message = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".mr2-cell__message")!;

  it("offers another player's yard a Message that names them", () => {
    const onMessage = vi.fn();
    const { host } = open(player(), { onMessage });
    expect(message(host).hidden).toBe(false);
    message(host).click();
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ uid: 77, n: "Bramblefoot" }));
  });

  it("offers none on the player's own yard, a camp, or without a way to write", () => {
    expect(message(open(player({ mine: 1 }), { onMessage: vi.fn() }).host).hidden).toBe(true);
    expect(message(open(camp(), { onMessage: vi.fn() }).host).hidden).toBe(true);
    expect(message(open(player()).host).hidden).toBe(true);
  });
});

describe("Truce (#203)", () => {
  const truce = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".mr2-cell__truce")!;

  it("offers another player's yard a Truce that names them", () => {
    const onTruce = vi.fn();
    const { host } = open(player(), { onTruce });
    expect(truce(host).hidden).toBe(false);
    truce(host).click();
    expect(onTruce).toHaveBeenCalledWith(expect.objectContaining({ uid: 77, n: "Bramblefoot" }));
  });

  it("offers none while a truce with them runs, and says so instead", () => {
    const { host } = open(player({ t: Math.floor(Date.now() / 1000) + 3_600 }), { onTruce: vi.fn() });
    expect(truce(host).hidden).toBe(true);
    expect(host.querySelector(".mr2-cell__chips")?.textContent).toContain("Truce");
  });

  it("offers one again once the truce has run out", () => {
    const { host } = open(player({ t: Math.floor(Date.now() / 1000) - 60 }), { onTruce: vi.fn() });
    expect(truce(host).hidden).toBe(false);
  });

  it("offers none on the player's own yard, a camp, or without a way to propose", () => {
    expect(truce(open(player({ mine: 1 }), { onTruce: vi.fn() }).host).hidden).toBe(true);
    expect(truce(open(camp(), { onTruce: vi.fn() }).host).hidden).toBe(true);
    expect(truce(open(player()).host).hidden).toBe(true);
  });
});

describe("Invitations to move (#205)", () => {
  const invite = (host: HTMLElement) => host.querySelector<HTMLButtonElement>(".mr2-cell__invite")!;
  const inviteRow = (host: HTMLElement) =>
    host.querySelector<HTMLElement>(".mr2-cell__invite-other")!.closest<HTMLElement>(".mr2-cell__row")!;
  const ownOutpost = (overrides: Partial<PlayerCell> = {}) => player({ mine: 1, b: 3, bid: "2000241208", ...overrides });

  it("offers the player's own outpost Invite to move here", () => {
    const onInvite = vi.fn();
    const { host } = open(ownOutpost(), { onInvite, onWithdrawInvite: vi.fn() });
    expect(invite(host).hidden).toBe(false);
    expect(invite(host).textContent).toBe("Invite to move here");
    invite(host).click();
    expect(onInvite).toHaveBeenCalledWith({ col: 241, row: 208 }, expect.objectContaining({ bid: "2000241208" }));
  });

  it("with an invitation waiting: a chip, and the button withdraws it", () => {
    const onInvite = vi.fn();
    const onWithdrawInvite = vi.fn();
    const { host } = open(ownOutpost({ pi: 41 }), { onInvite, onWithdrawInvite });
    expect(host.querySelector(".mr2-cell__chips")?.textContent).toContain("Invite pending");
    expect(invite(host).textContent).toBe("Withdraw invite");
    invite(host).click();
    expect(onWithdrawInvite).toHaveBeenCalledWith({ col: 241, row: 208 }, expect.objectContaining({ pi: 41 }));
    expect(onInvite).not.toHaveBeenCalled();
  });

  it("offers none on the player's main yard, or without a way to invite", () => {
    expect(invite(open(player({ mine: 1 }), { onInvite: vi.fn() }).host).hidden).toBe(true);
    expect(invite(open(ownOutpost()).host).hidden).toBe(true);
  });

  it("offers another player's yard Invite to my outpost, when the scene says the player may", () => {
    const onInviteToOutpost = vi.fn();
    const { host } = open(player(), { onInviteToOutpost, canInviteToOutpost: () => true });
    expect(inviteRow(host).hidden).toBe(false);
    host.querySelector<HTMLButtonElement>(".mr2-cell__invite-other")!.click();
    expect(onInviteToOutpost).toHaveBeenCalledWith(expect.objectContaining({ uid: 77 }));

    expect(inviteRow(open(player(), { onInviteToOutpost, canInviteToOutpost: () => false }).host).hidden).toBe(true);
    expect(inviteRow(open(camp(), { onInviteToOutpost }).host).hidden).toBe(true);
    expect(inviteRow(open(ownOutpost(), { onInviteToOutpost }).host).hidden).toBe(true);
    expect(inviteRow(open(player()).host).hidden).toBe(true);
  });
});
