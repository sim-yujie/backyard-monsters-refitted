// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchAccount: vi.fn(),
  changeUsername: vi.fn(),
  setShinyLocked: vi.fn(),
}));
vi.mock("@/api/account", () => api);
const privacyApi = vi.hoisted(() => ({
  setPrivacy: vi.fn(),
  fetchBlocked: vi.fn(),
  unblockPlayer: vi.fn(),
  fetchMuted: vi.fn(),
  unmutePlayer: vi.fn(),
}));
vi.mock("@/api/privacy", () => privacyApi);
const countryApi = vi.hoisted(() => ({ setCountry: vi.fn() }));
vi.mock("@/api/country", () => countryApi);
const chat = vi.hoisted(() => ({ worldChat: { setCountryRoom: vi.fn(), unmute: vi.fn() } }));
vi.mock("@/game/chat/chatSession", () => chat);
const lookReport = vi.hoisted(() => ({ reportLook: vi.fn() }));
vi.mock("@/app/lookReport", () => lookReport);

import { reduceEffects } from "@/game/attack/juice";
import { resetShinyLockForTests, shinyLocked } from "@/game/shinyLock";
import { setWorldChatOn, worldChatOn } from "@/game/chat/worldChatSetting";
import { SETTINGS_TEXT, openAccountSettings } from "./AccountSettings";
import { AvatarPicker } from "./AvatarPicker";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = async (account: Record<string, unknown>) => {
  api.fetchAccount.mockResolvedValue({
    username: "Agent",
    canChangeUsername: true,
    nextChangeAt: null,
    shinyLocked: false,
    privacy: { hideOnline: false, friendRequests: true },
    country: { country: null, countryAsked: false, countryChannel: null },
    ...account,
  });
  const popup = openAccountSettings({ container: document.body });
  await settle();
  return popup;
};

beforeEach(() => {
  privacyApi.fetchBlocked.mockResolvedValue([]);
  privacyApi.fetchMuted.mockResolvedValue([]);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  resetShinyLockForTests();
});

