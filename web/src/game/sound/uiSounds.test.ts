// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { EFFECTS, EffectsPlayer, type Effect, type EffectsBackend } from "./EffectsPlayer";
import type { GestureTarget } from "./MusicPlayer";
import { installUiSounds, isCloseButton, UI_SOUND_EFFECT, uiSoundFor, uiSoundsOn, UI_SOUNDS_IN_MODERN } from "./uiSounds";

const undos: (() => void)[] = [];

afterEach(() => {
  for (const undo of undos.splice(0)) undo();
  document.body.innerHTML = "";
});

/** The page, its sounds heard into `played`; made-up clicks count as the player's. */
const page = (html: string, enabled = () => true): Effect[] => {
  document.body.innerHTML = html;
  const played: Effect[] = [];
  undos.push(installUiSounds(document, { play: (effect) => played.push(effect), enabled, trustedOnly: false }));
  return played;
};

const press = (selector: string): void => {
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`no ${selector}`);
  element.click();
};

describe("Flash's UI sounds on the page", () => {
  it("clicks on a button press", () => {
    const played = page('<button id="b">Build</button>');
    press("#b");
    expect(played).toEqual(["click1"]);
  });

  it("clicks on a tab change, once even for a button inside a tab", () => {
    const played = page(
      '<div role="tablist"><div role="tab" id="t1" aria-selected="true">Hatch</div>' +
        '<button role="tab" id="t2"><span id="label">Housing</span></button></div>',
    );
    press("#t1");
    press("#label");
    expect(played).toEqual(["click1", "click1"]);
  });

  it("plays one sound for a press on the icon inside a button inside a clickable card", () => {
    const played = page('<div role="button" id="card"><button id="b"><img id="icon" alt=""></button></div>');
    press("#icon");
    expect(played).toEqual(["click1"]);
  });

  it("plays Flash's close on a window's close button", () => {
    const played = page(
      '<button id="a" aria-label="Close Shop">x</button>' +
        '<button id="b" class="btn mail-toast__close">ok</button>' +
        '<button id="c" class="chat-box__player-close">ok</button>' +
        '<button id="d">×</button>',
    );
    for (const id of ["#a", "#b", "#c", "#d"]) press(id);
    expect(played).toEqual(["close", "close", "close", "close"]);
  });

  it("is silent on a disabled or aria-disabled button, and in a disabled fieldset", () => {
    const played = page(
      '<button id="a" disabled><span id="inner">Buy</span></button>' +
        '<button id="b" aria-disabled="true">Workers</button>' +
        '<fieldset disabled><button id="c">Send</button></fieldset>',
    );
    // A disabled button gets no click from the browser; a click on what is inside it is still dropped.
    document.querySelector("#inner")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    press("#b");
    document.querySelector("#c")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(played).toEqual([]);
  });

  it("plays what data-ui-sound asks for: a locked tile's refusal, or nothing", () => {
    const played = page(
      '<button id="locked" aria-disabled="true" data-ui-sound="error">Freeze</button>' +
        '<div data-ui-sound="none"><button id="quiet">Zoom</button></div>' +
        '<button id="back" data-ui-sound="close">Back</button>',
    );
    press("#locked");
    press("#quiet");
    press("#back");
    expect(played).toEqual(["error1", "close"]);
  });

  it("is silent on what is not pressable: text, the canvas, a text box", () => {
    const played = page('<p id="p">Hello</p><canvas id="c"></canvas><input id="i" type="text">');
    press("#p");
    press("#c");
    press("#i");
    expect(played).toEqual([]);
  });

  it("clicks once for a label's click on its tick box", () => {
    const played = page('<label id="l"><input type="checkbox" id="box"> Show grid</label>');
    press("#l");
    expect(played).toEqual(["click1"]);
  });

  it("is silent while switched off for the look, and after the undo", () => {
    let on = false;
    const played = page('<button id="b">Build</button>', () => on);
    press("#b");
    on = true;
    press("#b");
    undos.pop()!();
    press("#b");
    expect(played).toEqual(["click1"]);
  });

  it("ignores a script's click by default, so a tab opened in code makes no sound", () => {
    document.body.innerHTML = '<button id="b">Build</button>';
    const played: Effect[] = [];
    undos.push(installUiSounds(document, { play: (effect) => played.push(effect), enabled: () => true }));
    press("#b");
    expect(played).toEqual([]);
  });

  it("still clicks when the button's own handler stops the click", () => {
    const played = page('<button id="b">Build</button>');
    document.querySelector("#b")!.addEventListener("click", (event) => event.stopPropagation());
    press("#b");
    expect(played).toEqual(["click1"]);
  });
});

