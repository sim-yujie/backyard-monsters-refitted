// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AvatarId } from "@/game/avatars";
import { AccountMenu, DEFAULT_NOTE, PICK_FAILED, accountName } from "./AccountMenu";

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

  describe("avatar picker (#175)", () => {
    const withAvatar = (
      current: AvatarId,
      picked: boolean,
      onPick: (id: AvatarId) => Promise<void> = () => Promise.resolve(),
    ) => {
      const pick = vi.fn(onPick);
      const created = new AccountMenu({
        name: "Agent Tester",
        onSignOut: vi.fn(),
        avatar: { current, picked, onPick: pick },
      });
      menu = created;
      document.body.append(created.element);
      const tile = (id: AvatarId) =>
        created.element.querySelector<HTMLButtonElement>(`.account-menu__tile[data-avatar="${id}"]`)!;
      const checked = () =>
        [...created.element.querySelectorAll<HTMLElement>('.account-menu__tile[aria-checked="true"]')].map(
          (node) => node.dataset["avatar"],
        );
      const note = () => created.element.querySelector<HTMLElement>(".account-menu__note")!;
      const status = () => created.element.querySelector<HTMLElement>(".account-menu__status")!;
      const face = () => created.element.querySelector<HTMLImageElement>(".account-menu__face")!;
      return { menu: created, pick, tile, checked, note, status, face };
    };

    it("shows all twelve critters with the current one marked", () => {
      const { menu, checked, note, face } = withAvatar("owl", true);
      expect(menu.element.querySelectorAll(".account-menu__tile")).toHaveLength(12);
      expect(checked()).toEqual(["owl"]);
      expect(note().hidden).toBe(true);
      expect(face().getAttribute("src")).toMatch(/avatars\/owl-64\.webp$/);
      expect(menu.element.querySelector(".account-menu__button")?.textContent).toBe("Account");
    });

    it("says when the marked critter is only the default", () => {
      const { checked, note } = withAvatar("frog", false);
      expect(checked()).toEqual(["frog"]);
      expect(note().hidden).toBe(false);
      expect(note().textContent).toBe(DEFAULT_NOTE);
    });

    it("stores a pick, then moves the mark and the faces to it", async () => {
      const { menu, pick, tile, checked, note, face } = withAvatar("frog", false);
      menu.element.querySelector<HTMLButtonElement>(".account-menu__button")!.click();
      tile("bee").click();
      expect(pick).toHaveBeenCalledWith("bee");
      await vi.waitFor(() => expect(checked()).toEqual(["bee"]));
      expect(menu.avatar).toBe("bee");
      expect(note().hidden).toBe(true);
      expect(face().getAttribute("src")).toMatch(/avatars\/bee-64\.webp$/);
      expect(menu.open).toBe(true);
    });

    it("keeps the old mark and says so when the save fails", async () => {
      const { pick, tile, checked, status } = withAvatar("owl", true, () => Promise.reject(new Error("no")));
      tile("mole").click();
      expect(pick).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(status().hidden).toBe(false));
      expect(status().textContent).toBe(PICK_FAILED);
      expect(checked()).toEqual(["owl"]);
      expect(tile("mole").disabled).toBe(false);
    });

    it("does not re-send the avatar already picked, but lets a default be confirmed", async () => {
      const picked = withAvatar("owl", true);
      picked.tile("owl").click();
      expect(picked.pick).not.toHaveBeenCalled();
      menu!.destroy();

      const fallback = withAvatar("owl", false);
      fallback.tile("owl").click();
      expect(fallback.pick).toHaveBeenCalledWith("owl");
      await vi.waitFor(() => expect(fallback.note().hidden).toBe(true));
    });

    it("sends one pick at a time", async () => {
      let finish: () => void = () => {};
      const { pick, tile, checked } = withAvatar("owl", true, () => new Promise<void>((done) => (finish = done)));
      tile("bee").click();
      tile("worm").click();
      expect(pick).toHaveBeenCalledOnce();
      expect(tile("worm").disabled).toBe(true);
      finish();
      await vi.waitFor(() => expect(checked()).toEqual(["bee"]));
    });

    it("has no picker without an avatar", () => {
      build();
      expect(menu!.element.querySelector(".account-menu__avatars")).toBeNull();
      expect(menu!.element.querySelector(".account-menu__face")).toBeNull();
      expect(menu!.avatar).toBeNull();
    });
  });
});
