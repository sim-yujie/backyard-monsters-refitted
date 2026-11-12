// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_CATEGORY_IDS, type NotificationCategoryId } from "@/api/notificationSettings";
import { CATEGORY_TEXT, GAME_NOTICES_TEXT, NOTIFICATION_SETTINGS_TEXT, notificationSettingsSection } from "./NotificationSettings";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (off: NotificationCategoryId[], save = vi.fn(async () => off)) => {
  const section = notificationSettingsSection(off, save);
  document.body.append(section);
  const row = (id: string) => section.querySelector<HTMLElement>(`[data-category='${id}']`)!;
  const button = (id: string) => row(id).querySelector<HTMLButtonElement>("[role='switch']")!;
  return { section, row, button, save };
};

afterEach(() => document.body.replaceChildren());

describe("the Notifications settings", () => {
  it("lists every category in order, with its icon and words, the game notices last", () => {
    const { section } = mount([]);
    const rows = [...section.querySelectorAll<HTMLElement>(".notif-settings__row")];
    expect(rows.map((row) => row.dataset["category"])).toEqual([...NOTIFICATION_CATEGORY_IDS, "game"]);
    for (const id of NOTIFICATION_CATEGORY_IDS) {
      const row = rows.find((one) => one.dataset["category"] === id)!;
      expect(row.querySelector("img")!.dataset["icon"]).toBe(CATEGORY_TEXT[id].icon);
      expect(row.textContent).toContain(CATEGORY_TEXT[id].label);
    }
  });

  it("shows on and off as the account has them, an off row greyed", () => {
    const { button, row } = mount(["attacks", "boosts"]);
    expect(button("attacks").getAttribute("aria-checked")).toBe("false");
    expect(button("attacks").textContent).toBe(NOTIFICATION_SETTINGS_TEXT.off);
    expect(row("attacks").classList.contains("notif-settings__row--off")).toBe(true);
    expect(button("buildings").getAttribute("aria-checked")).toBe("true");
    expect(button("buildings").textContent).toBe(NOTIFICATION_SETTINGS_TEXT.on);
    expect(row("buildings").classList.contains("notif-settings__row--off")).toBe(false);
  });

  it("names each switch by its category, for a screen reader", () => {
    const { button } = mount([]);
    const label = document.getElementById(button("friends").getAttribute("aria-labelledby")!)!;
    expect(label.textContent).toBe(CATEGORY_TEXT.friends.label);
  });

  it("saves a flip at once and shows what the server stored", async () => {
    const save = vi.fn(async () => ["friends"] as NotificationCategoryId[]);
    const { button } = mount([], save);
    button("friends").click();
    expect(button("friends").getAttribute("aria-checked")).toBe("false");
    expect(button("friends").disabled).toBe(true);
    await settle();
    expect(save).toHaveBeenCalledWith("friends", false);
    expect(button("friends").getAttribute("aria-checked")).toBe("false");
    expect(button("friends").disabled).toBe(false);
  });

  it("goes back and says so when the save fails", async () => {
    const save = vi.fn(async () => {
      throw new Error("down");
    });
    const { button, row } = mount(["boosts"], save);
    button("boosts").click();
    await settle();
    expect(save).toHaveBeenCalledWith("boosts", true);
    expect(button("boosts").getAttribute("aria-checked")).toBe("false");
    expect(row("boosts").textContent).toContain(NOTIFICATION_SETTINGS_TEXT.failed);
  });

  it("keeps the game notices always on, with no switch, and says why", () => {
    const { row } = mount(["attacks", "buildings", "monsters", "boosts", "friends", "achievements"]);
    expect(row("game").querySelector("[role='switch']")).toBeNull();
    expect(row("game").textContent).toContain(NOTIFICATION_SETTINGS_TEXT.alwaysOn);
    expect(row("game").textContent).toContain(GAME_NOTICES_TEXT.why);
  });
});
