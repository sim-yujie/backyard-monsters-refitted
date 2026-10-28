// @vitest-environment jsdom
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GAME_ICON_NAMES,
  GAME_ICON_SIDES,
  GAME_ICONS,
  gameIcon,
  gameIconSrcset,
  gameIconUrl,
  iconAmount,
  iconChip,
} from "./gameIcon";
import { spokenText } from "./resourceIcon";

/** The painted icons that stand in for words (owner, 28 Oct). */

const PUBLIC_ICONS = path.resolve(__dirname, "../../public/ui/icons");

describe("the pictures", () => {
  it("ships every size of every icon, game-sized", () => {
    expect(GAME_ICON_NAMES).toHaveLength(20);
    for (const name of GAME_ICON_NAMES) {
      for (const side of GAME_ICON_SIDES) {
        const file = path.join(PUBLIC_ICONS, `${name}-${side}.webp`);
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size).toBeLessThan(8_000);
      }
    }
  });

  it("serves a size of an icon by its name, and offers every size to the browser", () => {
    expect(gameIconUrl("health", 32)).toMatch(/ui\/icons\/health-32\.webp$/);
    const srcset = gameIconSrcset("damage").split(", ");
    expect(srcset).toHaveLength(GAME_ICON_SIDES.length);
    expect(srcset[0]).toMatch(/ui\/icons\/damage-16\.webp 16w$/);
    expect(srcset.at(-1)).toMatch(/ui\/icons\/damage-64\.webp 64w$/);
  });

  it("names every icon in words", () => {
    for (const name of GAME_ICON_NAMES) expect(GAME_ICONS[name].length).toBeGreaterThan(0);
    expect(GAME_ICONS.yarddamage2).toBe("Yard damage");
    expect(GAME_ICONS.shield).toBe("Protection");
  });
});

describe("gameIcon", () => {
  it("draws the picture at 24 px by default, its size's file first", () => {
    const icon = gameIcon("health");
    expect(icon.tagName).toBe("IMG");
    expect(icon.width).toBe(24);
    expect(icon.height).toBe(24);
    expect(icon.getAttribute("src")).toMatch(/health-24\.webp$/);
    expect(icon.sizes).toBe("24px");
    expect(icon.srcset).toBe(gameIconSrcset("health"));
    expect(icon.classList).toContain("game-icon");
    expect(icon.classList).toContain("game-icon--health");
    expect(icon.dataset["icon"]).toBe("health");
  });

  it("draws 16 and 32 px too", () => {
    for (const size of [16, 32] as const) {
      const icon = gameIcon("speed", { size });
      expect(icon.width).toBe(size);
      expect(icon.getAttribute("src")).toMatch(new RegExp(`speed-${size}\\.webp$`));
      expect(icon.sizes).toBe(`${size}px`);
    }
  });

  it("keeps the word as the accessible name and the tooltip", () => {
    const icon = gameIcon("damage");
    expect(icon.getAttribute("role")).toBe("img");
    expect(icon.getAttribute("aria-label")).toBe("Damage");
    expect(icon.alt).toBe("Damage");
    expect(icon.title).toBe("Damage");
    expect(spokenText(icon)).toBe("Damage");
  });

  it("takes a narrower word for the place it is in", () => {
    const icon = gameIcon("time", { label: "Upgrade time" });
    expect(icon.getAttribute("aria-label")).toBe("Upgrade time");
    expect(icon.title).toBe("Upgrade time");
  });

  it("leaves the hover to the parent when asked, keeping the word", () => {
    const icon = gameIcon("shield", { tooltip: false });
    expect(icon.title).toBe("");
    expect(icon.getAttribute("aria-label")).toBe("Protection");
  });

  it("says nothing when decorative", () => {
    const icon = gameIcon("levelup", { decorative: true, className: "extra" });
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.alt).toBe("");
    expect(icon.hasAttribute("role")).toBe(false);
    expect(icon.title).toBe("");
    expect(icon.classList).toContain("extra");
    expect(spokenText(icon)).toBe("");
  });
});

describe("iconAmount and iconChip", () => {
  it("puts a 16 px icon before a number spelled in full", () => {
    const amount = iconAmount("health", 12500);
    expect(amount.className).toBe("icon-amount");
    expect(amount.dataset["icon"]).toBe("health");
    const icon = amount.querySelector("img");
    expect(icon?.width).toBe(16);
    expect(amount.querySelector(".icon-amount__value")?.textContent).toBe("12,500");
    expect(spokenText(amount)).toBe("Health 12,500");
  });

  it("spells a number short when compact, and takes a string as already spelled", () => {
    expect(iconAmount("storagefull", 15_000_000, { compact: true }).textContent).toBe("15.0M");
    expect(spokenText(iconAmount("health", "400 → 480"))).toBe("Health 400 → 480");
    expect(spokenText(iconAmount("yarddamage2", "35%", { label: "Damage dealt" }))).toBe("Damage dealt 35%");
  });

  it("passes size, tooltip and its own class through", () => {
    const amount = iconAmount("time", "15m", { size: 24, tooltip: false, className: "panel__time" });
    expect(amount.className).toBe("icon-amount panel__time");
    const icon = amount.querySelector("img");
    expect(icon?.width).toBe(24);
    expect(icon?.title).toBe("");
    expect(icon?.classList).not.toContain("panel__time");
  });

  it("draws a chip with the shared chip style", () => {
    const chip = iconChip("speed", 64, { className: "chip--accent" });
    expect(chip.classList).toContain("icon-amount");
    expect(chip.classList).toContain("chip");
    expect(chip.classList).toContain("chip--accent");
    expect(spokenText(chip)).toBe("Speed 64");
  });
});
