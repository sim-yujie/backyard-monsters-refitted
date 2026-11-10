// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AllianceApi, AllianceInviteRow, AllianceListing, AllianceMember, MyAlliance } from "@/api/alliance";
import { ALLIANCE_TEXT, AllianceWindow, type AllianceWindowOptions } from "./AllianceWindow";

/** The alliance window (beta 7 phase 1) against a stand-in for the routes. */

const ok = <T extends object>(value: T) => Promise.resolve({ ok: true as const, ...value });

const listing = (id: number, extra: Partial<AllianceListing> = {}): AllianceListing => ({
  alliance_id: id,
  name: `Alliance ${id}`,
  image: id,
  members: 3,
  member_limit: 15,
  active_members: 2,
  leader_name: "Lead",
  type: "midas",
  ...extra,
});

const mine = (extra: Partial<MyAlliance> = {}): MyAlliance => ({
  alliance_id: 7,
  name: "Goo Lords",
  image: 4,
  description: "We farm goo.",
  leader_name: "Me",
  number_of_members: 3,
  online_members: 1,
  type: "conquest",
  member_limit: 30,
  officer_limit: 4,
  points: 120,
  points_spent: 0,
  type_options: [],
  role: "leader",
  permissions: ["setRank", "handOver", "kickMember", "kickOfficer", "invite", "editAd", "rename", "switchType", "answerRequest"],
  must_rename: false,
  rename_available_at: null,
  can_take_over: false,
  ...extra,
});

const member = (id: number, role: AllianceMember["role"], extra: Partial<AllianceMember> = {}): AllianceMember => ({
  user_id: id,
  display_name: `Player ${id}`,
  pic_square: null,
  level: 20,
  points: 0,
  online: false,
  role,
  ...extra,
});

const invite = (id: number, extra: Partial<AllianceInviteRow> = {}): AllianceInviteRow => ({
  invite_id: id,
  type: "invite",
  status: "pending",
  alliance_name: "Fortress Folk",
  alliance_image: 9,
  leader_name: "Boss",
  invited_by_name: "Officer Olly",
  user_id: 1,
  user_name: "Me",
  user_pic_square: null,
  ...extra,
});

const fakeApi = (overrides: Partial<AllianceApi> = {}): AllianceApi => ({
  mine: vi.fn(() => ok({ alliance: null, rejoinAt: null })),
  members: vi.fn(() => ok({ members: [] as AllianceMember[] })),
  search: vi.fn(() => ok({ alliances: [] as AllianceListing[], pageSize: 10, totalResults: 0 })),
  create: vi.fn(() => ok({ alliance: null })),
  edit: vi.fn(() => ok({})),
  changeType: vi.fn(() => ok({})),
  rename: vi.fn((name: string) => ok({ name })),
  takeOver: vi.fn(() => ok({})),
  report: vi.fn(() => ok({})),
  leave: vi.fn(() => ok({})),
  requestJoin: vi.fn(() => ok({})),
  invite: vi.fn(() => ok({ inviteId: 1 })),
  answerInvite: vi.fn(() => ok({})),
  kick: vi.fn(() => ok({})),
  handOver: vi.fn(() => ok({})),
  setRank: vi.fn(() => ok({})),
  messages: vi.fn(() => ok({ messages: [] as AllianceInviteRow[] })),
  suggested: vi.fn(() => ok({ members: [] as AllianceMember[] })),
  ...overrides,
});

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

const open = async (api: AllianceApi, options: AllianceWindowOptions = {}): Promise<AllianceWindow> => {
  const view = new AllianceWindow({ api, myId: () => 1, now: () => 1_000_000, players: { search: vi.fn(() => Promise.resolve([])) }, ...options });
  view.mount(document.body);
  await flush();
  return view;
};

