// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountMenu, accountName } from "./AccountMenu";

describe("AccountMenu", () => {
  let menu: AccountMenu | null = null;

  afterEach(() => {
    menu?.destroy();
    menu = null;
  });

  const build = (name: string | null = "Agent Tester") => {
    const signOut = vi.fn();
    menu = new AccountMenu({ name, onSignOut: signOut });
    document.body.append(menu.element);
    const button = menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!;
    const logOut = menu.element.querySelector<HTMLButtonElement>(".account-menu__item")!;
    return { menu, signOut, button, logOut };
  };

  it("opens on Account without signing anyone out", () => {
    const { menu, signOut, button } = build();
    expect(button.textContent).toBe("Account");
    expect(menu.open).toBe(false);
    button.click();
    expect(menu.open).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(signOut).not.toHaveBeenCalled();
    expect(menu.element.querySelector(".account-menu__name")?.textContent).toBe("Agent Tester");
  });

  it("signs out only from the explicit Log out item", () => {
    const { menu, signOut, button, logOut } = build();
    button.click();
    expect(logOut.textContent).toBe("Log out");
    logOut.click();
    expect(signOut).toHaveBeenCalledOnce();
    expect(menu.open).toBe(false);
  });

  it("closes on a press elsewhere or Escape", () => {
    const { menu, button } = build();
    button.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.open).toBe(false);
    button.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(menu.open).toBe(false);
  });

  it("stands in for a missing name", () => {
    expect(accountName(null)).toBe("Signed in");
    expect(accountName("  ")).toBe("Signed in");
    expect(accountName("Kozu")).toBe("Kozu");
  });
});
