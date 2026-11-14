// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AllianceApi, AllianceInviteRow, AllianceListing, AllianceMember, MyAlliance } from "@/api/alliance";
import type { AllianceProgressApi, ConstellationView } from "@/api/allianceProgress";
import { setClassicLook } from "@/game/classicLook";
import { inAlliance, resetAllianceButton, setInAlliance } from "@/game/alliance/allianceButton";
import { allianceTradeOn, setAllianceTradeOn, TRADE_OFF_TITLE } from "@/game/alliance/tradeSwitch";
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
  requestJoin: vi.fn(() => ok({ joined: false })),
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

const fakeProgress = (overrides: Partial<AllianceProgressApi> = {}): AllianceProgressApi => ({
  lightStar: vi.fn(() => ok({})),
  suggestStar: vi.fn(() => ok({})),
  setGoal: vi.fn(() => ok({})),
  removeGoal: vi.fn(() => ok({})),
  territory: vi.fn(() => ok({ rows: [] })),
  news: vi.fn(() => ok({ news: [] })),
  ...overrides,
});

const open = async (api: AllianceApi, options: AllianceWindowOptions = {}): Promise<AllianceWindow> => {
  const view = new AllianceWindow({
    api,
    progressApi: fakeProgress(),
    myId: () => 1,
    now: () => 1_000_000,
    players: { search: vi.fn(() => Promise.resolve([])) },
    ...options,
  });
  view.mount(document.body);
  await flush();
  return view;
};

const buttonNamed = (words: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === words);

/** The Language, Time zone and Min level dropdown boxes, in order. */
const picks = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".alliance__sets .alliance__pick")];

