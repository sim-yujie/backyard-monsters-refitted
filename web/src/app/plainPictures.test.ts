import { describe, expect, it } from "vitest";
import { loadTextures } from "pixi.js";
import { usePlainPictures } from "./plainPictures";

/** Beta 8: pictures load as plain `<img>`s, readable through a canvas from the art server. */
describe("usePlainPictures", () => {
  it("makes Pixi's texture loader load <img> pictures, not ImageBitmaps, on the page", () => {
    usePlainPictures();
    expect(loadTextures.config?.preferCreateImageBitmap).toBe(false);
    expect(loadTextures.config?.preferWorkers).toBe(false);
  });

  it("asks for the pictures with CORS, so a canvas can read art from another address", () => {
    usePlainPictures();
    expect(loadTextures.config?.crossOrigin).toBe("anonymous");
  });
});
