// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRY_CODES } from "@/game/account/countries";
import { countryFlagImage, countryLabelNodes } from "./countryFlag";

/** Flag pictures instead of the two letters Windows draws for flag emoji (owner 3 Nov 2026). */

const flagsDir = resolve(__dirname, "../../public/flags");

describe("country flag pictures", () => {
  it("has a flag file for every country the picker offers, and the licence beside them", () => {
    const missing = COUNTRY_CODES.filter((code) => !existsSync(resolve(flagsDir, `${code.toLowerCase()}.svg`)));
    expect(missing).toEqual([]);
    expect(existsSync(resolve(flagsDir, "LICENSE.txt"))).toBe(true);
  });

  it("shows a small lazy picture with the letters as its alt text", () => {
    const img = countryFlagImage("PH") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.getAttribute("src")).toBe("/flags/ph.svg");
    expect(img.alt).toBe("PH");
    expect(img.loading).toBe("lazy");
  });

  it("falls back to the letters when the picture cannot load", () => {
    const holder = document.createElement("span");
    const img = countryFlagImage("PH");
    holder.append(img);
    img.dispatchEvent(new Event("error"));
    expect(holder.querySelector("img")).toBeNull();
    expect(holder.textContent).toBe("PH");
  });

  it("puts the flag before the country's name", () => {
    const holder = document.createElement("p");
    holder.append(...countryLabelNodes("PH"));
    expect(holder.querySelector("img")?.getAttribute("src")).toBe("/flags/ph.svg");
    expect(holder.textContent).toBe("Philippines");
  });
});
