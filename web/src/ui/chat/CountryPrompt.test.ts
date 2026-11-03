// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountrySettings } from "@/api/country";
import { openCountryPrompt, PROMPT_TEXT, resetCountryPrompt } from "./CountryPrompt";

/**
 * "Where are you playing from?" (country chat rooms, owner 3 Nov 2026): shown
 * once, a pick saves and switches the chat, "Not now" or closing puts it off.
 */

const PH: CountrySettings = { country: "PH", countryAsked: true, countryChannel: "chat:country:PH" };
const ASKED: CountrySettings = { country: null, countryAsked: true, countryChannel: null };

let api: { setCountry: ReturnType<typeof vi.fn>; putOff: ReturnType<typeof vi.fn> };
let onSaved: ReturnType<typeof vi.fn>;

const open = () => openCountryPrompt({ container: document.body, onSaved, api });

const option = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".country-picker__option")].find(
    (button) => button.textContent?.includes(name),
  )!;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.replaceChildren();
  resetCountryPrompt();
  api = { setCountry: vi.fn().mockResolvedValue(PH), putOff: vi.fn().mockResolvedValue(ASKED) };
  onSaved = vi.fn();
});

describe("the country prompt", () => {
  it("asks where the player is from, with a searchable list and Not now", () => {
    expect(open()).not.toBeNull();
    expect(document.body.textContent).toContain(PROMPT_TEXT.title);
    expect(document.querySelector(".country-picker__search")).not.toBeNull();
    expect(document.querySelectorAll(".country-picker__option").length).toBe(249);
    expect(document.querySelector(".country-prompt__not-now")?.textContent).toBe("Not now");
  });

  it("is shown only once in a page", () => {
    open();
    expect(open()).toBeNull();
    expect(document.querySelectorAll(".country-prompt")).toHaveLength(1);
  });

  it("narrows the list as the player types", () => {
    open();
    const search = document.querySelector<HTMLInputElement>(".country-picker__search")!;
    search.value = "philip";
    search.dispatchEvent(new Event("input"));
    expect(document.querySelectorAll(".country-picker__option")).toHaveLength(1);
  });

  it("saves a pick, closes, and hands the new room on", async () => {
    open();
    option("Philippines").click();
    await flush();
    expect(api.setCountry).toHaveBeenCalledWith("PH");
    expect(onSaved).toHaveBeenCalledWith(PH);
    expect(api.putOff).not.toHaveBeenCalled();
    expect(document.querySelector(".country-prompt")).toBeNull();
  });

  it("Not now puts it off for good and changes nothing else", async () => {
    open();
    document.querySelector<HTMLButtonElement>(".country-prompt__not-now")!.click();
    await flush();
    expect(api.putOff).toHaveBeenCalledTimes(1);
    expect(api.setCountry).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(document.querySelector(".country-prompt")).toBeNull();
  });

  it("the close button counts as Not now", async () => {
    open();
    document.querySelector<HTMLButtonElement>(".panel__close, [aria-label='Close']")!.click();
    await flush();
    expect(api.putOff).toHaveBeenCalledTimes(1);
  });

  it("stays open, saying so, when the save fails", async () => {
    api.setCountry.mockRejectedValueOnce(new Error("down"));
    open();
    option("Philippines").click();
    await flush();
    expect(document.querySelector(".country-prompt")).not.toBeNull();
    expect(document.body.textContent).toContain(PROMPT_TEXT.failed);
    expect(onSaved).not.toHaveBeenCalled();
  });
});