afterEach(() => {
  resetAllianceButton();
  setClassicLook(false);
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

  it("a row the player already asked (from the server) says Asked; a refused second ask says Asked too", async () => {
    const api = fakeApi({
      search: vi.fn(() => ok({ alliances: [listing(5), listing(6)], pageSize: 10, totalResults: 2, myRequests: [5] })),
      requestJoin: vi.fn(() => Promise.resolve({ ok: false as const, reason: "requestPending", message: "You already asked to join this alliance.", availableAt: null })),
    });
    await open(api);
    const rows = () => document.querySelectorAll<HTMLButtonElement>(".alliance__row");
    rows()[0]!.click();
    expect(buttonNamed(ALLIANCE_TEXT.asked)!.disabled).toBe(true);
    rows()[1]!.click();
    buttonNamed(ALLIANCE_TEXT.ask)!.click();
    await flush();
    expect(buttonNamed(ALLIANCE_TEXT.asked)!.disabled).toBe(true);
  });

  it("a player below an alliance's minimum level sees the level needed, off, instead of Join", async () => {
    const api = fakeApi({
      search: vi.fn(() => ok({ alliances: [listing(5, { join_mode: "open", min_level: 40 })], pageSize: 10, totalResults: 1, myLevel: 35 })),
    });
    await open(api);
    document.querySelector<HTMLButtonElement>(".alliance__row")!.click();
    // The row's only join button is the level needed.
    expect([...document.querySelectorAll(".alliance__row-more .alliance__join")].map((node) => node.textContent)).toEqual(["40+"]);
    const low = document.querySelector<HTMLButtonElement>(".alliance__join--level")!;
    expect(low.textContent).toBe("40+");
    expect(low.disabled).toBe(true);
    expect(low.title).toBe(ALLIANCE_TEXT.needsLevel(40));
  });

  it("an alliance that invited the player offers Accept invite on its row, not Ask to join", async () => {
    const api = fakeApi({
      search: vi.fn(() => ok({ alliances: [listing(5)], pageSize: 10, totalResults: 1 })),
      messages: vi.fn(() => ok({ messages: [invite(77, { alliance_id: 5 })] })),
    });
    await open(api);
    document.querySelector<HTMLButtonElement>(".alliance__row")!.click();
    expect(buttonNamed(ALLIANCE_TEXT.ask)).toBeUndefined();
    buttonNamed(ALLIANCE_TEXT.acceptInvite)!.click();
    await flush();
    expect(api.answerInvite).toHaveBeenCalledWith(77, true);
  });

  it("Quick Join joins the first Open alliance of the chosen type with room, asking the server for Open ones", async () => {
    const api = fakeApi({
      search: vi.fn(() =>
        ok({
          alliances: [
            listing(1, { members: 15, join_mode: "open" }),
            listing(2, { type: "conquest", member_limit: 30, join_mode: "open" }),
            listing(4, { join_mode: "ask" }),
            listing(3, { join_mode: "open" }),
          ],
          pageSize: 10,
          totalResults: 4,
        }),
      ),
    });
    await open(api);
    const midas = [...document.querySelectorAll<HTMLButtonElement>(".alliance__quick-types .alliance__chip")].find((chip) => chip.textContent?.startsWith("Midas"))!;
    midas.click();
    document.querySelector<HTMLButtonElement>(".alliance__quick-join")!.click();
    await flush();
    expect(api.search).toHaveBeenLastCalledWith("", 0, { type: "midas", open: true });
    expect(api.requestJoin).toHaveBeenCalledWith(3);
  });

  it("Quick Join prefers an Open alliance in the player's language", async () => {
    const api = fakeApi({
      search: vi.fn(() =>
        ok({
          alliances: [listing(1, { join_mode: "open", language: "DE" }), listing(2, { join_mode: "open", language: "PH" })],
          pageSize: 10,
          totalResults: 2,
          myCountry: "PH",
        }),
      ),
    });
    await open(api);
    [...document.querySelectorAll<HTMLButtonElement>(".alliance__quick-types .alliance__chip")].at(-1)!.click();
    document.querySelector<HTMLButtonElement>(".alliance__quick-join")!.click();
    await flush();
    expect(api.requestJoin).toHaveBeenCalledWith(2);
  });

  it("each ad shows its joining mode, flag, time zone and a minimum level above 30", async () => {
    const api = fakeApi({
      search: vi.fn(() =>
        ok({
          alliances: [
            listing(1, { join_mode: "open", language: "PH", time_zone: 8, min_level: 40, description: "Goo farmers" }),
            listing(2, { join_mode: "invite", time_zone: -5, min_level: 30 }),
          ],
          pageSize: 10,
          totalResults: 2,
        }),
      ),
    });
    await open(api);
    const rows = document.querySelectorAll(".alliance__item");
    expect(rows[0]!.querySelector(".alliance__ad-mode")!.textContent).toBe("Open");
    expect(rows[0]!.querySelector(".alliance__ad-flag img, .alliance__ad-flag")).not.toBeNull();
    expect(rows[0]!.querySelector(".alliance__ad-zone")!.textContent).toBe("GMT+8");
    expect(rows[0]!.querySelector(".alliance__ad-level")!.textContent).toBe("40+");
    expect(rows[1]!.querySelector(".alliance__ad-mode")!.textContent).toBe("Invite only");
    expect(rows[1]!.querySelector(".alliance__ad-zone")!.textContent).toBe("GMT-5");
    expect(rows[1]!.querySelector(".alliance__ad-level")).toBeNull();
    expect(rows[1]!.querySelector(".alliance__ad-flag")).toBeNull();
  });

  it("an opened ad shows its line; Open says Join, Invite only offers no button", async () => {
    const api = fakeApi({
      search: vi.fn(() =>
        ok({
          alliances: [listing(1, { join_mode: "open", description: "Goo farmers" }), listing(2, { join_mode: "invite" })],
          pageSize: 10,
          totalResults: 2,
        }),
      ),
    });
    await open(api);
    document.querySelectorAll<HTMLButtonElement>(".alliance__row")[0]!.click();
    expect(document.querySelector(".alliance__row-desc")!.textContent).toBe("Goo farmers");
    expect(document.querySelector(".alliance__join")!.textContent).toBe(ALLIANCE_TEXT.join);
    document.querySelectorAll<HTMLButtonElement>(".alliance__row")[1]!.click();
    expect(document.querySelector(".alliance__join")).toBeNull();
    expect(document.querySelector(".alliance__invite-only")!.textContent).toBe("Invite only");
  });

  it("Join on an Open alliance opens My alliance at once", async () => {
    let joined = false;
    const api = fakeApi({
      mine: vi.fn(() => ok({ alliance: joined ? mine({ role: "member", permissions: [] }) : null, rejoinAt: null })),
      search: vi.fn(() => ok({ alliances: [listing(5, { join_mode: "open" })], pageSize: 10, totalResults: 1 })),
      requestJoin: vi.fn(() => {
        joined = true;
        return ok({ joined: true });
      }),
    });
    const onChanged = vi.fn();
    const onMembership = vi.fn();
    const view = await open(api, { onChanged, onMembership });
    // Not in an alliance yet: the More menu's Alliance button rule hears so.
    expect(onMembership).toHaveBeenLastCalledWith(false);
    expect(inAlliance()).toBe(false);
    document.querySelector<HTMLButtonElement>(".alliance__row")!.click();
    document.querySelector<HTMLButtonElement>(".alliance__join")!.click();
    await flush();
    await flush();
    expect(api.requestJoin).toHaveBeenCalledWith(5);
    expect(onChanged).toHaveBeenCalled();
    expect(view.kind).toBe("mine");
    // Joined: the button's rule hears it at once, without a reload.
    expect(onMembership).toHaveBeenLastCalledWith(true);
    expect(inAlliance()).toBe(true);
  });

  it("tells the Alliance button's rule when the player is found to be out of their alliance (left, kicked)", async () => {
    setInAlliance(true);
    const onMembership = vi.fn();
    await open(fakeApi(), { onMembership });
    expect(onMembership).toHaveBeenLastCalledWith(false);
    expect(inAlliance()).toBe(false);
  });

  it("filters: Open, the player's flag and a type go to the server; Clear drops them", async () => {
    const api = fakeApi({
      search: vi.fn(() => ok({ alliances: [listing(1)], pageSize: 10, totalResults: 1, myCountry: "PH" })),
    });
    await open(api);
    const filter = (index: number) => document.querySelectorAll<HTMLButtonElement>(".alliance__filters .alliance__filter")[index]!;
    filter(0).click();
    await flush();
    expect(api.search).toHaveBeenLastCalledWith("", 0, { type: null, language: null, open: true });
    filter(1).click();
    await flush();
    expect(api.search).toHaveBeenLastCalledWith("", 0, { type: null, language: "PH", open: true });
    filter(4).click();
    await flush();
    expect(api.search).toHaveBeenLastCalledWith("", 0, { type: "fortress", language: "PH", open: true });
    expect(filter(4).getAttribute("aria-pressed")).toBe("true");
    buttonNamed(ALLIANCE_TEXT.clear)!.click();
    await flush();
    expect(api.search).toHaveBeenLastCalledWith("", 0, { type: null, language: null, open: false });
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
    expect(api.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Goo Lords", image: 1, description: "We farm goo.", type: "fortress", join_mode: "open", language: null, min_level: 30 }),
    );
    expect(view.kind).toBe("mine");
  });

  it("the ad fields: joining mode, time zone and minimum level go with the alliance", async () => {
    const api = fakeApi();
    await open(api);
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    const name = document.querySelector<HTMLInputElement>(".alliance__form input")!;
    name.value = "Goo Lords";
    name.dispatchEvent(new Event("input"));
    const about = document.querySelector<HTMLTextAreaElement>(".alliance__form textarea")!;
    about.value = "We farm goo.";
    about.dispatchEvent(new Event("input"));
    const modes = [...document.querySelectorAll<HTMLButtonElement>(".alliance__mode")];
    expect(modes.map((mode) => mode.textContent)).toEqual(["Open", "Ask", "Invite only"]);
    expect(modes[0]!.getAttribute("aria-pressed")).toBe("true");
    modes[2]!.click();
    expect(modes[2]!.getAttribute("aria-pressed")).toBe("true");
    expect(modes[0]!.getAttribute("aria-pressed")).toBe("false");
    const [, zone, level] = picks();
    expect(zone!.textContent).toMatch(/^GMT/);
    expect(level!.textContent).toBe(ALLIANCE_TEXT.anyLevel);
    level!.click();
    expect(level!.getAttribute("aria-expanded")).toBe("true");
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".alliance__pop .alliance__option")];
    expect(rows.map((row) => row.textContent)).toEqual(["Any level\u2713", "Level 35+", "Level 40+", "Level 45+", "Level 50+", "Level 55+", "Level 60+"]);
    rows[2]!.click();
    expect(document.querySelector(".alliance__pop")).toBeNull();
    expect(level!.getAttribute("aria-expanded")).toBe("false");
    expect(level!.textContent).toBe("40+");
    document.querySelector<HTMLButtonElement>(".alliance__submit")!.click();
    await flush();
    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ join_mode: "invite", min_level: 40 }));
  });

  it("the language dropdown opens the country list; a pick shows its flag", async () => {
    await open(fakeApi());
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    const [pick] = picks();
    expect(pick!.textContent).toBe(ALLIANCE_TEXT.anyLanguage);
    pick!.click();
    const anyRow = document.querySelector<HTMLButtonElement>(".alliance__pop button[data-code='']")!;
    expect(anyRow.textContent).toContain(ALLIANCE_TEXT.anyLanguageRow);
    const option = document.querySelector<HTMLButtonElement>(".alliance__pop button[data-code='PH']")!;
    option.click();
    expect(document.querySelector(".alliance__pop")).toBeNull();
    expect(pick!.querySelector(".country-flag, img")).not.toBeNull();
  });

  it("the three settings sit in one row of dropdowns, each named by its label", async () => {
    await open(fakeApi());
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    const row = document.querySelector(".alliance__sets")!;
    const labels = [...row.querySelectorAll(".alliance__label")].map((label) => label.textContent);
    expect(labels).toEqual([ALLIANCE_TEXT.language, ALLIANCE_TEXT.timeZone, ALLIANCE_TEXT.minLevel]);
    for (const pick of picks()) {
      expect(pick.getAttribute("aria-haspopup")).toBe("listbox");
      const [labelId] = pick.getAttribute("aria-labelledby")!.split(" ");
      expect(document.getElementById(labelId!)!.textContent).toBeTruthy();
    }
    // No ‹ › steppers any more.
    expect(document.querySelector(".alliance__stepper")).toBeNull();
  });

  it("the time zone list runs GMT-12 to GMT+14 and marks the player's own zone", async () => {
    await open(fakeApi());
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    const [, zone] = picks();
    zone!.click();
    const rows = [...document.querySelectorAll<HTMLButtonElement>(".alliance__pop .alliance__option")];
    expect(rows).toHaveLength(27);
    expect(rows[0]!.textContent).toBe("GMT-12");
    expect(rows[26]!.textContent).toBe("GMT+14");
    expect(document.querySelectorAll(".alliance__pop .alliance__you")).toHaveLength(1);
    expect(document.querySelectorAll('.alliance__pop [aria-selected="true"]')).toHaveLength(1);
  });

  it("a dropdown closes on a press outside it or on Escape, and opening another closes the first", async () => {
    await open(fakeApi());
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    const [, zone, level] = picks();
    zone!.click();
    expect(document.querySelectorAll(".alliance__pop")).toHaveLength(1);
    level!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    level!.click();
    expect(document.querySelectorAll(".alliance__pop")).toHaveLength(1);
    expect(zone!.getAttribute("aria-expanded")).toBe("false");
    expect(level!.getAttribute("aria-expanded")).toBe("true");
    level!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".alliance__pop")).toBeNull();
    zone!.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(document.querySelector(".alliance__pop")).toBeNull();
  });

  it("About counts its letters up to 120 and stops there", async () => {
    await open(fakeApi());
    document.querySelector<HTMLButtonElement>(".alliance__create")!.click();
    const about = document.querySelector<HTMLTextAreaElement>(".alliance__about textarea")!;
    const count = document.querySelector<HTMLElement>(".alliance__count")!;
    expect(about.maxLength).toBe(120);
    expect(count.textContent).toBe("0/120");
    about.value = "x".repeat(37);
    about.dispatchEvent(new Event("input"));
    expect(count.textContent).toBe("37/120");
    expect(count.dataset["state"]).toBe("");
    about.value = "x".repeat(120);
    about.dispatchEvent(new Event("input"));
    expect(count.textContent).toBe("120/120");
    expect(count.dataset["state"]).toBe("full");
    expect(about.getAttribute("aria-describedby")).toBe(count.id);
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
    const tabs = [...document.querySelectorAll(".alliance__tab")].map((tab) => tab.getAttribute("aria-label"));
    expect(tabs).toEqual(["Overview", "Constellation", "Members", "Trade", "Territory"]);
    // Trading is off unless the server says on (beta 7): Trade is there, greyed out.
    expect(document.querySelector<HTMLButtonElement>('.alliance__tab[data-tab="trade"]')!.disabled).toBe(true);
  });

  it("Edit starts from the saved ad and sends the whole ad back", async () => {
    const api = fakeApi({
      mine: vi.fn(() => ok({ alliance: mine({ join_mode: "ask", language: "DE", time_zone: -5, min_level: 45 }), rejoinAt: null })),
    });
    await open(api);
    expect(document.querySelector(".alliance__ad-mode")!.textContent).toBe("Ask");
    buttonNamed(ALLIANCE_TEXT.edit)!.click();
    const modes = [...document.querySelectorAll<HTMLButtonElement>(".alliance__mode")];
    expect(modes[1]!.getAttribute("aria-pressed")).toBe("true");
    const [language, zone, level] = picks();
    expect(language!.textContent).toBe("Germany");
    expect(zone!.textContent).toBe("GMT-5");
    expect(level!.textContent).toBe("45+");
    modes[0]!.click();
    zone!.click();
    [...document.querySelectorAll<HTMLButtonElement>(".alliance__pop .alliance__option")].find((row) => row.textContent === "GMT-4")!.click();
    expect(zone!.textContent).toBe("GMT-4");
    buttonNamed(ALLIANCE_TEXT.save)!.click();
    await flush();
    expect(api.edit).toHaveBeenCalledWith({
      image: 4,
      description: "We farm goo.",
      join_mode: "open",
      language: "DE",
      time_zone: -4,
      min_level: 45,
    });
  });

  it("Edit keeps an older About over 120 whole, shows it over and asks for a shorter one before saving", async () => {
    const long = "We farm goo every day. ".repeat(8).trim();
    expect(long.length).toBeGreaterThan(120);
    const api = fakeApi({ mine: vi.fn(() => ok({ alliance: mine({ description: long }), rejoinAt: null })) });
    await open(api);
    expect(document.querySelector(".alliance__description")!.textContent).toBe(long);
    buttonNamed(ALLIANCE_TEXT.edit)!.click();
    const about = document.querySelector<HTMLTextAreaElement>(".alliance__about textarea")!;
    const count = document.querySelector<HTMLElement>(".alliance__count")!;
    expect(about.value).toBe(long);
    expect(count.textContent).toBe(`${long.length}/120`);
    expect(count.dataset["state"]).toBe("over");
    expect(about.getAttribute("aria-invalid")).toBe("true");
    buttonNamed(ALLIANCE_TEXT.save)!.click();
    await flush();
    expect(api.edit).not.toHaveBeenCalled();
    expect(document.querySelector(".alliance__status")!.textContent).toContain("At most 120 letters.");
    expect(document.activeElement).toBe(about);
    about.value = long.slice(0, 120);
    about.dispatchEvent(new Event("input"));
    expect(count.dataset["state"]).toBe("full");
    expect(about.getAttribute("aria-invalid")).toBe("false");
    buttonNamed(ALLIANCE_TEXT.save)!.click();
    await flush();
    expect(api.edit).toHaveBeenCalledWith(expect.objectContaining({ description: long.slice(0, 120).trim() }));
  });

  it("shows phase 2's Overview cards, and a goal set from the menu reloads on the same tab", async () => {
    const goal = { id: 7, kind: "tribeDestroy", name: "Destroy tribe yards", tier: "easy", target: 150, progress: 60, points: 10, done: false, removable: false } as const;
    const api = fakeApi({
      mine: vi.fn(() =>
        ok({
          alliance: mine({
            today: { contributed: 1, members: 2, points_today: 3, helped_ids: [1] },
            goals: [goal],
            goals_per_week: 5,
            week_ends_at: 1_000_000 + 3600,
            goal_menu: [{ kind: "kitRebuild", name: "Rebuild outposts with Starter Kits", only: "conquest", tiers: [{ tier: "easy", target: 40, points: 10 }] }],
            top_helpers: [{ userid: 1, username: "Player 1", quests: 3, goal_share: 40 }],
          }),
          rejoinAt: null,
        }),
      ),
    });
    const progress = fakeProgress({ news: vi.fn(() => ok({ news: [{ name: "Player 1", type: "goal_set", text: "Player 1 set a goal", ts: 999_000_000 }] })) });
    await open(api, { progressApi: progress });
    expect(document.querySelectorAll(".alliance-card").length).toBeGreaterThanOrEqual(4);
    expect(document.querySelector(".alliance-goal__count")!.textContent).toBe("60 / 150");
    expect(document.querySelector(".alliance-news__text")!.textContent).toBe("Player 1 set a goal");

    buttonNamed("Add goal")!.click();
    document.querySelector<HTMLButtonElement>(".alliance-goal-menu__tier")!.click();
    await flush();
    expect(progress.setGoal).toHaveBeenCalledWith("kitRebuild", "easy");
    expect(api.mine).toHaveBeenCalledTimes(2);
    expect(document.querySelector(".alliance__tab[aria-selected='true']")!.getAttribute("aria-label")).toBe("Overview");
  });

  it("the goal picker says once, per tier, who it is sized for and what it pays; buttons show short targets", async () => {
    const tiers = [
      { tier: "easy", target: 450_000_000, points: 15, players: 3 },
      { tier: "medium", target: 1_200_000_000, points: 37, players: 8 },
      { tier: "hard", target: 2_250_000_000, points: 70, players: 15 },
    ] as const;
    const api = fakeApi({
      mine: vi.fn(() =>
        ok({
          alliance: mine({
            goals: [],
            goals_per_week: 5,
            goal_menu: [
              { kind: "loot", name: "Loot resources", only: null, tiers },
              { kind: "upgrade", name: "Upgrade buildings", only: null, tiers: tiers.map((t) => ({ ...t, target: 90 })) },
            ],
          }),
          rejoinAt: null,
        }),
      ),
    });
    await open(api, { progressApi: fakeProgress() });
    buttonNamed("Add goal")!.click();
    const cols = [...document.querySelectorAll(".alliance-goal-menu__col")].map((c) => c.textContent);
    expect(cols).toEqual(["Easy~3★ 15", "Medium~8★ 37", "Hard~15★ 70"]);
    expect(document.querySelectorAll(".alliance-goal-menu__head").length).toBe(1);
    const picks = [...document.querySelectorAll<HTMLButtonElement>(".alliance-goal-menu__tier")];
    expect(picks.slice(0, 3).map((b) => b.textContent)).toEqual(["450M", "1.2B", "2.25B"]);
    expect(picks[0]!.title).toBe("Easy: 450,000,000 · ★ 15, sized for about 3 players");
    expect(picks[0]!.getAttribute("aria-label")).toBe("Loot resources, Easy 450,000,000");
  });

  it("Territory loads its board and switches type; Constellation draws the sky", async () => {
    const progress = fakeProgress({
      territory: vi.fn(() => ok({ rows: [{ rank: 1, alliance_id: 1, name: "Goo Farmers", image: 3, month: 12, all_time: 40, badge: null }] })),
    });
    const view = await open(fakeApi({ mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })) }), { progressApi: progress });
    view.showTab("territory");
    await flush();
    expect(progress.territory).toHaveBeenCalledWith("conquest");
    expect(document.querySelectorAll(".alliance-board__row")).toHaveLength(1);
    document.querySelectorAll<HTMLButtonElement>(".alliance-board__type")[2]!.click();
    await flush();
    expect(progress.territory).toHaveBeenLastCalledWith("fortress");

    // The chosen board is marked pressed.
    const types = [...document.querySelectorAll<HTMLButtonElement>(".alliance-board__type")];
    expect(types.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true"]);

    // Clicking the tab button itself switches (as a tap on a phone does).
    document.querySelector<HTMLButtonElement>(".alliance__tab[data-tab='constellation']")!.click();
    expect(document.querySelector(".alliance__tab[aria-selected='true']")!.getAttribute("data-tab")).toBe("constellation");
    expect(document.querySelector(".alliance-sky__empty, .alliance-sky")).not.toBeNull();
  });

  it("draws each constellation's monster faint behind its stars, in both looks", async () => {
    const star = (id: string, name: string, kind: ConstellationView["kind"]): ConstellationView => ({
      id,
      name,
      kind,
      steps: 1,
      next_price: 40,
      prices: [20, 40, 60, 80, 100],
      suggest_count: 0,
      effects: [{ stat: "production", values: [15, 17, 19, 21, 23, 25] }],
    });
    const constellations = [star("crabatron", "Crabatron", "strength"), star("octoooze", "Octo-ooze", "weakness"), star("mystery", "Mystery", "strength")];
    const api = fakeApi({ mine: vi.fn(() => ok({ alliance: mine({ constellations }), rejoinAt: null })) });
    const pictures = (): HTMLImageElement[] => [...document.querySelectorAll<HTMLImageElement>(".alliance-sky__con .alliance-sky__monster")];

    const view = await open(api);
    view.showTab("constellation");
    await flush();
    // The picture comes before the stars, so the stars draw on top; none for a constellation with no monster.
    expect(pictures().map((image) => image.dataset.monster)).toEqual(["C10", "C2"]);
    expect(pictures().map((image) => new URL(image.src).pathname)).toEqual(["/portraits/C10.webp", "/portraits/C2.webp"]);
    expect(pictures()[0]!.alt).toBe("");
    expect(pictures()[0]!.nextElementSibling!.classList.contains("alliance-sky__figure")).toBe(true);

    // Classic: the original Flash portrait.
    document.body.replaceChildren();
    setClassicLook(true);
    const classic = await open(api);
    classic.showTab("constellation");
    await flush();
    expect(pictures().map((image) => new URL(image.src).pathname)).toEqual(["/assets/monsters/C10-portrait.jpg", "/assets/monsters/C2-portrait.jpg"]);
  });

  it("a tap on any tab, its icon included, switches to that tab (a phone shows icons only)", async () => {
    await open(fakeApi({ mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })) }), { progressApi: fakeProgress() });
    for (const tab of ["constellation", "members", "territory", "overview", "constellation"]) {
      const icon = document.querySelector<HTMLElement>(`.alliance__tab[data-tab='${tab}'] > :first-child`)!;
      icon.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flush();
      expect(document.querySelector(".alliance__tab[aria-selected='true']")!.getAttribute("data-tab")).toBe(tab);
    }
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

