import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TUNES, tuneUrl } from "./tunes";

/** The game server's public folder, which serves `/assets/...`. */
const serverPublic = fileURLToPath(new URL("../../../../server/public", import.meta.url));

describe("tunes", () => {
  it("every tune file is on the game server", () => {
    for (const file of Object.values(TUNES)) {
      for (const url of [file.url, file.ogg, file.lite?.url, file.lite?.ogg]) {
        if (url) expect(existsSync(serverPublic + url), url).toBe(true);
      }
    }
  });

  it("the yard plays the new yard theme, Ogg first with an MP3 for iPhones", () => {
    expect(tuneUrl(TUNES.yard, true)).toBe("/assets/sounds/music/yard-theme.ogg");
    expect(tuneUrl(TUNES.yard, false)).toBe("/assets/sounds/music/yard-theme.mp3");
  });

  it("the yard tune's lighter copy plays on Medium and Low (`game/quality.ts`)", () => {
    expect(tuneUrl(TUNES.yard, true, true)).toBe("/assets/sounds/music/yard-theme-lite.ogg");
    expect(tuneUrl(TUNES.yard, false, true)).toBe("/assets/sounds/music/yard-theme-lite.mp3");
  });

  it("a tune with no lighter copy plays as it is when one is asked for", () => {
    expect(tuneUrl(TUNES.attack, true, true)).toBe(TUNES.attack.url);
  });

  it("a tune with no Ogg copy plays its MP3 everywhere", () => {
    expect(tuneUrl(TUNES.attack, true)).toBe(TUNES.attack.url);
  });

  it("the Inferno plays Flash's Inferno tunes at Flash's volumes (`SOUNDS.as:122-138`)", () => {
    expect(TUNES.infernoYard).toEqual({ url: "/assets/sounds/infernomusic/Music_IBuild.mp3", volume: 0.6 });
    expect(TUNES.infernoAttack).toEqual({ url: "/assets/sounds/infernomusic/Music_IAttack.mp3", volume: 0.7 });
  });

  it("Flash's yard tune stays on the server in case it has to come back", () => {
    expect(existsSync(`${serverPublic}/assets/sounds/music/Music_Building.mp3`)).toBe(true);
  });
});
