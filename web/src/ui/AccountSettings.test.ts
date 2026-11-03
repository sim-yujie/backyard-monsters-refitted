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
}));
vi.mock("@/api/privacy", () => privacyApi);
const countryApi = vi.hoisted(() => ({ setCountry: vi.fn() }));
vi.mock("@/api/country", () => countryApi);
const chat = vi.hoisted(() => ({ worldChat: { setCountryRoom: vi.fn() } }));
vi.mock("@/game/chat/chatSession", () => chat);

import { setWorldChatOn, worldChatOn } from "@/game/chat/worldChatSetting";
import { SETTINGS_TEXT, openAccountSettings } from "./AccountSettings";

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

beforeEach(() => privacyApi.fetchBlocked.mockResolvedValue([]));

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
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

  it("sends the Shiny Lock switch and puts it back when the save fails", async () => {
    api.setShinyLocked.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error("down"));
    await open({});
    const box = document.querySelector<HTMLInputElement>("#settings-shiny-lock")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await settle();
    expect(api.setShinyLocked).toHaveBeenLastCalledWith(true);
    expect(box.checked).toBe(true);

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

  it("lists blocked players by name and unblocks one", async () => {
    privacyApi.unblockPlayer.mockResolvedValue(undefined);
    privacyApi.fetchBlocked.mockResolvedValue([
      { userid: 7, username: "Gus" },
      { userid: 9, username: "Hal" },
    ]);
    await open({});
    const rows = () => [...document.querySelectorAll("#settings-blocked li")];
    expect(rows().map((row) => row.textContent)).toEqual(["GusUnblock", "HalUnblock"]);
    rows()[0]!.querySelector("button")!.click();
    await settle();
    expect(privacyApi.unblockPlayer).toHaveBeenCalledWith(7);
    expect(rows().map((row) => row.textContent)).toEqual(["HalUnblock"]);
    rows()[0]!.querySelector("button")!.click();
    await settle();
    expect(document.body.textContent).toContain(SETTINGS_TEXT.blockedNone);
  });

  it("keeps a blocked player listed when Unblock fails", async () => {
    privacyApi.unblockPlayer.mockRejectedValue(new Error("down"));
    privacyApi.fetchBlocked.mockResolvedValue([{ userid: 7, username: "Gus" }]);
    await open({});
    document.querySelector<HTMLButtonElement>("#settings-blocked button")!.click();
    await settle();
    expect(document.querySelectorAll("#settings-blocked li")).toHaveLength(1);
    expect(document.body.textContent).toContain(SETTINGS_TEXT.unblockFailed);
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
    select.value = "low";
    select.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.quality")).toBe("low");
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
    look.value = "classic";
    look.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.look")).toBe("classic");
    expect(document.body.textContent).toContain(SETTINGS_TEXT.lookSaved);
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
    music.value = "flash";
    music.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.music")).toBe("flash");
    expect(document.body.textContent).toContain(SETTINGS_TEXT.musicSaved);
    music.value = "style";
    music.dispatchEvent(new Event("change"));
    expect(localStorage.getItem("bymr.music")).toBeNull();
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

    it("moving to a country without a room takes the country room away", async () => {
      countryApi.setCountry.mockResolvedValue({ country: "SG", countryAsked: true, countryChannel: null });
      await open({ country: { country: "PH", countryAsked: true, countryChannel: "chat:country:PH" } });
      pick("Singapore").click();
      await settle();
      expect(chat.worldChat.setCountryRoom).toHaveBeenCalledWith(null, "SG");
      expect(document.querySelector("#settings-country-hint")?.textContent).toBe(SETTINGS_TEXT.countryHint);
    });

    it("Not set clears it", async () => {
      countryApi.setCountry.mockResolvedValue({ country: null, countryAsked: true, countryChannel: null });
      await open({ country: { country: "PH", countryAsked: true, countryChannel: "chat:country:PH" } });
      pick("Not set").click();
      await settle();
      expect(countryApi.setCountry).toHaveBeenCalledWith(null);
      expect(now()).toBe(SETTINGS_TEXT.countryNotSet);
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