describe("AccountSettings", () => {
  it("renames through the server and then locks the field for the cooldown", async () => {
    api.changeUsername.mockResolvedValue({ username: "NewName", nextChangeAt: "2027-04-01T00:00:00.000Z" });
    await open({});
    const input = document.querySelector<HTMLInputElement>("#settings-username")!;
    input.value = "NewName";
    document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(api.changeUsername).toHaveBeenCalledWith("NewName");
    expect(input.disabled).toBe(true);
    expect(document.querySelector("#settings-username-hint")!.textContent).toContain("NewName");
  });

  it("does not ask the server about a name the rules refuse", async () => {
    await open({});
    document.querySelector<HTMLInputElement>("#settings-username")!.value = "a b";
    document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(api.changeUsername).not.toHaveBeenCalled();
    expect(document.querySelector("#settings-username")!.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the cooldown instead of an editable name", async () => {
    await open({ canChangeUsername: false, nextChangeAt: "2027-04-01T00:00:00.000Z" });
    expect(document.querySelector<HTMLInputElement>("#settings-username")!.disabled).toBe(true);
    expect(document.querySelector("#settings-username-hint")!.textContent).toContain("again on");
  });

  it("says first that the lock hides the Shiny, and that it is kept", async () => {
    await open({ shinyLocked: true });
    const hint = document.querySelector("#settings-shiny-hint")!.textContent ?? "";
    expect(hint.startsWith("Hides your Shiny")).toBe(true);
    expect(hint).toContain("Your Shiny is kept");
    expect(shinyLocked()).toBe(true);
  });

  it("sends the Shiny Lock switch and puts it back when the save fails", async () => {
    api.setShinyLocked.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("down"));
    await open({});
    const box = document.querySelector<HTMLInputElement>("#settings-shiny-lock")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(api.setShinyLocked).toHaveBeenLastCalledWith(true);
    expect(box.checked).toBe(true);
    // The HUD's Shiny counter hears it at once (bug report #10).
    expect(shinyLocked()).toBe(true);

    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(box.checked).toBe(true);
    expect(document.querySelector("#settings-shiny-hint")!.textContent).toBe(SETTINGS_TEXT.shinyFailed);
  });

  it("saves 'Show when I'm online' as hideOnline and puts it back when the save fails", async () => {
    privacyApi.setPrivacy
      .mockResolvedValueOnce({ hideOnline: true, friendRequests: true })
      .mockRejectedValueOnce(new Error("down"));
    await open({});
    const box = document.querySelector<HTMLInputElement>("#settings-show-online")!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(privacyApi.setPrivacy).toHaveBeenLastCalledWith({ hideOnline: true });
    expect(box.checked).toBe(false);

    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(box.checked).toBe(false);
    expect(document.querySelector("#settings-show-online-hint")!.textContent).toBe(SETTINGS_TEXT.privacyFailed);
  });

  it("starts the switches from the saved state and saves friend requests", async () => {
    privacyApi.setPrivacy.mockResolvedValue({ hideOnline: true, friendRequests: false });
    await open({ privacy: { hideOnline: true, friendRequests: true } });
    expect(document.querySelector<HTMLInputElement>("#settings-show-online")!.checked).toBe(false);
    const box = document.querySelector<HTMLInputElement>("#settings-friend-requests")!;
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(privacyApi.setPrivacy).toHaveBeenLastCalledWith({ friendRequests: false });
    expect(box.checked).toBe(false);
  });

  /** The visible rows' names in a list. */
  const names = (list: string) =>
    [...document.querySelectorAll<HTMLElement>(`#${list} .account-settings__blocked-row`)]
      .filter((row) => !row.hidden)
      .map((row) => row.querySelector(".account-settings__player-name")!.textContent);
  const row = (list: string, name: string) =>
    [...document.querySelectorAll<HTMLElement>(`#${list} .account-settings__blocked-row`)].find(
      (el) => el.querySelector(".account-settings__player-name")!.textContent === name,
    )!;
  /** Unblock/Unmute, then the row's Confirm. */
  const undo = async (list: string, name: string) => {
    row(list, name).querySelector<HTMLButtonElement>(".block-button__ask")!.click();
    row(list, name).querySelector<HTMLButtonElement>(".block-button__yes")!.click();
    await settle();
  };
  const typeSearch = (list: string, text: string) => {
    const search = document.querySelector<HTMLInputElement>(`#${list}-search`)!;
    search.value = text;
    search.dispatchEvent(new Event("input"));
  };

  it("lists blocked players by name and unblocks one after the confirm", async () => {
    privacyApi.unblockPlayer.mockResolvedValue(undefined);
    privacyApi.fetchBlocked.mockResolvedValue([
      { userid: 7, username: "Gus" },
      { userid: 9, username: "Hal" },
    ]);
    await open({});
    expect(names("settings-blocked")).toEqual(["Gus", "Hal"]);
    await undo("settings-blocked", "Gus");
    expect(privacyApi.unblockPlayer).toHaveBeenCalledWith(7);
    expect(names("settings-blocked")).toEqual(["Hal"]);
    await undo("settings-blocked", "Hal");
    expect(document.body.textContent).toContain(SETTINGS_TEXT.blockedNone);
    // Nobody left: the search box and the list box go.
    expect(document.querySelector<HTMLElement>("#settings-blocked")!.closest<HTMLElement>(".account-settings__players")!.hidden).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#settings-blocked-search")!.disabled).toBe(true);
  });

  it("keeps a blocked player listed when Unblock fails", async () => {
    privacyApi.unblockPlayer.mockRejectedValue(new Error("down"));
    privacyApi.fetchBlocked.mockResolvedValue([{ userid: 7, username: "Gus" }]);
    await open({});
    await undo("settings-blocked", "Gus");
    expect(names("settings-blocked")).toEqual(["Gus"]);
    expect(document.body.textContent).toContain(SETTINGS_TEXT.unblockFailed);
  });

  it("asks 'Unmute <name>?' on the row; Cancel puts the row back without calling the server", async () => {
    privacyApi.fetchMuted.mockResolvedValue([{ userid: 4, username: "Loud" }]);
    await open({});
    const loud = row("settings-muted", "Loud");
    const ask = loud.querySelector<HTMLButtonElement>(".block-button__ask")!;
    const confirm = loud.querySelector<HTMLElement>(".block-button__confirm")!;
    expect(confirm.hidden).toBe(true);
    ask.click();
    expect(ask.hidden).toBe(true);
    expect(confirm.hidden).toBe(false);
    expect(loud.querySelector(".block-button__question")!.textContent).toBe("Unmute Loud?");
    expect(loud.querySelector(".block-button__yes")!.textContent).toBe(SETTINGS_TEXT.confirm);
    loud.querySelector<HTMLButtonElement>(".block-button__no")!.click();
    await settle();
    expect(confirm.hidden).toBe(true);
    expect(ask.hidden).toBe(false);
    expect(privacyApi.unmutePlayer).not.toHaveBeenCalled();
    expect(chat.worldChat.unmute).not.toHaveBeenCalled();
    expect(names("settings-muted")).toEqual(["Loud"]);
  });

  it("unmutes after the confirm, on the server and in the chat box", async () => {
    privacyApi.unmutePlayer.mockResolvedValue(undefined);
    privacyApi.fetchMuted.mockResolvedValue([
      { userid: 4, username: "Loud" },
      { userid: 5, username: "Spam" },
    ]);
    await open({});
    expect(names("settings-muted")).toEqual(["Loud", "Spam"]);
    // The blocked list is its own list.
    expect(names("settings-blocked")).toEqual([]);
    await undo("settings-muted", "Loud");
    expect(privacyApi.unmutePlayer).toHaveBeenCalledWith(4);
    expect(chat.worldChat.unmute).toHaveBeenCalledWith(4);
    expect(names("settings-muted")).toEqual(["Spam"]);
    await undo("settings-muted", "Spam");
    expect(document.body.textContent).toContain(SETTINGS_TEXT.mutedNone);
  });

  it("filters the muted list by name as you type, with 'No match.' when nothing is left", async () => {
    privacyApi.fetchMuted.mockResolvedValue([
      { userid: 4, username: "Loud" },
      { userid: 5, username: "Spam" },
      { userid: 6, username: "SpamKing" },
    ]);
    await open({});
    const list = document.querySelector<HTMLElement>("#settings-muted")!;
    const search = document.querySelector<HTMLInputElement>("#settings-muted-search")!;
    expect(search.disabled).toBe(false);
    expect(search.placeholder).toContain(SETTINGS_TEXT.mutedSearch);
    typeSearch("settings-muted", "spam");
    expect(names("settings-muted")).toEqual(["Spam", "SpamKing"]);
    expect(list.textContent).not.toContain(SETTINGS_TEXT.noMatch);
    typeSearch("settings-muted", "zzz");
    expect(names("settings-muted")).toEqual([]);
    expect(list.textContent).toContain(SETTINGS_TEXT.noMatch);
    typeSearch("settings-muted", "");
    expect(names("settings-muted")).toEqual(["Loud", "Spam", "SpamKing"]);
    expect(list.textContent).not.toContain(SETTINGS_TEXT.noMatch);
  });

  it("puts each list in its own scroll box under its own search", async () => {
    privacyApi.fetchMuted.mockResolvedValue(Array.from({ length: 16 }, (_, i) => ({ userid: 100 + i, username: `P${i}` })));
    await open({});
    const list = document.querySelector<HTMLElement>("#settings-muted")!;
    expect(list.classList.contains("country-picker__list")).toBe(true);
    expect(list.classList.contains("account-settings__player-list")).toBe(true);
    expect(list.querySelectorAll(".account-settings__blocked-row")).toHaveLength(16);
    const box = list.closest<HTMLElement>(".account-settings__players")!;
    expect(box.hidden).toBe(false);
    expect(box.firstElementChild).toBe(document.querySelector("#settings-muted-search"));
    // No blocked players: their search and box stay hidden, the "none" line shows.
    expect(document.querySelector<HTMLElement>("#settings-blocked")!.closest<HTMLElement>(".account-settings__players")!.hidden).toBe(true);
    expect(document.body.textContent).toContain(SETTINGS_TEXT.blockedNone);
  });

  it("keeps a muted player listed, and the chat box unchanged, when Unmute fails", async () => {
    privacyApi.unmutePlayer.mockRejectedValue(new Error("down"));
    privacyApi.fetchMuted.mockResolvedValue([{ userid: 4, username: "Loud" }]);
    await open({});
    await undo("settings-muted", "Loud");
    expect(names("settings-muted")).toEqual(["Loud"]);
    expect(chat.worldChat.unmute).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(SETTINGS_TEXT.unmuteFailed);
  });

  it("says so when the muted list cannot load", async () => {
    privacyApi.fetchMuted.mockRejectedValue(new Error("down"));
    await open({});
    expect(document.body.textContent).toContain(SETTINGS_TEXT.mutedLoadFailed);
    expect(document.body.textContent).toContain(SETTINGS_TEXT.blockedNone);
  });

  it("keeps Screen shake in this browser, on until switched off", async () => {
    localStorage.clear();
    await open({});
    const box = document.querySelector<HTMLInputElement>("#settings-screen-shake")!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.screenShake")).toBe("0");
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.screenShake")).toBeNull();
  });

  it("greys out Screen shake when the device asks for less motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduced-motion") }));
    try {
      await open({});
      const box = document.querySelector<HTMLInputElement>("#settings-screen-shake")!;
      expect(box.checked).toBe(false);
      expect(box.disabled).toBe(true);
      expect(document.body.textContent).toContain(SETTINGS_TEXT.shakeReducedHint);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("saves Effects: Full / Low, and shows the effects even when the account fails to load", async () => {
    localStorage.clear();
    api.fetchAccount.mockRejectedValue(new Error("down"));
    openAccountSettings({ container: document.body });
    await settle();
    expect(document.body.textContent).toContain(SETTINGS_TEXT.loadFailed);
    const select = document.querySelector<HTMLSelectElement>("#settings-effects-quality")!;
    expect(select.value).toBe("full");
    select.value = "low";
    select.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.effectsQuality")).toBe("low");
  });

  it("offers Quality: High / Medium / Low, High by default, kept in this browser", async () => {
    localStorage.clear();
    await open({});
    const select = document.querySelector<HTMLSelectElement>("#settings-quality")!;
    expect(select.closest("label")!.textContent).toContain(SETTINGS_TEXT.downloadLabel);
    expect([...select.options].map((option) => option.value)).toEqual(["high", "medium", "low"]);
    expect(select.value).toBe("high");
    const hint = document.querySelector("#settings-quality-hint")!;
    expect(hint.textContent).toBe(SETTINGS_TEXT.downloadHint.high);
    lookReport.reportLook.mockClear();
    select.value = "low";
    select.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.quality")).toBe("low");
    expect(lookReport.reportLook).toHaveBeenCalledTimes(1);
    expect(hint.textContent).toContain(SETTINGS_TEXT.downloadHint.low);
    expect(hint.textContent).toContain(SETTINGS_TEXT.downloadSaved);
    localStorage.clear();
  });

  it("shows the saved Quality, even when the account fails to load", async () => {
    localStorage.clear();
    localStorage.setItem("bymr.quality", "medium");
    api.fetchAccount.mockRejectedValue(new Error("down"));
    openAccountSettings({ container: document.body });
    await settle();
    expect(document.querySelector<HTMLSelectElement>("#settings-quality")!.value).toBe("medium");
    localStorage.clear();
  });

  it("offers one Look and sound choice, Modern by default, kept in this browser for the next load", async () => {
    localStorage.clear();
    await open({});
    const look = document.querySelector<HTMLSelectElement>("#settings-look")!;
    expect(look.closest("label")!.textContent).toContain(SETTINGS_TEXT.lookLabel);
    expect([...look.options].map((option) => option.textContent)).toEqual([
      SETTINGS_TEXT.lookModern,
      SETTINGS_TEXT.lookClassic,
    ]);
    expect(look.value).toBe("modern");
    lookReport.reportLook.mockClear();
    look.value = "classic";
    look.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.look")).toBe("classic");
    expect(document.body.textContent).toContain(SETTINGS_TEXT.lookSaved);
    // The new choice goes to the owner's dashboard (owner 4 Nov 2026); the player sees nothing of it.
    expect(lookReport.reportLook).toHaveBeenCalledTimes(1);
    look.value = "modern";
    look.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.look")).toBeNull();
    // The old art checkbox is gone: one choice covers it.
    expect(document.querySelector("#settings-classic-art")).toBeNull();
  });

  it("offers the music on its own, following the Style by default, kept in this browser for the next load", async () => {
    localStorage.clear();
    await open({});
    const music = document.querySelector<HTMLSelectElement>("#settings-music")!;
    expect(music.closest("label")!.textContent).toContain(SETTINGS_TEXT.musicLabel);
    expect([...music.options].map((option) => option.textContent)).toEqual([
      SETTINGS_TEXT.musicStyle,
      SETTINGS_TEXT.musicNew,
      SETTINGS_TEXT.musicFlash,
    ]);
    expect(music.value).toBe("style");
    lookReport.reportLook.mockClear();
    music.value = "flash";
    music.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.music")).toBe("flash");
    expect(lookReport.reportLook).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(SETTINGS_TEXT.musicSaved);
    music.value = "style";
    music.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.music")).toBeNull();
  });

  it("offers a Font choice that shows at once and is kept in this browser", async () => {
    localStorage.clear();
    delete document.documentElement.dataset.font;
    await open({});
    const font = document.querySelector<HTMLSelectElement>("#settings-font")!;
    expect(font.closest("label")!.textContent).toContain(SETTINGS_TEXT.fontLabel);
    expect([...font.options].map((option) => option.textContent)).toEqual([
      SETTINGS_TEXT.fontGame,
      SETTINGS_TEXT.fontClear,
      SETTINGS_TEXT.fontReadable,
    ]);
    // Each option is drawn in its own face, so the list is a preview.
    expect([...font.options].map((option) => option.style.fontFamily)).toEqual([
      '"Titan One", sans-serif',
      '"Nunito", sans-serif',
      '"Atkinson Hyperlegible", sans-serif',
    ]);
    expect(font.value).toBe("game");
    font.value = "readable";
    font.dispatchEvent(new Event("change"));
    expect(document.documentElement.dataset.font).toBe("readable");
    expect(localStorage.getItem("bymr.font")).toBe("readable");
    expect(document.querySelector("#settings-font-hint")!.textContent).toBe(SETTINGS_TEXT.fontHint.readable);
    font.value = "game";
    font.dispatchEvent(new Event("change"));
    expect(document.documentElement.dataset.font).toBeUndefined();
    expect(localStorage.getItem("bymr.font")).toBeNull();
  });

  it("shows the saved Font choice when the dialog opens, even when the account fails to load", async () => {
    localStorage.clear();
    localStorage.setItem("bymr.font", "clear");
    api.fetchAccount.mockRejectedValue(new Error("down"));
    openAccountSettings({ container: document.body });
    await settle();
    expect(document.querySelector<HTMLSelectElement>("#settings-font")!.value).toBe("clear");
    localStorage.clear();
  });

  it("shows Classic for a player who had Classic building art on, even when the account fails to load", async () => {
    localStorage.clear();
    localStorage.setItem("bymr.classicBuildingArt", "1");
    api.fetchAccount.mockRejectedValue(new Error("down"));
    openAccountSettings({ container: document.body });
    await settle();
    expect(document.querySelector<HTMLSelectElement>("#settings-look")!.value).toBe("classic");
    localStorage.clear();
  });

  describe("Country", () => {
    const pick = (name: string) =>
      [...document.querySelectorAll<HTMLButtonElement>(".country-picker__option")].find((button) =>
        button.textContent?.includes(name),
      )!;
    const now = () => document.querySelector("#settings-country-now")?.textContent;

    it("shows Not set and the whole list for a player without a country", async () => {
      await open({});
      expect(now()).toBe(SETTINGS_TEXT.countryNotSet);
      expect(document.querySelectorAll(".country-picker__option")).toHaveLength(250);
      expect(pick("Not set").getAttribute("aria-selected")).toBe("true");
    });

    it("shows the stored country, ticked in the list, and says it has a room", async () => {
      await open({ country: { country: "PH", countryAsked: true, countryChannel: "chat:country:PH" } });
      expect(now()).toContain("Philippines");
      expect(pick("Philippines").getAttribute("aria-selected")).toBe("true");
      expect(document.querySelector("#settings-country-hint")?.textContent).toBe(SETTINGS_TEXT.countryRoom);
    });

    it("saves a pick and switches the chat box to the new country's room", async () => {
      countryApi.setCountry.mockResolvedValue({ country: "PH", countryAsked: true, countryChannel: "chat:country:PH" });
      await open({});
      pick("Philippines").click();
      await settle();
      expect(countryApi.setCountry).toHaveBeenCalledWith("PH");
      expect(chat.worldChat.setCountryRoom).toHaveBeenCalledWith("chat:country:PH", "PH");
      expect(now()).toContain("Philippines");
    });

    it("moving to Singapore swaps the Philippines room for the Singapore room", async () => {
      countryApi.setCountry.mockResolvedValue({ country: "SG", countryAsked: true, countryChannel: "chat:country:SG" });
      await open({ country: { country: "PH", countryAsked: true, countryChannel: "chat:country:PH" } });
      pick("Singapore").click();
      await settle();
      expect(chat.worldChat.setCountryRoom).toHaveBeenCalledWith("chat:country:SG", "SG");
      expect(document.querySelector("#settings-country-hint")?.textContent).toBe(SETTINGS_TEXT.countryRoom);
    });

    it("Not set clears it", async () => {
      countryApi.setCountry.mockResolvedValue({ country: null, countryAsked: true, countryChannel: null });
      await open({ country: { country: "PH", countryAsked: true, countryChannel: "chat:country:PH" } });
      pick("Not set").click();
      await settle();
      expect(countryApi.setCountry).toHaveBeenCalledWith(null);
      expect(now()).toBe(SETTINGS_TEXT.countryNotSet);
      expect(chat.worldChat.setCountryRoom).toHaveBeenCalledWith(null, null);
      expect(document.querySelector("#settings-country-hint")?.textContent).toBe(SETTINGS_TEXT.countryHint);
    });

    it("says so and keeps the old country when the save fails", async () => {
      countryApi.setCountry.mockRejectedValue(new Error("down"));
      await open({ country: { country: "PH", countryAsked: true, countryChannel: "chat:country:PH" } });
      pick("Singapore").click();
      await settle();
      expect(document.querySelector("#settings-country-hint")?.textContent).toBe(SETTINGS_TEXT.countryFailed);
      expect(chat.worldChat.setCountryRoom).not.toHaveBeenCalled();
      expect(now()).toContain("Philippines");
    });
  });
});

