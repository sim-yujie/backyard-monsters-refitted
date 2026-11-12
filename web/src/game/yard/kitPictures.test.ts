// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { setClassicLook } from "@/game/classicLook";
import { KIT_PICTURE_VERSION, kitPicture, kitPictureFile, showKitPicture } from "./kitPictures";
import { STARTER_KIT_SUMMARIES } from "./starterKitData";

describe("the Starter Kits' pictures", () => {
  afterEach(() => setClassicLook(false));

  it("names one file per kit and look", () => {
    expect(STARTER_KIT_SUMMARIES.flatMap((kit) => [kitPictureFile(kit.id, false), kitPictureFile(kit.id, true)])).toEqual([
      "kit-regular-modern.webp",
      "kit-regular-classic.webp",
      "kit-mega-modern.webp",
      "kit-mega-classic.webp",
      "kit-ultra-modern.webp",
      "kit-ultra-classic.webp",
    ]);
  });

  it("follows the player's look, with the version that busts the week-long cache", () => {
    expect(kitPicture({ id: 2 })).toBe(`/assets/ui/kits/kit-mega-modern.webp?v=${KIT_PICTURE_VERSION}`);
    setClassicLook(true);
    expect(kitPicture({ id: 2 })).toBe(`/assets/ui/kits/kit-mega-classic.webp?v=${KIT_PICTURE_VERSION}`);
    expect(kitPicture({ id: 2 }, false)).toBe(`/assets/ui/kits/kit-mega-modern.webp?v=${KIT_PICTURE_VERSION}`);
  });

  it("falls back to Flash's thumbnail once when the picture does not load", () => {
    const kit = STARTER_KIT_SUMMARIES[0]!;
    const img = showKitPicture(document.createElement("img"), kit, true);
    expect(img.getAttribute("src")).toBe(kitPicture(kit, true));
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe(kit.thumbnail);
    // A second failure (the thumbnail too) leaves it be, never a loop.
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe(kit.thumbnail);
  });
});