describe("uiSoundFor and the look switch", () => {
  it("knows a close button and nothing else", () => {
    document.body.innerHTML = '<button id="a" title="Close the Map Room"></button><button id="b">Closet</button>';
    expect(isCloseButton(document.querySelector("#a")!)).toBe(true);
    expect(isCloseButton(document.querySelector("#b")!)).toBe(false);
    expect(uiSoundFor(null)).toBeNull();
  });

  it("plays in Classic, and in Modern while the one switch says so", () => {
    expect(uiSoundsOn(true)).toBe(true);
    expect(uiSoundsOn(false)).toBe(UI_SOUNDS_IN_MODERN);
  });

  it("uses Flash's own files", () => {
    expect(EFFECTS[UI_SOUND_EFFECT.click].url).toBe("/assets/sounds/uisounds/sound_click1.mp3");
    expect(EFFECTS[UI_SOUND_EFFECT.close].url).toBe("/assets/sounds/uisounds/sound_close.mp3");
    expect(EFFECTS[UI_SOUND_EFFECT.error].url).toBe("/assets/sounds/uisounds/sound_error1.mp3");
  });
});

/** Web Audio stand-in, already let out, every file decoded at once. */
class OpenCard implements EffectsBackend {
  running = true;
  readonly starts: { sound: unknown; volume: number }[] = [];
  resume(): Promise<void> {
    return Promise.resolve();
  }
  load(url: string): Promise<unknown> {
    return Promise.resolve(url);
  }
  start(sound: unknown, volume: number): void {
    this.starts.push({ sound, volume });
  }
}

const quietPage: GestureTarget = { addEventListener() {}, removeEventListener() {} };

describe("UI sounds through the effects player", () => {
  const setup = async () => {
    const card = new OpenCard();
    let now = 0;
    const player = new EffectsPlayer({ createBackend: () => card, gestures: quietPage, now: () => now });
    player.setEnabled(true);
    player.preload([]);
    await Promise.resolve();
    await Promise.resolve();
    page('<button id="b">Build</button>');
    undos.pop()!();
    undos.push(installUiSounds(document, { play: (effect) => player.play(effect), enabled: () => true, trustedOnly: false }));
    return { card, player, tick: (ms: number) => (now += ms) };
  };

  it("plays the click at Flash's 0.8 times the slider", async () => {
    const { card, player, tick } = await setup();
    player.setVolume(0.5);
    press("#b");
    tick(1000);
    expect(card.starts).toEqual([{ sound: "/assets/sounds/uisounds/sound_click1.mp3", volume: 0.4 }]);
  });

  it("is silent with sound effects off or the slider at 0", async () => {
    const { card, player, tick } = await setup();
    player.setEnabled(false);
    press("#b");
    tick(1000);
    player.setEnabled(true);
    player.setVolume(0);
    press("#b");
    expect(card.starts).toEqual([]);
  });

  it("does not stack a double press into two clicks", async () => {
    const { card, tick } = await setup();
    press("#b");
    tick(10);
    press("#b");
    expect(card.starts).toHaveLength(1);
    tick(1000);
    press("#b");
    expect(card.starts).toHaveLength(2);
  });
});
