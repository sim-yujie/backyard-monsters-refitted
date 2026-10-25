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

import { SETTINGS_TEXT, openAccountSettings } from "./AccountSettings";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = async (account: Record<string, unknown>) => {
  api.fetchAccount.mockResolvedValue({
    username: "Agent",
    canChangeUsername: true,
    nextChangeAt: null,
    shinyLocked: false,
    privacy: { hideOnline: false, friendRequests: true },
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
});
