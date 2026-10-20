// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { spokenText } from "@/ui/resourceIcon";
import {
  GOLDEN_MUSHROOM_ART,
  GOLDEN_TITLE,
  JACK_O_LANTERN_ART,
  JACK_O_LANTERN_TITLE,
  showGoldenMushroom,
} from "./MushroomReward";

/** The golden mushroom popup (design §5.6): title, picture, the Shiny with its icon, one button. */
describe("showGoldenMushroom", () => {
  it("says what the mushroom was worth and closes on OK", () => {
    const layer = document.createElement("div");
    document.body.append(layer);

    const popup = showGoldenMushroom(layer, 8);

    expect(layer.querySelector(".panel__title")?.textContent).toBe(GOLDEN_TITLE);
    expect(layer.querySelector("img")?.getAttribute("src")).toBe(GOLDEN_MUSHROOM_ART);
    const text = layer.querySelector(".mushroom-reward__text")!;
    expect(spokenText(text)).toMatch(/worth Shiny 8\. Mushrooms grow back every day\./);
    expect(text.querySelector('[data-resource="shiny"]')?.textContent).toBe("8");

    const ok = [...layer.querySelectorAll("button")].find((one) => one.textContent === "OK")!;
    ok.click();
    expect(layer.querySelector(".mushroom-reward")).toBeNull();
    expect(popup.element.isConnected).toBe(false);
  });

  it("at Halloween the golden mushroom is a glowing jack-o'-lantern", () => {
    const layer = document.createElement("div");
    document.body.append(layer);

    const popup = showGoldenMushroom(layer, 3, "halloween");

    expect(layer.querySelector(".panel__title")?.textContent).toBe(JACK_O_LANTERN_TITLE);
    expect(layer.querySelector("img")?.getAttribute("src")).toBe(JACK_O_LANTERN_ART);
    const text = layer.querySelector(".mushroom-reward__text")!;
    expect(spokenText(text)).toMatch(/jack-o'-lantern worth Shiny 3\. Pumpkins grow back every hour/);
    popup.close();
  });
});