describe("AllianceWindow: Trade sheet Back, then another tab (lead, 11 Nov)", () => {
  const press = (node: Element): void => {
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    (node as HTMLElement).click();
  };

  it("Back on the New request sheet goes to the Trade tab, and Members then opens with the window still up", async () => {
    const storage = { held: { r1: 1_000, r2: 1_000, r3: 1_000, r4: 1_000 }, cap: 10_000 };
    const tradeApi = {
      view: vi.fn(() =>
        ok({
          view: {
            today: { sendsLeft: 1, receivesLeft: 1, postsLeft: 3, newDayIn: 3_600 },
            rules: { loss: 0.1, capShare: 0.1, requestSeconds: 86_400 },
            me: storage,
            myRequest: null,
            requests: [],
            recent: [],
            mate: null,
          },
        }),
      ),
      post: vi.fn(() => ok({})),
      cancel: vi.fn(() => ok({})),
      accept: vi.fn(() => ok({})),
      send: vi.fn(() => ok({})),
    } as unknown as NonNullable<AllianceWindowOptions["tradeApi"]>;
    const onClose = vi.fn();
    const view = await open(fakeApi({ mine: vi.fn(() => ok({ alliance: mine({ trade_on: true }), rejoinAt: null })) }), {
      tab: "trade",
      tradeApi,
      onClose,
    });
    await flush();

    press(document.querySelector(".trade-new")!);
    expect(document.querySelector(".trade-sheet__back")).not.toBeNull();
    press(document.querySelector(".trade-sheet__back")!);
    expect(document.querySelector(".trade-sheet__back")).toBeNull();
    expect(document.querySelector(".trade-new")).not.toBeNull();

    press(document.querySelector('.alliance__tab[data-tab="members"]')!);
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".popup-backdrop")).not.toBeNull();
    expect(document.querySelector('.alliance__tab[aria-selected="true"]')!.getAttribute("data-tab")).toBe("members");
    expect(view.kind).toBe("mine");
  });
});

