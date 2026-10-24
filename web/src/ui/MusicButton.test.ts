// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { loadSoundSwitches, resetSoundSwitchesForTest, soundSwitches } from "@/game/sound/soundSwitches";
import { MusicButton, musicButtonLabel } from "./MusicButton";

describe("MusicButton", () => {
  let button: MusicButton | null = null;

  afterEach(() => {
    button?.destroy();
    button = null;
    resetSoundSwitchesForTest();
  });

  const build = (stored: { music: boolean; effects: boolean }) => {
    const saves: unknown[] = [];
    resetSoundSwitchesForTest({
      account: () => 7,
      fetch: async () => ({ ...stored }),
      save: async (change) => {
        saves.push(change);
        return { ...stored, ...change };
      },
    });
    button = new MusicButton("speaker").mount(document.body);
    return { saves, element: button.element };
  };

  it("waits, greyed, until the switches are known, then shows them", async () => {
    const { element } = build({ music: true, effects: false });
    expect(element.disabled).toBe(true);
    expect(element.dataset["music"]).toBe("unknown");
    await loadSoundSwitches();
    expect(element.disabled).toBe(false);
    expect(element.dataset["music"]).toBe("on");
    expect(element.getAttribute("aria-label")).toBe(musicButtonLabel(true));
    expect(element.querySelector("svg")).not.toBeNull();
  });

  it("one press turns music off, the next back on, effects untouched", async () => {
    const { element, saves } = build({ music: true, effects: false });
    await loadSoundSwitches();
    element.click();
    expect(element.dataset["music"]).toBe("off");
    expect(element.getAttribute("aria-label")).toBe("Music off: press to turn it on");
    await Promise.resolve();
    element.click();
    expect(element.dataset["music"]).toBe("on");
    await Promise.resolve();
    expect(saves).toEqual([{ music: false }, { music: true }]);
    expect(soundSwitches()?.effects).toBe(false);
  });

  it("stops following the switches once destroyed", async () => {
    const { element } = build({ music: true, effects: true });
    button!.destroy();
    button = null;
    await loadSoundSwitches();
    expect(element.isConnected).toBe(false);
    expect(element.dataset["music"]).toBe("unknown");
  });
});