const buttonNamed = (words: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === words);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AllianceWindow: marketplace", () => {
  it("says the world has none yet and offers Create", async () => {
    const view = await open(fakeApi());
    expect(view.kind).toBe("market");
    expect(document.body.textContent).toContain(ALLIANCE_TEXT.empty);
    expect(document.querySelector(".alliance__first-create")).not.toBeNull();
  });

  it("lists the world's alliances with their type and members", async () => {
    const api = fakeApi({
      search: vi.fn(() => ok({ alliances: [listing(1), listing(2, { type: "fortress", member_limit: 60 })], pageSize: 10, totalResults: 2 })),
    });
    await open(api);
    const rows = document.querySelectorAll(".alliance__item");
    expect(rows).toHaveLength(2);
    expect(rows[1]!.querySelector(".alliance__type")!.textContent).toBe("Fortress Legion");
    expect(rows[1]!.querySelector(".alliance__members-count")!.textContent).toBe("3/60");
  });

  it("the green number is members online now, not the member count or the week's active", async () => {
    const api = fakeApi({
      search: vi.fn(() =>
        ok({ alliances: [listing(1, { members: 9, active_members: 7, online_members: 4 }), listing(2, { members: 5, active_members: 3 })], pageSize: 10, totalResults: 2 }),
      ),
    });
    await open(api);
    const green = [...document.querySelectorAll(".alliance__item .alliance__active")];
    expect(green.map((node) => node.textContent)).toEqual(["4", "0"]);
    expect(green[0]!.getAttribute("aria-label")).toBe(ALLIANCE_TEXT.online(4));
    expect(green[0]!.querySelector(".alliance__active-dot")).not.toBeNull();
  });

  it("Quick Join: four chips, each type's icon and member limit kept together", async () => {
    await open(fakeApi({ search: vi.fn(() => ok({ alliances: [listing(1)], pageSize: 10, totalResults: 1 })) }));
    const chips = [...document.querySelectorAll(".alliance__quick-types > .alliance__chip")];
    expect(chips).toHaveLength(4);
    for (const chip of chips.slice(0, 3)) {
      const size = chip.querySelector(".alliance__chip-size")!;
      expect(size.querySelector("svg, img, .game-icon, [class*='icon']")).not.toBeNull();
      expect(size.querySelector(".alliance__chip-count")).not.toBeNull();
    }
    expect(chips.map((chip) => chip.querySelector(".alliance__chip-count")?.textContent ?? null)).toEqual(["15", "30", "60", null]);
  });

  it("asks to join from an opened row, then marks it Asked", async () => {
    const api = fakeApi({ search: vi.fn(() => ok({ alliances: [listing(5)], pageSize: 10, totalResults: 1 })) });
    await open(api);
    document.querySelector<HTMLButtonElement>(".alliance__row")!.click();
    buttonNamed(ALLIANCE_TEXT.ask)!.click();
    await flush();
    expect(api.requestJoin).toHaveBeenCalledWith(5);
    expect(buttonNamed(ALLIANCE_TEXT.asked)!.disabled).toBe(true);
  });

  it("Quick Join asks the first alliance of the chosen type with room", async () => {
    const api = fakeApi({
      search: vi.fn(() =>
        ok({
          alliances: [listing(1, { members: 15 }), listing(2, { type: "conquest", member_limit: 30 }), listing(3)],
          pageSize: 10,
          totalResults: 3,
        }),
      ),
    });
    await open(api);
    const midas = [...document.querySelectorAll<HTMLButtonElement>(".alliance__chip")].find((chip) => chip.textContent?.startsWith("Midas"))!;
    midas.click();
    document.querySelector<HTMLButtonElement>(".alliance__quick-join")!.click();
    await flush();
    expect(api.requestJoin).toHaveBeenCalledWith(3);
  });

  it("shows a join-gate refusal with the next step", async () => {
    const api = fakeApi({
      search: vi.fn(() => Promise.resolve({ ok: false as const, reason: "noObservatory", message: "Build an Observatory first.", availableAt: null })),
    });
    const onBuildObservatory = vi.fn();
    await open(api, { onBuildObservatory });
    expect(document.querySelector(".alliance__status")!.textContent).toContain("Build an Observatory first.");
    document.querySelector<HTMLButtonElement>(".alliance__step")!.click();
    expect(onBuildObservatory).toHaveBeenCalled();
  });

  it("accepts an invite waiting and opens My alliance", async () => {
    let joined = false;
    const api = fakeApi({
      mine: vi.fn(() => ok({ alliance: joined ? mine({ role: "member", permissions: [] }) : null, rejoinAt: null })),
      messages: vi.fn(() => ok({ messages: joined ? [] : [invite(44)] })),
      answerInvite: vi.fn(() => {
        joined = true;
        return ok({});
      }),
    });
    const onChanged = vi.fn();
    const view = await open(api, { onChanged });
    expect(document.querySelector(".alliance__invites")!.textContent).toContain("Fortress Folk");
    // Accept / Decline in a group of their own after the shield and words (a phone puts it on its own line).
    const row = document.querySelector(".alliance__invites .alliance__invite--answer")!;
    expect([...row.children].map((child) => child.className.split(" ")[0])).toEqual(["alliance__shield", "alliance__invite-words", "alliance__invite-answer"]);
    expect([...row.querySelectorAll(".alliance__invite-answer > button")].map((node) => node.textContent)).toEqual([ALLIANCE_TEXT.accept, ALLIANCE_TEXT.decline]);
    buttonNamed(ALLIANCE_TEXT.accept)!.click();
    await flush();
    await flush();
    expect(api.answerInvite).toHaveBeenCalledWith(44, true);
    expect(onChanged).toHaveBeenCalled();
    expect(view.kind).toBe("mine");
  });
});