describe("AllianceWindow: trading's switch (owner 11 Nov: greyed out for beta 7)", () => {
  const tradeApi = () =>
    ({
      view: vi.fn(() => ok({})),
      post: vi.fn(() => ok({})),
      cancel: vi.fn(() => ok({})),
      accept: vi.fn(() => ok({})),
      send: vi.fn(() => ok({})),
    }) as unknown as NonNullable<AllianceWindowOptions["tradeApi"]>;
  const tabNames = () => [...document.querySelectorAll(".alliance__tab")].map((tab) => tab.getAttribute("data-tab"));
  const tradeTab = () => document.querySelector<HTMLButtonElement>('.alliance__tab[data-tab="trade"]')!;
  const selected = () => document.querySelector('.alliance__tab[aria-selected="true"]')!.getAttribute("data-tab");
  const withMembers = (alliance: MyAlliance) =>
    fakeApi({
      mine: vi.fn(() => ok({ alliance, rejoinAt: null })),
      members: vi.fn(() => ok({ members: [member(1, "leader"), member(3, "member")] })),
    });

  afterEach(() => setAllianceTradeOn(false));

  it("switch off: Trade and a mate's Send are there but greyed out, Coming soon, and never reach the server", async () => {
    setAllianceTradeOn(true);
    const trade = tradeApi();
    const view = await open(withMembers(mine({ trade_on: false })), { tab: "trade", focus: { request: 5 }, tradeApi: trade });
    expect(tabNames()).toEqual(["overview", "constellation", "members", "trade", "territory"]);
    expect(tradeTab().disabled).toBe(true);
    expect(tradeTab().title).toBe(TRADE_OFF_TITLE);
    // A Trade ask (chat, an old tab) lands on Overview.
    expect(selected()).toBe("overview");
    expect(allianceTradeOn()).toBe(false);

    tradeTab().click();
    tradeTab().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(selected()).toBe("overview");

    view.showTab("trade", { send: { userid: 3, username: "Player 3" } });
    await flush();
    expect(selected()).toBe("overview");
    expect(document.querySelector(".trade-new")).toBeNull();

    view.showTab("members");
    await flush();
    document.querySelector<HTMLButtonElement>("[data-userid='3'] .alliance__row")!.click();
    const send = document.querySelector<HTMLButtonElement>(".alliance__send")!;
    expect(send).not.toBeNull();
    expect(send.disabled).toBe(true);
    expect(send.title).toBe(TRADE_OFF_TITLE);
    send.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(selected()).toBe("members");
    expect(trade.view).not.toHaveBeenCalled();
  });

  it("an older server that says nothing counts as off", async () => {
    await open(withMembers(mine()));
    expect(tradeTab().disabled).toBe(true);
  });

  it("switch on: Trade and a mate's Send work as before", async () => {
    const trade = tradeApi();
    const view = await open(withMembers(mine({ trade_on: true })), { tradeApi: trade });
    expect(tradeTab().disabled).toBe(false);
    expect(tradeTab().title).toBe("Trade");
    expect(allianceTradeOn()).toBe(true);
    view.showTab("members");
    await flush();
    document.querySelector<HTMLButtonElement>("[data-userid='3'] .alliance__row")!.click();
    const send = document.querySelector<HTMLButtonElement>(".alliance__send")!;
    expect(send.disabled).toBe(false);
    tradeTab().click();
    await flush();
    expect(selected()).toBe("trade");
    expect(trade.view).toHaveBeenCalled();
  });
});