describe("AccountSettings tabs", () => {
  const tab = (id: string) => document.querySelector<HTMLButtonElement>(`[role="tab"][data-tab="${id}"]`)!;
  const pane = (id: string) => document.querySelector<HTMLElement>(`#account-settings-pane-${id}`)!;

  it("opens on Account, and each tab shows only its own settings", async () => {
    await open({});
    expect(tab("account").getAttribute("aria-selected")).toBe("true");
    expect(pane("account").contains(document.querySelector("#settings-username"))).toBe(true);
    expect(pane("look").hidden).toBe(true);
    tab("social").click();
    expect(pane("account").hidden).toBe(true);
    expect(pane("social").hidden).toBe(false);
    expect(pane("social").contains(document.querySelector("#settings-show-online"))).toBe(true);
    expect(pane("social").textContent).toContain(SETTINGS_TEXT.countryTitle);
    expect(pane("account").textContent).not.toContain(SETTINGS_TEXT.countryTitle);
    expect(tab("social").getAttribute("aria-selected")).toBe("true");
    expect(tab("account").tabIndex).toBe(-1);
  });

  it("moves between tabs with the arrow keys, wrapping round", async () => {
    await open({});
    tab("account").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(tab("social").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tab("social"));
    tab("social").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(pane("account").hidden).toBe(false);
  });

  it("shows the avatar picker on Account only when it has an avatar", async () => {
    await open({});
    expect(document.querySelector(".avatar-picker")).toBeNull();
    document.body.replaceChildren();
    api.fetchAccount.mockRejectedValue(new Error("down"));
    openAccountSettings({
      container: document.body,
      avatarPicker: new AvatarPicker({ current: "owl", picked: true, onPick: () => Promise.resolve() }),
    });
    await settle();
    expect(pane("account").querySelectorAll(".avatar-picker__tile")).toHaveLength(12);
    expect(pane("account").textContent).toContain(SETTINGS_TEXT.loadFailed);
  });

  it("keeps Reduce effects with the game effects, in this browser", async () => {
    localStorage.clear();
    await open({});
    const reduce = document.querySelector<HTMLInputElement>("#settings-reduce-effects")!;
    expect(pane("look").contains(reduce)).toBe(true);
    expect(reduce.checked).toBe(false);
    reduce.click();
    expect(reduceEffects()).toBe(true);
    reduce.click();
    expect(reduceEffects()).toBe(false);
  });
});

describe("AccountSettings: World chat", () => {
  afterEach(() => setWorldChatOn(true));

  it("is on by default; switching it off turns world chat off now and keeps it in this browser", async () => {
    localStorage.clear();
    setWorldChatOn(true);
    await open({});
    const box = document.querySelector<HTMLInputElement>("#settings-world-chat")!;
    expect(box.checked).toBe(true);
    expect(box.closest("label")!.textContent).toBe(SETTINGS_TEXT.chatLabel);

    box.checked = false;
    box.dispatchEvent(new Event("change"));
    expect(worldChatOn()).toBe(false);
    expect(localStorage.getItem("bymr.worldChat")).toBe("off");

    box.checked = true;
    box.dispatchEvent(new Event("change"));
    expect(worldChatOn()).toBe(true);
    expect(localStorage.getItem("bymr.worldChat")).toBeNull();
  });

  it("shows Off when it is off, even when the account fails to load", async () => {
    setWorldChatOn(false);
    api.fetchAccount.mockRejectedValue(new Error("down"));
    openAccountSettings({ container: document.body });
    await settle();
    expect(document.querySelector<HTMLInputElement>("#settings-world-chat")!.checked).toBe(false);
  });
});