describe("AllianceWindow: create", () => {
  it("shows three type cards led by their member limits, and founds with the chosen type", async () => {
    let founded = false;
    const api = fakeApi({
      mine: vi.fn(() => ok({ alliance: founded ? mine() : null, rejoinAt: null })),
      create: vi.fn(() => {
        founded = true;
        return ok({ alliance: mine() });
      }),
    });
    const view = await open(api);
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    expect(view.kind).toBe("create");
    const cards = [...document.querySelectorAll<HTMLButtonElement>(".alliance__type-card")];
    expect(cards.map((card) => card.querySelector(".alliance__type-size")!.textContent)).toEqual([
      "Up to 15 members",
      "Up to 30 members",
      "Up to 60 members",
    ]);
    const name = document.querySelector<HTMLInputElement>(".alliance__form input")!;
    name.value = "Goo Lords";
    name.dispatchEvent(new Event("input"));
    const about = document.querySelector<HTMLTextAreaElement>(".alliance__form textarea")!;
    about.value = "We farm goo.";
    about.dispatchEvent(new Event("input"));
    cards[2]!.click();
    expect(cards[2]!.getAttribute("aria-checked")).toBe("true");
    expect(cards[0]!.getAttribute("aria-checked")).toBe("false");
    document.querySelector<HTMLButtonElement>(".alliance__submit")!.click();
    await flush();
    await flush();
    expect(api.create).toHaveBeenCalledWith({ name: "Goo Lords", image: 1, description: "We farm goo.", type: "fortress" });
    expect(view.kind).toBe("mine");
  });

  it("does not send a name that is too short", async () => {
    const api = fakeApi();
    await open(api);
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    document.querySelector<HTMLButtonElement>(".alliance__submit")!.click();
    await flush();
    expect(api.create).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>(".alliance__status")!.hidden).toBe(false);
  });
});

describe("AllianceWindow: my alliance", () => {
  it("opens on Overview with the tiles and the Leader's buttons", async () => {
    const view = await open(fakeApi({ mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })) }));
    expect(view.kind).toBe("mine");
    expect(document.querySelectorAll(".alliance__tile")).toHaveLength(3);
    expect(document.querySelector(".alliance__description")!.textContent).toBe("We farm goo.");
    expect(buttonNamed(ALLIANCE_TEXT.rename)).toBeDefined();
    expect(buttonNamed(ALLIANCE_TEXT.changeType)).toBeDefined();
    const tabs = [...document.querySelectorAll(".alliance__tab")].map((tab) => tab.textContent);
    expect(tabs).toEqual([ALLIANCE_TEXT.overview, ALLIANCE_TEXT.members]);
  });

  it("lists members Leader first, and gives the Leader rank buttons with a confirm", async () => {
    const api = fakeApi({
      mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })),
      members: vi.fn(() => ok({ members: [member(3, "member", { online: true }), member(1, "leader"), member(2, "officer")] })),
    });
    const view = await open(api);
    view.showTab("members");
    await flush();
    const names = [...document.querySelectorAll(".alliance__row-name")].map((node) => node.textContent);
    expect(names).toEqual(["Player 1", "Player 2", "Player 3"]);
    // The viewer's own row has no buttons.
    expect(document.querySelector<HTMLButtonElement>("[data-userid='1'] .alliance__row")!.disabled).toBe(true);
    // Only the online member wears the dot.
    expect(document.querySelectorAll(".alliance__online.online-dot")).toHaveLength(1);

    document.querySelector<HTMLButtonElement>("[data-userid='3'] .alliance__row")!.click();
    buttonNamed(ALLIANCE_TEXT.action.promote)!.click();
    expect(document.body.textContent).toContain(ALLIANCE_TEXT.confirm.promote("Player 3"));
    buttonNamed(ALLIANCE_TEXT.yes)!.click();
    await flush();
    expect(api.setRank).toHaveBeenCalledWith(3, "officer");
  });

  it("lets a Member leave, after a confirm", async () => {
    let left = false;
    const api = fakeApi({
      mine: vi.fn(() => ok({ alliance: left ? null : mine({ role: "member", permissions: [] }), rejoinAt: left ? 1_086_400 : null })),
      leave: vi.fn(() => {
        left = true;
        return ok({});
      }),
    });
    const view = await open(api);
    buttonNamed(ALLIANCE_TEXT.leave)!.click();
    expect(document.body.textContent).toContain(ALLIANCE_TEXT.leaveConfirm);
    buttonNamed(ALLIANCE_TEXT.yes)!.click();
    await flush();
    await flush();
    expect(api.leave).toHaveBeenCalled();
    expect(view.kind).toBe("market");
    expect(document.querySelector(".alliance__note--wait")).not.toBeNull();
  });

  it("keeps the Leader of a full alliance from leaving", async () => {
    await open(fakeApi({ mine: vi.fn(() => ok({ alliance: mine({ number_of_members: 5 }), rejoinAt: null })) }));
    expect(buttonNamed(ALLIANCE_TEXT.leave)).toBeUndefined();
  });
});

describe("AllianceWindow: the Alliance chat room", () => {
  it("opens the room for the player's alliance, with its name and shield", async () => {
    const chat = { setAllianceRoom: vi.fn() };
    await open(fakeApi({ mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })) }), { chat });
    expect(chat.setAllianceRoom).toHaveBeenCalledWith({ id: 7, name: "Goo Lords", image: 4 });
  });

  it("closes it when the player is in no alliance", async () => {
    const chat = { setAllianceRoom: vi.fn() };
    await open(fakeApi(), { chat });
    expect(chat.setAllianceRoom).toHaveBeenCalledWith(null);
  });
});