describe("AllianceWindow: players' uploaded photos (owner, 13 Nov 2026)", () => {
  /** The face beside the row that names `name`, inside `scope`. */
  const faceOf = (scope: string, name: string): HTMLImageElement => {
    const row = [...document.querySelectorAll(`${scope}`)].find((node) => node.textContent?.includes(name))!;
    return row.querySelector<HTMLImageElement>(".alliance__face")!;
  };
  const isPhoto = (img: HTMLImageElement, userid: number, version: number): void => {
    expect(img.classList.contains("is-photo")).toBe(true);
    expect(img.getAttribute("src")).toContain(`/profile/photos/${userid}?v=${version}`);
  };
  const isCritter = (img: HTMLImageElement): void => {
    expect(img.classList.contains("is-photo")).toBe(false);
    expect(img.getAttribute("src")).not.toContain("/profile/photos/");
  };

  it("members, join requests and suggestions show a visible photo, and the critter when there is none", async () => {
    const api = fakeApi({
      mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })),
      members: vi.fn(() => ok({ members: [member(1, "leader"), member(2, "officer", { photo: 3 }), member(3, "member", { photo: null })] })),
      messages: vi.fn(() =>
        ok({
          messages: [
            invite(50, { type: "request", user_id: 8, user_name: "Asker Photo", user_photo: 2 }),
            invite(51, { type: "request", user_id: 9, user_name: "Asker Critter", user_photo: null }),
          ],
        }),
      ),
      suggested: vi.fn(() =>
        ok({ members: [member(20, "member", { display_name: "Sugg Photo", photo: 1 }), member(21, "member", { display_name: "Sugg Critter" })] }),
      ),
    });
    const view = await open(api);
    view.showTab("members");
    await flush();

    isPhoto(faceOf(".alliance__member, [data-userid]", "Player 2"), 2, 3);
    isCritter(faceOf(".alliance__member, [data-userid]", "Player 3"));
    isPhoto(faceOf(".alliance__invite--answer", "Asker Photo"), 8, 2);
    isCritter(faceOf(".alliance__invite--answer", "Asker Critter"));
    isPhoto(faceOf(".alliance__invite-box .alliance__invite", "Sugg Photo"), 20, 1);
    isCritter(faceOf(".alliance__invite-box .alliance__invite", "Sugg Critter"));
  });

  it("the invite search shows a found player's photo", async () => {
    const search = vi.fn(() =>
      Promise.resolve([
        { userid: 30, username: "Found Photo", pic: null, photo: 4, level: 12, relation: "none" as const },
        { userid: 31, username: "Found Critter", pic: null, level: 12, relation: "none" as const },
      ]),
    );
    const view = await open(fakeApi({ mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })) }), { players: { search } });
    view.showTab("members");
    await flush();
    const input = document.querySelector<HTMLInputElement>(".alliance__invite-box .alliance__input")!;
    input.value = "Found";
    input.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();

    expect(search).toHaveBeenCalledWith("Found");
    isPhoto(faceOf(".alliance__invite-box .alliance__invite", "Found Photo"), 30, 4);
    isCritter(faceOf(".alliance__invite-box .alliance__invite", "Found Critter"));
  });

  it("a photo that will not load falls back to the critter", async () => {
    await open(
      fakeApi({
        mine: vi.fn(() => ok({ alliance: mine(), rejoinAt: null })),
        members: vi.fn(() => ok({ members: [member(1, "leader"), member(2, "member", { photo: 5 })] })),
      }),
      { tab: "members" },
    );
    await flush();
    const img = faceOf(".alliance__member, [data-userid]", "Player 2");
    isPhoto(img, 2, 5);
    img.dispatchEvent(new Event("error"));
    isCritter(img);
  });
});
