// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchAccount: vi.fn(),
  changeUsername: vi.fn(),
  setShinyLocked: vi.fn(),
}));
vi.mock("@/api/account", () => api);

import { SETTINGS_TEXT, openAccountSettings } from "./AccountSettings";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const open = async (account: Record<string, unknown>) => {
  api.fetchAccount.mockResolvedValue({
    username: "Agent",
    canChangeUsername: true,
    nextChangeAt: null,
    shinyLocked: false,
    ...account,
  });
  const popup = openAccountSettings({ container: document.body });
  await settle();
  return popup;
};

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
});
